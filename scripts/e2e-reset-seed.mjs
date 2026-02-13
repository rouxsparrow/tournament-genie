import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const TRANSIENT_DB_ERROR_CODES = new Set(["P1001", "P1002", "P1017"]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientDbError(error) {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String(error.code ?? "") : "";
  if (TRANSIENT_DB_ERROR_CODES.has(code)) return true;

  const message = error instanceof Error ? error.message : String(error);
  const lowered = message.toLowerCase();
  return (
    lowered.includes("server has closed the connection") ||
    lowered.includes("connection terminated unexpectedly") ||
    lowered.includes("connection reset") ||
    lowered.includes("timed out")
  );
}

function assertSafeDatabaseTarget() {
  const url = process.env.DATABASE_URL ?? "";
  const requiredGuard = process.env.E2E_DB_GUARD ?? "";

  if (!url) {
    throw new Error("DATABASE_URL is required for E2E seed.");
  }
  if (!requiredGuard) {
    throw new Error("E2E_DB_GUARD is required for E2E seed safety.");
  }
  if (!url.includes(requiredGuard)) {
    throw new Error(
      `Refusing to seed DB. DATABASE_URL must include E2E_DB_GUARD (${requiredGuard}).`
    );
  }
}

function combinations(items) {
  const pairs = [];
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      pairs.push([items[i], items[j]]);
    }
  }
  return pairs;
}

function resolveScenario() {
  const cliScenario = process.argv
    .slice(2)
    .find((arg) => arg.startsWith("--scenario="))
    ?.split("=")[1];
  return cliScenario ?? process.env.E2E_SCENARIO ?? "existing-group";
}

// Preserve static tournament setup while clearing mutable runtime/competition state.
async function resetScheduleDataPreserveCore() {
  await prisma.refereeSubmission.deleteMany({});
  await prisma.forcedMatchPriority.deleteMany({});
  await prisma.blockedMatch.deleteMany({});
  await prisma.scheduleActionLog.deleteMany({});
  await prisma.courtAssignment.deleteMany({});
  await prisma.knockoutGameScore.deleteMany({});
  await prisma.knockoutMatch.deleteMany({});
  await prisma.knockoutRandomDraw.deleteMany({});
  await prisma.knockoutSeed.deleteMany({});
  await prisma.seriesQualifier.deleteMany({});
  await prisma.gameScore.deleteMany({});
  await prisma.match.deleteMany({});
  await prisma.groupRandomDraw.deleteMany({});
  await prisma.categoryConfig.deleteMany({});
  await prisma.scheduleConfig.deleteMany({});
  await prisma.tournamentSettings.deleteMany({});
}

async function createStandardCategories() {
  const mdCategory = await prisma.category.upsert({
    where: { code: "MD" },
    create: { code: "MD", name: "Men's Doubles" },
    update: { name: "Men's Doubles" },
  });
  const wdCategory = await prisma.category.upsert({
    where: { code: "WD" },
    create: { code: "WD", name: "Women's Doubles" },
    update: { name: "Women's Doubles" },
  });
  const xdCategory = await prisma.category.upsert({
    where: { code: "XD" },
    create: { code: "XD", name: "Mixed Doubles" },
    update: { name: "Mixed Doubles" },
  });

  await prisma.groupAssignmentLock.upsert({
    where: { categoryCode: "MD" },
    create: { categoryCode: "MD", locked: true },
    update: { locked: true },
  });
  await prisma.groupAssignmentLock.upsert({
    where: { categoryCode: "WD" },
    create: { categoryCode: "WD", locked: false },
    update: { locked: false },
  });
  await prisma.groupAssignmentLock.upsert({
    where: { categoryCode: "XD" },
    create: { categoryCode: "XD", locked: false },
    update: { locked: false },
  });

  await prisma.groupStageLock.upsert({
    where: { categoryCode: "MD" },
    create: { categoryCode: "MD", locked: false },
    update: { locked: false },
  });
  await prisma.groupStageLock.upsert({
    where: { categoryCode: "WD" },
    create: { categoryCode: "WD", locked: false },
    update: { locked: false },
  });
  await prisma.groupStageLock.upsert({
    where: { categoryCode: "XD" },
    create: { categoryCode: "XD", locked: false },
    update: { locked: false },
  });

  await prisma.tournamentSettings.create({
    data: {
      groupAssignmentMode: "MANUAL",
      secondChanceEnabled: false,
      scoringMode: "SINGLE_GAME_21",
    },
  });

  return { mdCategory, wdCategory, xdCategory };
}

