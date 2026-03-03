import { createHash, randomBytes, scrypt as scryptCallback } from "crypto";
import { promisify } from "util";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const scrypt = promisify(scryptCallback);

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

export async function clearActiveGroupAssignments() {
  await prisma.courtAssignment.updateMany({
    where: { stage: "GROUP", status: "ACTIVE" },
    data: { status: "CLEARED", clearedAt: new Date() },
  });
}

export async function countActiveGroupAssignmentsWithUncheckedPlayers() {
  return prisma.courtAssignment.count({
    where: {
      stage: "GROUP",
      status: "ACTIVE",
      matchType: "GROUP",
      groupMatchId: { not: null },
      groupMatch: {
        OR: [
          { homeTeam: { members: { some: { player: { checkedIn: false } } } } },
          { awayTeam: { members: { some: { player: { checkedIn: false } } } } },
        ],
      },
    },
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

export async function getGroupStagePreconditions() {
  const [assignmentLocks, stageLocks, schedulableGroupMatches] = await Promise.all([
    prisma.groupAssignmentLock.findMany({
      where: { categoryCode: { in: ["MD", "WD", "XD"] } },
      select: { categoryCode: true, locked: true },
    }),
    prisma.groupStageLock.findMany({
      where: { categoryCode: { in: ["MD", "WD", "XD"] } },
      select: { categoryCode: true, locked: true },
    }),
    prisma.match.count({
      where: {
        stage: "GROUP",
        homeTeamId: { not: null },
        awayTeamId: { not: null },
      },
    }),
  ]);

  return {
    assignmentLocks,
    stageLocks,
    schedulableGroupMatches,
  };
}

export async function getGeneratedGroupMatchesByCategory(categoryCodes: ("MD" | "WD" | "XD")[]) {
  const rows = await prisma.match.groupBy({
    by: ["groupId"],
    where: {
      stage: "GROUP",
      group: { category: { code: { in: categoryCodes } } },
    },
    _count: { _all: true },
  });

  const groups = await prisma.group.findMany({
    where: { id: { in: rows.map((row) => row.groupId).filter(Boolean) as string[] } },
    select: { id: true, category: { select: { code: true } } },
  });
  const codeByGroupId = new Map(groups.map((group) => [group.id, group.category.code]));
  const counts: Record<"MD" | "WD" | "XD", number> = { MD: 0, WD: 0, XD: 0 };

  for (const row of rows) {
    if (!row.groupId) continue;
    const code = codeByGroupId.get(row.groupId);
    if (!code) continue;
    counts[code] += row._count._all;
  }
  return counts;
}

export async function getGroupSimulationCourtLabels(limit = 5) {
  const [activeAssignments, courts] = await Promise.all([
    prisma.courtAssignment.findMany({
      where: { stage: "GROUP", status: "ACTIVE" },
      orderBy: [{ assignedAt: "asc" }, { courtId: "asc" }],
      select: { courtId: true },
    }),
    prisma.court.findMany({
      orderBy: { id: "asc" },
      select: { id: true },
    }),
  ]);

  const ordered = [
    ...new Set([
      ...activeAssignments.map((entry) => entry.courtId),
      ...courts.map((court) => court.id),
    ]),
  ].slice(0, limit);

  return ordered;
}

export async function getGroupProgress() {
  const [scheduled, completed, activeAssignments, blocked] = await Promise.all([
    prisma.match.count({
      where: {
        stage: "GROUP",
        status: "SCHEDULED",
        homeTeamId: { not: null },
        awayTeamId: { not: null },
      },
    }),
    prisma.match.count({
      where: {
        stage: "GROUP",
        status: { in: ["COMPLETED"] },
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
      },
    }),
    prisma.blockedMatch.count({
      where: { matchType: "GROUP", groupMatchId: { not: null } },
    }),
  ]);
  return { scheduled, completed, activeAssignments, blocked };
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

export async function getActiveGroupAssignmentSnapshot() {
  const assignment = await prisma.courtAssignment.findFirst({
    where: {
      stage: "GROUP",
      status: "ACTIVE",
      matchType: "GROUP",
      groupMatchId: { not: null },
    },
    orderBy: { assignedAt: "asc" },
    include: {
      groupMatch: {
        select: {
          id: true,
          homeTeam: { select: { name: true } },
          awayTeam: { select: { name: true } },
        },
      },
    },
  });

  if (!assignment?.groupMatch) return null;
  return {
    courtId: assignment.courtId,
    matchId: assignment.groupMatch.id,
    homeTeamName: assignment.groupMatch.homeTeam?.name ?? "TBD",
    awayTeamName: assignment.groupMatch.awayTeam?.name ?? "TBD",
  };
}

export async function getActiveKnockoutMatchId() {
  const assignment = await prisma.courtAssignment.findFirst({
    where: {
      stage: "KNOCKOUT",
      status: "ACTIVE",
      matchType: "KNOCKOUT",
      knockoutMatchId: { not: null },
    },
    orderBy: { assignedAt: "asc" },
    select: { knockoutMatchId: true },
  });
  return assignment?.knockoutMatchId ?? null;
}

export async function ensureActiveKnockoutMatchId() {
  const existing = await getActiveKnockoutMatchId();
  if (existing) return existing;

  const activeIds = await prisma.courtAssignment.findMany({
    where: {
      stage: "KNOCKOUT",
      status: "ACTIVE",
      matchType: "KNOCKOUT",
      knockoutMatchId: { not: null },
    },
    select: { knockoutMatchId: true },
  });
  const occupiedMatchIds = activeIds
    .map((entry) => entry.knockoutMatchId)
    .filter(Boolean) as string[];

  const match = await prisma.knockoutMatch.findFirst({
    where: {
      status: "SCHEDULED",
      isPublished: true,
      homeTeamId: { not: null },
      awayTeamId: { not: null },
      ...(occupiedMatchIds.length > 0 ? { id: { notIn: occupiedMatchIds } } : {}),
    },
    orderBy: [{ round: "asc" }, { matchNo: "asc" }, { createdAt: "asc" }],
    select: { id: true },
  });
  if (!match) return null;

  let court = await prisma.court.findFirst({
    where: {
      assignments: {
        none: {
          stage: "KNOCKOUT",
          status: "ACTIVE",
        },
      },
    },
    orderBy: { id: "asc" },
    select: { id: true },
  });

  if (!court) {
    const active = await prisma.courtAssignment.findFirst({
      where: {
        stage: "KNOCKOUT",
        status: "ACTIVE",
      },
      orderBy: { assignedAt: "asc" },
      select: { id: true, courtId: true },
    });
    if (!active) return null;
    await prisma.courtAssignment.update({
      where: { id: active.id },
      data: { status: "CANCELED", clearedAt: new Date() },
    });
    court = { id: active.courtId };
  }

  await prisma.courtAssignment.create({
    data: {
      courtId: court.id,
      stage: "KNOCKOUT",
      matchType: "KNOCKOUT",
      knockoutMatchId: match.id,
      status: "ACTIVE",
    },
  });

  return match.id;
}

export async function getActiveKnockoutAssignmentSnapshot() {
  const assignment = await prisma.courtAssignment.findFirst({
    where: {
      stage: "KNOCKOUT",
      status: "ACTIVE",
      matchType: "KNOCKOUT",
      knockoutMatchId: { not: null },
    },
    orderBy: { assignedAt: "asc" },
    include: {
      knockoutMatch: {
        select: {
          id: true,
          homeTeam: { select: { name: true } },
          awayTeam: { select: { name: true } },
        },
      },
    },
  });

  if (!assignment?.knockoutMatch) return null;
  return {
    courtId: assignment.courtId,
    matchId: assignment.knockoutMatch.id,
    homeTeamName: assignment.knockoutMatch.homeTeam?.name ?? "TBD",
    awayTeamName: assignment.knockoutMatch.awayTeam?.name ?? "TBD",
  };
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
      (match) => match.status === "COMPLETED"
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

export async function getTop12GlobalRankingTeamIds(categoryCode: "MD" | "WD" | "XD") {
  const ranking = await getGlobalRankingEntries(categoryCode);
  return ranking.slice(0, 12).map((row) => row.teamId);
}

export async function getTop16GlobalRankingTeamIds(categoryCode: "MD" | "WD" | "XD") {
  const ranking = await getGlobalRankingEntries(categoryCode);
  return ranking.slice(0, 16).map((row) => row.teamId);
}

export async function getGlobalRankingTeamIds(categoryCode: "MD" | "WD" | "XD") {
  const ranking = await getGlobalRankingEntries(categoryCode);
  return ranking.map((row) => row.teamId);
}

export async function getSeriesAQualifierTeamIds(categoryCode: "MD" | "WD" | "XD") {
  const qualifiers = await prisma.seriesQualifier.findMany({
    where: { categoryCode, series: "A" },
    select: { teamId: true },
    orderBy: { teamId: "asc" },
  });
  return qualifiers.map((entry) => entry.teamId);
}

export async function getSeriesBQualifierTeamIds(categoryCode: "MD" | "WD" | "XD") {
  const qualifiers = await prisma.seriesQualifier.findMany({
    where: { categoryCode, series: "B" },
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

export async function seedSeriesQualifiersFromCurrentRules(categoryCode: "MD" | "WD" | "XD") {
  const ranking = await getGlobalRankingEntries(categoryCode);
  await prisma.seriesQualifier.deleteMany({ where: { categoryCode } });

  if (ranking.length === 0) {
    return { seriesACount: 0, seriesBCount: 0, eliminatedCount: 0 };
  }

  if (categoryCode === "WD") {
    if (ranking.length < 4) {
      return {
        seriesACount: 0,
        seriesBCount: 0,
        eliminatedCount: ranking.length,
      };
    }

    const qualifiedCount = ranking.length > 8 ? 8 : 4;
    const seriesA = ranking.slice(0, qualifiedCount);
    await prisma.seriesQualifier.createMany({
      data: seriesA.map((entry) => ({
        categoryCode,
        series: "A",
        groupId: entry.groupId,
        teamId: entry.teamId,
        groupRank: entry.groupRank,
      })),
    });

    return {
      seriesACount: seriesA.length,
      seriesBCount: 0,
      eliminatedCount: Math.max(0, ranking.length - seriesA.length),
    };
  }

  if (ranking.length < 8) {
    return {
      seriesACount: 0,
      seriesBCount: 0,
      eliminatedCount: ranking.length,
    };
  }

  const config = await prisma.categoryConfig.findUnique({
    where: { categoryCode },
    select: { playInsEnabled: true },
  });
  const playInsEnabled = config?.playInsEnabled ?? false;
  const eligible = ranking.slice(0, playInsEnabled ? 16 : 12);
  const seriesA = eligible.slice(0, 8);
  const seriesB = eligible.slice(8);

  await prisma.seriesQualifier.createMany({
    data: seriesA.map((entry) => ({
      categoryCode,
      series: "A",
      groupId: entry.groupId,
      teamId: entry.teamId,
      groupRank: entry.groupRank,
    })),
  });

  if (seriesB.length > 0) {
    await prisma.seriesQualifier.createMany({
      data: seriesB.map((entry) => ({
        categoryCode,
        series: "B",
        groupId: entry.groupId,
        teamId: entry.teamId,
        groupRank: entry.groupRank,
      })),
    });
  }

  return {
    seriesACount: seriesA.length,
    seriesBCount: seriesB.length,
    eliminatedCount: Math.max(0, ranking.length - eligible.length),
  };
}

export async function seedMdXdSeriesQualifiersWithSeriesBCount(
  categoryCode: "MD" | "XD",
  seriesBCount: number
) {
  const ranking = await getGlobalRankingEntries(categoryCode);
  const needed = 8 + seriesBCount;
  await prisma.seriesQualifier.deleteMany({ where: { categoryCode } });

  if (seriesBCount < 0 || ranking.length < needed || ranking.length < 8) {
    return { ok: false as const, rankingCount: ranking.length, needed };
  }

  const seriesA = ranking.slice(0, 8);
  const seriesB = ranking.slice(8, needed);

  await prisma.seriesQualifier.createMany({
    data: seriesA.map((entry) => ({
      categoryCode,
      series: "A",
      groupId: entry.groupId,
      teamId: entry.teamId,
      groupRank: entry.groupRank,
    })),
  });

  if (seriesB.length > 0) {
    await prisma.seriesQualifier.createMany({
      data: seriesB.map((entry) => ({
        categoryCode,
        series: "B",
        groupId: entry.groupId,
        teamId: entry.teamId,
        groupRank: entry.groupRank,
      })),
    });
  }

  return { ok: true as const, seriesACount: seriesA.length, seriesBCount: seriesB.length };
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

export async function setPlayInsEnabled(
  categoryCode: "MD" | "WD" | "XD",
  enabled: boolean
) {
  if (categoryCode === "WD") return;
  await prisma.categoryConfig.upsert({
    where: { categoryCode },
    create: { categoryCode, playInsEnabled: enabled },
    update: { playInsEnabled: enabled },
  });
}

async function hashRefereeTestPassword(password: string) {
  const salt = randomBytes(16).toString("base64url");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${derived.toString("base64url")}`;
}

function hashRefereeSessionToken(token: string) {
  return createHash("sha256").update(token).digest("base64url");
}

export async function createTestRefereeAccount(params: {
  prefix: string;
  password: string;
  username?: string;
  displayName?: string;
}) {
  const randomSuffix = randomBytes(4).toString("hex");
  const generatedUsername = `${params.prefix}_${Date.now()}_${randomSuffix}`.toLowerCase();
  const username = (params.username ?? generatedUsername).trim();
  const usernameNormalized = username.toLowerCase();
  const displayName = params.displayName?.trim() || `Referee ${username}`;
  const passwordHash = await hashRefereeTestPassword(params.password);

  return prisma.refereeAccount.create({
    data: {
      username,
      usernameNormalized,
      displayName,
      passwordHash,
      isActive: true,
    },
    select: {
      id: true,
      username: true,
      displayName: true,
    },
  });
}

export async function createRefereeSessionToken(refereeAccountId: string, ttlSeconds = 60 * 60 * 24) {
  const token = randomBytes(32).toString("base64url");
  await prisma.refereeSession.create({
    data: {
      refereeAccountId,
      sessionTokenHash: hashRefereeSessionToken(token),
      expiresAt: new Date(Date.now() + ttlSeconds * 1000),
    },
  });
  return token;
}

export async function setRefereeAccountActive(refereeAccountId: string, isActive: boolean) {
  await prisma.refereeAccount.update({
    where: { id: refereeAccountId },
    data: { isActive },
  });
}

export async function deleteRefereeSessionsByAccountIds(refereeAccountIds: string[]) {
  if (refereeAccountIds.length === 0) return 0;
  const deleted = await prisma.refereeSession.deleteMany({
    where: {
      refereeAccountId: { in: refereeAccountIds },
    },
  });
  return deleted.count;
}

export async function deleteTestRefereeSubmissionsByAccountIds(refereeAccountIds: string[]) {
  if (refereeAccountIds.length === 0) return 0;
  const deleted = await prisma.refereeSubmission.deleteMany({
    where: {
      refereeAccountId: { in: refereeAccountIds },
    },
  });
  return deleted.count;
}

export async function deleteTestRefereeAccountsByPrefix(prefix: string) {
  const normalizedPrefix = prefix.trim().toLowerCase();
  if (!normalizedPrefix) {
    return {
      deletedAccounts: 0,
      deletedSessions: 0,
      deletedSubmissions: 0,
      accountIds: [] as string[],
    };
  }

  const accounts = await prisma.refereeAccount.findMany({
    where: {
      usernameNormalized: {
        startsWith: normalizedPrefix,
      },
    },
    select: { id: true },
  });
  const accountIds = accounts.map((account) => account.id);
  const deletedSubmissions = await deleteTestRefereeSubmissionsByAccountIds(accountIds);
  const deletedSessions = await deleteRefereeSessionsByAccountIds(accountIds);
  const deletedAccounts = await prisma.refereeAccount.deleteMany({
    where: {
      id: { in: accountIds },
    },
  });

  return {
    deletedAccounts: deletedAccounts.count,
    deletedSessions,
    deletedSubmissions,
    accountIds,
  };
}

export async function countTestRefereeAccountsByPrefix(prefix: string) {
  const normalizedPrefix = prefix.trim().toLowerCase();
  if (!normalizedPrefix) return 0;
  return prisma.refereeAccount.count({
    where: {
      usernameNormalized: {
        startsWith: normalizedPrefix,
      },
    },
  });
}

export async function closeDb() {
  await prisma.$disconnect();
}
