import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

async function countDuplicateActiveAssignments() {
  const [dupByCourt, dupByGroup, dupByKnockout] = await Promise.all([
    prisma.$queryRaw`
      SELECT stage, "courtId", COUNT(*)::int AS count
      FROM "CourtAssignment"
      WHERE status = 'ACTIVE'::"AssignmentStatus"
      GROUP BY stage, "courtId"
      HAVING COUNT(*) > 1
      ORDER BY count DESC
    `,
    prisma.$queryRaw`
      SELECT stage, "groupMatchId", COUNT(*)::int AS count
      FROM "CourtAssignment"
      WHERE status = 'ACTIVE'::"AssignmentStatus" AND "groupMatchId" IS NOT NULL
      GROUP BY stage, "groupMatchId"
      HAVING COUNT(*) > 1
      ORDER BY count DESC
    `,
    prisma.$queryRaw`
      SELECT stage, "knockoutMatchId", COUNT(*)::int AS count
      FROM "CourtAssignment"
      WHERE status = 'ACTIVE'::"AssignmentStatus" AND "knockoutMatchId" IS NOT NULL
      GROUP BY stage, "knockoutMatchId"
      HAVING COUNT(*) > 1
      ORDER BY count DESC
    `,
  ]);
  return { dupByCourt, dupByGroup, dupByKnockout };
}

async function assertRequiredIndexes() {
  const indexes = await prisma.$queryRaw`
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'CourtAssignment'
      AND indexname IN (
        'CourtAssignment_active_court_stage_key',
        'CourtAssignment_active_group_stage_key',
        'CourtAssignment_active_knockout_stage_key'
      )
    ORDER BY indexname
  `;
  const names = new Set(indexes.map((row) => row.indexname));
  const required = [
    "CourtAssignment_active_court_stage_key",
    "CourtAssignment_active_group_stage_key",
    "CourtAssignment_active_knockout_stage_key",
  ];
  const missing = required.filter((name) => !names.has(name));
  return missing;
}

async function runUniquenessSmokeTests() {
  const groupMatch = await prisma.match.findFirst({
    where: { stage: "GROUP", homeTeamId: { not: null }, awayTeamId: { not: null } },
    select: { id: true },
  });
  const knockoutMatch = await prisma.knockoutMatch.findFirst({
    where: { homeTeamId: { not: null }, awayTeamId: { not: null } },
    select: { id: true },
  });

  let results = {
    courtStageUnique: false,
    groupMatchUnique: groupMatch ? false : "SKIPPED",
    knockoutMatchUnique: knockoutMatch ? false : "SKIPPED",
  };

  const expectP2002 = async (runner) => {
    try {
      await prisma.$transaction(async (tx) => {
        await runner(tx);
      });
      return false;
    } catch (error) {
      return (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      );
    }
  };

  {
    const testId = Date.now();
    const courtA = `TEST_A_${testId}`;
    results.courtStageUnique = await expectP2002(async (tx) => {
      await tx.court.create({ data: { id: courtA } });
      await tx.courtAssignment.create({
        data: {
          courtId: courtA,
          stage: "GROUP",
          matchType: "GROUP",
          groupMatchId: null,
          knockoutMatchId: null,
          status: "ACTIVE",
        },
      });
      await tx.courtAssignment.create({
        data: {
          courtId: courtA,
          stage: "GROUP",
          matchType: "GROUP",
          groupMatchId: null,
          knockoutMatchId: null,
          status: "ACTIVE",
        },
      });
    });
  }

  if (groupMatch) {
    const testId = Date.now() + 1;
    const courtA = `TEST_B_${testId}`;
    const courtB = `TEST_C_${testId}`;
    results.groupMatchUnique = await expectP2002(async (tx) => {
      await tx.court.createMany({ data: [{ id: courtA }, { id: courtB }] });
      await tx.courtAssignment.create({
        data: {
          courtId: courtA,
          stage: "GROUP",
          matchType: "GROUP",
          groupMatchId: groupMatch.id,
          knockoutMatchId: null,
          status: "ACTIVE",
        },
      });
      await tx.courtAssignment.create({
        data: {
          courtId: courtB,
          stage: "GROUP",
          matchType: "GROUP",
          groupMatchId: groupMatch.id,
          knockoutMatchId: null,
          status: "ACTIVE",
        },
      });
    });
  }

  if (knockoutMatch) {
    const testId = Date.now() + 2;
    const courtA = `TEST_D_${testId}`;
    const courtB = `TEST_E_${testId}`;
    results.knockoutMatchUnique = await expectP2002(async (tx) => {
      await tx.court.createMany({ data: [{ id: courtA }, { id: courtB }] });
      await tx.courtAssignment.create({
        data: {
          courtId: courtA,
          stage: "KNOCKOUT",
          matchType: "KNOCKOUT",
          groupMatchId: null,
          knockoutMatchId: knockoutMatch.id,
          status: "ACTIVE",
        },
      });
      await tx.courtAssignment.create({
        data: {
          courtId: courtB,
          stage: "KNOCKOUT",
          matchType: "KNOCKOUT",
          groupMatchId: null,
          knockoutMatchId: knockoutMatch.id,
          status: "ACTIVE",
        },
      });
    });
  }

  return results;
}

async function main() {
  const missingIndexes = await assertRequiredIndexes();
  if (missingIndexes.length > 0) {
    throw new Error(`Missing required indexes: ${missingIndexes.join(", ")}`);
  }

  const duplicatesBefore = await countDuplicateActiveAssignments();
  const hasDupes =
    duplicatesBefore.dupByCourt.length > 0 ||
    duplicatesBefore.dupByGroup.length > 0 ||
    duplicatesBefore.dupByKnockout.length > 0;

  if (hasDupes) {
    console.error("Duplicate ACTIVE assignments still present:");
    console.error(JSON.stringify(duplicatesBefore, null, 2));
    throw new Error("Integrity check failed: duplicate ACTIVE assignments exist.");
  }

  const uniqueness = await runUniquenessSmokeTests();
  if (uniqueness.courtStageUnique !== true) {
    throw new Error("Unique check failed: (courtId, stage, ACTIVE) was not enforced.");
  }
  if (uniqueness.groupMatchUnique === false) {
    throw new Error("Unique check failed: (groupMatchId, stage, ACTIVE) was not enforced.");
  }
  if (uniqueness.knockoutMatchUnique === false) {
    throw new Error("Unique check failed: (knockoutMatchId, stage, ACTIVE) was not enforced.");
  }

  console.log("Schedule assignment integrity validation passed.");
  console.log(
    JSON.stringify(
      {
        duplicates: duplicatesBefore,
        uniqueness,
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
