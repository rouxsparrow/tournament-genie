-- Remove unused WALKOVER status from MatchStatus enum.

UPDATE "Match"
SET "status" = 'COMPLETED'
WHERE "status" = 'WALKOVER';

UPDATE "KnockoutMatch"
SET "status" = 'COMPLETED'
WHERE "status" = 'WALKOVER';

CREATE TYPE "MatchStatus_new" AS ENUM ('SCHEDULED', 'COMPLETED');

ALTER TABLE "Match"
ALTER COLUMN "status" DROP DEFAULT,
ALTER COLUMN "status" TYPE "MatchStatus_new"
USING ("status"::text::"MatchStatus_new");

ALTER TABLE "KnockoutMatch"
ALTER COLUMN "status" DROP DEFAULT,
ALTER COLUMN "status" TYPE "MatchStatus_new"
USING ("status"::text::"MatchStatus_new");

DROP TYPE "MatchStatus";
ALTER TYPE "MatchStatus_new" RENAME TO "MatchStatus";

ALTER TABLE "Match"
ALTER COLUMN "status" SET DEFAULT 'SCHEDULED';

ALTER TABLE "KnockoutMatch"
ALTER COLUMN "status" SET DEFAULT 'SCHEDULED';
