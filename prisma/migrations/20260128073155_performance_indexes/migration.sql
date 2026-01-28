-- CreateIndex
CREATE INDEX "CourtAssignment_groupMatchId_idx" ON "CourtAssignment"("groupMatchId");

-- CreateIndex
CREATE INDEX "CourtAssignment_knockoutMatchId_idx" ON "CourtAssignment"("knockoutMatchId");

-- CreateIndex
CREATE INDEX "KnockoutMatch_homeTeamId_idx" ON "KnockoutMatch"("homeTeamId");

-- CreateIndex
CREATE INDEX "KnockoutMatch_awayTeamId_idx" ON "KnockoutMatch"("awayTeamId");

-- CreateIndex
CREATE INDEX "KnockoutMatch_winnerTeamId_idx" ON "KnockoutMatch"("winnerTeamId");

-- CreateIndex
CREATE INDEX "KnockoutMatch_nextMatchId_idx" ON "KnockoutMatch"("nextMatchId");

-- CreateIndex
CREATE INDEX "KnockoutSeed_teamId_idx" ON "KnockoutSeed"("teamId");

-- CreateIndex
CREATE INDEX "Match_homeTeamId_idx" ON "Match"("homeTeamId");

-- CreateIndex
CREATE INDEX "Match_awayTeamId_idx" ON "Match"("awayTeamId");

-- CreateIndex
CREATE INDEX "Match_winnerTeamId_idx" ON "Match"("winnerTeamId");

-- CreateIndex
CREATE INDEX "SeriesQualifier_teamId_idx" ON "SeriesQualifier"("teamId");
