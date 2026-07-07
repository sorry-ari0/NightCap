# Changelog

## 2026-07-07

### Added
- Added a saved shortlist so users can compare bookmarked venues before planning a night.
- Added a public ranking HTML route for shared NightCap ranking links.
- Expanded Playwright coverage for saved venues and the 3-invite public ranking unlock/share gate.
- Added `npm run release:check` to prevent NC-003 regressions where fixes exist locally but are not committed.
- Added `scripts/check-clean.mjs` so release checks fail on uncommitted or untracked files before and after validation.

### Changed
- Replaced the Leaflet dependency with an in-app static cached map for simpler rendering and faster Chromium QA.
- Stabilized Playwright configuration so explicit system Chromium runs headlessly without an Xvfb dependency.
- Documented the NightCap release gate in `README.md`.
- Hardened the public health endpoint so it only returns `{ "ok": true }`.
- Removed visible Maps/storage/cache implementation labels from the app UI.
- Added Resend-backed password reset email delivery support with local-json fallback for development.

### Verified
- `npm run build`
- `npm run test:api`
- `PLAYWRIGHT_CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e -- --project=desktop --project=mobile`
- `PLAYWRIGHT_CHROMIUM_PATH=/usr/bin/chromium npm run test:browser`
