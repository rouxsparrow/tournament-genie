/*
  Warnings:

  - A unique constraint covering the columns `[teamId]` on the table `GroupTeam` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "GroupTeam_teamId_key" ON "GroupTeam"("teamId");