async function createCourts(courts = ["C1", "C2", "C3", "C4", "C5"]) {
  for (const courtId of courts) {
    await prisma.court.upsert({
      where: { id: courtId },
      create: { id: courtId },
      update: {},
    });
  }

  await ensureStageLocksForCourts(courts);
  await upsertScheduleConfig("GROUP", true);
  await upsertScheduleConfig("KNOCKOUT", false);

  return courts;
}

async function ensureStageLocksForCourts(courtIds) {
  for (const courtId of courtIds) {
    await prisma.courtStageLock.upsert({
      where: { courtId_stage: { courtId, stage: "GROUP" } },
      create: { courtId, stage: "GROUP", locked: false },
      update: { locked: false, lockReason: null },
    });
    await prisma.courtStageLock.upsert({
      where: { courtId_stage: { courtId, stage: "KNOCKOUT" } },
      create: { courtId, stage: "KNOCKOUT", locked: false },
      update: { locked: false, lockReason: null },
    });
  }
}

async function upsertScheduleConfig(stage, autoScheduleEnabled) {
  const existing = await prisma.scheduleConfig.findFirst({
    where: { stage },
    orderBy: { createdAt: "asc" },
  });

  if (existing) {
    await prisma.scheduleConfig.update({
      where: { id: existing.id },
      data: { autoScheduleEnabled, dayStartAt: new Date() },
    });
    return;
  }

  await prisma.scheduleConfig.create({
    data: { stage, autoScheduleEnabled, dayStartAt: new Date() },
  });
}

async function createPlayers({ count, gender, prefix }) {
  const players = [];
  for (let i = 1; i <= count; i += 1) {
    const player = await prisma.player.create({
      data: {
        name: `${prefix} ${i.toString().padStart(2, "0")}`,
        gender,
      },
    });
    players.push(player);
  }
  return players;
}

async function createTeamsFromPlayers({ categoryId, players, teamPrefix }) {
  const teams = [];
  for (let i = 0; i < players.length; i += 2) {
    const teamIndex = i / 2 + 1;
    const team = await prisma.team.create({
      data: {
        name: `${teamPrefix}-${teamIndex}`,
        categoryId,
      },
    });
    await prisma.teamMember.createMany({
      data: [
        { teamId: team.id, playerId: players[i].id },
        { teamId: team.id, playerId: players[i + 1].id },
      ],
    });
    teams.push(team);
  }
  return teams;
}

