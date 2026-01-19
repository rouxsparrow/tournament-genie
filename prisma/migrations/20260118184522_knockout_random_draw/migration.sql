-- CreateTable
CREATE TABLE "KnockoutRandomDraw" (
    "id" TEXT NOT NULL,
    "categoryCode" "CategoryCode" NOT NULL,
    "series" "Series" NOT NULL,
    "round" INTEGER NOT NULL,
    "drawKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnockoutRandomDraw_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "KnockoutRandomDraw_drawKey_key" ON "KnockoutRandomDraw"("drawKey");

-- CreateIndex
CREATE INDEX "KnockoutRandomDraw_categoryCode_series_round_idx" ON "KnockoutRandomDraw"("categoryCode", "series", "round");
