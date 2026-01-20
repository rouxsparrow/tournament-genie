-- CreateTable
CREATE TABLE "ForcedMatchPriority" (
    "id" TEXT NOT NULL,
    "matchType" "MatchType" NOT NULL,
    "matchId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ForcedMatchPriority_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ForcedMatchPriority_createdAt_idx" ON "ForcedMatchPriority"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ForcedMatchPriority_matchType_matchId_key" ON "ForcedMatchPriority"("matchType", "matchId");
