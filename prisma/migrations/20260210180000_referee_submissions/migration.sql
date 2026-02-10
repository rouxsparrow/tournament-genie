-- CreateTable
CREATE TABLE "RefereeSubmission" (
    "id" TEXT NOT NULL,
    "matchType" "MatchType" NOT NULL,
    "categoryCode" "CategoryCode" NOT NULL,
    "lockState" BOOLEAN NOT NULL DEFAULT false,
    "submittedBy" TEXT NOT NULL,
    "scores" JSONB NOT NULL,
    "notes" TEXT,
    "groupMatchId" TEXT,
    "knockoutMatchId" TEXT,
    "series" "Series",
    "round" INTEGER,
    "matchNo" INTEGER,
    "isBestOf3" BOOLEAN,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefereeSubmission_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "RefereeSubmission_groupMatchId_idx" ON "RefereeSubmission"("groupMatchId");
CREATE INDEX "RefereeSubmission_knockoutMatchId_idx" ON "RefereeSubmission"("knockoutMatchId");
CREATE INDEX "RefereeSubmission_submittedAt_idx" ON "RefereeSubmission"("submittedAt");
CREATE INDEX "RefereeSubmission_matchType_submittedAt_idx" ON "RefereeSubmission"("matchType", "submittedAt");

-- Foreign keys
ALTER TABLE "RefereeSubmission"
ADD CONSTRAINT "RefereeSubmission_groupMatchId_fkey"
FOREIGN KEY ("groupMatchId") REFERENCES "Match"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RefereeSubmission"
ADD CONSTRAINT "RefereeSubmission_knockoutMatchId_fkey"
FOREIGN KEY ("knockoutMatchId") REFERENCES "KnockoutMatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Exactly one match reference must be set
ALTER TABLE "RefereeSubmission"
ADD CONSTRAINT "RefereeSubmission_exactly_one_match_ref"
CHECK (
  ("groupMatchId" IS NOT NULL AND "knockoutMatchId" IS NULL)
  OR
  ("groupMatchId" IS NULL AND "knockoutMatchId" IS NOT NULL)
);
