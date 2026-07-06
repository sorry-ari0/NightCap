import express from "express";
import crypto from "node:crypto";
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

app.use(express.json({ limit: "4mb" }));

const state = loadState();
const ratings = state.ratings;
const sessions = state.sessions;
const venueCache = state.venueCache;
const memberDirectory = state.memberDirectory;
const feedback = state.feedback;
const posts = state.posts;
const venueCacheTtlMs = Number(process.env.VENUE_CACHE_TTL_MS || 1000 * 60 * 60 * 24 * 30);
const nycVenueTargetCount = Number(process.env.NYC_VENUE_TARGET_COUNT || 1000);
const googleSearchConcurrency = Number(process.env.GOOGLE_SEARCH_CONCURRENCY || 6);
const supportedCities = ["New York", "San Francisco", "Los Angeles"];
const seedMembers = [
  {
    id: "seed-member-maya",
    name: "Maya Chen",
    contacts: ["maya@example.com", "+14155550131"],
    contactGraph: ["alex@example.com", "jordan@example.com", "+14155550141", "sofia@example.com"]
  },
  {
    id: "seed-member-jordan",
    name: "Jordan Lee",
    contacts: ["jordan@example.com", "+12125550144"],
    contactGraph: ["maya@example.com", "alex@example.com", "nina@example.com", "+12125550191"]
  },
  {
    id: "seed-member-sofia",
    name: "Sofia Rivera",
    contacts: ["sofia@example.com", "+13105550119"],
    contactGraph: ["maya@example.com", "nina@example.com", "cam@example.com", "+13105550122"]
  }
];

const passwordResetTtlMs = 1000 * 60 * 20;

