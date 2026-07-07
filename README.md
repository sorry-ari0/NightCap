# NightCap MVP

NightCap is a Beli-inspired nightlife planner MVP for bars, clubs, lounges, and late-night spots.

## What It Does

- Pulls bars and clubs from Google Places when `GOOGLE_MAPS_API_KEY` is configured.
- Caches Google Places venue data locally by city and vibe so repeat searches use stored Maps data instead of spending quota.
- Renders an in-app stored-location map from cached latitude/longitude points.
- Supports Near Me search with browser geolocation, biased through Google Places when Maps is configured.
- Stores official venue website URLs from Google Places and shows Website plus Map actions on venue cards.
- Falls back to seeded venues so the MVP works immediately.
- Lets users rate an overall venue score.
- Supports optional category ratings for vibes, drinks, people, aesthetics, music, and value.
- Supports comments and saved venues.
- Generates a simple three-stop night-out plan from selected priorities and group size.
- Persists local MVP data to `data/nightcap-db.json`.
- Adds contact import, friend recommendations, and invite-based unlock progress for friend match scores, group planner, city scores, and private mode.
- Lets users leave category ratings blank unless they explicitly add a score for that category.

## Run Locally

```sh
npm install
npm run dev
```

Client: `http://localhost:5173`

API: `http://localhost:3001`

## Maps Setup

Create `.env` from `.env.example` and set:

```sh
GOOGLE_MAPS_API_KEY=your_google_maps_api_key
```

The server uses Google Places API Text Search and Place Photos. With a valid key, venue cards use Google Places photo names through `/api/google-photo`, so the live site shows real location imagery instead of seed placeholders.

Venue search responses are stored in `data/nightcap-db.json` under `venueCache`. Cache keys combine city and vibe, default expiry is 30 days, and repeat requests return `source: "google-cache"` without calling Google again. Override the TTL with:

```sh
VENUE_CACHE_TTL_MS=2592000000
```

The current launch city order is New York, San Francisco, then Los Angeles. `/api/cities` returns that order plus any cached cities.

## Contacts And App Path

The web MVP cannot read a user's address book without native app permissions, so the current flow accepts pasted contacts and posts them to `/api/contacts/import`. The same endpoint is designed for a future iOS/Android app to populate after the user grants Contacts permission. The backend compares imported contacts with known NightCap members and recommends invites when a non-user has mutual contacts already on NightCap.

For a real public deployment, also set:

```sh
REQUIRE_GOOGLE_MAPS=true
```

That makes `/api/venues` return a configuration error instead of silently using seed data when the Maps key is missing.

## Local Data

The MVP stores ratings, saved venues, invite progress, and cached venue/map data in `data/nightcap-db.json`. That file is ignored by git so local testing does not leak user-generated data or cached API payloads.

## Deploy For Free

The fastest current deployment path is a single Render Web Service:

- Build command: `npm install && npm run build`
- Start command: `npm start`
- Free instance type
- Required env vars for a real site:
  - `GOOGLE_MAPS_API_KEY`
  - `REQUIRE_GOOGLE_MAPS=true`

This repo includes `render.yaml` for a Render Blueprint deploy.

Render's free web services spin down after idle time and use an ephemeral filesystem, so local JSON data can disappear after restarts or deploys. For real user data, move ratings, saves, invites, and users to Supabase Free Postgres next.

Production server:

```sh
npm run build
npm start
```

Health check:

```sh
curl http://localhost:3001/api/health
```

## Release Check

Run the release gate before pushing NightCap changes:

```sh
npm run release:check
```

The command fails immediately when tracked or untracked files are not committed, then runs build, API validation, Playwright e2e, browser audit, and a final clean-tree check. This prevents NC-003-style releases where fixes exist locally but are not committed.

## Agent Coordination

Read `ORCHESTRATION.md` before assigning or accepting multi-agent work. `NightCap-Builder` is the global coordinator, lane agents must stay within their lane, and no agent should push, merge, deploy, publish externally, or run destructive git commands without explicit coordination.
