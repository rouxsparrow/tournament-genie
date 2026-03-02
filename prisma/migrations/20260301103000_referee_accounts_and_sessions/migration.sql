-- CreateTable
CREATE TABLE "RefereeAccount" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "usernameNormalized" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RefereeAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefereeSession" (
    "id" TEXT NOT NULL,
    "refereeAccountId" TEXT NOT NULL,
    "sessionTokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefereeSession_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "RefereeSubmission"
ADD COLUMN "refereeAccountId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "RefereeAccount_usernameNormalized_key" ON "RefereeAccount"("usernameNormalized");

-- CreateIndex
CREATE INDEX "RefereeAccount_usernameNormalized_idx" ON "RefereeAccount"("usernameNormalized");

-- CreateIndex
CREATE UNIQUE INDEX "RefereeSession_sessionTokenHash_key" ON "RefereeSession"("sessionTokenHash");

-- CreateIndex
CREATE INDEX "RefereeSession_refereeAccountId_expiresAt_revokedAt_idx" ON "RefereeSession"("refereeAccountId", "expiresAt", "revokedAt");

-- CreateIndex
CREATE INDEX "RefereeSubmission_refereeAccountId_submittedAt_idx" ON "RefereeSubmission"("refereeAccountId", "submittedAt");

-- AddForeignKey
ALTER TABLE "RefereeSession"
ADD CONSTRAINT "RefereeSession_refereeAccountId_fkey"
FOREIGN KEY ("refereeAccountId") REFERENCES "RefereeAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefereeSubmission"
ADD CONSTRAINT "RefereeSubmission_refereeAccountId_fkey"
FOREIGN KEY ("refereeAccountId") REFERENCES "RefereeAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
