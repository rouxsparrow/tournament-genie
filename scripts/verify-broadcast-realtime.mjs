import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";

dotenv.config({ path: ".env.e2e" });
dotenv.config();

const REQUIRED_TABLES = [
  "BlockedMatch",
  "CourtAssignment",
  "KnockoutMatch",
  "Match",
  "ScheduleConfig",
];

async function main() {
  const prisma = new PrismaClient();
  try {
    const publicationRows = await prisma.$queryRawUnsafe(`
      SELECT tablename
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
      ORDER BY tablename
    `);

    const anonPolicyRows = await prisma.$queryRawUnsafe(`
      SELECT tablename, policyname
      FROM pg_policies
      WHERE schemaname = 'public'
        AND cmd = 'SELECT'
        AND roles @> ARRAY['anon']::name[]
        AND tablename IN ('CourtAssignment', 'BlockedMatch', 'Match', 'KnockoutMatch', 'ScheduleConfig')
      ORDER BY tablename, policyname
    `);

    const publicationSet = new Set(publicationRows.map((row) => row.tablename));
    const missingPublication = REQUIRED_TABLES.filter((table) => !publicationSet.has(table));
    const policySet = new Set(anonPolicyRows.map((row) => row.tablename));
    const missingPolicies = REQUIRED_TABLES.filter((table) => !policySet.has(table));

    console.log("[broadcast-realtime] publication tables:");
    console.table(publicationRows);
    console.log("[broadcast-realtime] anon select policies:");
    console.table(anonPolicyRows);

    if (missingPublication.length > 0 || missingPolicies.length > 0) {
      if (missingPublication.length > 0) {
        console.error(
          `[broadcast-realtime] missing publication tables: ${missingPublication.join(", ")}`
        );
      }
      if (missingPolicies.length > 0) {
        console.error(
          `[broadcast-realtime] missing anon SELECT policies: ${missingPolicies.join(", ")}`
        );
      }
      process.exitCode = 1;
      return;
    }

    console.log(
      "[broadcast-realtime] OK: publication + anon SELECT policies present for broadcast tables."
    );
  } finally {
    await prisma.$disconnect();
  }
}

await main();
