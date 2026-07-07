# Changelog

## Unreleased

### Added
- Added a saved shortlist so users can compare bookmarked venues before planning a night.
- Added a public ranking HTML route for shared NightCap ranking links.
- Expanded Playwright coverage for saved venues and the 3-invite public ranking unlock/share gate.

### Changed
- Replaced the Leaflet dependency with an in-app static cached map for simpler rendering and faster Chromium QA.
- Stabilized Playwright configuration so explicit system Chromium runs headlessly without an Xvfb dependency.

### Verified
- `npm run build`
- `npm run test:api`
- `PLAYWRIGHT_CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e -- --project=desktop --project=mobile`
- `PLAYWRIGHT_CHROMIUM_PATH=/usr/bin/chromium npm run test:browser`
