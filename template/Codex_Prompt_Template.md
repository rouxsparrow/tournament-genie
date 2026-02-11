# Codex Prompt Template (Clean + Low-Token Workflow)

> **Operating mode:** You are **Codex** working inside this repo. Follow **token discipline**: do not paste large code blocks in chat; create/edit files directly. :contentReference[oaicite:0]{index=0}

---

## 0) Read-First (source of truth order)
1. `Agents.md`
2. `SPEC.md`
3. `docs/ARCHITECTURE.md`
4. `TASKS.md`
5. `DECISIONS.md`
6. `README.md`

If any are missing, **create minimal versions** first (do not invent product details).

---

## 1) Goal
**What I want changed (1–3 lines):**
- Goal:
- Why now / user impact:
- Done means:

---

## 2) Current State Evidence (required)
**Observed behavior / errors (paste exact evidence):**
- Logs / stack traces:
- Screenshots description (if any):
- Current vs expected behavior:
- Repro steps (minimal):
  1)
  2)
- Environment:
  - OS:
  - Node:
  - Package manager:
  - Relevant env vars (redact secrets):

---

## 3) Non-Negotiables (hard rules)
**MUST follow:**
- Generate the solution strictly based on repo docs (see Read-First) and existing code patterns.
- **Do NOT** silently change existing logic or behavior outside the described fix.
- **Do NOT** refactor unrelated code or rename things “for cleanliness.”
- Keep diffs **minimal & targeted**.
- Update `SPEC.md` / `DECISIONS.md` **only if** behavior/requirements/decisions change.
- Add/update tests when behavior changes or a bug is fixed.

---

## 4) Scope / Blast Radius
**Allowed to modify only:**
- `path/to/fileA`
- `path/to/fileB`
- `tests/...`

**Explicitly forbidden:**
- (list folders/files to avoid)

If you must touch a file outside scope: **stop and justify in the report before doing so**.

---

## 5) Approach (plan before coding)
**Write a short execution plan (max ~10 bullets):**
1. Root cause hypothesis (tie to evidence)
2. Fix strategy (minimal change)
3. Test strategy (what to add/adjust)
4. Risk notes + rollback idea (if relevant)

Then implement.

---

## 6) Acceptance Criteria (verifiable)
Write pass/fail checks only (no vague statements):
- AC1:
- AC2:
- AC3:

---

## 7) Output Required (strict)
When finished, respond with **ONLY** the following:

====================================================================
# Codex Change Report

## 1) Outcome (1–3 lines)
- Goal:
- Result:
- Risk level: Low / Medium / High — why (1 line)

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

## 3) Files Touched (complete list)
> One line per file. No duplicates. No bare filenames.
- `path/to/file.ext` — reason (what + why)
- …

## 4) Data / Schema / Config Impact
### Database migrations
- Migration(s):
- Command(s):
- If none: **No migrations required**

### Secrets / Env vars
- Added:
- Changed:
- Required locally:
- Required in prod:
- If none: None

### External setup required
- Dashboards / CI / hosting / storage / RLS policies
- If none: None

## 5) Validation Evidence (reproducible)
### Automated
- `npm test` → PASS/FAIL (include key output)
- `npm run lint` → PASS/FAIL
- `npm run typecheck` → PASS/FAIL
- If not run: reason + exact commands to run

### Manual
- Steps executed:
  1.
  2.
- Observed results:
  - …

## 6) Acceptance Criteria (pass/fail)
- AC1: … — PASS/FAIL — evidence:
- AC2: … — PASS/FAIL — evidence:
- If any FAIL: list follow-ups

## 7) Edge Cases Checked
- Case:
- Result:
- If none: “Not checked” + why

## 8) Next Actions / Follow-ups
- [Owner: Codex/User] [Priority: P0/P1/P2] — action
- …

---

# Mandatory Summary (always at the end)
## Files changed (brief reasons)
- …

## Database migrations
- **No migrations required** / [list + commands]

## Documentation updates
- `Agents.md` updated: Yes/No — reason
- `SPEC.md` updated: Yes/No — reason
- `DECISIONS.md` updated: Yes/No — reason
- If none: “No documentation updates (behavior unchanged)”
====================================================================
