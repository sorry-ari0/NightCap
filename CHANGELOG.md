# Changelog

## 2026-07-07

- Added `npm run release:check` to prevent NC-003 regressions where fixes exist locally but are not committed.
- Added `scripts/check-clean.mjs` so release checks fail on uncommitted or untracked files before and after validation.
- Documented the NightCap release gate in `README.md`.
- Hardened the public health endpoint so it only returns `{ "ok": true }`.
- Removed visible Maps/storage/cache implementation labels from the app UI.
- Added Resend-backed password reset email delivery support with local-json fallback for development.
- Verified build, API validation, Playwright e2e, browser audit, and live health.
