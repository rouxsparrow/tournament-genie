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
4. Ensure your event dataset is present before running tests:
   - locked category exists in `GroupAssignmentLock`
   - groups/teams/players already exist for locked categories
   - schedulable group matches can be generated from existing groups

## Court Mapping Note
- DB/internal court IDs are `C1..C5`.
- Schedule and Referee UI display labels are `P5..P9`.
- E2E selectors and lane mapping must use UI labels (`P5..P9`) when interacting with pages.

## Commands
- DB preflight:
  - `npm run test:e2e:preflight`
- Seed/reset deterministic test data:
  - `npm run test:e2e:seed`
- Run PR smoke suite:
  - `npm run test:e2e:smoke`
- Run critical suite:
  - `npm run test:e2e:critical`
- Run regression suite:
  - `npm run test:e2e:regression`
- Run group-stage real-life event simulation:
  - `npm run test:e2e:event-group`
- Run nightly full suite:
  - `npm run test:e2e:nightly`
- Run E2E tests (headless):
  - `npm run test:e2e`
- Run broadcast realtime check without seed/reset (uses existing data as-is):
  - `npm run test:e2e:broadcast:realtime`
- Run headed:
  - `npm run test:e2e:headed`
- Open interactive UI mode:
  - `npm run test:e2e:ui`
- Open HTML report:
  - `npm run test:e2e:report`

## Modes
### `PreData` (uses existing data as precondition; preserves core setup)
- `npm run test:predata:integrity`
- `npm run test:predata:stress`
- `npm run test:e2e:event-group` (preserves Players/Teams/Groups; after reset regenerates group-stage matches for locked categories only)

## Progress and Results
- Live progress is shown in CLI (`list` reporter).
- HTML report is generated at `playwright-report/`.
- Failure artifacts:
  - traces, screenshots, and videos retained on failure.
- Group-stage simulation metrics artifact:
  - `test-results/metrics/group-stage-event-sim-<timestamp>.json`
- Mobile tests run under `mobile-chromium` project only for `@mobile`-tagged tests.

## Scenario Presets
The seed script supports a single enforced preset via `E2E_SCENARIO`:
- `existing-group` (default and mandatory): preserve Player/Team/Group setup; clear runtime state and regenerate group-stage matches for locked categories only

Example:
- `E2E_SCENARIO=existing-group npm run test:e2e:regression`

Synthetic scenarios (`baseline-group`, `knockout-ready`, `imports-validation`) are intentionally disabled to prevent creating dump data such as `E2E-*` or `KR-*`.

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

Preflight also checks:
- DB hostname DNS resolves
- Prisma can run `SELECT 1`

## No-Seed Realtime Test
- `test:e2e:broadcast:realtime` uses `playwright.no-seed.config.ts` and intentionally does not run `globalSetup`.
- It does not create/reset synthetic data.
