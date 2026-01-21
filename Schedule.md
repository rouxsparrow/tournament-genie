# Schedule – Real-Time Court Scheduling Rules

This document defines how matches are scheduled in real time to ensure smooth flow,
fair rest, and efficient court usage.

---

## 1. Courts

Courts are treated **equally** (no priority courts).

---

## 2. Match Types

### Group Stage Matches
- Scheduled with highest priority
- Used to determine standings and knockout qualification

### Knockout (KO) Matches
- Includes Series A and Series B (with Second Chance logic)
- KO matches are eligible for scheduling **only after the knockout bracket is generated**
- Bracket generation implies:
  - Group stage for that category is completed
  - KO participants are fixed

---

## 3. Early Knockout Scheduling

- Group matches always have priority over knockout matches
- Knockout matches may be scheduled **while other group matches are still running**
  as long as:
  - The KO bracket exists
  - No eligible group-stage match is available at that moment

### In-Play Guard
- A match **may appear** in Queue and Upcoming even if its players are currently playing.
- A match **must not be assigned** to a court if any of its players are currently in a Playing (active) court assignment.
- When filling a free court, skip matches that conflict with in-play players.

---

## 4. Real-Time Scheduling Model (Rolling)

Scheduling is **rolling**, not fixed-slot:

- Matches finish at different times
- Whenever a court becomes free, the scheduler immediately selects the next match
- Courts should never idle if eligible matches exist

### Playing vs Upcoming
- **Playing** = matches currently assigned to courts
- **Upcoming** = next playable set of up to 5 matches from the sorted Queue
- Upcoming avoids duplicate players within itself
- Upcoming prioritizes Force Next matches first (assignable, then waiting) before normal matches
- Upcoming is recalculated whenever scheduling runs

---

## 5. Rest & Fairness Priority (Core Rule)

When selecting the next match to schedule, prioritize **player rest**.

### Definition: “Rested”
- A player is **rested** if and only if:
  1) They are **not currently assigned** to any Playing (active) court, AND
  2) They **do not appear** in the latest 5 **COMPLETED** matches (ordered by completedAt DESC)

### Priority Order
When scheduling a match, prefer matches where:
1) **4 rested players**
2) then **3**
3) then **2**
4) then **1**
5) finally **0** (back-to-back matches accepted if unavoidable)

### Priority Type
- **Soft priority**
- Scheduler prefers higher rest count but may relax the rule to avoid blocking progress

This rule applies **across all categories** (MD / WD / XD).

### Resting Source of Truth
- Resting is computed from **DB state only** (completed matches + active courts).
- Scheduling batches or UI history do not affect rest calculation.

### Tie-breaks (when rest score is equal)
Use the following deterministic order:
1) Group matches before KO
2) Category code (MD, WD, XD)
3) KO round (later rounds first)
4) Match ID (stable fallback)

---

## 6. Category Handling
- Categories are **independent**
- Matches from MD / WD / XD may be mixed freely on any court
- Player rest is tracked across categories

---

## 7. Knockout Match Scheduling

- Knockout matches are scheduled **only when no eligible group match exists**
- When multiple KO matches are eligible:
  - Prefer later rounds (Semifinals / Finals) as a **soft preference**
  - No hard reservation window
- Knockout round mapping (global):
  - Round 1 = Play-ins (Series B only, when Second Chance + play-ins needed)
  - Round 2 = Quarterfinals (Series A starts here)
  - Round 3 = Semifinals
  - Round 4 = Final

---

## 8. Second Chance Logic (Per Category)

- Second Chance is configured **per category**
- When enabled:
  - Losers of Series A Quarterfinals automatically drop into Series B Quarterfinals
  - This auto-placement applies both in:
    - real-time “Save result”
    - DB sync on page load
- Scheduling respects updated brackets immediately

---

## 9. Admin Controls (Schedule Page)

Admin has full control for urgent or manual adjustments:

- **Force-schedule** a specific match to the next free court
- **Block a match** temporarily (injury, break, dispute)
- **Lock / unlock a court**
- Overrides do not change tournament rules, only scheduling order

### Force Next (Priority Override)
- Admin can flag a match as **Force Next** to move it to the top of the eligible order
- Force Next persists across refresh until the match is scheduled or becomes ineligible

---

## 10. Non-Goals (Out of Scope for Scheduler)

- No prediction of match duration
- No automatic court assignment by category
- No forced rest enforcement (rest is best-effort, not mandatory)

---

## 11. Design Principles

- Never idle courts unnecessarily
- Prioritize fairness but ensure progress
- Avoid deadlocks
- Deterministic and explainable behavior
- Admin can always override in exceptional cases

## 12. Auto-Schedule Behavior
- If Auto Schedule is ON, the scheduler fills free courts from Upcoming
- If Auto Schedule is OFF, matches are never auto-assigned
- On refresh, any Playing match that is completed or ineligible is removed

---

## Schedule Overview (Planning)
- Overview is separate from live scheduling
- Hard cap: no player may be scheduled more than 2 consecutive slots
- Hard cap: total consecutive matches per player is capped at 2
- Fairness-first: courts may remain idle if constraints prevent assignment
- Avoid consecutive assignments for high totalMatchesPlanned players
- Rest badge uses only the previous slot (Rest: X/4)
- Overview ignores completion status (analytics uses all group matches)

---

End of Schedule.md
