CREATE INDEX IF NOT EXISTS "CourtAssignment_stage_status_idx"
  ON "CourtAssignment"("stage", "status");

CREATE INDEX IF NOT EXISTS "CourtAssignment_stage_status_assignedAt_idx"
  ON "CourtAssignment"("stage", "status", "assignedAt");

CREATE INDEX IF NOT EXISTS "ForcedMatchPriority_matchType_createdAt_idx"
  ON "ForcedMatchPriority"("matchType", "createdAt");

CREATE INDEX IF NOT EXISTS "Match_stage_status_completedAt_idx"
  ON "Match"("stage", "status", "completedAt");

CREATE INDEX IF NOT EXISTS "KnockoutMatch_status_completedAt_idx"
  ON "KnockoutMatch"("status", "completedAt");

CREATE INDEX IF NOT EXISTS "KnockoutMatch_isPublished_categoryCode_series_round_matchNo_idx"
  ON "KnockoutMatch"("isPublished", "categoryCode", "series", "round", "matchNo");

CREATE INDEX IF NOT EXISTS "ScheduleActionLog_action_createdAt_idx"
  ON "ScheduleActionLog"("action", "createdAt");
