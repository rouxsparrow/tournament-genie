-- AlterTable
ALTER TABLE "KnockoutMatch" ADD COLUMN     "isPublished" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "KnockoutGameScore" (
    "id" TEXT NOT NULL,
    "knockoutMatchId" TEXT NOT NULL,
    "gameNumber" INTEGER NOT NULL,
    "homePoints" INTEGER NOT NULL,
    "awayPoints" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnockoutGameScore_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "KnockoutGameScore_knockoutMatchId_gameNumber_key" ON "KnockoutGameScore"("knockoutMatchId", "gameNumber");

-- AddForeignKey
ALTER TABLE "KnockoutGameScore" ADD CONSTRAINT "KnockoutGameScore_knockoutMatchId_fkey" FOREIGN KEY ("knockoutMatchId") REFERENCES "KnockoutMatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
