-- CreateTable
CREATE TABLE "RefereeGuideline" (
    "id" TEXT NOT NULL,
    "mainRefereeSections" JSONB NOT NULL DEFAULT '[]',
    "lineRefereeSections" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RefereeGuideline_pkey" PRIMARY KEY ("id")
);
