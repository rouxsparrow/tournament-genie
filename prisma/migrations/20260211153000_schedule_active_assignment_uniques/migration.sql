-- 1) One-time cleanup: keep newest ACTIVE assignment and cancel older duplicates.
--    Tie-breaker: assignedAt DESC, id DESC.

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY stage, "courtId"
      ORDER BY "assignedAt" DESC, id DESC
    ) AS rn
  FROM "CourtAssignment"
  WHERE status = 'ACTIVE'::"AssignmentStatus"
)
UPDATE "CourtAssignment" ca
SET
  status = 'CANCELED'::"AssignmentStatus",
  "clearedAt" = COALESCE(ca."clearedAt", NOW())
FROM ranked
WHERE ca.id = ranked.id
  AND ranked.rn > 1;

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY stage, "groupMatchId"
      ORDER BY "assignedAt" DESC, id DESC
    ) AS rn
  FROM "CourtAssignment"
  WHERE status = 'ACTIVE'::"AssignmentStatus"
    AND "groupMatchId" IS NOT NULL
)
UPDATE "CourtAssignment" ca
SET
  status = 'CANCELED'::"AssignmentStatus",
  "clearedAt" = COALESCE(ca."clearedAt", NOW())
FROM ranked
WHERE ca.id = ranked.id
  AND ranked.rn > 1;

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY stage, "knockoutMatchId"
      ORDER BY "assignedAt" DESC, id DESC
    ) AS rn
  FROM "CourtAssignment"
  WHERE status = 'ACTIVE'::"AssignmentStatus"
    AND "knockoutMatchId" IS NOT NULL
)
UPDATE "CourtAssignment" ca
SET
  status = 'CANCELED'::"AssignmentStatus",
  "clearedAt" = COALESCE(ca."clearedAt", NOW())
FROM ranked
WHERE ca.id = ranked.id
  AND ranked.rn > 1;

-- 2) Permanent DB guardrails against duplicate ACTIVE assignments.
CREATE UNIQUE INDEX "CourtAssignment_active_court_stage_key"
ON "CourtAssignment"("courtId", stage)
WHERE status = 'ACTIVE'::"AssignmentStatus";

CREATE UNIQUE INDEX "CourtAssignment_active_group_stage_key"
ON "CourtAssignment"("groupMatchId", stage)
WHERE status = 'ACTIVE'::"AssignmentStatus"
  AND "groupMatchId" IS NOT NULL;

CREATE UNIQUE INDEX "CourtAssignment_active_knockout_stage_key"
ON "CourtAssignment"("knockoutMatchId", stage)
WHERE status = 'ACTIVE'::"AssignmentStatus"
  AND "knockoutMatchId" IS NOT NULL;
