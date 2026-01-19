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
2. Point difference (pointsFor - pointsAgainst)
3. Points scored
4. Head-to-head (only if tied teams played each other)
5. Random draw (stored; last resort)

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
- **Top half** of each group -> **Series A**
- **Bottom half** -> **Series B**
- **Always prioritize Series A to have exactly 8 teams** (to form Quarterfinals).
- If Series A does not have 8 teams after initial split, adjust by moving teams between Series A and Series B within the same category until **Series A = 8**.
- When choosing which team(s) to move, use **lowest-ranked teams in Series A overall** (based on groupRank tier first; do not compare raw totals across uneven groups).
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
  1) **Average PA per match** (PA / matchesPlayed) -- **higher Avg PA is weaker**
  2) If still tied, **random draw (stored)**

### No byes
- Knockout stages must NOT use byes.
- No automatic advancement: teams only progress by winning a match.
- If the number of teams does not fit the desired bracket size, use **play-in elimination matches**.

### Series Qualification Boundary (Important)
- Knockout brackets MUST be generated ONLY from the qualified teams of that series.
- Series A bracket must use ONLY the 8 Series A qualified teams.
- Series A seeding must follow the top-8 Global Group Stage Ranking order.
- A non-qualified team (e.g., global rank #9+) must never appear in Series A bracket.

### Series A Qualification Source (Important)
- Series A is determined by taking the **top 8 teams** from the **Global Group Stage Ranking** (within the same category).
- Global Group Stage Ranking order is based on the locked standings tie-break rules (wins, point difference, points for, head-to-head, stored random draw).
- Series A must contain exactly those 8 teams (ranks #1-#8).
- Teams outside rank #8 must not appear in Series A.

## Series Stage

### Default Format
- **Single-elimination (KO)** brackets
- Series A and Series B are separate

### Women's Doubles (WD) Special Case
- WD uses **Series A only** (no Series B)
- WD **minimum teams: 4**, **maximum teams: 8**
- If WD has **< 8 teams**, Series A starts at **Semifinals** using the **top 4** from group stage ranking
- If WD has **8 teams**, Series A starts at **Quarterfinals** using top-8 group stage ranking + Avg PA seeding rules
- **Second chance is not available** for WD

### Second-Chance Rule (Configurable)
At tournament creation:
- `secondChanceEnabled`: true / false

## Second Chance (Series A Losers Drop to Series B)

If `secondChanceEnabled: true`:

- The **4 losers of Series A Quarterfinals** drop into **Series B Quarterfinals**.
- Series B Quarterfinals must always have **8 teams total**:
  - 4 teams = the dropped Series A QF losers
  - 4 teams = selected from original Series B via play-ins

### How many Series B play-in matches?
Let `B` be the number of original Series B teams.
- We must qualify exactly **4** of them into Series B QF.
- Number of elimination matches required: `B - 4`
- Teams playing in play-ins: `2 * (B - 4)`
- Teams that wait directly for QF: `8 - B` (these are the strongest teams)

### Selecting teams that wait for QF (strongest)
Select the strongest `8 - B` teams from Series B using:
1) groupRank tier (e.g., #1 > #2 > #3)
2) Avg PA per match (lower is stronger)
3) stored random draw

### Pairing play-ins
Pair the play-in teams using:
- avoid same-group pairing whenever possible
- if multiple valid opponents in same tier exist, use Avg PA per match (higher = weaker) as decider; if still tied use stored random draw
- A-drop losers never play each other in Series B Quarterfinals; each QF match contains exactly one A-drop loser.
- Series B Play-ins use: avoid same-group where possible + groupRank tier + Avg PA + stored draw.
- Series B Quarterfinals pairing uses only: groupRank tier + Avg PA + stored draw (no highest-vs-lowest seeding rule; no same-group constraint unless later specified).
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
