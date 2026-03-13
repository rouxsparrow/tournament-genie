# Project: Tournament Genie

## Project Purpose
Tournament Genie is a web application to manage badminton tournaments.
It prioritizes manual control, clear tournament rules, and stability during
live tournament operation.

Automation exists only to support admin decisions -- not replace them.

---

## Core Tournament Rules (DO NOT CHANGE WITHOUT CONFIRMATION)

### General
- **Doubles only**
- No singles events
- No player rating or matchmaking logic

### Categories
Each category is handled independently:
- **Men's Doubles (MD)**: Male + Male
- **Women's Doubles (WD)**: Female + Female
- **Mixed Doubles (XD)**: Male + Female

A player may participate in multiple categories, but:
- A player cannot be in more than one team **within the same category**

---

## Player Rules
- Players are created manually
- Each player has:
  - Name
  - Gender: `Male` or `Female`

---

## Team Rules
- Teams are created manually
- Team must contain exactly 2 players
- Team composition must match the category rules (MD / WD / XD)

---

## Bulk Import (Players & Teams)
- Import sections live on the Players and Teams pages (admin-only)
- Supported formats: CSV and XLSX (first row is headers, case-insensitive)
- Template routes:
  - `/api/templates/players.csv`
  - `/api/templates/players.xlsx`
  - `/api/templates/teams.csv`
  - `/api/templates/teams.xlsx`
- Import routes:
  - `POST /api/import/players`
  - `POST /api/import/teams`
- Players import validation:
  - Required: name + gender (MALE/FEMALE)
  - Trim whitespace and normalize values
  - Deduplicate by player name (case-insensitive); existing names are skipped
- Teams import validation:
  - Required: Player 1, Player 2, Category (MD/WD/XD)
  - Lookup players by name (case-insensitive); missing players error
  - Enforce category gender rules (MD/WD/XD)
  - Prevent duplicate teams (same two players + category, any order) -> skip
  - A player cannot be in more than one team within the same category

---

## Group Stage

### Group Creation
- Groups can be created manually by admin
- Teams can be assigned manually OR via randomization (see below)
- Matches inside a group use **round-robin** format

### Group Randomization (Optional)
At tournament creation, admin selects group assignment mode:
- `MANUAL`
- `RANDOM_WITH_SEEDS`

#### Group Seed Rules (Group Stage ONLY)
- Teams can be marked with `isGroupSeed`
- `isGroupSeed` is used **only** for group randomization
- Group seeds do NOT affect knockout seeding

When randomizing groups:
- Distribute `isGroupSeed` teams as evenly as possible across groups
- Prefer max 1 group seed per group
- If group seeds > group count:
  - Allow multiple group seeds but keep distribution balanced (difference <= 1)
- After placing group seeds, fill remaining slots randomly

---

## Group Standings & Measurements
Group standings are calculated from match results using:
1. Wins
2. Average point difference per match ((pointsFor - pointsAgainst) / matchesPlayed)
3. Average points scored per match (pointsFor / matchesPlayed)
4. Head-to-head (only if tied teams played each other)
5. Manual admin tie override for the exact current fallback tie, if one exists
6. Random draw (stored; last resort)

---

## Tournament Flow

### 1. Group Stage
- Play all round-robin matches
- Standings auto-calculated per group

### 2. Lock Group Stage
- Group results must be locked before progression
- After locking, group matches cannot be edited

## Series Split

After group stage is locked:
- Use **Global Group Stage Ranking** (within same category) after lock.
- **MD / XD**:
  - If `playInsEnabled = false` (default):
    - Only global ranks **#1-#12** qualify for knockout split.
    - **Series A** = ranks **#1-#8**
    - **Series B** = ranks **#9-#12**
    - Ranks **#13+** are **eliminated** (not qualified for knockout).
  - If `playInsEnabled = true`:
    - Only global ranks **#1-#16** qualify for knockout split.
    - **Series A** = ranks **#1-#8**
    - **Series B** = ranks **#9-#16**
    - Ranks **#17+** are **eliminated** (not qualified for knockout).
- **WD**:
  - WD remains **Series A only**.
  - If WD has **> 8 teams**, qualify **top 8** to Series A.
  - If WD has **4-8 teams**, qualify **top 4** to Series A.
  - Remaining WD teams are **eliminated**.
---

## Knockout Seeding

### Knockout Seed Flag
- Teams may be marked with `isKnockOutSeed`
- This flag is used ONLY for knockout bracket seeding
- `isKnockOutSeed` is independent from `isGroupSeed`

