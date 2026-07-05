import express from "express";
import { fallbackVenues } from "./fallbackVenues.js";

const app = express();
const port = process.env.PORT || 3001;
const googleKey = process.env.GOOGLE_MAPS_API_KEY;

app.use(express.json({ limit: "1mb" }));

const ratings = [];
const savedVenueIds = new Set();

function toVenue(place, city) {
  const photoName = place.photos?.[0]?.name;
  return {
    id: `google-${place.id}`,
    googlePlaceId: place.id,
    name: place.displayName?.text ?? "Unknown venue",
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
  return ratings.filter((rating) => rating.venueId === venueId);
}

function average(values) {
  const nums = values.filter((value) => Number.isFinite(value));
  if (!nums.length) return null;
  return Math.round((nums.reduce((sum, value) => sum + value, 0) / nums.length) * 10) / 10;
}

function withScores(venue) {
  const venueSpecificRatings = venueRatings(venue.id);
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
    saved: savedVenueIds.has(venue.id),
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
  const city = String(req.query.city || "New York").trim();
  const vibe = String(req.query.vibe || "").trim();

  if (googleKey) {
    try {
      const query = [vibe, "bars clubs nightlife", city].filter(Boolean).join(" ");
      const venues = await googleTextSearch(query, city);
      return res.json({ source: "google", venues: venues.map(withScores) });
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
    venues: (venues.length ? venues : fallbackVenues).map(withScores)
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
  const rating = {
    id: `rating-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    venueId: req.body.venueId,
    overallScore: Number(req.body.overallScore),
    vibesScore: optionalNumber(req.body.vibesScore),
    drinksScore: optionalNumber(req.body.drinksScore),
    peopleScore: optionalNumber(req.body.peopleScore),
    aestheticsScore: optionalNumber(req.body.aestheticsScore),
    musicScore: optionalNumber(req.body.musicScore),
    valueScore: optionalNumber(req.body.valueScore),
    comment: String(req.body.comment || "").trim(),
    createdAt: new Date().toISOString()
  };

  if (!rating.venueId || !Number.isFinite(rating.overallScore)) {
    return res.status(400).json({ error: "venueId and overallScore are required" });
  }

  ratings.push(rating);
  res.status(201).json({ rating });
});

app.post("/api/saved-venues", (req, res) => {
  if (!req.body.venueId) return res.status(400).json({ error: "venueId is required" });
  savedVenueIds.add(req.body.venueId);
  res.status(201).json({ savedVenueIds: Array.from(savedVenueIds) });
});

app.delete("/api/saved-venues/:venueId", (req, res) => {
  savedVenueIds.delete(req.params.venueId);
  res.json({ savedVenueIds: Array.from(savedVenueIds) });
});

app.post("/api/plans", (req, res) => {
  const venues = req.body.venues ?? [];
  const groupSize = Number(req.body.groupSize || 2);
  const priorities = req.body.priorities ?? [];

  const ranked = venues
    .map((venue) => {
      const score = plannerScore(venue, priorities, groupSize);
      return { ...venue, plannerScore: score };
    })
    .sort((a, b) => b.plannerScore - a.plannerScore)
    .slice(0, 3);

  res.json({
    plan: ranked.map((venue, index) => ({
      stop: index + 1,
      venue,
      role: index === 0 ? "Start here" : index === 1 ? "Main move" : "Late-night backup",
      reason: reasonForVenue(venue, priorities)
    }))
  });
});

function optionalNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function plannerScore(venue, priorities, groupSize) {
  const categoryScores = venue.categoryScores ?? {};
  const selected = priorities.map((priority) => categoryScores[priority]).filter(Number.isFinite);
  const categoryAverage = selected.length ? average(selected) : 7;
  const socialBoost = venue.ratingCount ? Math.min(1.2, venue.ratingCount * 0.2) : 0;
  const groupPenalty = groupSize >= 6 && venue.types?.includes("night_club") ? 0.2 : 0;
  return Math.round(((venue.overallScore ?? categoryAverage ?? 7) + categoryAverage + socialBoost - groupPenalty) * 10) / 10;
}

function reasonForVenue(venue, priorities) {
  const readable = priorities.length ? priorities.join(", ") : "overall fit";
  if (venue.ratingCount) return `Strong ${readable} signal from ${venue.ratingCount} rating${venue.ratingCount === 1 ? "" : "s"}.`;
  if (venue.googleRating) return `Good Maps baseline (${venue.googleRating}) while the local rating graph fills in.`;
  return "Included as a seed spot so the planner works before map data is connected.";
}

app.listen(port, () => {
  console.log(`Planner API running on http://localhost:${port}`);
});