// Legacy synthetic scenario helper kept for reference; intentionally disabled in main flow.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function seedBaselineGroup() {
  const { mdCategory } = await createStandardCategories();

  const players = await createPlayers({
    count: 16,
    gender: "MALE",
    prefix: "E2E MD Player",
  });
  const teams = await createTeamsFromPlayers({
    categoryId: mdCategory.id,
    players,
    teamPrefix: "E2E-MD-Team",
  });

  const groupA = await prisma.group.create({
    data: { name: "E2E-A", categoryId: mdCategory.id },
  });
  const groupB = await prisma.group.create({
    data: { name: "E2E-B", categoryId: mdCategory.id },
  });

  for (const team of teams.slice(0, 4)) {
    await prisma.groupTeam.create({ data: { groupId: groupA.id, teamId: team.id } });
  }
  for (const team of teams.slice(4, 8)) {
    await prisma.groupTeam.create({ data: { groupId: groupB.id, teamId: team.id } });
  }

  const matches = [];
  for (const [home, away] of combinations(teams.slice(0, 4))) {
    matches.push(
      await prisma.match.create({
        data: {
          stage: "GROUP",
          status: "SCHEDULED",
          groupId: groupA.id,
          homeTeamId: home.id,
          awayTeamId: away.id,
        },
      })
    );
  }
  for (const [home, away] of combinations(teams.slice(4, 8))) {
    matches.push(
      await prisma.match.create({
        data: {
          stage: "GROUP",
          status: "SCHEDULED",
          groupId: groupB.id,
          homeTeamId: home.id,
          awayTeamId: away.id,
        },
      })
    );
  }

  const courts = await createCourts();
  for (let i = 0; i < Math.min(courts.length, matches.length); i += 1) {
    await prisma.courtAssignment.create({
      data: {
        courtId: courts[i],
        stage: "GROUP",
        matchType: "GROUP",
        groupMatchId: matches[i].id,
        status: "ACTIVE",
      },
    });
  }
}

// Legacy synthetic scenario helper kept for reference; intentionally disabled in main flow.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function seedKnockoutReady() {
  const { mdCategory } = await createStandardCategories();

  const players = await createPlayers({
    count: 20,
    gender: "MALE",
    prefix: "KR MD Player",
  });

  const teams = await createTeamsFromPlayers({
    categoryId: mdCategory.id,
    players,
    teamPrefix: "KR-MD-Team",
  });

  const groupA = await prisma.group.create({
    data: { name: "KR-A", categoryId: mdCategory.id },
  });
  const groupB = await prisma.group.create({
    data: { name: "KR-B", categoryId: mdCategory.id },
  });

  const groupATeams = teams.slice(0, 5);
  const groupBTeams = teams.slice(5, 10);

  for (const team of groupATeams) {
    await prisma.groupTeam.create({ data: { groupId: groupA.id, teamId: team.id } });
  }
  for (const team of groupBTeams) {
    await prisma.groupTeam.create({ data: { groupId: groupB.id, teamId: team.id } });
  }

  for (const [home, away] of combinations(groupATeams)) {
    const homeIndex = groupATeams.findIndex((team) => team.id === home.id);
    const awayIndex = groupATeams.findIndex((team) => team.id === away.id);
    const winner = homeIndex < awayIndex ? home : away;
    const loser = winner.id === home.id ? away : home;
    const loserPoints = 8 + awayIndex;

    const match = await prisma.match.create({
      data: {
        stage: "GROUP",
        status: "COMPLETED",
        groupId: groupA.id,
        homeTeamId: home.id,
        awayTeamId: away.id,
        winnerTeamId: winner.id,
        completedAt: new Date(),
      },
    });

    await prisma.gameScore.create({
      data: {
        matchId: match.id,
        gameNumber: 1,
        homePoints: winner.id === home.id ? 21 : loserPoints,
        awayPoints: winner.id === away.id ? 21 : loserPoints,
      },
    });

    await prisma.match.update({
      where: { id: match.id },
      data: {
        winnerTeamId: winner.id,
        status: "COMPLETED",
        completedAt: new Date(),
      },
    });

    void loser;
  }

  for (const [home, away] of combinations(groupBTeams)) {
    const homeIndex = groupBTeams.findIndex((team) => team.id === home.id);
    const awayIndex = groupBTeams.findIndex((team) => team.id === away.id);
    const winner = homeIndex < awayIndex ? home : away;
    const loserPoints = 11 + homeIndex;

    const match = await prisma.match.create({
      data: {
        stage: "GROUP",
        status: "COMPLETED",
        groupId: groupB.id,
        homeTeamId: home.id,
        awayTeamId: away.id,
        winnerTeamId: winner.id,
        completedAt: new Date(),
      },
    });

    await prisma.gameScore.create({
      data: {
        matchId: match.id,
        gameNumber: 1,
        homePoints: winner.id === home.id ? 21 : loserPoints,
        awayPoints: winner.id === away.id ? 21 : loserPoints,
      },
    });

    await prisma.match.update({
      where: { id: match.id },
      data: {
        winnerTeamId: winner.id,
        status: "COMPLETED",
        completedAt: new Date(),
      },
    });
  }

  await prisma.groupStageLock.update({
    where: { categoryCode: "MD" },
    data: { locked: true },
  });

  await prisma.categoryConfig.upsert({
    where: { categoryCode: "MD" },
    create: { categoryCode: "MD", secondChanceEnabled: true },
    update: { secondChanceEnabled: true },
  });

  await createCourts();
}

