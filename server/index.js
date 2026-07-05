import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fallbackVenues } from "./fallbackVenues.js";
import { loadState, saveState } from "./store.js";

const app = express();
const port = process.env.PORT || 3001;
const googleKey = process.env.GOOGLE_MAPS_API_KEY;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.join(__dirname, "..", "dist");

app.use(express.json({ limit: "1mb" }));

const state = loadState();
const ratings = state.ratings;
const sessions = state.sessions;

function getSession(req) {
  const rawSessionId = String(req.get("x-nightcap-session") || "demo").trim();
  const sessionId = rawSessionId.slice(0, 80) || "demo";
  sessions[sessionId] ??= { savedVenueIds: [], invites: [] };
  return {
    id: sessionId,
    data: sessions[sessionId]
  };
}

const unlocks = [
  { id: "friend-match", label: "Friend match scores", requiredInvites: 1 },
  { id: "group-planner", label: "Group planner", requiredInvites: 2 },
  { id: "city-scores", label: "City average scores", requiredInvites: 3 },
  { id: "stealth-mode", label: "Private mode", requiredInvites: 4 }
];

function persist() {
  saveState({
    ratings,
    savedVenueIds: [],
    invites: [],
    sessions
  });
}

function toVenue(place, city) {
  const photoName = place.photos?.[0]?.name;
  const name = place.displayName?.text ?? "Unknown venue";
  return {
    id: `google-${place.id}`,
    canonicalVenueKey: canonicalVenueKey(name, city),
    googlePlaceId: place.id,
    name,
    address: place.formattedAddress ?? place.shortFormattedAddress ?? "",
    neighborhood: "",
    city,
    types: place.types ?? [],
    location: {
      lat: place.location?.latitude,
      lng: place.location?.longitude
    },
    googleRating: place.rating ?? null,
    userRatingCount: place.userRatingCount ?? null,
    priceLevel: place.priceLevel ?? null,
    openNow: place.regularOpeningHours?.openNow ?? null,
    source: "google",
    photoUrl: photoName && googleKey
      ? `/api/google-photo?name=${encodeURIComponent(photoName)}`
      : null
  };
}

function venueRatings(venueId) {
  return ratings.filter((rating) => rating.venueId === venueId || rating.canonicalVenueKey === venueId);
}

function average(values) {
  const nums = values.filter((value) => Number.isFinite(value));
  if (!nums.length) return null;
  return Math.round((nums.reduce((sum, value) => sum + value, 0) / nums.length) * 10) / 10;
}

function withScores(venue, sessionData) {
  const canonicalKey = venue.canonicalVenueKey || canonicalVenueKey(venue.name, venue.city);
  const venueSpecificRatings = [
    ...venueRatings(venue.id),
    ...ratings.filter((rating) => rating.canonicalVenueKey === canonicalKey)
  ].filter((rating, index, all) => all.findIndex((item) => item.id === rating.id) === index);
  const categoryScores = {
    vibes: average(venueSpecificRatings.map((rating) => rating.vibesScore)),
    drinks: average(venueSpecificRatings.map((rating) => rating.drinksScore)),
    people: average(venueSpecificRatings.map((rating) => rating.peopleScore)),
    aesthetics: average(venueSpecificRatings.map((rating) => rating.aestheticsScore)),
    music: average(venueSpecificRatings.map((rating) => rating.musicScore)),
    value: average(venueSpecificRatings.map((rating) => rating.valueScore))
  };

  return {
    ...venue,
    canonicalVenueKey: canonicalKey,
    saved: sessionData.savedVenueIds.includes(venue.id),
    overallScore: average(venueSpecificRatings.map((rating) => rating.overallScore)),
    ratingCount: venueSpecificRatings.length,
    categoryScores,
    recentComments: venueSpecificRatings
      .filter((rating) => rating.comment?.trim())
      .slice(-3)
      .reverse()
      .map((rating) => ({
        comment: rating.comment,
        overallScore: rating.overallScore,
        createdAt: rating.createdAt
      }))
  };
}

