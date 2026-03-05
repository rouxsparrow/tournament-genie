-- CreateTable
CREATE TABLE "TournamentFormat" (
    "id" TEXT NOT NULL,
    "sections" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TournamentFormat_pkey" PRIMARY KEY ("id")
);
