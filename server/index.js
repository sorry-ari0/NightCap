import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fallbackVenues } from "./fallbackVenues.js";
import { loadState, saveState } from "./store.js";

const app = express();
const port = process.env.PORT || 3001;
const googleKey = process.env.GOOGLE_MAPS_API_KEY;
const requireGoogleMaps = process.env.REQUIRE_GOOGLE_MAPS === "true";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.join(__dirname, "..", "dist");

app.use(express.json({ limit: "1mb" }));

const state = loadState();
const ratings = state.ratings;
const sessions = state.sessions;
const venueCache = state.venueCache;
const venueCacheTtlMs = Number(process.env.VENUE_CACHE_TTL_MS || 1000 * 60 * 60 * 24 * 30);
const supportedCities = ["New York", "San Francisco", "Los Angeles"];

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
  { id: "public-ranking", label: "Public ranking share", requiredInvites: 3 },
  { id: "city-scores", label: "City average scores", requiredInvites: 3 },
  { id: "stealth-mode", label: "Private mode", requiredInvites: 4 }
];

function persist() {
  saveState({
    ratings,
    savedVenueIds: [],
    invites: [],
    sessions,
    venueCache
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
      maxResultCount: 16
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
  const refresh = req.query.refresh === "true";
  const key = venueCacheKey(city, vibe);
  const cached = venueCache[key];
  const now = Date.now();

  if (requireGoogleMaps && !googleKey) {
    return res.status(503).json({
      error: "GOOGLE_MAPS_API_KEY is required for production venue discovery.",
      code: "maps_not_configured"
    });
  }

  if (!refresh && cached?.venues?.length && Date.parse(cached.expiresAt) > now) {
    const venues = cached.venues.map((venue) => withScores(venue, sessionData));
    return res.json({
      source: "google-cache",
      cacheStatus: "hit",
      fallbackReason: null,
      fetchedAt: cached.fetchedAt,
      expiresAt: cached.expiresAt,
      venues,
      map: mapPayload(venues)
    });
  }

  if (googleKey) {
    try {
      const query = [vibe, "bars clubs nightlife", city].filter(Boolean).join(" ");
      const venues = await googleTextSearch(query, city);
      const fetchedAt = new Date().toISOString();
      const expiresAt = new Date(now + venueCacheTtlMs).toISOString();
      venueCache[key] = {
        city,
        vibe,
        source: "google",
        fetchedAt,
        expiresAt,
        venues
      };
      persist();
      const scoredVenues = venues.map((venue) => withScores(venue, sessionData));
      return res.json({
        source: "google",
        cacheStatus: cached ? "refresh" : "miss",
        fallbackReason: null,
        fetchedAt,
        expiresAt,
        venues: scoredVenues,
        map: mapPayload(scoredVenues)
      });
    } catch (error) {
      console.error(error);
      if (requireGoogleMaps) {
        return res.status(502).json({
          error: "Google Places failed while production Maps mode is required.",
          code: "maps_request_failed"
        });
      }
    }
  }

  const normalizedCity = city.toLowerCase();
  const venues = fallbackVenues.filter((venue) => {
    return venue.city.toLowerCase().includes(normalizedCity) || normalizedCity.includes(venue.city.toLowerCase());
  });
  const seedVenues = (venues.length ? venues : fallbackVenues).map((venue) => withScores(venue, sessionData));

  res.json({
    source: "seed",
    cacheStatus: "seed",
    fallbackReason: googleKey ? "Google Places failed, using seed venues." : "GOOGLE_MAPS_API_KEY is not configured.",
    venues: seedVenues,
    map: mapPayload(seedVenues)
  });
});

app.get("/api/cities", (req, res) => {
  const cachedCities = Object.values(venueCache)
    .map((entry) => entry.city)
    .filter(Boolean);
  res.json({
    cities: Array.from(new Set([...supportedCities, ...cachedCities])),
    launchOrder: supportedCities,
    cacheTtlDays: Math.round(venueCacheTtlMs / (1000 * 60 * 60 * 24))
  });
});

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    mapsConfigured: Boolean(googleKey),
    mapsRequired: requireGoogleMaps,
    storage: "local-json",
    venueCacheEntries: Object.keys(venueCache).length
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
    venueName: String(req.body.venueName || req.body.venueId).trim().slice(0, 120),
    venueAddress: String(req.body.venueAddress || "").trim().slice(0, 180),
    venueCity: String(req.body.venueCity || "").trim().slice(0, 80),
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
      status: "credited",
      joinedAt: new Date().toISOString(),
      creditedAt: new Date().toISOString(),
      createdAt: new Date().toISOString()
    });
    persist();
  }

  res.status(201).json(progressPayload(sessionId, sessionData));
});

