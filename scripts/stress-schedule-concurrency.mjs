import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function isPrismaP2002(error) {
  return Boolean(error && typeof error === "object" && error.code === "P2002");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function ensureStageSetup(stage) {
  const config = await prisma.scheduleConfig.findFirst({
    where: { stage },
    orderBy: { createdAt: "desc" },
  });
  if (!config) {
    await prisma.scheduleConfig.create({
      data: {
        stage,
        dayStartAt: new Date(),
        autoScheduleEnabled: true,
      },
    });
  } else if (!config.autoScheduleEnabled) {
    await prisma.scheduleConfig.update({
      where: { id: config.id },
      data: { autoScheduleEnabled: true },
    });
  }

  const courtIds = ["C1", "C2", "C3", "C4", "C5"];
  for (const courtId of courtIds) {
    await prisma.court.upsert({
      where: { id: courtId },
      update: {},
      create: { id: courtId },
    });
    await prisma.courtStageLock.upsert({
      where: { courtId_stage: { courtId, stage } },
      update: { locked: false, lockReason: null },
      create: { courtId, stage, locked: false, lockReason: null },
    });
  }
}

async function runAutoFill(stage) {
  const courtIds = ["C1", "C2", "C3", "C4", "C5"];
  const lockedByCourt = new Map(
    (
      await prisma.courtStageLock.findMany({
        where: { stage, courtId: { in: courtIds } },
        select: { courtId: true, locked: true },
      })
    ).map((x) => [x.courtId, x.locked])
  );

  const activeAssignments = await prisma.courtAssignment.findMany({
    where: { stage, status: "ACTIVE" },
    select: { courtId: true, matchType: true, groupMatchId: true, knockoutMatchId: true },
  });
  const assignedCourtIds = new Set(activeAssignments.map((x) => x.courtId));
  const assignedGroupIds = new Set(
    activeAssignments.filter((x) => x.groupMatchId).map((x) => x.groupMatchId)
  );
  const assignedKnockoutIds = new Set(
    activeAssignments.filter((x) => x.knockoutMatchId).map((x) => x.knockoutMatchId)
  );

  const freeCourts = courtIds.filter(
    (courtId) => !lockedByCourt.get(courtId) && !assignedCourtIds.has(courtId)
  );
  if (freeCourts.length === 0) {
    return { assigned: 0, uniqueConflicts: 0 };
  }

  const blocked = await prisma.blockedMatch.findMany({
    where: { matchType: stage },
    select: { groupMatchId: true, knockoutMatchId: true },
  });
  const blockedGroup = new Set(blocked.map((b) => b.groupMatchId).filter(Boolean));
  const blockedKnockout = new Set(blocked.map((b) => b.knockoutMatchId).filter(Boolean));

  let assigned = 0;
  let uniqueConflicts = 0;

  for (const courtId of freeCourts) {
    if (stage === "GROUP") {
      const next = await prisma.match.findFirst({
        where: {
          stage: "GROUP",
          status: "SCHEDULED",
          homeTeamId: { not: null },
          awayTeamId: { not: null },
          id: {
            notIn: [...assignedGroupIds, ...blockedGroup],
          },
        },
        orderBy: [{ createdAt: "asc" }],
        select: { id: true },
      });
      if (!next) continue;
      try {
        await prisma.courtAssignment.create({
          data: {
            courtId,
            stage: "GROUP",
            matchType: "GROUP",
            groupMatchId: next.id,
            knockoutMatchId: null,
            status: "ACTIVE",
          },
        });
        assignedGroupIds.add(next.id);
        assigned += 1;
      } catch (error) {
        if (isPrismaP2002(error)) {
          uniqueConflicts += 1;
          continue;
        }
        throw error;
      }
    } else {
      const next = await prisma.knockoutMatch.findFirst({
        where: {
          status: "SCHEDULED",
          isPublished: true,
          homeTeamId: { not: null },
          awayTeamId: { not: null },
          id: {
            notIn: [...assignedKnockoutIds, ...blockedKnockout],
          },
        },
        orderBy: [{ round: "asc" }, { matchNo: "asc" }, { createdAt: "asc" }],
        select: { id: true },
      });
      if (!next) continue;
      try {
        await prisma.courtAssignment.create({
          data: {
            courtId,
            stage: "KNOCKOUT",
            matchType: "KNOCKOUT",
            groupMatchId: null,
            knockoutMatchId: next.id,
            status: "ACTIVE",
          },
        });
        assignedKnockoutIds.add(next.id);
        assigned += 1;
      } catch (error) {
        if (isPrismaP2002(error)) {
          uniqueConflicts += 1;
          continue;
        }
        throw error;
      }
    }
  }

  return { assigned, uniqueConflicts };
}

async function markAllAssignedCompleted(stage) {
  const active = await prisma.courtAssignment.findMany({
    where: { stage, status: "ACTIVE" },
    select: { id: true, matchType: true, groupMatchId: true, knockoutMatchId: true },
  });

  if (stage === "GROUP") {
    const ids = active.map((a) => a.groupMatchId).filter(Boolean);
    if (ids.length) {
      await prisma.match.updateMany({
        where: { id: { in: ids } },
        data: { status: "COMPLETED", completedAt: new Date() },
      });
    }
  } else {
    const ids = active.map((a) => a.knockoutMatchId).filter(Boolean);
    if (ids.length) {
      await prisma.knockoutMatch.updateMany({
        where: { id: { in: ids } },
        data: { status: "COMPLETED", completedAt: new Date() },
      });
    }
  }
}

async function worker(stage, iterations, workerName) {
  let actions = 0;
  let conflicts = 0;
  let noActive = 0;
  let autoFillAssigned = 0;
  let autoFillUniqueConflicts = 0;

  for (let i = 0; i < iterations; i += 1) {
    const active = await prisma.courtAssignment.findMany({
      where: { stage, status: "ACTIVE" },
      orderBy: { assignedAt: "asc" },
      select: { id: true },
    });

    if (active.length === 0) {
      noActive += 1;
      const autoFill = await runAutoFill(stage);
      autoFillAssigned += autoFill.assigned;
      autoFillUniqueConflicts += autoFill.uniqueConflicts;
      await sleep(randomInt(20, 60));
      continue;
    }

    const target = active[randomInt(0, active.length - 1)];
    const update = await prisma.courtAssignment.updateMany({
      where: { id: target.id, status: "ACTIVE" },
      data: { status: "CLEARED", clearedAt: new Date() },
    });

    if (update.count === 0) {
      conflicts += 1;
    } else {
      actions += 1;
      const autoFill = await runAutoFill(stage);
      autoFillAssigned += autoFill.assigned;
      autoFillUniqueConflicts += autoFill.uniqueConflicts;
    }

    await sleep(randomInt(10, 40));
  }

  return {
    workerName,
    actions,
    conflicts,
    noActive,
    autoFillAssigned,
    autoFillUniqueConflicts,
  };
}

async function collectMetrics(stage, startedAt, workerStats) {
  const blocked = await prisma.blockedMatch.findMany({
    where: { matchType: stage },
    select: { groupMatchId: true, knockoutMatchId: true },
  });
  const blockedGroupIds = blocked.map((b) => b.groupMatchId).filter(Boolean);
  const blockedKnockoutIds = blocked.map((b) => b.knockoutMatchId).filter(Boolean);

  const [dupByCourt, dupByGroup, dupByKnockout, activeAssignments, logs] = await Promise.all([
    prisma.$queryRaw`
      SELECT stage, "courtId", COUNT(*)::int AS count
      FROM "CourtAssignment"
      WHERE status = 'ACTIVE'::"AssignmentStatus" AND stage = ${stage}::"ScheduleStage"
      GROUP BY stage, "courtId"
      HAVING COUNT(*) > 1
      ORDER BY count DESC
    `,
    prisma.$queryRaw`
      SELECT stage, "groupMatchId", COUNT(*)::int AS count
      FROM "CourtAssignment"
      WHERE status = 'ACTIVE'::"AssignmentStatus" AND stage = ${stage}::"ScheduleStage" AND "groupMatchId" IS NOT NULL
      GROUP BY stage, "groupMatchId"
      HAVING COUNT(*) > 1
      ORDER BY count DESC
    `,
    prisma.$queryRaw`
      SELECT stage, "knockoutMatchId", COUNT(*)::int AS count
      FROM "CourtAssignment"
      WHERE status = 'ACTIVE'::"AssignmentStatus" AND stage = ${stage}::"ScheduleStage" AND "knockoutMatchId" IS NOT NULL
      GROUP BY stage, "knockoutMatchId"
      HAVING COUNT(*) > 1
      ORDER BY count DESC
    `,
    prisma.courtAssignment.findMany({
      where: { stage, status: "ACTIVE" },
      select: { id: true, courtId: true, groupMatchId: true, knockoutMatchId: true, matchType: true },
    }),
    prisma.scheduleActionLog.findMany({
      where: { createdAt: { gte: startedAt } },
      select: { action: true },
    }),
  ]);

  const assignedGroupIds = new Set(
    activeAssignments.filter((a) => a.groupMatchId).map((a) => a.groupMatchId)
  );
  const assignedKnockoutIds = new Set(
    activeAssignments.filter((a) => a.knockoutMatchId).map((a) => a.knockoutMatchId)
  );

  const [scheduledGroupMissing, scheduledKnockoutMissing] = await Promise.all([
    stage === "GROUP"
      ? prisma.match.count({
          where: {
            stage: "GROUP",
            status: "SCHEDULED",
            homeTeamId: { not: null },
            awayTeamId: { not: null },
            id: { notIn: [...assignedGroupIds, ...blockedGroupIds] },
          },
        })
      : 0,
    stage === "KNOCKOUT"
      ? prisma.knockoutMatch.count({
          where: {
            status: "SCHEDULED",
            isPublished: true,
            homeTeamId: { not: null },
            awayTeamId: { not: null },
            id: { notIn: [...assignedKnockoutIds, ...blockedKnockoutIds] },
          },
        })
      : 0,
  ]);

  const logCounts = logs.reduce((acc, row) => {
    acc[row.action] = (acc[row.action] ?? 0) + 1;
    return acc;
  }, {});

  return {
    stage,
    workerStats,
    activeAssignments: activeAssignments.length,
    duplicates: {
      byCourt: dupByCourt,
      byGroup: dupByGroup,
      byKnockout: dupByKnockout,
    },
    possiblyUnassignedScheduled: {
      group: scheduledGroupMissing,
      knockout: scheduledKnockoutMissing,
    },
    actionLogsSinceStart: logCounts,
  };
}

async function main() {
  const stage = (process.env.STRESS_STAGE || "GROUP").toUpperCase();
  if (stage !== "GROUP" && stage !== "KNOCKOUT") {
    throw new Error("STRESS_STAGE must be GROUP or KNOCKOUT.");
  }
  const iterations = Number.parseInt(process.env.STRESS_ITERATIONS || "40", 10);
  if (!Number.isFinite(iterations) || iterations < 1) {
    throw new Error("STRESS_ITERATIONS must be a positive integer.");
  }

  await ensureStageSetup(stage);
  await markAllAssignedCompleted(stage);
  await prisma.courtAssignment.updateMany({
    where: { stage, status: "ACTIVE" },
    data: { status: "CLEARED", clearedAt: new Date() },
  });
  await runAutoFill(stage);

  const startedAt = new Date();
  const [w1, w2] = await Promise.all([
    worker(stage, iterations, "worker-1"),
    worker(stage, iterations, "worker-2"),
  ]);

  const report = await collectMetrics(stage, startedAt, [w1, w2]);
  const hasDuplicates =
    report.duplicates.byCourt.length > 0 ||
    report.duplicates.byGroup.length > 0 ||
    report.duplicates.byKnockout.length > 0;

  console.log("Schedule concurrency stress report:");
  console.log(JSON.stringify(report, null, 2));

  if (hasDuplicates) {
    throw new Error("Stress test failed: duplicate ACTIVE assignments detected.");
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