### Knockout Seeding Logic
- Default knockout seeding is computed from **group-stage measurements**
- `isKnockOutSeed` may be used to influence initial bracket placement
- If both computed ranking and `isKnockOutSeed` exist:
  - Admin-defined knockout seeds take priority
  - Remaining teams are seeded by standings

## Knockout Pairing

### Round-1 pairing constraints
- In the first knockout round (including Series B play-ins and Series B Quarterfinals), **avoid pairing teams from the same group** whenever possible.
- If same-group pairing is unavoidable, minimize the number of such pairings.

### Decider for equal-tier opponent choice
- If multiple valid opponents exist and they are the same group-rank tier (e.g., both are "#2 in their group"), decide using:
  1) **Average PD per match** ((PF - PA) / matchesPlayed) -- **lower Avg PD is weaker**
  2) If still tied, **random draw (stored)**

### No byes
- Knockout stages must NOT use byes.
- No automatic advancement: teams only progress by winning a match.
- If the number of teams does not fit the desired bracket size, use **play-in elimination matches**.

### Round Numbering (Global)
- Round 1 = Play-ins (when enabled and needed)
- Round 2 = Quarterfinals (QF)
- Round 3 = Semifinals (SF)
- Round 4 = Finals block (matchNo 1 = Final, matchNo 2 = Bronze Medal Match)
- Series A starts at Round 2 (no Round 1 matches)
- If knockout matches were previously generated, clear/regenerate to apply the new round model.

### Series Qualification Boundary (Important)
- Knockout brackets MUST be generated ONLY from the qualified teams of that series.
- Series A bracket must use ONLY the 8 Series A qualified teams.
- For MD/XD with `playInsEnabled = true`, Series B bracket must use ONLY MD/XD ranks #9-#16 (within qualified set).
- For MD/XD with `playInsEnabled = false`, Series B bracket must use ONLY MD/XD ranks #9-#12 (within qualified set).
- Series A seeding must follow the top-8 Global Group Stage Ranking order.
- A non-qualified team must never appear in knockout brackets.

### Series A Qualification Source (Important)
- Series A is determined from the **Global Group Stage Ranking** (within the same category):
  - MD/XD: **top 8**
  - WD: **top 8** when total teams > 8, otherwise **top 4**
- Global Group Stage Ranking order is based on:
  1. Final group rank
  2. Average point difference per match ((PF - PA) / matchesPlayed)
  3. Manual admin tie override for the exact current fallback tie, if one exists
  4. Stored random draw
- Series A must contain exactly those qualified teams.
- Teams outside the qualification boundary must not appear in Series A.

## Series Stage

### Default Format
- **Single-elimination (KO)** brackets
- Series A and Series B are separate

### Women's Doubles (WD) Special Case
- WD uses **Series A only** (no Series B)
- WD **minimum teams: 4**
- WD **do NOT have Play-ins**
- If WD has **4-8 teams**, Series A starts at **Semifinals** using the **top 4** from group stage ranking
- If WD has **> 8 teams**, Series A starts at **Quarterfinals** using top-8 group stage ranking + Avg PD seeding rules
- WD teams outside qualified top cutoff are **eliminated**
- **Second chance is not available** for WD

### Play-ins Toggle (MD/XD)
- `playInsEnabled`: true / false (default: **false**)
- If `playInsEnabled = false`:
  - Series B is fixed to ranks #9-#12 (4 teams)
  - Those 4 teams go directly to Series B Quarterfinals (no Round 1 play-ins)
  - Bracket generation is blocked unless `secondChanceEnabled = true`
- If `playInsEnabled = true`:
  - Keep existing MD/XD behavior (Series B ranks #9-#16, play-ins as required)

### Second-Chance Rule (Configurable)
At tournament creation:
- `secondChanceEnabled`: true / false

## Second Chance (Series A Losers Drop to Series B)

If `secondChanceEnabled: true`:

- The **4 losers of Series A Quarterfinals** drop into **Series B Quarterfinals**.
- Series B Quarterfinals must always have **8 teams total**:
  - 4 teams = the dropped Series A QF losers
  - 4 teams = selected from original Series B (via play-ins when enabled; direct QF entry when play-ins are disabled)
- Series B bracket generation requires **minimum 4 qualified Series B teams**.

### How many Series B play-in matches?
When play-ins are enabled:
Let `B` be the number of original Series B teams.
- We must qualify exactly **4** of them into Series B QF.
- Number of elimination matches required: `B - 4`
- Teams playing in play-ins: `2 * (B - 4)`
- Teams that wait directly for QF: `8 - B` (these are the strongest teams)

### Selecting teams that wait for QF (strongest)
Select the strongest `8 - B` teams from Series B using:
1) groupRank tier (e.g., #1 > #2 > #3)
2) Avg PD per match (higher is stronger)
3) stored random draw

