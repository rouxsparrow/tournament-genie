import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

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
  return cliScenario ?? process.env.E2E_SCENARIO ?? "baseline-group";
}

async function resetScheduleData() {
  await prisma.refereeSubmission.deleteMany({});
  await prisma.forcedMatchPriority.deleteMany({});
  await prisma.blockedMatch.deleteMany({});
  await prisma.scheduleActionLog.deleteMany({});
  await prisma.courtAssignment.deleteMany({});
  await prisma.courtStageLock.deleteMany({});
  await prisma.court.deleteMany({});
  await prisma.scheduleConfig.deleteMany({});
  await prisma.knockoutGameScore.deleteMany({});
  await prisma.knockoutMatch.deleteMany({});
  await prisma.knockoutRandomDraw.deleteMany({});
  await prisma.knockoutSeed.deleteMany({});
  await prisma.seriesQualifier.deleteMany({});
  await prisma.gameScore.deleteMany({});
  await prisma.match.deleteMany({});
  await prisma.groupRandomDraw.deleteMany({});
  await prisma.groupTeam.deleteMany({});
  await prisma.group.deleteMany({});
  await prisma.groupAssignmentLock.deleteMany({});
  await prisma.groupStageLock.deleteMany({});
  await prisma.teamFlags.deleteMany({});
  await prisma.teamMember.deleteMany({});
  await prisma.team.deleteMany({});
  await prisma.player.deleteMany({});
  await prisma.categoryConfig.deleteMany({});
  await prisma.category.deleteMany({});
  await prisma.tournamentSettings.deleteMany({});
}

async function createStandardCategories() {
  const mdCategory = await prisma.category.create({
    data: { code: "MD", name: "Men's Doubles" },
  });
  const wdCategory = await prisma.category.create({
    data: { code: "WD", name: "Women's Doubles" },
  });
  const xdCategory = await prisma.category.create({
    data: { code: "XD", name: "Mixed Doubles" },
  });

  await prisma.groupAssignmentLock.createMany({
    data: [
      { categoryCode: "MD", locked: true },
      { categoryCode: "WD", locked: false },
      { categoryCode: "XD", locked: false },
    ],
  });

  await prisma.groupStageLock.createMany({
    data: [
      { categoryCode: "MD", locked: false },
      { categoryCode: "WD", locked: false },
      { categoryCode: "XD", locked: false },
    ],
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
    await prisma.court.create({ data: { id: courtId } });
    await prisma.courtStageLock.create({
      data: { courtId, stage: "GROUP", locked: false },
    });
    await prisma.courtStageLock.create({
      data: { courtId, stage: "KNOCKOUT", locked: false },
    });
  }

  await prisma.scheduleConfig.create({
    data: { stage: "GROUP", dayStartAt: new Date(), autoScheduleEnabled: true },
  });
  await prisma.scheduleConfig.create({
    data: { stage: "KNOCKOUT", dayStartAt: new Date(), autoScheduleEnabled: false },
  });

  return courts;
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
    data: { name: "A", categoryId: mdCategory.id },
  });
  const groupB = await prisma.group.create({
    data: { name: "B", categoryId: mdCategory.id },
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
    data: { name: "A", categoryId: mdCategory.id },
  });
  const groupB = await prisma.group.create({
    data: { name: "B", categoryId: mdCategory.id },
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

async function seed() {
  assertSafeDatabaseTarget();
  const scenario = resolveScenario();
  await resetScheduleData();

  if (scenario === "baseline-group") {
    await seedBaselineGroup();
    return;
  }
  if (scenario === "knockout-ready") {
    await seedKnockoutReady();
    return;
  }
  if (scenario === "imports-validation") {
    await seedImportsValidation();
    return;
  }

  throw new Error(`Unknown E2E scenario: ${scenario}`);
}

seed()
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
