# Schedule Overview (Planning)

This document defines the static overview schedule generation for
`/schedule-overview`. It is separate from the live scheduler.

## Scope
- Group stage matches only (no knockout)
- Matches must have both teams set
- Ignores match completion status (includes all generated group matches)

## Slot Model
- 20-minute slots
- Start time: 12:30 PM
- 5 courts per slot (P5–P9)
- Generate slots until all matches are placed or a safety cap is reached

## Hard Constraint
- No player can appear in two matches within the same slot.

## Rest Model (Overview Only)
Rest badge uses: `Rest = count of players who did NOT play in slotIndex-1`.

## Consecutive Cap (Hard Rule)
Maintain `playedSlotsByPlayer[playerId]` (list of slot indexes played).
A match is ineligible if any player would play in 3 straight slots.
Total consecutive matches per player are capped at 2.

## Fairness Priority (Deterministic)
Rank candidates by:
1) Lower consecutive risk penalty for high totalMatchesPlanned players
2) Higher Rest (from previous slot)
3) Category order (MD, WD, XD)
4) Group label (A, B, C...)
5) Match ID

## Per-Slot Selection
For each slot:
- Fill courts P5..P9 sequentially
- Skip any match that overlaps slot players
- Skip any match that would exceed consecutive 2
- Leave a court empty if no match fits

## Determinism
Identical DB state produces identical schedules.
Force/Forced Next logic is ignored.

## Consecutive Ranking
The overview page includes a "Consecutive Ranking" list computed from the
generated slots:
- Total consecutive matches (played in slot t and t-1)
- Max consecutive run length
- Total matches
