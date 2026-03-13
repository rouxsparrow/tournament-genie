import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

function createPrismaClient() {
  return new PrismaClient({
    log: ["error", "warn"],
  });
}

const REQUIRED_PRISMA_DELEGATES = [
  "refereeAccount",
  "refereeSession",
  "rankingTieOverride",
] as const;

function hasCurrentPrismaDelegates(client: PrismaClient | undefined) {
  if (!client) return false;
  const value = client as unknown as Record<string, unknown>;
  return REQUIRED_PRISMA_DELEGATES.every(
    (delegateName) => typeof value[delegateName] !== "undefined"
  );
}

const cached = globalForPrisma.prisma;
if (cached && !hasCurrentPrismaDelegates(cached)) {
  void cached.$disconnect().catch(() => undefined);
}

const resolvedPrisma: PrismaClient =
  cached && hasCurrentPrismaDelegates(cached) ? cached : createPrismaClient();

export const prisma = resolvedPrisma;

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