app.post("/api/invites/:inviteId/accept", (req, res) => {
  const invite = Object.values(sessions)
    .flatMap((sessionData) => sessionData.invites || [])
    .find((item) => item.id === req.params.inviteId);

  if (!invite) return res.status(404).json({ error: "invite not found" });

  invite.status = "credited";
  invite.joinedAt = invite.joinedAt || new Date().toISOString();
  invite.creditedAt = invite.creditedAt || new Date().toISOString();
  persist();
  res.json({ invite });
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
      reason: reasonForVenue(venue, priorities, sessionData.invites.length)
    }))
  });
});

app.get("/api/rankings/me", (req, res) => {
  const { id: sessionId, data: sessionData } = getSession(req);
  res.json(rankingPayload(sessionId, sessionData));
});

app.post("/api/rankings/publish", (req, res) => {
  const { id: sessionId, data: sessionData } = getSession(req);
  const successfulInvites = successfulInviteCount(sessionData);

  if (successfulInvites < 3) {
    return res.status(403).json({
      error: `Invite ${3 - successfulInvites} more friend${3 - successfulInvites === 1 ? "" : "s"} to publish your ranking.`,
      ranking: rankingPayload(sessionId, sessionData)
    });
  }

  sessionData.publicRanking ??= {};
  sessionData.publicRanking.publishedAt = sessionData.publicRanking.publishedAt || new Date().toISOString();
  sessionData.publicRanking.slug = sessionData.publicRanking.slug || `nightcap-${sessionId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 16)}`;
  persist();

  res.json(rankingPayload(sessionId, sessionData));
});

app.get("/api/u/:handle/rankings/:slug", (req, res) => {
  const match = Object.entries(sessions).find(([, sessionData]) => {
    return sessionData.publicRanking?.slug === req.params.slug && sessionData.publicRanking?.publishedAt;
  });

  if (!match) return res.status(404).json({ error: "public ranking not found" });

  const [sessionId, sessionData] = match;
  res.json({
    handle: req.params.handle,
    ...rankingPayload(sessionId, sessionData)
  });
});

