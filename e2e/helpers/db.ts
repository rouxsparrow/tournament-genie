import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function markAllActiveGroupAssignmentsCompleted() {
  const active = await prisma.courtAssignment.findMany({
    where: { stage: "GROUP", status: "ACTIVE", matchType: "GROUP", groupMatchId: { not: null } },
    select: { groupMatchId: true },
  });
  const ids = active.map((row) => row.groupMatchId).filter(Boolean) as string[];
  if (ids.length === 0) return;
  await prisma.match.updateMany({
    where: { id: { in: ids } },
    data: { status: "COMPLETED", completedAt: new Date() },
  });
}

export async function markCourtAssignmentCompleted(courtId: string) {
  const assignment = await prisma.courtAssignment.findFirst({
    where: { stage: "GROUP", status: "ACTIVE", courtId, matchType: "GROUP" },
    select: { groupMatchId: true },
  });
  if (!assignment?.groupMatchId) return false;
  await prisma.match.update({
    where: { id: assignment.groupMatchId },
    data: { status: "COMPLETED", completedAt: new Date() },
  });
  return true;
}

export async function getDuplicateActiveAssignments() {
  const [byCourt, byGroup, byKnockout] = await Promise.all([
    prisma.$queryRaw<Array<{ stage: "GROUP" | "KNOCKOUT"; courtId: string; count: number }>>`
      SELECT stage, "courtId" AS "courtId", COUNT(*)::int AS count
      FROM "CourtAssignment"
      WHERE status = 'ACTIVE'::"AssignmentStatus"
      GROUP BY stage, "courtId"
      HAVING COUNT(*) > 1
    `,
    prisma.$queryRaw<Array<{ stage: "GROUP" | "KNOCKOUT"; groupMatchId: string; count: number }>>`
      SELECT stage, "groupMatchId" AS "groupMatchId", COUNT(*)::int AS count
      FROM "CourtAssignment"
      WHERE status = 'ACTIVE'::"AssignmentStatus" AND "groupMatchId" IS NOT NULL
      GROUP BY stage, "groupMatchId"
      HAVING COUNT(*) > 1
    `,
    prisma.$queryRaw<
      Array<{ stage: "GROUP" | "KNOCKOUT"; knockoutMatchId: string; count: number }>
    >`
      SELECT stage, "knockoutMatchId" AS "knockoutMatchId", COUNT(*)::int AS count
      FROM "CourtAssignment"
      WHERE status = 'ACTIVE'::"AssignmentStatus" AND "knockoutMatchId" IS NOT NULL
      GROUP BY stage, "knockoutMatchId"
      HAVING COUNT(*) > 1
    `,
  ]);

  return { byCourt, byGroup, byKnockout };
}

export async function getGroupScheduleSnapshot() {
  const [scheduled, active, blocked] = await Promise.all([
    prisma.match.count({
      where: {
        stage: "GROUP",
        status: "SCHEDULED",
        homeTeamId: { not: null },
        awayTeamId: { not: null },
      },
    }),
    prisma.courtAssignment.count({
      where: {
        stage: "GROUP",
        status: "ACTIVE",
        matchType: "GROUP",
        groupMatchId: { not: null },
        groupMatch: { status: "SCHEDULED" },
      },
    }),
    prisma.blockedMatch.count({
      where: { matchType: "GROUP", groupMatchId: { not: null } },
    }),
  ]);
  return { scheduled, active, blocked };
}

export async function getActiveGroupMatchId() {
  const assignment = await prisma.courtAssignment.findFirst({
    where: { stage: "GROUP", status: "ACTIVE", matchType: "GROUP", groupMatchId: { not: null } },
    orderBy: { assignedAt: "asc" },
    select: { groupMatchId: true },
  });
  return assignment?.groupMatchId ?? null;
}

