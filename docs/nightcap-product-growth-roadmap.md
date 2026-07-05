# Nightcap Product and Growth Roadmap

## Product Thesis

Nightcap should become the social memory, ranking, and planning layer for nightlife. Maps gives users locations; Nightcap gives them taste, social proof, and a reason to bring friends into the graph.

The core loop:

1. Pull venues from Maps or seed data.
2. User rates/ranks bars, clubs, lounges, rooftops, and late-night spots.
3. Nightcap turns that activity into a personal nightlife profile.
4. User invites friends to unlock higher-value social features.
5. User shares public ranking artifacts that bring new users back into Nightcap.

## Required Growth Gate

Users can unlock and publicly share their ranking only after **3 successful invites**.

This should be a referral gate, not a spam wall:

- Show the ranking preview immediately, but blur/share-lock the public version.
- Explain: "Invite 3 friends to publish your Nightcap ranking."
- Count only successful invites: the invited person must create an account or verify phone/email.
- Show progress: `1/3 friends joined`.
- Let users continue using the app without unlocking public sharing.
- Provide non-spammy invite copy: "I’m building my nightlife ranking on Nightcap. Join so we can compare spots."
- Do not auto-message contacts or dark-pattern users into contact upload.

Implementation notes:

- Add `invite_status`: `sent`, `joined`, `credited`, `expired`.
- Add `successful_invite_count` per user.
- Add `public_ranking_unlocked_at`.
- Add `public_profile_slug`.
- Add server enforcement: share endpoints return `403` until 3 credited invites.
- Add client states: locked preview, progress meter, invite CTA, unlocked share card.

## Prioritized Roadmap

### P0: Finish the Web MVP

Build now.

1. **Stable Public Demo**
   - Host single Node service on Render free or equivalent.
   - Serve Vite build through Express.
   - Keep fallback venue data so demo works without Google Places.
   - Move production persistence to Supabase before real launch.

2. **Venue Discovery**
   - Google Places Text Search and Place Details.
   - Types: `bar`, `night_club`, live music/event venues where relevant.
   - Store Google Place IDs, but keep Nightcap user data in our own venue graph.

3. **Ratings**
   - Required overall score.
   - Optional category scores: vibes, drinks, people, aesthetics, music, value, door.
   - Optional comments.
   - Aggregate scores only when enough ratings exist.

4. **Tonight Planner**
   - Inputs: city, vibe, group size, category priorities.
   - Output: 3-stop plan: start, main move, backup.
   - Respect unlock rules for group planning.

5. **Session/User Boundary**
   - Short term: browser session ID.
   - Launch: real auth with phone/email/social login.
   - User-specific saves, invites, unlocks, and rankings.

### P1: Public Ranking and Organic Sharing

Build next. This is the highest-leverage growth surface.

1. **Personal Ranking Page**
   - Public URL: `/u/{handle}/rankings/{city}`.
   - Shows top bars/clubs, category strengths, comments, and badges.
   - Privacy controls: public, friends-only, private.

2. **3-Successful-Invite Share Gate**
   - Public ranking remains locked until 3 friends join.
   - Users can see a private preview before unlocking.
   - Unlock copy should emphasize usefulness, not punishment:
     - "Your ranking gets better with friends. Invite 3 to publish it."
   - After unlock, generate share cards for Instagram Stories, TikTok, X, iMessage, and link copy.

3. **Share Cards**
   - Auto-generated image:
     - "Ari’s Top 10 NYC Nightlife"
     - Top 3 venues
     - category badge: "Best for dancing", "Cocktail person", "Late-night loyalist"
     - Nightcap watermark and QR/link
   - Export PNG and native Web Share API.

4. **Taste Badges**
   - Examples:
     - Dance Floor Person
     - Cocktail Maximalist
     - Rooftop Regular
     - Dive Bar Defender
     - After-Midnight Specialist
   - Badges make rankings more shareable than plain lists.

5. **Friend Match**
   - Compare two users:
     - shared top spots
     - disagreement spots
     - best plan for both of you
   - Strong invite reason: "Join so we can compare our nightlife taste."

### P2: Retention and Habit Loops

Build after share loop works.

1. **Weekly Night Recap**
   - "Your weekend in 3 spots."
   - New ratings, changed ranking, unlocked badge.
   - Shareable recap card.

2. **Streaks Without Guilt**
   - Track weekly activity: rated, saved, planned, or invited.
   - Avoid harsh streak-loss mechanics for nightlife because users do not go out daily.

3. **City Leaderboards**
   - Most trusted nightlife rankers by city.
   - Venue category leaderboards.
   - Require anti-spam trust weighting.

4. **Collections**
   - Best first-date bars.
   - Good for big groups.
   - Worth the line.
   - Can actually talk here.
   - Best after 1 AM.

5. **Private Crew Lists**
   - Shared list for friend groups.
   - Group ranking and voting.
   - Useful before public social graph gets dense.

### P3: Marketplace and Perks

Build once demand density exists.

1. **Venue Partner Perks**
   - RSVP windows.
   - Priority line before a specific time.
   - Free cover windows.
   - Welcome drink credits.
   - Birthday/group inquiry flow.

2. **Creator/Curator Pages**
   - Nightlife curators can publish rankings.
   - Shareable city guides.
   - Affiliate/perk attribution later.

3. **Event Layer**
   - DJ/event nights.
   - Ticketing links.
   - Best night-of-week intelligence.

4. **Trust and Safety**
   - Anti-fake invite checks.
   - Rate limits.
   - Venue harassment/spam moderation.
   - Clear policies for comments and public rankings.

## Implementation Backlog

### Build Now

- `users`
- `venues`
- `venue_external_ids`
- `ratings`
- `saved_venues`
- `invites`
- `invite_credits`
- `feature_unlocks`
- `public_rankings`
- `ranking_share_cards`

Endpoints:

- `POST /api/invites`
- `POST /api/invites/:id/accept`
- `GET /api/unlocks`
- `GET /api/rankings/me`
- `POST /api/rankings/publish`
- `GET /api/u/:handle/rankings/:city`
- `POST /api/share-cards`

Share gate logic:

```text
if successful_invite_count < 3:
  allow private preview
  deny public publish/share
  show remaining invite count
else:
  allow public profile, share link, and image export
```

### Build Later

- Supabase/Postgres migration.
- Native mobile app.
- Real-time group planning.
- Venue dashboards.
- Partner perk redemption.
- City trust leaderboards.
- Creator monetization.

## Product Principles

- Sharing should feel like identity, not advertising.
- Invite gates must unlock meaningful social value.
- Never block the core product behind referrals.
- Track successful joins, not raw invite sends.
- Give users privacy and control over public rankings.
- Optimize for friend groups deciding where to go tonight.
