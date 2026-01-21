-- CreateEnum
CREATE TYPE "ScheduleStage" AS ENUM ('GROUP', 'KNOCKOUT');

-- DropIndex
DROP INDEX "CourtAssignment_courtId_status_idx";

-- AlterTable
ALTER TABLE "CourtAssignment" ADD COLUMN     "stage" "ScheduleStage" NOT NULL DEFAULT 'GROUP';

-- AlterTable
ALTER TABLE "ScheduleConfig" ADD COLUMN     "stage" "ScheduleStage" NOT NULL DEFAULT 'GROUP';

-- CreateTable
CREATE TABLE "CourtStageLock" (
    "id" TEXT NOT NULL,
    "courtId" TEXT NOT NULL,
    "stage" "ScheduleStage" NOT NULL,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "lockReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourtStageLock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CourtStageLock_stage_idx" ON "CourtStageLock"("stage");

-- CreateIndex
CREATE UNIQUE INDEX "CourtStageLock_courtId_stage_key" ON "CourtStageLock"("courtId", "stage");

-- CreateIndex
CREATE INDEX "CourtAssignment_courtId_status_stage_idx" ON "CourtAssignment"("courtId", "status", "stage");

-- CreateIndex
CREATE INDEX "ScheduleConfig_stage_idx" ON "ScheduleConfig"("stage");

-- AddForeignKey
ALTER TABLE "CourtStageLock" ADD CONSTRAINT "CourtStageLock_courtId_fkey" FOREIGN KEY ("courtId") REFERENCES "Court"("id") ON DELETE CASCADE ON UPDATE CASCADE;