async function googleTextSearch(query, city) {
  const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": googleKey,
      "X-Goog-FieldMask": [
        "places.id",
        "places.displayName",
        "places.formattedAddress",
        "places.shortFormattedAddress",
        "places.location",
        "places.types",
        "places.rating",
        "places.userRatingCount",
        "places.priceLevel",
        "places.regularOpeningHours",
        "places.photos"
      ].join(",")
    },
    body: JSON.stringify({
      textQuery: query,
      includedType: "bar",
      maxResultCount: 12
    })
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Google Places request failed: ${response.status} ${message}`);
  }

  const data = await response.json();
  return (data.places ?? []).map((place) => toVenue(place, city));
}

app.get("/api/venues", async (req, res) => {
  const { data: sessionData } = getSession(req);
  const city = String(req.query.city || "New York").trim();
  const vibe = String(req.query.vibe || "").trim();

  if (googleKey) {
    try {
      const query = [vibe, "bars clubs nightlife", city].filter(Boolean).join(" ");
      const venues = await googleTextSearch(query, city);
      return res.json({ source: "google", fallbackReason: null, venues: venues.map((venue) => withScores(venue, sessionData)) });
    } catch (error) {
      console.error(error);
    }
  }

  const normalizedCity = city.toLowerCase();
  const venues = fallbackVenues.filter((venue) => {
    return venue.city.toLowerCase().includes(normalizedCity) || normalizedCity.includes(venue.city.toLowerCase());
  });

  res.json({
    source: "seed",
    fallbackReason: googleKey ? "Google Places failed, using seed venues." : "GOOGLE_MAPS_API_KEY is not configured.",
    venues: (venues.length ? venues : fallbackVenues).map((venue) => withScores(venue, sessionData))
  });
});

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    mapsConfigured: Boolean(googleKey),
    storage: "local-json"
  });
});

app.get("/api/google-photo", async (req, res) => {
  if (!googleKey || !req.query.name) {
    return res.status(404).send("Photo unavailable");
  }

  const url = `https://places.googleapis.com/v1/${req.query.name}/media?maxWidthPx=1200&key=${googleKey}`;
  const response = await fetch(url, { redirect: "manual" });
  const location = response.headers.get("location");

  if (location) return res.redirect(location);
  res.status(response.status).send("Photo unavailable");
});

app.post("/api/ratings", (req, res) => {
  const { id: sessionId } = getSession(req);
  const overallScore = scoreValue(req.body.overallScore);
  const optionalScores = {
    vibesScore: scoreValue(req.body.vibesScore, true),
    drinksScore: scoreValue(req.body.drinksScore, true),
    peopleScore: scoreValue(req.body.peopleScore, true),
    aestheticsScore: scoreValue(req.body.aestheticsScore, true),
    musicScore: scoreValue(req.body.musicScore, true),
    valueScore: scoreValue(req.body.valueScore, true)
  };
  if (!req.body.venueId || overallScore === null) {
    return res.status(400).json({ error: "venueId and overallScore from 1 to 10 are required" });
  }

  const invalidOptionalScore = Object.entries(optionalScores).some(([key, value]) => {
    return req.body[key] !== undefined && req.body[key] !== null && req.body[key] !== "" && value === null;
  });

  if (invalidOptionalScore) {
    return res.status(400).json({ error: "category scores must be from 1 to 10" });
  }

  const rating = {
    id: `rating-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    sessionId,
    venueId: String(req.body.venueId).slice(0, 140),
    canonicalVenueKey: String(req.body.canonicalVenueKey || "").slice(0, 180),
    overallScore,
    ...optionalScores,
    comment: String(req.body.comment || "").trim().slice(0, 500),
    createdAt: new Date().toISOString()
  };

  ratings.push(rating);
  persist();
  res.status(201).json({ rating });
});

app.post("/api/saved-venues", (req, res) => {
  const { data: sessionData } = getSession(req);
  if (!req.body.venueId) return res.status(400).json({ error: "venueId is required" });
  const venueId = String(req.body.venueId).slice(0, 140);
  if (sessionData.savedVenueIds.includes(venueId)) {
    sessionData.savedVenueIds = sessionData.savedVenueIds.filter((id) => id !== venueId);
  } else {
    sessionData.savedVenueIds.push(venueId);
  }
  persist();
  res.status(201).json({ savedVenueIds: sessionData.savedVenueIds });
});

app.delete("/api/saved-venues/:venueId", (req, res) => {
  const { data: sessionData } = getSession(req);
  sessionData.savedVenueIds = sessionData.savedVenueIds.filter((id) => id !== req.params.venueId);
  persist();
  res.json({ savedVenueIds: sessionData.savedVenueIds });
});

app.get("/api/progress", (req, res) => {
  const { id: sessionId, data: sessionData } = getSession(req);
  res.json(progressPayload(sessionId, sessionData));
});

app.post("/api/invites", (req, res) => {
  const { id: sessionId, data: sessionData } = getSession(req);
  const contact = String(req.body.contact || "").trim().slice(0, 120);
  if (!contact || !isValidInviteContact(contact)) return res.status(400).json({ error: "valid phone or email is required" });

  const normalized = contact.toLowerCase();
  const existing = sessionData.invites.find((invite) => invite.normalized === normalized);
  if (!existing) {
    sessionData.invites.push({
      id: `invite-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      contact,
      normalized,
      createdAt: new Date().toISOString()
    });
    persist();
  }

  res.status(201).json(progressPayload(sessionId, sessionData));
});

