-- CreateIndex
CREATE INDEX "BlockedMatch_matchType_groupMatchId_idx" ON "BlockedMatch"("matchType", "groupMatchId");

-- CreateIndex
CREATE INDEX "BlockedMatch_matchType_knockoutMatchId_idx" ON "BlockedMatch"("matchType", "knockoutMatchId");