// Legacy synthetic scenario helper kept for reference; intentionally disabled in main flow.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function seedImportsValidation() {
  const { mdCategory, wdCategory, xdCategory } = await createStandardCategories();

  const males = await createPlayers({
    count: 4,
    gender: "MALE",
    prefix: "Import Male",
  });
  const females = await createPlayers({
    count: 4,
    gender: "FEMALE",
    prefix: "Import Female",
  });

  const mdTeam = await prisma.team.create({
    data: {
      name: "Import Existing MD Team",
      categoryId: mdCategory.id,
    },
  });

  await prisma.teamMember.createMany({
    data: [
      { teamId: mdTeam.id, playerId: males[0].id },
      { teamId: mdTeam.id, playerId: males[1].id },
    ],
  });

  await prisma.team.create({
    data: {
      name: "Import Existing WD Team",
      categoryId: wdCategory.id,
      members: {
        create: [
          { playerId: females[0].id },
          { playerId: females[1].id },
        ],
      },
    },
  });

  await prisma.team.create({
    data: {
      name: "Import Existing XD Team",
      categoryId: xdCategory.id,
      members: {
        create: [
          { playerId: males[2].id },
          { playerId: females[2].id },
        ],
      },
    },
  });

  await createCourts(["C1", "C2"]);
}

// Legacy cleanup helper for synthetic fixtures; intentionally disabled in main flow.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function cleanupSeededTestCoreData() {
  await prisma.teamFlags.deleteMany({
    where: {
      team: {
        OR: [
          { name: { startsWith: "E2E-" } },
          { name: { startsWith: "KR-" } },
          { name: { startsWith: "Import " } },
        ],
      },
    },
  });

  await prisma.group.deleteMany({
    where: {
      OR: [
        { name: { startsWith: "E2E-" } },
        { name: { startsWith: "KR-" } },
      ],
    },
  });

  await prisma.team.deleteMany({
    where: {
      OR: [
        { name: { startsWith: "E2E-" } },
        { name: { startsWith: "KR-" } },
        { name: { startsWith: "Import " } },
      ],
    },
  });

  await prisma.player.deleteMany({
    where: {
      OR: [
        { name: { startsWith: "E2E " } },
        { name: { startsWith: "KR " } },
        { name: { startsWith: "Import " } },
      ],
    },
  });
}