function getSession(req) {
  const rawSessionId = String(req.get("x-nightcap-session") || "demo").trim();
  const sessionId = rawSessionId.slice(0, 80) || "demo";
  sessions[sessionId] ??= { savedVenueIds: [], invites: [] };
  sessions[sessionId].savedVenueIds ??= [];
  sessions[sessionId].invites ??= [];
  sessions[sessionId].contacts ??= [];
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
    venueCache,
    memberDirectory,
    feedback,
    posts
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
    websiteUrl: place.websiteUri ?? null,
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

async function googleTextSearch(query, city, options = {}) {
  const locationBias = Number.isFinite(options.lat) && Number.isFinite(options.lng)
    ? {
      circle: {
        center: {
          latitude: options.lat,
          longitude: options.lng
        },
        radius: options.radiusMeters || 5000
      }
    }
    : undefined;
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
        "places.websiteUri",
        "places.photos"
      ].join(",")
    },
    body: JSON.stringify({
      textQuery: query,
      maxResultCount: 20,
      ...(locationBias ? { locationBias } : {})
    })
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Google Places request failed: ${response.status} ${message}`);
  }

  const data = await response.json();
  return (data.places ?? []).map((place) => toVenue(place, city));
}

async function googleVenueSearches({ city, vibe, isNearby, lat, lng, radiusMeters, targetCount }) {
  const venueCity = isNearby ? "Near me" : city;
  const baseQuery = [vibe, "bars clubs nightlife", isNearby ? "near me" : city].filter(Boolean).join(" ");
  const normalizedCity = city.toLowerCase();
  const queries = normalizedCity.includes("new york") && !isNearby
    ? nycVenueQueries(vibe, targetCount)
    : [baseQuery];

  const seen = new Set();
  const venues = [];
  const concurrency = Math.max(1, Math.min(10, googleSearchConcurrency));
  for (let index = 0; index < queries.length && venues.length < targetCount; index += concurrency) {
    const batch = queries.slice(index, index + concurrency);
    const batchResults = await Promise.all(batch.map(async (query) => {
      try {
        return await googleTextSearch(query, venueCity, { lat, lng, radiusMeters });
      } catch (error) {
        console.error(`Google Places query failed for "${query}"`, error);
        return [];
      }
    }));

    for (const results of batchResults) {
      for (const venue of results) {
        const key = venue.googlePlaceId || venue.canonicalVenueKey || venue.id;
        if (seen.has(key)) continue;
        seen.add(key);
        venues.push(venue);
        if (venues.length >= targetCount) break;
      }
      if (venues.length >= targetCount) break;
    }
  }

  if (!venues.length) {
    throw new Error("Google Places returned no venues");
  }

  return venues;
}

function nycVenueQueries(vibe, targetCount) {
  const neighborhoods = [
    "Lower East Side", "East Village", "West Village", "Greenwich Village", "SoHo", "NoHo",
    "Nolita", "Chinatown", "Tribeca", "Financial District", "Seaport", "Flatiron",
    "Chelsea", "Meatpacking District", "Hell's Kitchen", "Midtown Manhattan", "Times Square",
    "Upper East Side", "Upper West Side", "Harlem", "Washington Heights", "Williamsburg",
    "Greenpoint", "Bushwick", "Bedford-Stuyvesant", "Crown Heights", "Fort Greene",
    "Clinton Hill", "Downtown Brooklyn", "DUMBO", "Gowanus", "Park Slope", "Red Hook",
    "Carroll Gardens", "Boerum Hill", "Cobble Hill", "Long Island City", "Astoria",
    "Sunnyside", "Ridgewood", "Flushing", "Jackson Heights", "Forest Hills", "Jersey City",
    "Hoboken"
  ];
  const categories = [
    vibe || "nightlife",
    "cocktail bars",
    "neighborhood bars",
    "wine bars",
    "beer bars",
    "dive bars",
    "speakeasies",
    "hotel bars",
    "rooftop bars",
    "lounges",
    "nightclubs",
    "dance clubs",
    "music venues",
    "jazz bars",
    "karaoke bars",
    "sports bars",
    "gay bars",
    "Latin clubs",
    "sake bars",
    "listening bars",
    "pubs",
    "tiki bars",
    "comedy clubs with bars",
    "late night bars"
  ];
  const citywide = [
    "best bars New York City",
    "best nightlife New York City",
    "best cocktail bars New York City",
    "best clubs New York City",
    "best rooftop bars New York City",
    "best lounges New York City",
    "best speakeasies New York City",
    "best bars Brooklyn",
    "best nightlife Brooklyn",
    "best bars Queens",
    "best nightlife Queens",
    "best bars Manhattan",
    "best nightlife Manhattan"
  ];
  const queries = [...citywide];

  for (const neighborhood of neighborhoods) {
    for (const category of categories) {
      queries.push(`${category} ${neighborhood} New York`);
    }
  }

  const minimumQueries = Math.ceil((targetCount || nycVenueTargetCount) / 12);
  return Array.from(new Set(queries)).slice(0, Math.max(minimumQueries, 360));
}

app.get("/api/venues", async (req, res) => {
  const { data: sessionData } = getSession(req);
  const city = String(req.query.city || "New York").trim();
  const vibe = String(req.query.vibe || "").trim();
  const lat = optionalNumber(req.query.lat);
  const lng = optionalNumber(req.query.lng);
  const radiusMeters = Math.min(20000, Math.max(1000, optionalNumber(req.query.radiusMeters) || 5000));
  const isNearby = Number.isFinite(lat) && Number.isFinite(lng);
  const targetCount = city.toLowerCase().includes("new york") && !isNearby ? nycVenueTargetCount : 20;
  const refresh = req.query.refresh === "true";
  const key = venueCacheKey(city, vibe, isNearby ? { lat, lng, radiusMeters } : null);
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
      const venueCity = isNearby ? "Near me" : city;
      const venues = await googleVenueSearches({ city, vibe, isNearby, lat, lng, radiusMeters, targetCount });
      const fetchedAt = new Date().toISOString();
      const expiresAt = new Date(now + venueCacheTtlMs).toISOString();
      venueCache[key] = {
        city: venueCity,
        vibe,
        location: isNearby ? { lat, lng, radiusMeters } : null,
        source: "google",
        targetCount,
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

  const normalizedCity = (isNearby ? city : city).toLowerCase();
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

app.get("/favicon.ico", (req, res) => {
  res.status(204).end();
});

app.get("/api/google-photo", async (req, res) => {
  if (!googleKey || !req.query.name) {
    return res.status(404).send("Photo unavailable");
  }

  const width = Math.min(720, Math.max(240, optionalNumber(req.query.width) || 520));
  const url = `https://places.googleapis.com/v1/${req.query.name}/media?maxWidthPx=${width}&key=${googleKey}`;
  const response = await fetch(url, { redirect: "manual" });
  const location = response.headers.get("location");

  if (location) return res.redirect(location);
  res.status(response.status).send("Photo unavailable");
});

app.post("/api/ratings", (req, res) => {
  const { id: sessionId, data: sessionData } = getSession(req);
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
  const post = postFromRating(rating, sessionData);
  posts.push(post);
  persist();
  res.status(201).json({ rating, post });
});

