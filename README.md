# Nightcap MVP

Nightcap is a Beli-inspired nightlife planner MVP for bars, clubs, lounges, and late-night spots.

## What It Does

- Pulls bars and clubs from Google Places when `GOOGLE_MAPS_API_KEY` is configured.
- Falls back to seeded venues so the MVP works immediately.
- Lets users rate an overall venue score.
- Supports optional category ratings for vibes, drinks, people, aesthetics, music, and value.
- Supports comments and saved venues.
- Generates a simple three-stop night-out plan from selected priorities and group size.

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

The server uses Google Places API Text Search and Place Photos. Without a key, the app uses fallback seed venues.