async function generateLockedCategoryGroupMatches() {
  const locks = await prisma.groupAssignmentLock.findMany({
    where: { locked: true },
    select: { categoryCode: true },
    orderBy: { categoryCode: "asc" },
  });

  if (locks.length === 0) {
    throw new Error(
      "existing-group scenario requires at least one locked category in GroupAssignmentLock."
    );
  }

  const lockedCategoryCodes = locks.map((lock) => lock.categoryCode);
  const categories = await prisma.category.findMany({
    where: { code: { in: lockedCategoryCodes } },
    select: { id: true, code: true },
  });
  const categoryByCode = new Map(categories.map((category) => [category.code, category]));

  let totalCreated = 0;
  const createdCountByCategory = {};

  for (const categoryCode of lockedCategoryCodes) {
    const category = categoryByCode.get(categoryCode);
    if (!category) {
      throw new Error(
        `Locked category ${categoryCode} is missing from Category table.`
      );
    }

    const groups = await prisma.group.findMany({
      where: { categoryId: category.id },
      include: {
        teams: {
          select: { teamId: true },
        },
      },
      orderBy: { name: "asc" },
    });

    if (groups.length === 0) {
      throw new Error(
        `Locked category ${categoryCode} has no groups. Cannot generate group-stage matches.`
      );
    }

    const toCreate = [];
    let generatablePairCount = 0;
    for (const group of groups) {
      const teamIds = [...new Set(group.teams.map((entry) => entry.teamId))].sort();
      if (teamIds.length < 2) continue;

      for (let i = 0; i < teamIds.length; i += 1) {
        for (let j = i + 1; j < teamIds.length; j += 1) {
          generatablePairCount += 1;
          toCreate.push({
            stage: "GROUP",
            status: "SCHEDULED",
            groupId: group.id,
            homeTeamId: teamIds[i],
            awayTeamId: teamIds[j],
          });
        }
      }
    }

    if (generatablePairCount === 0) {
      throw new Error(
        `Locked category ${categoryCode} has no groups with at least 2 teams.`
      );
    }

    const created = await prisma.match.createMany({
      data: toCreate,
      skipDuplicates: true,
    });
    createdCountByCategory[categoryCode] = created.count;
    totalCreated += created.count;
  }

  if (totalCreated === 0) {
    throw new Error(
      "Locked-category generation created 0 group matches after reset."
    );
  }

  return { lockedCategoryCodes, createdCountByCategory, totalCreated };
}

async function seedExistingGroup() {
  const lockedGeneration = await generateLockedCategoryGroupMatches();

  await prisma.tournamentSettings.create({
    data: {
      groupAssignmentMode: "MANUAL",
      secondChanceEnabled: false,
      scoringMode: "SINGLE_GAME_21",
    },
  });

  let courts = await prisma.court.findMany({
    select: { id: true },
    orderBy: { id: "asc" },
  });

  if (courts.length === 0) {
    const fallback = ["P5", "P6", "P7", "P8", "P9"];
    for (const courtId of fallback) {
      await prisma.court.create({ data: { id: courtId } });
    }
    courts = await prisma.court.findMany({
      select: { id: true },
      orderBy: { id: "asc" },
    });
  }

  const courtIds = courts.map((court) => court.id);
  await ensureStageLocksForCourts(courtIds);
  await upsertScheduleConfig("GROUP", false);
  await upsertScheduleConfig("KNOCKOUT", false);

  const matches = await prisma.match.findMany({
    where: {
      stage: "GROUP",
      status: "SCHEDULED",
      group: { category: { code: { in: lockedGeneration.lockedCategoryCodes } } },
    },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });

  const limit = Math.min(courtIds.length, matches.length, 5);
  for (let i = 0; i < limit; i += 1) {
    await prisma.courtAssignment.create({
      data: {
        courtId: courtIds[i],
        stage: "GROUP",
        matchType: "GROUP",
        groupMatchId: matches[i].id,
        status: "ACTIVE",
      },
    });
  }
}

async function seed() {
  assertSafeDatabaseTarget();
  const scenario = resolveScenario();
  await resetScheduleDataPreserveCore();

  if (scenario !== "existing-group") {
    throw new Error("Synthetic E2E scenarios are disabled; use existing-group.");
  }

  await seedExistingGroup();
}

async function seedWithRetry(maxAttempts = 3) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await seed();
      return;
    } catch (error) {
      const transient = isTransientDbError(error);
      if (!transient || attempt === maxAttempts) {
        throw error;
      }
      console.warn(
        `[e2e-seed] transient DB error on attempt ${attempt}/${maxAttempts}: ${error instanceof Error ? error.message : String(error)}`
      );
      await prisma.$disconnect().catch(() => undefined);
      await sleep(500 * attempt);
    }
  }
}

seedWithRetry()
  .then(() => {
    const scenario = resolveScenario();
    console.log(`E2E seed complete. Scenario: ${scenario}`);
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
