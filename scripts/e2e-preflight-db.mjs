import dns from "dns/promises";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";

dotenv.config({ path: ".env.e2e" });
dotenv.config();

function fail(message, details) {
  console.error(`[e2e-preflight] ${message}`);
  if (details) {
    console.error(details);
  }
  process.exit(1);
}

function getHostFromDatabaseUrl(databaseUrl) {
  try {
    const parsed = new URL(databaseUrl);
    return parsed.hostname;
  } catch {
    return null;
  }
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL ?? "";
  const guard = process.env.E2E_DB_GUARD ?? "";

  if (!databaseUrl) {
    fail("DATABASE_URL is missing. Set it in .env/.env.e2e before running E2E.");
  }

  if (!guard) {
    fail("E2E_DB_GUARD is missing. Set a guard substring to prevent wrong DB usage.");
  }

  if (!databaseUrl.includes(guard)) {
    fail(
      `DATABASE_URL does not include E2E_DB_GUARD (${guard}). Refusing to run E2E wipe/seed.`,
      `DATABASE_URL host: ${getHostFromDatabaseUrl(databaseUrl) ?? "invalid"}`
    );
  }

  const host = getHostFromDatabaseUrl(databaseUrl);
  if (!host) {
    fail("DATABASE_URL is not a valid URL.", databaseUrl);
  }

  try {
    await dns.lookup(host);
  } catch (error) {
    fail(
      `DNS lookup failed for database host: ${host}`,
      `Likely invalid host or network/DNS issue. Original error: ${error.code ?? error.message}`
    );
  }

  const prisma = new PrismaClient();
  try {
    await prisma.$queryRawUnsafe("SELECT 1");
  } catch (error) {
    fail(
      "Prisma connectivity check failed (SELECT 1).",
      `Likely auth/network/pgbouncer issue. Original error: ${error.message ?? String(error)}`
    );
  } finally {
    await prisma.$disconnect();
  }

  console.log("[e2e-preflight] OK: DATABASE_URL reachable and Prisma SELECT 1 succeeded.");
}

await main();