export async function ensureActiveGroupMatchId() {
  const existing = await getActiveGroupMatchId();
  if (existing) return existing;

  let match = await prisma.match.findFirst({
    where: {
      stage: "GROUP",
      status: "SCHEDULED",
      homeTeamId: { not: null },
      awayTeamId: { not: null },
    },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });

  if (!match) {
    const fallback = await prisma.match.findFirst({
      where: {
        stage: "GROUP",
        homeTeamId: { not: null },
        awayTeamId: { not: null },
      },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (!fallback) return null;
    match = await prisma.match.update({
      where: { id: fallback.id },
      data: { status: "SCHEDULED", completedAt: null, winnerTeamId: null },
      select: { id: true },
    });
  }

  const preferredCourtIds = ["P5", "P6", "P7", "P8", "P9"];

  let court = await prisma.court.findFirst({
    where: {
      id: { in: preferredCourtIds },
      assignments: {
        none: {
          stage: "GROUP",
          status: "ACTIVE",
        },
      },
    },
    orderBy: { id: "asc" },
    select: { id: true },
  });

  if (!court) {
    court = await prisma.court.findFirst({
      where: {
        assignments: {
          none: {
            stage: "GROUP",
            status: "ACTIVE",
          },
        },
      },
      orderBy: { id: "asc" },
      select: { id: true },
    });
  }

  if (!court) {
    const active = await prisma.courtAssignment.findFirst({
      where: {
        stage: "GROUP",
        status: "ACTIVE",
        courtId: { in: preferredCourtIds },
      },
      orderBy: { assignedAt: "asc" },
      select: { id: true, courtId: true },
    });
    const activeFallback =
      active ??
      (await prisma.courtAssignment.findFirst({
        where: { stage: "GROUP", status: "ACTIVE" },
        orderBy: { assignedAt: "asc" },
        select: { id: true, courtId: true },
      }));
    if (!activeFallback) return null;
    await prisma.courtAssignment.update({
      where: { id: activeFallback.id },
      data: { status: "CANCELED", clearedAt: new Date() },
    });
    court = { id: activeFallback.courtId };
  }

  await prisma.courtAssignment.create({
    data: {
      courtId: court.id,
      stage: "GROUP",
      matchType: "GROUP",
      groupMatchId: match.id,
      status: "ACTIVE",
    },
  });

  return match.id;
}

async function getGlobalRankingEntries(categoryCode: "MD" | "WD" | "XD") {
  const groups = await prisma.group.findMany({
    where: { category: { code: categoryCode } },
    include: {
      matches: {
        where: { stage: "GROUP" },
        include: { games: true },
      },
      teams: {
        include: {
          team: true,
        },
      },
    },
    orderBy: { name: "asc" },
  });

  const entries: {
    teamId: string;
    groupId: string;
    groupRank: number;
    avgPA: number;
  }[] = [];
  for (const group of groups) {
    const stats = new Map();
    for (const teamEntry of group.teams) {
      stats.set(teamEntry.team.id, {
        teamId: teamEntry.team.id,
        wins: 0,
        pointsAgainst: 0,
        played: 0,
      });
    }

    const completedMatches = group.matches.filter(
      (match) => match.status === "COMPLETED" || match.status === "WALKOVER"
    );

    for (const match of completedMatches) {
      if (!match.homeTeamId || !match.awayTeamId || !match.winnerTeamId) continue;
      const home = stats.get(match.homeTeamId);
      const away = stats.get(match.awayTeamId);
      if (!home || !away) continue;
      home.played += 1;
      away.played += 1;
      if (match.winnerTeamId === match.homeTeamId) {
        home.wins += 1;
      } else if (match.winnerTeamId === match.awayTeamId) {
        away.wins += 1;
      }
      for (const game of match.games) {
        home.pointsAgainst += game.awayPoints;
        away.pointsAgainst += game.homePoints;
      }
    }

    const groupRanking = Array.from(stats.values())
      .map((row) => ({
        ...row,
        avgPA: row.played > 0 ? row.pointsAgainst / row.played : 0,
      }))
      .sort((a, b) => {
        if (b.wins !== a.wins) return b.wins - a.wins;
        if (a.avgPA !== b.avgPA) return a.avgPA - b.avgPA;
        return a.teamId.localeCompare(b.teamId);
      });

    groupRanking.forEach((row, index) => {
      entries.push({
        teamId: row.teamId,
        groupId: group.id,
        groupRank: index + 1,
        avgPA: row.avgPA,
      });
    });
  }

  return entries
    .sort((a, b) => {
      if (a.groupRank !== b.groupRank) return a.groupRank - b.groupRank;
      if (a.avgPA !== b.avgPA) return a.avgPA - b.avgPA;
      return a.teamId.localeCompare(b.teamId);
    })
    .map((row, index) => ({
      ...row,
      globalRank: index + 1,
    }));
}

export async function getTop8GlobalRankingTeamIds(categoryCode: "MD" | "WD" | "XD") {
  const ranking = await getGlobalRankingEntries(categoryCode);
  return ranking.slice(0, 8).map((row) => row.teamId);
}

export async function getSeriesAQualifierTeamIds(categoryCode: "MD" | "WD" | "XD") {
  const qualifiers = await prisma.seriesQualifier.findMany({
    where: { categoryCode, series: "A" },
    select: { teamId: true },
    orderBy: { teamId: "asc" },
  });
  return qualifiers.map((entry) => entry.teamId);
}

export async function getKnockoutMatchIds(categoryCode: "MD" | "WD" | "XD") {
  const matches = await prisma.knockoutMatch.findMany({
    where: { categoryCode },
    select: { id: true },
  });
  return matches.map((match) => match.id);
}

export async function setGroupStageLock(categoryCode: "MD" | "WD" | "XD", locked: boolean) {
  await prisma.groupStageLock.upsert({
    where: { categoryCode },
    create: { categoryCode, locked },
    update: { locked },
  });
}

export async function seedSeriesAQualifiersFromTop8(categoryCode: "MD" | "WD" | "XD") {
  const ranking = await getGlobalRankingEntries(categoryCode);
  const top8 = ranking.slice(0, 8);
  await prisma.seriesQualifier.deleteMany({ where: { categoryCode } });
  if (top8.length === 0) return;

  await prisma.seriesQualifier.createMany({
    data: top8.map((entry) => ({
      categoryCode,
      series: "A",
      groupId: entry.groupId,
      teamId: entry.teamId,
      groupRank: entry.groupRank,
    })),
  });

  const rest = ranking.slice(8);
  if (rest.length > 0) {
    await prisma.seriesQualifier.createMany({
      data: rest.map((entry) => ({
        categoryCode,
        series: "B",
        groupId: entry.groupId,
        teamId: entry.teamId,
        groupRank: entry.groupRank,
      })),
    });
  }
}

export async function setSecondChanceEnabled(
  categoryCode: "MD" | "WD" | "XD",
  enabled: boolean
) {
  await prisma.categoryConfig.upsert({
    where: { categoryCode },
    create: { categoryCode, secondChanceEnabled: enabled },
    update: { secondChanceEnabled: enabled },
  });
}

export async function closeDb() {
  await prisma.$disconnect();
}
