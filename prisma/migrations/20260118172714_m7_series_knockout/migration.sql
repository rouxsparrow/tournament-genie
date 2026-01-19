-- CreateEnum
CREATE TYPE "Series" AS ENUM ('A', 'B');

-- CreateTable
CREATE TABLE "SeriesQualifier" (
    "id" TEXT NOT NULL,
    "categoryCode" "CategoryCode" NOT NULL,
    "series" "Series" NOT NULL,
    "groupId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "groupRank" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SeriesQualifier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnockoutMatch" (
    "id" TEXT NOT NULL,
    "categoryCode" "CategoryCode" NOT NULL,
    "series" "Series" NOT NULL,
    "round" INTEGER NOT NULL,
    "matchNo" INTEGER NOT NULL,
    "homeTeamId" TEXT,
    "awayTeamId" TEXT,
    "winnerTeamId" TEXT,
    "status" "MatchStatus" NOT NULL DEFAULT 'SCHEDULED',
    "nextMatchId" TEXT,
    "nextSlot" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnockoutMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CategoryConfig" (
    "categoryCode" "CategoryCode" NOT NULL,
    "secondChanceEnabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CategoryConfig_pkey" PRIMARY KEY ("categoryCode")
);

-- CreateIndex
CREATE INDEX "SeriesQualifier_categoryCode_series_idx" ON "SeriesQualifier"("categoryCode", "series");

-- CreateIndex
CREATE INDEX "SeriesQualifier_groupId_idx" ON "SeriesQualifier"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "SeriesQualifier_categoryCode_series_teamId_key" ON "SeriesQualifier"("categoryCode", "series", "teamId");

-- CreateIndex
CREATE INDEX "KnockoutMatch_categoryCode_series_idx" ON "KnockoutMatch"("categoryCode", "series");

-- CreateIndex
CREATE UNIQUE INDEX "KnockoutMatch_categoryCode_series_round_matchNo_key" ON "KnockoutMatch"("categoryCode", "series", "round", "matchNo");

-- AddForeignKey
ALTER TABLE "SeriesQualifier" ADD CONSTRAINT "SeriesQualifier_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeriesQualifier" ADD CONSTRAINT "SeriesQualifier_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnockoutMatch" ADD CONSTRAINT "KnockoutMatch_homeTeamId_fkey" FOREIGN KEY ("homeTeamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnockoutMatch" ADD CONSTRAINT "KnockoutMatch_awayTeamId_fkey" FOREIGN KEY ("awayTeamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnockoutMatch" ADD CONSTRAINT "KnockoutMatch_winnerTeamId_fkey" FOREIGN KEY ("winnerTeamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnockoutMatch" ADD CONSTRAINT "KnockoutMatch_nextMatchId_fkey" FOREIGN KEY ("nextMatchId") REFERENCES "KnockoutMatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
