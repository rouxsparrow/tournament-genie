-- CreateEnum
CREATE TYPE "MatchType" AS ENUM ('GROUP', 'KNOCKOUT');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('ACTIVE', 'CLEARED');

-- CreateTable
CREATE TABLE "ScheduleConfig" (
    "id" TEXT NOT NULL,
    "dayStartAt" TIMESTAMP(3) NOT NULL,
    "firstPhaseCourts" INTEGER NOT NULL DEFAULT 5,
    "firstPhaseMinutes" INTEGER NOT NULL DEFAULT 420,
    "secondPhaseCourts" INTEGER NOT NULL DEFAULT 2,
    "secondPhaseMinutes" INTEGER NOT NULL DEFAULT 120,
    "autoScheduleEnabled" BOOLEAN NOT NULL DEFAULT false,
    "lastBatch" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScheduleConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Court" (
    "id" TEXT NOT NULL,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "lockReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Court_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourtAssignment" (
    "id" TEXT NOT NULL,
    "courtId" TEXT NOT NULL,
    "matchType" "MatchType" NOT NULL,
    "groupMatchId" TEXT,
    "knockoutMatchId" TEXT,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clearedAt" TIMESTAMP(3),
    "status" "AssignmentStatus" NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "CourtAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlockedMatch" (
    "id" TEXT NOT NULL,
    "matchType" "MatchType" NOT NULL,
    "groupMatchId" TEXT,
    "knockoutMatchId" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BlockedMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleActionLog" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScheduleActionLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CourtAssignment_courtId_status_idx" ON "CourtAssignment"("courtId", "status");

-- CreateIndex
CREATE INDEX "BlockedMatch_matchType_idx" ON "BlockedMatch"("matchType");

-- AddForeignKey
ALTER TABLE "CourtAssignment" ADD CONSTRAINT "CourtAssignment_courtId_fkey" FOREIGN KEY ("courtId") REFERENCES "Court"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourtAssignment" ADD CONSTRAINT "CourtAssignment_groupMatchId_fkey" FOREIGN KEY ("groupMatchId") REFERENCES "Match"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourtAssignment" ADD CONSTRAINT "CourtAssignment_knockoutMatchId_fkey" FOREIGN KEY ("knockoutMatchId") REFERENCES "KnockoutMatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
