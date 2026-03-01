import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

function createPrismaClient() {
  return new PrismaClient({
    log: ["error", "warn"],
  });
}

function hasCurrentRefereeDelegates(client: PrismaClient | undefined) {
  if (!client) return false;
  const value = client as unknown as Record<string, unknown>;
  return typeof value.refereeAccount !== "undefined" && typeof value.refereeSession !== "undefined";
}

const cached = globalForPrisma.prisma;
if (cached && !hasCurrentRefereeDelegates(cached)) {
  void cached.$disconnect().catch(() => undefined);
}

const resolvedPrisma: PrismaClient =
  cached && hasCurrentRefereeDelegates(cached) ? cached : createPrismaClient();

export const prisma = resolvedPrisma;

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
