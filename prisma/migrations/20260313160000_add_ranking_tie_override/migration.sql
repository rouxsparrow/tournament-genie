CREATE TYPE "RankingTieScope" AS ENUM ('GROUP_STANDINGS', 'GLOBAL_GROUP_RANKING');

CREATE TABLE "RankingTieOverride" (
    "id" TEXT NOT NULL,
    "scope" "RankingTieScope" NOT NULL,
    "categoryCode" "CategoryCode" NOT NULL,
    "groupId" TEXT,
    "tieKey" TEXT NOT NULL,
    "orderedTeamIds" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RankingTieOverride_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RankingTieOverride_tieKey_key" ON "RankingTieOverride"("tieKey");
CREATE INDEX "RankingTieOverride_scope_categoryCode_idx" ON "RankingTieOverride"("scope", "categoryCode");
CREATE INDEX "RankingTieOverride_groupId_idx" ON "RankingTieOverride"("groupId");

ALTER TABLE "RankingTieOverride" ADD CONSTRAINT "RankingTieOverride_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