Implementation note: Series B second-chance bracket generation supports B=4..8 with deterministic
auto-advance selection, strongest-vs-weakest play-ins, and stable base QF slotting before A-drop insertion.

Implementation note: Brackets render Series B play-ins for XD (category-agnostic), and Matches round filter
stays enabled without auto-reset when Series = All.
Implementation note: Knockout round numbers follow the global stage mapping above (Series A starts at Round 2).

### Pairing play-ins
Pair the play-in teams using:
- avoid same-group pairing whenever possible
- if multiple valid opponents in same tier exist, use Avg PD per match (lower = weaker) as decider; if still tied use stored random draw
- A-drop losers never play each other in Series B Quarterfinals; each QF match contains exactly one A-drop loser.
- Series B Play-ins use: avoid same-group where possible + groupRank tier + Avg PD + stored draw.
- Series B Quarterfinals pairing uses only: groupRank tier + Avg PD + stored draw (no highest-vs-lowest seeding rule; no same-group constraint unless later specified).
- A-drop vs B-opponent pairing: best A-drop faces weakest B-opponent.

---

## Scoring Rules
- Doubles scoring only
- Configurable:
  - Single game to 21 OR
  - Best of 3 games to 21
- Admin can:
  - Edit or undo scores
  - Mark walkover

---

## Technology Stack (MVP)
- Framework: **Next.js (TypeScript, App Router)**
- Database: **Supabase (Postgres)**
- ORM: **Prisma**
- Hosting: **Vercel**
- Authentication: **None** (admin-only usage)

---

## Non-Goals (DO NOT BUILD)
- Singles tournaments
- Automatic team balancing
- Player ranking / rating systems
- Public user accounts
- Social features
- Offline or PWA support (v1)

---

## AI Coding Instructions
- Do not invent tournament rules
- Do not merge group seeding with knockout seeding
- Ask before changing core logic or data models
- Prefer simple, readable code over abstractions
- Implement features incrementally
- Assume live tournament usage -- correctness > elegance
- Avoid full page refreshes after actions (e.g., Generate matches, score input); prefer in-place UI updates.

---

## Schedule Page Controls
- Stage toggle: Group Stage / Knockout; courts, locks, rest, in-play guard, queue, and Force Next are stage-scoped
- Live Courts view is split into Playing (court assignments) and Upcoming (top 5 eligible)
- Auto Schedule is permanently disabled; court assignment is manual-only
- Playing actions: Back to Queue, Block (default reason: injury / absent), Completed (verify DB), Lock, Assign Next
- Queue view filters: Status (Eligible/Blocked) + Category
- Force Next elevates a match to the top of eligible order and persists across refresh
- Matches with players already in Playing are not eligible for assignment
- Matches with in-play players can still appear in Queue/Upcoming; they are only blocked from court assignment
- Empty courts show a muted note when no assignable match exists due to in-play conflicts
- Queue controls include per-match “Back to correct position” and global “Reset the Queue” for forced priorities
- Back to Queue on a playing court swaps in the next assignable match when possible
- Back to Queue always clears the court; it does not auto-swap in a replacement match
- Upcoming is derived from the sorted queue as the next playable set with no duplicate players
- Upcoming prioritizes Force Next matches when selecting the next playable set
- Upcoming selection is forced-first (before normal queue items), while still avoiding duplicate players
- Forced matches show a “Forced” badge in Upcoming and Queue
- Forced detection uses consistent matchKey mapping (GROUP:<id> / KNOCKOUT:<id>)
- Schedule debug logs can be enabled via SCHEDULE_DEBUG / NEXT_PUBLIC_SCHEDULE_DEBUG
- Upcoming tiers run forced assignable + forced waiting before normal assignable + normal waiting; Forced badge is red
- Courts are always active on the Schedule page; Lock/Unlock is the only restriction.
- Rested players are computed from playing courts + latest 5 completed matches (DB-based, stage-scoped)
- Last batch is derived from latest 5 effective assignments (canceled assignments excluded)

---

