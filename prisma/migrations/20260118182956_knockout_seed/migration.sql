-- CreateTable
CREATE TABLE "KnockoutSeed" (
    "id" TEXT NOT NULL,
    "categoryCode" "CategoryCode" NOT NULL,
    "series" "Series" NOT NULL,
    "teamId" TEXT NOT NULL,
    "seedNo" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnockoutSeed_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KnockoutSeed_categoryCode_series_idx" ON "KnockoutSeed"("categoryCode", "series");

-- CreateIndex
CREATE UNIQUE INDEX "KnockoutSeed_categoryCode_series_teamId_key" ON "KnockoutSeed"("categoryCode", "series", "teamId");

-- CreateIndex
CREATE UNIQUE INDEX "KnockoutSeed_categoryCode_series_seedNo_key" ON "KnockoutSeed"("categoryCode", "series", "seedNo");

-- AddForeignKey
ALTER TABLE "KnockoutSeed" ADD CONSTRAINT "KnockoutSeed_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