app.post("/api/plans", (req, res) => {
  const { id: sessionId, data: sessionData } = getSession(req);
  if (!Array.isArray(req.body.venues)) return res.status(400).json({ error: "venues must be an array" });
  const venues = req.body.venues;
  const groupSize = Number(req.body.groupSize || 2);
  const validPriorities = ["vibes", "drinks", "people", "aesthetics", "music", "value"];
  const priorities = Array.isArray(req.body.priorities)
    ? req.body.priorities.filter((priority) => validPriorities.includes(priority))
    : [];
  const hasGroupPlanner = sessionData.invites.length >= 2;

  if (!Number.isFinite(groupSize) || groupSize < 1 || groupSize > 12) {
    return res.status(400).json({ error: "groupSize must be between 1 and 12" });
  }

  if (groupSize > 1 && !hasGroupPlanner) {
    return res.status(403).json({
      error: "Invite two friends to unlock group planning.",
      lockedFeatures: { groupPlanner: true },
      progress: progressPayload(sessionId, sessionData)
    });
  }

  const ranked = venues
    .map((venue) => {
      const score = plannerScore(venue, priorities, groupSize);
      return { ...venue, plannerScore: score };
    })
    .sort((a, b) => b.plannerScore - a.plannerScore)
    .slice(0, 3);

  res.json({
    lockedFeatures: {
      groupPlanner: !hasGroupPlanner
    },
    plan: ranked.map((venue, index) => ({
      stop: index + 1,
      venue,
      role: index === 0 ? "Start here" : index === 1 ? "Main move" : "Late-night backup",
      reason: reasonForVenue(venue, priorities, hasGroupPlanner)
    }))
  });
});

app.use(express.static(distPath));

app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(distPath, "index.html"));
});

function optionalNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function scoreValue(value, optional = false) {
  if ((value === undefined || value === null || value === "") && optional) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 1 || number > 10) return null;
  return Math.round(number * 10) / 10;
}

function plannerScore(venue, priorities, groupSize) {
  const categoryScores = venue.categoryScores ?? {};
  const selected = priorities.map((priority) => categoryScores[priority]).filter(Number.isFinite);
  const categoryAverage = selected.length ? average(selected) : 7;
  const socialBoost = venue.ratingCount ? Math.min(1.2, venue.ratingCount * 0.2) : 0;
  const savedBoost = venue.saved ? 0.4 : 0;
  const groupPenalty = groupSize >= 6 && venue.types?.includes("night_club") ? 0.2 : 0;
  return Math.round(((venue.overallScore ?? categoryAverage ?? 7) + categoryAverage + socialBoost + savedBoost - groupPenalty) * 10) / 10;
}

function reasonForVenue(venue, priorities, hasGroupPlanner) {
  const readable = priorities.length ? priorities.join(", ") : "overall fit";
  const unlockNote = hasGroupPlanner ? " Group planning is unlocked." : " Invite one more friend to unlock group planning.";
  if (venue.ratingCount) return `Strong ${readable} signal from ${venue.ratingCount} rating${venue.ratingCount === 1 ? "" : "s"}.${unlockNote}`;
  if (venue.googleRating) return `Good Maps baseline (${venue.googleRating}) while the local rating graph fills in.`;
  return "Included as a seed spot so the planner works before map data is connected.";
}

function progressPayload(sessionId, sessionData) {
  const inviteCount = sessionData.invites.length;
  return {
    sessionId,
    inviteCount,
    ratingCount: ratings.filter((rating) => rating.sessionId === sessionId).length,
    savedCount: sessionData.savedVenueIds.length,
    unlocks: unlocks.map((unlock) => ({
      ...unlock,
      unlocked: inviteCount >= unlock.requiredInvites,
      remaining: Math.max(0, unlock.requiredInvites - inviteCount)
    })),
    recentInvites: sessionData.invites.slice(-4).reverse()
  };
}

function isValidInviteContact(contact) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact) || /^\+?[0-9().\-\s]{7,}$/.test(contact);
}

function canonicalVenueKey(name, city) {
  return `${name}-${city}`
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

if (process.env.NODE_ENV === "test") {
  app.post("/api/test/reset", (req, res) => {
    ratings.splice(0, ratings.length);
    for (const key of Object.keys(sessions)) delete sessions[key];
    persist();
    res.json({ ok: true });
  });
}

app.listen(port, () => {
  console.log(`Planner API running on http://localhost:${port}`);
});
