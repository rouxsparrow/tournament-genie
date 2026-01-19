/*
  Warnings:

  - A unique constraint covering the columns `[groupId,homeTeamId,awayTeamId]` on the table `Match` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateTable
CREATE TABLE "GroupAssignmentLock" (
    "categoryCode" "CategoryCode" NOT NULL,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "lockedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GroupAssignmentLock_pkey" PRIMARY KEY ("categoryCode")
);

-- CreateIndex
CREATE UNIQUE INDEX "Match_groupId_homeTeamId_awayTeamId_key" ON "Match"("groupId", "homeTeamId", "awayTeamId");
