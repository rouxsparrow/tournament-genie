-- AlterTable
ALTER TABLE "Match" ADD COLUMN     "winnerTeamId" TEXT;

-- CreateTable
CREATE TABLE "GroupStageLock" (
    "categoryCode" "CategoryCode" NOT NULL,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "lockedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GroupStageLock_pkey" PRIMARY KEY ("categoryCode")
);

-- CreateTable
CREATE TABLE "GroupRandomDraw" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "categoryCode" "CategoryCode" NOT NULL,
    "tieKey" TEXT NOT NULL,
    "orderedTeamIds" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupRandomDraw_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GroupRandomDraw_tieKey_key" ON "GroupRandomDraw"("tieKey");

-- CreateIndex
CREATE INDEX "GroupRandomDraw_groupId_idx" ON "GroupRandomDraw"("groupId");

-- CreateIndex
CREATE INDEX "GroupRandomDraw_categoryCode_idx" ON "GroupRandomDraw"("categoryCode");

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_winnerTeamId_fkey" FOREIGN KEY ("winnerTeamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupRandomDraw" ADD CONSTRAINT "GroupRandomDraw_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