app.get("/api/posts", (req, res) => {
  res.json({
    posts: posts
      .filter((post) => post.published)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, 100)
      .map(publicPost)
  });
});

app.post("/api/posts/:postId/likes", (req, res) => {
  const { id: sessionId } = getSession(req);
  const post = posts.find((item) => item.id === req.params.postId);
  if (!post || !post.published) return res.status(404).json({ error: "post not found" });
  post.likes ??= [];
  if (!post.likes.includes(sessionId)) post.likes.push(sessionId);
  persist();
  res.status(201).json({ post: publicPost(post) });
});

app.get("/api/people/search", (req, res) => {
  const { id: sessionId, data: sessionData } = getSession(req);
  const successfulInvites = successfulInviteCount(sessionData);
  if (successfulInvites < 3) {
    return res.status(403).json({
      error: `Invite ${3 - successfulInvites} more friend${3 - successfulInvites === 1 ? "" : "s"} to unlock people search.`,
      inviteGate: inviteGatePayload(successfulInvites)
    });
  }

  const query = String(req.query.q || "").trim().toLowerCase();
  const people = topPeoplePayload(query);
  res.json({ people, inviteGate: inviteGatePayload(successfulInvites) });
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

app.get("/api/profile", (req, res) => {
  const { id: sessionId, data: sessionData } = getSession(req);
  res.json(profilePayload(sessionId, sessionData));
});

app.post("/api/profile", (req, res) => {
  const { id: sessionId, data: sessionData } = getSession(req);
  const name = String(req.body.name || "").trim().slice(0, 80);
  const email = String(req.body.email || "").trim().slice(0, 120);
  const phone = String(req.body.phone || "").trim().slice(0, 40);
  const password = String(req.body.password || "");
  const profilePhoto = sanitizeProfilePhoto(req.body.profilePhoto);

  if (!name) return res.status(400).json({ error: "name is required" });
  if (email && !isValidInviteContact(email)) return res.status(400).json({ error: "valid email is required" });
  if (phone && !isValidInviteContact(phone)) return res.status(400).json({ error: "valid phone number is required" });
  if (!email && !phone) return res.status(400).json({ error: "email or phone is required" });
  if (!sessionData.profile && password.length < 8) return res.status(400).json({ error: "password must be at least 8 characters" });
  if (password && password.length < 8) return res.status(400).json({ error: "password must be at least 8 characters" });

  sessionData.profile = {
    id: sessionData.profile?.id || `user-${sessionId}`,
    name,
    email,
    phone,
    normalizedEmail: email ? normalizeContact(email) : "",
    normalizedPhone: phone ? normalizeContact(phone) : "",
    profilePhoto: profilePhoto ?? sessionData.profile?.profilePhoto ?? "",
    passwordHash: password ? hashPassword(password) : sessionData.profile?.passwordHash,
    passwordUpdatedAt: password ? new Date().toISOString() : sessionData.profile?.passwordUpdatedAt,
    createdAt: sessionData.profile?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  persist();
  res.status(201).json(profilePayload(sessionId, sessionData));
});

app.post("/api/profile/photo", (req, res) => {
  const { id: sessionId, data: sessionData } = getSession(req);
  if (!sessionData.profile) return res.status(400).json({ error: "sign up before adding a profile picture" });
  const profilePhoto = sanitizeProfilePhoto(req.body.profilePhoto);
  if (!profilePhoto) return res.status(400).json({ error: "valid image is required" });
  sessionData.profile.profilePhoto = profilePhoto;
  sessionData.profile.updatedAt = new Date().toISOString();
  persist();
  res.json(profilePayload(sessionId, sessionData));
});

app.post("/api/password/reset-request", (req, res) => {
  const { data: sessionData } = getSession(req);
  const contact = String(req.body.contact || "").trim().slice(0, 120);
  if (!contact || !isValidInviteContact(contact)) return res.status(400).json({ error: "valid email or phone is required" });

  const normalized = normalizeContact(contact);
  const match = findSessionByContact(normalized);
  const targetSessionData = match?.data || sessionData;
  if (!targetSessionData.profile) return res.status(404).json({ error: "no account found for that contact" });

  const resetToken = crypto.randomBytes(18).toString("hex");
  targetSessionData.passwordReset = {
    token: resetToken,
    contact: normalized,
    expiresAt: new Date(Date.now() + passwordResetTtlMs).toISOString(),
    createdAt: new Date().toISOString()
  };
  persist();
  res.status(201).json({
    ok: true,
    expiresAt: targetSessionData.passwordReset.expiresAt,
    resetToken: process.env.NODE_ENV === "production" ? undefined : resetToken
  });
});

app.post("/api/password/reset", (req, res) => {
  const token = String(req.body.token || "").trim();
  const password = String(req.body.password || "");
  if (!token) return res.status(400).json({ error: "reset token is required" });
  if (password.length < 8) return res.status(400).json({ error: "password must be at least 8 characters" });

  const match = Object.entries(sessions).find(([, sessionData]) => {
    return sessionData.passwordReset?.token === token && Date.parse(sessionData.passwordReset.expiresAt) > Date.now();
  });
  if (!match) return res.status(400).json({ error: "reset link is invalid or expired" });

  const [, sessionData] = match;
  sessionData.profile.passwordHash = hashPassword(password);
  sessionData.profile.passwordUpdatedAt = new Date().toISOString();
  delete sessionData.passwordReset;
  persist();
  res.json({ ok: true });
});

app.post("/api/feedback", (req, res) => {
  const { id: sessionId, data: sessionData } = getSession(req);
  const message = String(req.body.message || "").trim().slice(0, 1500);
  if (!message) return res.status(400).json({ error: "feedback message is required" });

  const item = {
    id: `feedback-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    sessionId,
    profile: sessionData.profile || null,
    message,
    path: String(req.body.path || "").slice(0, 200),
    createdAt: new Date().toISOString()
  };
  feedback.push(item);
  persist();
  res.status(201).json({ feedback: item });
});

app.get("/api/contacts", (req, res) => {
  const { id: sessionId, data: sessionData } = getSession(req);
  res.json(contactGraphPayload(sessionId, sessionData));
});

app.post("/api/contacts/import", (req, res) => {
  const { id: sessionId, data: sessionData } = getSession(req);
  const parsedContacts = parseImportedContacts(req.body.contacts, req.body.raw);
  if (!parsedContacts.length) {
    return res.status(400).json({ error: "paste at least one email or phone contact" });
  }

  sessionData.contacts ??= [];
  for (const contact of parsedContacts.slice(0, 500)) {
    const existingIndex = sessionData.contacts.findIndex((item) => item.normalized === contact.normalized);
    if (existingIndex >= 0) {
      sessionData.contacts[existingIndex] = {
        ...sessionData.contacts[existingIndex],
        ...contact,
        updatedAt: new Date().toISOString()
      };
    } else {
      sessionData.contacts.push({
        id: `contact-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        ...contact,
        createdAt: new Date().toISOString()
      });
    }
  }

  persist();
  res.status(201).json(contactGraphPayload(sessionId, sessionData));
});