app.post("/api/share-cards", (req, res) => {
  const { id: sessionId, data: sessionData } = getSession(req);
  const ranking = rankingPayload(sessionId, sessionData);
  if (!ranking.published) {
    return res.status(403).json({
      error: "Publish your ranking before generating a share card.",
      ranking
    });
  }

  res.status(201).json({
    shareCard: shareCardPayload(ranking)
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

function venueCacheKey(city, vibe) {
  return [city || "New York", vibe || "all"]
    .map((part) => String(part).toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""))
    .join("::");
}

function mapPayload(venues) {
  const points = venues
    .map((venue) => ({
      id: venue.id,
      name: venue.name,
      city: venue.city,
      lat: optionalNumber(venue.location?.lat),
      lng: optionalNumber(venue.location?.lng),
      score: venue.overallScore ?? venue.googleRating ?? null,
      source: venue.source,
      photoUrl: venue.photoUrl || null
    }))
    .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));

  if (!points.length) {
    return { points: [], bounds: null };
  }

  const lats = points.map((point) => point.lat);
  const lngs = points.map((point) => point.lng);
  const latPad = Math.max(0.002, (Math.max(...lats) - Math.min(...lats)) * 0.18);
  const lngPad = Math.max(0.002, (Math.max(...lngs) - Math.min(...lngs)) * 0.18);

  return {
    points,
    bounds: {
      north: Math.max(...lats) + latPad,
      south: Math.min(...lats) - latPad,
      east: Math.max(...lngs) + lngPad,
      west: Math.min(...lngs) - lngPad
    }
  };
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

function reasonForVenue(venue, priorities, inviteCount) {
  const readable = priorities.length ? priorities.join(", ") : "overall fit";
  const remainingInvites = Math.max(0, 2 - inviteCount);
  const unlockNote = remainingInvites === 0
    ? " Group planning is unlocked."
    : ` Invite ${remainingInvites} more friend${remainingInvites === 1 ? "" : "s"} to unlock group planning.`;
  if (venue.ratingCount) return `Strong ${readable} signal from ${venue.ratingCount} rating${venue.ratingCount === 1 ? "" : "s"}.${unlockNote}`;
  if (venue.googleRating) return `Good Maps baseline (${venue.googleRating}) while the local rating graph fills in.`;
  return "Included as a seed spot so the planner works before map data is connected.";
}

function progressPayload(sessionId, sessionData) {
  const inviteCount = successfulInviteCount(sessionData);
  return {
    sessionId,
    inviteCount,
    sentInviteCount: sessionData.invites.length,
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

function rankingPayload(sessionId, sessionData) {
  const successfulInvites = successfulInviteCount(sessionData);
  const topVenues = ratings
    .filter((rating) => rating.sessionId === sessionId)
    .reduce((acc, rating) => {
      const key = rating.canonicalVenueKey || rating.venueId;
      const existing = acc.get(key);
      if (!existing || rating.overallScore > existing.overallScore) {
        acc.set(key, {
          venueId: rating.venueId,
          canonicalVenueKey: rating.canonicalVenueKey,
          name: rating.venueName || rating.venueId,
          address: rating.venueAddress,
          city: rating.venueCity,
          overallScore: rating.overallScore,
          comment: rating.comment,
          ratedAt: rating.createdAt
        });
      }
      return acc;
    }, new Map());

  const ranking = Array.from(topVenues.values())
    .sort((a, b) => b.overallScore - a.overallScore)
    .slice(0, 10);
  const published = Boolean(sessionData.publicRanking?.publishedAt);
  const slug = sessionData.publicRanking?.slug || null;

  return {
    published,
    publishedAt: sessionData.publicRanking?.publishedAt || null,
    slug,
    handle: "demo",
    shareUrl: published && slug ? `/u/demo/rankings/${slug}` : null,
    shareText: ranking.length
      ? `My NightCap nightlife ranking: ${ranking.slice(0, 3).map((venue, index) => `${index + 1}. ${venue.name}`).join(" / ")}`
      : "I’m building my NightCap nightlife ranking.",
    inviteGate: {
      required: 3,
      successfulInvites,
      remaining: Math.max(0, 3 - successfulInvites),
      unlocked: successfulInvites >= 3
    },
    ranking
  };
}

function successfulInviteCount(sessionData) {
  return (sessionData.invites || []).filter((invite) => {
    return !invite.status || invite.status === "credited";
  }).length;
}

function shareCardPayload(ranking) {
  const top = ranking.ranking.slice(0, 3);
  const title = top.length ? "My NightCap Top 3" : "My NightCap Ranking";
  const lines = top.length
    ? top.map((venue, index) => `${index + 1}. ${venue.name} - ${venue.overallScore}/10`)
    : ["Building my nightlife ranking"];
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">`,
    `<rect width="1200" height="630" fill="#101010"/>`,
    `<rect x="56" y="56" width="1088" height="518" rx="28" fill="#f8f1e7"/>`,
    `<text x="96" y="136" font-family="Arial, sans-serif" font-size="34" font-weight="700" fill="#101010">NightCap</text>`,
    `<text x="96" y="210" font-family="Arial, sans-serif" font-size="70" font-weight="800" fill="#101010">${escapeSvg(title)}</text>`,
    ...lines.map((line, index) => `<text x="104" y="${300 + index * 74}" font-family="Arial, sans-serif" font-size="42" font-weight="700" fill="#101010">${escapeSvg(line)}</text>`),
    `<text x="96" y="540" font-family="Arial, sans-serif" font-size="28" fill="#444">Unlock yours with 3 friends at NightCap</text>`,
    `</svg>`
  ].join("");

  return {
    format: "svg",
    width: 1200,
    height: 630,
    svg,
    dataUrl: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
    shareText: ranking.shareText,
    shareUrl: ranking.shareUrl
  };
}

function escapeSvg(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
    for (const key of Object.keys(venueCache)) delete venueCache[key];
    persist();
    res.json({ ok: true });
  });
}

app.listen(port, () => {
  console.log(`Planner API running on http://localhost:${port}`);
});
