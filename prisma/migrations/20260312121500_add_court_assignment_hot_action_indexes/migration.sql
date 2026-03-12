-- Hot action lookup indexes for schedule mutations
CREATE INDEX IF NOT EXISTS "CourtAssignment_stage_status_courtId_idx"
ON "CourtAssignment"("stage", "status", "courtId");

CREATE INDEX IF NOT EXISTS "CourtAssignment_stage_status_groupMatchId_idx"
ON "CourtAssignment"("stage", "status", "groupMatchId");

CREATE INDEX IF NOT EXISTS "CourtAssignment_stage_status_knockoutMatchId_idx"
ON "CourtAssignment"("stage", "status", "knockoutMatchId");