app.post("/api/invites", (req, res) => {
  const { id: sessionId, data: sessionData } = getSession(req);
  const contact = String(req.body.contact || "").trim().slice(0, 120);
  if (!contact || !isValidInviteContact(contact)) return res.status(400).json({ error: "valid phone or email is required" });

  const normalized = normalizeContact(contact);
  const existing = sessionData.invites.find((invite) => invite.normalized === normalized);
  if (!existing) {
    sessionData.invites.push({
      id: `invite-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      contact,
      normalized,
      name: String(req.body.name || "").trim().slice(0, 80),
      status: "credited",
      joinedAt: new Date().toISOString(),
      creditedAt: new Date().toISOString(),
      createdAt: new Date().toISOString()
    });
    persist();
  }

  res.status(201).json({
    ...progressPayload(sessionId, sessionData),
    contactGraph: contactGraphPayload(sessionId, sessionData)
  });
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

function venueCacheKey(city, vibe, location) {
  const locationPart = location
    ? `near-${Math.round(location.lat * 100) / 100}-${Math.round(location.lng * 100) / 100}-${location.radiusMeters}`
    : city || "New York";
  return [locationPart, vibe || "all"]
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
  const contacts = sessionData.contacts || [];
  return {
    sessionId,
    inviteCount,
    sentInviteCount: sessionData.invites.length,
    contactCount: contacts.length,
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

function profilePayload(sessionId, sessionData) {
  return {
    sessionId,
    signedIn: Boolean(sessionData.profile),
    profile: publicProfile(sessionData.profile)
  };
}

function postFromRating(rating, sessionData) {
  const authorName = sessionData.profile?.name || "NightCap member";
  return {
    id: `post-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    sessionId: rating.sessionId,
    author: {
      name: authorName,
      profilePhoto: sessionData.profile?.profilePhoto || ""
    },
    ratingId: rating.id,
    venueId: rating.venueId,
    venueName: rating.venueName,
    venueAddress: rating.venueAddress,
    venueCity: rating.venueCity,
    overallScore: rating.overallScore,
    comment: rating.comment,
    likes: [],
    published: true,
    createdAt: rating.createdAt
  };
}

function publicPost(post) {
  return {
    id: post.id,
    author: post.author,
    venueName: post.venueName,
    venueAddress: post.venueAddress,
    venueCity: post.venueCity,
    overallScore: post.overallScore,
    comment: post.comment,
    likeCount: post.likes?.length || 0,
    createdAt: post.createdAt
  };
}

function inviteGatePayload(successfulInvites) {
  return {
    required: 3,
    successfulInvites,
    remaining: Math.max(0, 3 - successfulInvites),
    unlocked: successfulInvites >= 3
  };
}

function topPeoplePayload(query = "") {
  const peopleBySession = new Map();
  for (const post of posts.filter((item) => item.published)) {
    const person = peopleBySession.get(post.sessionId) || {
      id: post.sessionId,
      name: post.author?.name || "NightCap member",
      profilePhoto: post.author?.profilePhoto || "",
      postCount: 0,
      likeCount: 0,
      averageScore: 0,
      scoreTotal: 0,
      topPost: null
    };
    person.postCount += 1;
    person.likeCount += post.likes?.length || 0;
    person.scoreTotal += post.overallScore || 0;
    if (!person.topPost || (post.likes?.length || 0) > person.topPost.likeCount || post.overallScore > person.topPost.overallScore) {
      person.topPost = {
        venueName: post.venueName,
        overallScore: post.overallScore,
        likeCount: post.likes?.length || 0,
        comment: post.comment
      };
    }
    peopleBySession.set(post.sessionId, person);
  }

  return Array.from(peopleBySession.values())
    .map((person) => ({
      ...person,
      averageScore: person.postCount ? Math.round((person.scoreTotal / person.postCount) * 10) / 10 : 0,
      rankScore: Math.round((person.likeCount * 3 + person.postCount * 2 + (person.scoreTotal / Math.max(1, person.postCount))) * 10) / 10,
      scoreTotal: undefined
    }))
    .filter((person) => {
      if (!query) return true;
      const haystack = [
        person.name,
        person.topPost?.venueName,
        person.topPost?.comment
      ].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(query);
    })
    .sort((a, b) => b.rankScore - a.rankScore || b.likeCount - a.likeCount || b.postCount - a.postCount)
    .slice(0, 20);
}

function publicProfile(profile) {
  if (!profile) return null;
  return {
    id: profile.id,
    name: profile.name,
    email: profile.email,
    phone: profile.phone,
    profilePhoto: profile.profilePhoto || "",
    hasPassword: Boolean(profile.passwordHash),
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt
  };
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, salt, 120000, 32, "sha256").toString("hex");
  return `pbkdf2_sha256$120000$${salt}$${hash}`;
}

function sanitizeProfilePhoto(value) {
  if (value === undefined || value === null || value === "") return "";
  const photo = String(value);
  if (photo.length > 2_500_000) return null;
  if (!/^data:image\/(png|jpe?g|webp);base64,[a-z0-9+/=]+$/i.test(photo)) return null;
  return photo;
}

function findSessionByContact(normalizedContact) {
  return Object.entries(sessions).map(([id, data]) => ({ id, data })).find(({ data }) => {
    return data.profile?.normalizedEmail === normalizedContact || data.profile?.normalizedPhone === normalizedContact;
  });
}

function contactGraphPayload(sessionId, sessionData) {
  const contacts = sessionData.contacts || [];
  const members = memberRecords(sessionId);
  const memberByContact = new Map();
  for (const member of members) {
    for (const contact of member.normalizedContacts) {
      memberByContact.set(contact, member);
    }
  }

  const importedContacts = contacts.map((contact) => {
    const member = memberByContact.get(contact.normalized);
    const mutualMembers = members
      .filter((item) => item.contactGraph.includes(contact.normalized))
      .map((item) => ({ id: item.id, name: item.name }));
    return {
      id: contact.id,
      name: contact.name,
      contact: contact.contact,
      normalized: contact.normalized,
      onNightCap: Boolean(member),
      memberId: member?.id || null,
      memberName: member?.name || null,
      mutualMembers
    };
  });

  const onApp = importedContacts.filter((contact) => contact.onNightCap);
  const inviteCandidates = importedContacts.filter((contact) => !contact.onNightCap);
  const recommendations = inviteCandidates
    .map((contact) => {
      const alreadyInvited = (sessionData.invites || []).some((invite) => invite.normalized === contact.normalized);
      return {
        ...contact,
        alreadyInvited,
        score: contact.mutualMembers.length * 10 + (alreadyInvited ? -20 : 0)
      };
    })
    .filter((contact) => contact.score > 0 || !contact.alreadyInvited)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, 8);

  return {
    importedCount: importedContacts.length,
    onApp,
    inviteCandidates,
    recommendations,
    appMemberCount: members.length,
    unlocks: progressPayload(sessionId, sessionData).unlocks
  };
}

function memberRecords(currentSessionId) {
  const storedMembers = memberDirectory.map((member) => ({
    id: member.id,
    name: member.name,
    contacts: member.contacts || [],
    contactGraph: member.contactGraph || []
  }));
  const sessionMembers = Object.entries(sessions)
    .filter(([sessionId]) => sessionId !== currentSessionId)
    .map(([sessionId, sessionData]) => ({
      id: `session-member-${sessionId}`,
      name: sessionData.profile?.name || "NightCap member",
      contacts: [
        sessionData.profile?.email,
        sessionData.profile?.phone,
        ...(sessionData.invites || []).filter((invite) => invite.status === "credited").map((invite) => invite.contact)
      ].filter(Boolean),
      contactGraph: (sessionData.contacts || []).map((contact) => contact.normalized)
    }));

  return [...seedMembers, ...storedMembers, ...sessionMembers].map((member) => ({
    ...member,
    normalizedContacts: (member.contacts || []).map(normalizeContact).filter(Boolean),
    contactGraph: (member.contactGraph || []).map(normalizeContact).filter(Boolean)
  }));
}

function parseImportedContacts(contacts, raw) {
  const structured = Array.isArray(contacts)
    ? contacts.map((contact) => ({
      name: String(contact.name || "").trim().slice(0, 80),
      contact: String(contact.contact || contact.email || contact.phone || "").trim().slice(0, 120)
    }))
    : [];
  const pasted = String(raw || "")
    .split(/\n|,/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const email = line.match(/[^\s<>,;]+@[^\s<>,;]+\.[^\s<>,;]+/)?.[0];
      const phone = line.match(/\+?[0-9][0-9().\-\s]{6,}[0-9]/)?.[0];
      const contact = email || phone || "";
      const name = contact ? line.replace(contact, "").replace(/[<>;,-]+/g, " ").trim() : line;
      return { name: name.slice(0, 80), contact: contact.slice(0, 120) };
    });

  const deduped = new Map();
  for (const contact of [...structured, ...pasted]) {
    const normalized = normalizeContact(contact.contact);
    if (!normalized || !isValidInviteContact(contact.contact)) continue;
    deduped.set(normalized, {
      name: contact.name || contact.contact,
      contact: contact.contact,
      normalized
    });
  }
  return Array.from(deduped.values());
}

function rankingPayload(sessionId, sessionData) {
  const successfulInvites = successfulInviteCount(sessionData);
  const inviteGate = inviteGatePayload(successfulInvites);
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
    shareText: inviteGate.unlocked && ranking.length
      ? `My NightCap nightlife ranking: ${ranking.slice(0, 3).map((venue, index) => `${index + 1}. ${venue.name}`).join(" / ")}`
      : "I’m building my NightCap nightlife ranking.",
    inviteGate,
    rankingLocked: !inviteGate.unlocked,
    ranking: inviteGate.unlocked ? ranking : []
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

function normalizeContact(contact) {
  const value = String(contact || "").trim();
  if (!value) return "";
  if (value.includes("@")) return value.toLowerCase();
  const digits = value.replace(/\D/g, "");
  return digits.length >= 7 ? digits : value.toLowerCase();
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
    feedback.splice(0, feedback.length);
    posts.splice(0, posts.length);
    persist();
    res.json({ ok: true });
  });
}

app.listen(port, () => {
  console.log(`Planner API running on http://localhost:${port}`);
});