## Schedule Overview Page
- Route: `/schedule-overview`
- Static timetable for group stage matches only (no knockout)
- Configurable timing criteria via query params: `slotMinutes`, `startTime`, `bufferMinutes`
- Defaults: `slotMinutes=20`, `startTime=12:30 PM`, `bufferMinutes=0`
- Slot timeline spacing uses `(slotMinutes + bufferMinutes)`
- Lays out 5 courts in parallel (Court 1 through Court 5)
- Uses per-slot rest from previous slot only, independent of Schedule.md rest logic
- Enforces no player overlaps within a time slot; fairness-first priority
- Fairness upgrade: no Force; hard cap consecutive <= 2 and total consecutive <= 2; courts may idle
- Consecutive selection is weighted against high totalMatchesPlanned players
- UI highlights players in consecutive runs across slots, with per-player colors
- Shows a "Consecutive Ranking" table summarizing streak totals per player
- Analytics-only: overview ignores match completion status (uses all group matches)

---

## Broadcast Page
- Route: `/broadcast` (admin-only)
- Purpose: TV-friendly live display for Playing + Upcoming matches
- Layout/style mirrors `/presenting` without favourite-player highlighting
- Stage toggle supports Group / Knockout via query param (`?stage=group|ko`)
- Uses Supabase Realtime to refresh on schedule-relevant changes
- Fallback polling refresh runs every 10 seconds when realtime is unavailable

---

## Auth & Permissions
- Roles:
  - **Admin** (username: `admin`, password from `ADMIN_PASSWORD` env; defaults to `Starhub` locally)
  - **Viewer** (public, read-only)
- Admin login route: `/login`
- Session is stored in an **HttpOnly** cookie signed with `AUTH_SECRET`
- Viewer access:
  - Can view Standings, Brackets, and Schedule (Live Courts only)
  - All server-side mutations require Admin

### Favourite Player (Viewer)
- Viewer can set a favourite player on `/` (stored in `tg_fav_player_id` cookie)
- Favourite player is used to auto-configure:
  - Standings: category + group
  - Brackets: category + series
  - Schedule: highlight name only

### Required Environment Variables
- `AUTH_SECRET` (required for signing session cookies)
- `ADMIN_PASSWORD` (recommended; defaults to `Starhub` for local dev)


-------------------------
## Codex Response template
-------------------------
# Codex Change Report

## 1) Outcome (1–3 lines)
- Goal:
- Result:
- Risk level: Low / Medium / High (why in 1 line)

## 2) What Changed (structured)
### A) Behavior / Logic Changes
- [Change] → [Why] → [Impact]
- …

### B) Non-behavior Changes (refactor / formatting / comments)
- [Change] → [Why]
- …

### C) Breaking / Compatibility Notes (if any)
- [What breaks] → [Who impacted] → [Mitigation]
- If none: None

## 3) Files Touched (always complete list)
> One line per file. No duplicates. No bare filenames.
- `path/to/file.ext` — reason (what changed + why)
- …

## 4) Data / Schema / Config Impact
### Database migrations
- Migration(s): [name(s)]
- Command(s): `npx prisma migrate ...` / `supabase db ...`
- If none: **No migrations required**

### Secrets / Env vars
- Added:
- Changed:
- Required locally:
- Required in prod:
- If none: None

### External setup required (mandatory callout)
- Supabase dashboard steps / Vercel env updates / new buckets / RLS policies
- If none: None

## 5) Validation Evidence (must be reproducible)
### Automated
- Tests run:
  - `npm test` → PASS/FAIL (+ counts if available)
  - `npm run lint` → PASS/FAIL
- If not run: Explicit reason + what to run

### Manual
- Steps executed:
  1.
  2.
- Observed results (paste key outputs / status codes):
  - …
- If not done: Explicit reason + steps to validate

## 6) Acceptance Criteria (pass/fail)
- AC1: [observable condition] — PASS/FAIL — evidence: [link/log/output]
- AC2: …
- If any FAIL: list follow-ups

## 7) Edge Cases Checked
- Case:
- Result:
- If none: Explicitly state “Not checked” + why

## 8) Next Actions / Follow-ups
- [Owner: Codex/User] [Priority: P0/P1/P2] [Due: optional] — action
- …

---

# Mandatory Summary (always at the end)
## Files changed (with brief reasons)
- …

## Database migrations
- **No migrations required** / [list + commands]

## Documentation updates
- `Agents.md` updated: Yes/No — reason
- `[OtherDoc].md` updated: Yes/No — reason
- If none: “No documentation updates (behavior unchanged)”
