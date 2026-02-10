# Codex Fast Prompt - Auto Chooser (Bug Fix / Feature / UI)

You are Codex working inside this repo.

## Read First
1. `Agents.md`
2. `SPEC.md`
3. `docs/ARCHITECTURE.md`
4. `DECISIONS.md`
5. `README.md`

## Input
- Task request:
- User impact:
- Done means:

## Auto-Select Mode
Pick exactly one mode from the task request, then execute:
- `BUG_FIX_ONLY`: broken behavior, regressions, errors, wrong outputs.
- `NEW_FEATURE_ONLY`: adds new behavior/capability/flow.
- `NEW_UI_ONLY`: visual/layout/UX-only change without business logic changes.

If ambiguous, choose the smallest safe mode and state assumption in plan.

## Shared Hard Rules
- Follow tournament rules and permissions in `Agents.md` exactly.
- Keep diffs minimal and scoped to the selected mode.
- No unrelated refactor/renames/cleanup.
- No silent core logic or data model changes.
- Update tests when behavior changes or a bug is fixed.
- Update `SPEC.md` / `DECISIONS.md` only if requirements/decisions change.
- Avoid full page refreshes after actions; prefer in-place updates.

## Mode-Specific Constraints
### If `BUG_FIX_ONLY`
- Change only what is required to resolve the reported bug.
- Add regression test(s) proving the fix.

### If `NEW_FEATURE_ONLY`
- Preserve current behavior outside feature scope.
- Add tests for new behavior and key edge cases.

### If `NEW_UI_ONLY`
- Keep business logic unchanged unless explicitly requested.
- Ensure responsive (desktop/mobile) and accessible states.

## Scope Control
- Files allowed:
  -
- Files forbidden:
  -

If out-of-scope changes are required, stop and justify first.

## Plan (brief)
1. Confirm selected mode + assumption.
2. Minimal implementation strategy.
3. Test/validation strategy.
4. Risk note.

Then implement.

## Acceptance Criteria (pass/fail)
- AC1:
- AC2:
- AC3:

## Required Final Output
Return only the repo-standard `Codex Change Report` format defined in `Agents.md`.
