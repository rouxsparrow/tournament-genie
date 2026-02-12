# Playwright E2E Guide

## Scope
Critical Flow Pack for event-day risk:
- Admin auth + schedule load smoke
- Auto Schedule happy path
- No-disappearing-match guardrail
- Concurrency UI race (two contexts)
- Referee submit flow
- Utilities check/clear flow

Balanced expansion packs:
- `@smoke` (PR gate)
- `@critical` (event-day operations)
- `@regression` (broader correctness/permissions/imports)
- `@mobile` (selected mobile usability checks)

## Setup
1. Copy `.env.e2e.example` to `.env.e2e` and fill values.
2. Ensure `E2E_DB_GUARD` is set to a substring that exists in your Dev `DATABASE_URL`.
3. Install dependencies:
   - `npm i`
   - `npx playwright install chromium`

## Commands
- Seed/reset deterministic test data:
  - `npm run test:e2e:seed`
- Run PR smoke suite:
  - `npm run test:e2e:smoke`
- Run critical suite:
  - `npm run test:e2e:critical`
- Run regression suite:
  - `npm run test:e2e:regression`
- Run nightly full suite:
  - `npm run test:e2e:nightly`
- Run E2E tests (headless):
  - `npm run test:e2e`
- Run headed:
  - `npm run test:e2e:headed`
- Open interactive UI mode:
  - `npm run test:e2e:ui`
- Open HTML report:
  - `npm run test:e2e:report`

## Progress and Results
- Live progress is shown in CLI (`list` reporter).
- HTML report is generated at `playwright-report/`.
- Failure artifacts:
  - traces, screenshots, and videos retained on failure.
- Mobile tests run under `mobile-chromium` project only for `@mobile`-tagged tests.

## Scenario Presets
The seed script supports deterministic scenario presets via `E2E_SCENARIO`:
- `baseline-group` (default): schedule/referee/utilities critical flow
- `knockout-ready`: completed group stage + lock state for knockout regression
- `imports-validation`: focused data shape for import validation tests

Example:
- `E2E_SCENARIO=knockout-ready npm run test:e2e:regression`

## CI Plan
- PR workflow runs `test:e2e:smoke` with retries disabled.
- Nightly workflow runs `test:e2e:critical` + `test:e2e:regression` with retries enabled.
- Pre-release workflow runs nightly suite plus DB integrity scripts:
  - `npm run test:schedule:integrity`
  - `npm run test:schedule:stress`

## Safety
Seeding script refuses to run unless:
- `DATABASE_URL` exists
- `E2E_DB_GUARD` exists
- `DATABASE_URL` contains `E2E_DB_GUARD`

This is to avoid accidental production data mutation.
