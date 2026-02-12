"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type DuplicateByCourtRow = {
  stage: "GROUP" | "KNOCKOUT";
  courtId: string;
  count: number;
};

type DuplicateByGroupRow = {
  stage: "GROUP" | "KNOCKOUT";
  groupMatchId: string;
  count: number;
};

type DuplicateByKnockoutRow = {
  stage: "GROUP" | "KNOCKOUT";
  knockoutMatchId: string;
  count: number;
};

export type DuplicateAssignmentSummary = {
  byCourt: DuplicateByCourtRow[];
  byGroupMatch: DuplicateByGroupRow[];
  byKnockoutMatch: DuplicateByKnockoutRow[];
};

const LEGACY_COURT_MAP = [
  { legacy: "P5", canonical: "C1" },
  { legacy: "P6", canonical: "C2" },
  { legacy: "P7", canonical: "C3" },
  { legacy: "P8", canonical: "C4" },
  { legacy: "P9", canonical: "C5" },
] as const;

type LegacyCourtRow = {
  courtId: string;
  stageLockCount: number;
  assignmentCount: number;
};

export type LegacyCourtSummary = {
  legacyCourtRows: number;
  legacyStageLockRows: number;
  legacyAssignmentRows: number;
  byCourt: LegacyCourtRow[];
};

const TEST_PLAYER_PREFIXES = ["E2E ", "KR ", "Import "] as const;
const TEST_TEAM_PREFIXES = ["E2E-", "KR-", "Import "] as const;
const TEST_CLEANUP_CONFIRM_TOKEN = "CONFIRM_TEST_DELETE";

export type TestDataCleanupSummary = {
  players: number;
  teams: number;
  teamMembers: number;
  teamFlags: number;
  groupTeams: number;
  groups: number;
  groupRandomDraws: number;
  groupMatches: number;
  gameScores: number;
  knockoutMatches: number;
  knockoutGameScores: number;
  seriesQualifiers: number;
  knockoutSeeds: number;
  knockoutRandomDraws: number;
  refereeSubmissions: number;
  courtAssignments: number;
  blockedMatches: number;
  forcedMatchPriorities: number;
  scheduleActionLogs: number;
};

export type TestDataCleanupPreview = {
  summary: TestDataCleanupSummary;
  totalRows: number;
  hasMatches: boolean;
};

type TestCleanupTargets = {
  playerIds: string[];
  teamIds: string[];
  groupMatchIds: string[];
  knockoutMatchIds: string[];
  groupIds: string[];
  knockoutComboFilters: { categoryCode: "MD" | "WD" | "XD"; series: "A" | "B"; round: number }[];
  scheduleActionLogIds: string[];
};

type PrismaLike = Prisma.TransactionClient | typeof prisma;

function startsWithInsensitive<T extends string>(field: T, prefixes: readonly string[]) {
  return prefixes.map((prefix) => ({
    [field]: { startsWith: prefix, mode: "insensitive" as const },
  }));
}

async function resolveTestCleanupTargets(db: PrismaLike): Promise<TestCleanupTargets> {
  const prefixedPlayers = await db.player.findMany({
    where: { OR: startsWithInsensitive("name", TEST_PLAYER_PREFIXES) },
    select: { id: true },
  });
  const prefixedPlayerIds = new Set(prefixedPlayers.map((player) => player.id));

  const prefixedTeams = await db.team.findMany({
    where: { OR: startsWithInsensitive("name", TEST_TEAM_PREFIXES) },
    select: { id: true },
  });
  const teamIds = new Set(prefixedTeams.map((team) => team.id));

  const allTeamsWithMembers = await db.team.findMany({
    select: {
      id: true,
      members: { select: { playerId: true } },
    },
  });
  for (const team of allTeamsWithMembers) {
    if (
      team.members.length > 0 &&
      team.members.every((member) => prefixedPlayerIds.has(member.playerId))
    ) {
      teamIds.add(team.id);
    }
  }

  const teamIdList = [...teamIds];
  const teamMembers = teamIdList.length
    ? await db.teamMember.findMany({
        where: { teamId: { in: teamIdList } },
        select: { playerId: true },
      })
    : [];
  for (const member of teamMembers) {
    prefixedPlayerIds.add(member.playerId);
  }
  const playerIdList = [...prefixedPlayerIds];

  const groupMatches = teamIdList.length
    ? await db.match.findMany({
        where: {
          OR: [
            { homeTeamId: { in: teamIdList } },
            { awayTeamId: { in: teamIdList } },
            { winnerTeamId: { in: teamIdList } },
          ],
        },
        select: { id: true, groupId: true },
      })
    : [];
  const groupMatchIds = groupMatches.map((match) => match.id);

  const knockoutMatches = teamIdList.length
    ? await db.knockoutMatch.findMany({
        where: {
          OR: [
            { homeTeamId: { in: teamIdList } },
            { awayTeamId: { in: teamIdList } },
            { winnerTeamId: { in: teamIdList } },
          ],
        },
        select: { id: true, categoryCode: true, series: true, round: true },
      })
    : [];
  const knockoutMatchIds = knockoutMatches.map((match) => match.id);

  const groupLinks = teamIdList.length
    ? await db.groupTeam.findMany({
        where: { teamId: { in: teamIdList } },
        select: { groupId: true },
      })
    : [];
  const qualifierGroups = teamIdList.length
    ? await db.seriesQualifier.findMany({
        where: { teamId: { in: teamIdList } },
        select: { groupId: true },
      })
    : [];
  const groupIds = new Set<string>();
  for (const match of groupMatches) {
    if (match.groupId) groupIds.add(match.groupId);
  }
  for (const link of groupLinks) groupIds.add(link.groupId);
  for (const qualifier of qualifierGroups) groupIds.add(qualifier.groupId);

  const knockoutComboMap = new Map<string, { categoryCode: "MD" | "WD" | "XD"; series: "A" | "B"; round: number; targetedCount: number }>();
  for (const match of knockoutMatches) {
    const key = `${match.categoryCode}:${match.series}:${match.round}`;
    const existing = knockoutComboMap.get(key);
    if (existing) {
      existing.targetedCount += 1;
      continue;
    }
    knockoutComboMap.set(key, {
      categoryCode: match.categoryCode,
      series: match.series,
      round: match.round,
      targetedCount: 1,
    });
  }
  const knockoutComboFilters: TestCleanupTargets["knockoutComboFilters"] = [];
  for (const combo of knockoutComboMap.values()) {
    const totalInCombo = await db.knockoutMatch.count({
      where: {
        categoryCode: combo.categoryCode,
        series: combo.series,
        round: combo.round,
      },
    });
    if (totalInCombo === combo.targetedCount) {
      knockoutComboFilters.push({
        categoryCode: combo.categoryCode,
        series: combo.series,
        round: combo.round,
      });
    }
  }

  const scheduleLogMatchIds = [...groupMatchIds, ...knockoutMatchIds];
  const scheduleActionLogIds =
    scheduleLogMatchIds.length > 0
      ? (
          await db.$queryRaw<{ id: string }[]>(
            Prisma.sql`
              SELECT id
              FROM "ScheduleActionLog"
              WHERE payload::text ILIKE ANY (ARRAY[${Prisma.join(
                scheduleLogMatchIds.map((id) => `%${id}%`)
              )}])
            `
          )
        ).map((row) => row.id)
      : [];

  return {
    playerIds: playerIdList,
    teamIds: teamIdList,
    groupMatchIds,
    knockoutMatchIds,
    groupIds: [...groupIds],
    knockoutComboFilters,
    scheduleActionLogIds,
  };
}

function zeroTestCleanupSummary(): TestDataCleanupSummary {
  return {
    players: 0,
    teams: 0,
    teamMembers: 0,
    teamFlags: 0,
    groupTeams: 0,
    groups: 0,
    groupRandomDraws: 0,
    groupMatches: 0,
    gameScores: 0,
    knockoutMatches: 0,
    knockoutGameScores: 0,
    seriesQualifiers: 0,
    knockoutSeeds: 0,
    knockoutRandomDraws: 0,
    refereeSubmissions: 0,
    courtAssignments: 0,
    blockedMatches: 0,
    forcedMatchPriorities: 0,
    scheduleActionLogs: 0,
  };
}

async function buildTestCleanupPreview(db: PrismaLike): Promise<TestDataCleanupPreview> {
  const targets = await resolveTestCleanupTargets(db);
  const summary = zeroTestCleanupSummary();

  if (targets.teamIds.length > 0) {
    summary.teams = await db.team.count({ where: { id: { in: targets.teamIds } } });
    summary.teamMembers = await db.teamMember.count({ where: { teamId: { in: targets.teamIds } } });
    summary.teamFlags = await db.teamFlags.count({ where: { teamId: { in: targets.teamIds } } });
    summary.groupTeams = await db.groupTeam.count({ where: { teamId: { in: targets.teamIds } } });
    summary.seriesQualifiers = await db.seriesQualifier.count({
      where: { teamId: { in: targets.teamIds } },
    });
    summary.knockoutSeeds = await db.knockoutSeed.count({ where: { teamId: { in: targets.teamIds } } });
  }
  if (targets.playerIds.length > 0) {
    summary.players = await db.player.count({ where: { id: { in: targets.playerIds } } });
  }
  if (targets.groupMatchIds.length > 0) {
    summary.groupMatches = await db.match.count({ where: { id: { in: targets.groupMatchIds } } });
    summary.gameScores = await db.gameScore.count({ where: { matchId: { in: targets.groupMatchIds } } });
  }
  if (targets.knockoutMatchIds.length > 0) {
    summary.knockoutMatches = await db.knockoutMatch.count({
      where: { id: { in: targets.knockoutMatchIds } },
    });
    summary.knockoutGameScores = await db.knockoutGameScore.count({
      where: { knockoutMatchId: { in: targets.knockoutMatchIds } },
    });
  }
  if (targets.groupIds.length > 0) {
    summary.groupRandomDraws = await db.groupRandomDraw.count({
      where: { groupId: { in: targets.groupIds } },
    });
    summary.groups = await db.group.count({ where: { id: { in: targets.groupIds } } });
  }
  if (targets.knockoutComboFilters.length > 0) {
    summary.knockoutRandomDraws = await db.knockoutRandomDraw.count({
      where: { OR: targets.knockoutComboFilters },
    });
  }

  summary.refereeSubmissions = await db.refereeSubmission.count({
    where: {
      OR: [
        targets.groupMatchIds.length > 0 ? { groupMatchId: { in: targets.groupMatchIds } } : undefined,
        targets.knockoutMatchIds.length > 0
          ? { knockoutMatchId: { in: targets.knockoutMatchIds } }
          : undefined,
      ].filter(Boolean) as Prisma.RefereeSubmissionWhereInput[],
    },
  });

  summary.courtAssignments = await db.courtAssignment.count({
    where: {
      OR: [
        targets.groupMatchIds.length > 0 ? { groupMatchId: { in: targets.groupMatchIds } } : undefined,
        targets.knockoutMatchIds.length > 0
          ? { knockoutMatchId: { in: targets.knockoutMatchIds } }
          : undefined,
      ].filter(Boolean) as Prisma.CourtAssignmentWhereInput[],
    },
  });

  summary.blockedMatches = await db.blockedMatch.count({
    where: {
      OR: [
        targets.groupMatchIds.length > 0 ? { groupMatchId: { in: targets.groupMatchIds } } : undefined,
        targets.knockoutMatchIds.length > 0
          ? { knockoutMatchId: { in: targets.knockoutMatchIds } }
          : undefined,
      ].filter(Boolean) as Prisma.BlockedMatchWhereInput[],
    },
  });

  summary.forcedMatchPriorities = await db.forcedMatchPriority.count({
    where: {
      OR: [
        targets.groupMatchIds.length > 0
          ? { matchType: "GROUP", matchId: { in: targets.groupMatchIds } }
          : undefined,
        targets.knockoutMatchIds.length > 0
          ? { matchType: "KNOCKOUT", matchId: { in: targets.knockoutMatchIds } }
          : undefined,
      ].filter(Boolean) as Prisma.ForcedMatchPriorityWhereInput[],
    },
  });

  summary.scheduleActionLogs = targets.scheduleActionLogIds.length;

  const totalRows = Object.values(summary).reduce((sum, value) => sum + value, 0);
  const hasMatches = targets.groupMatchIds.length > 0 || targets.knockoutMatchIds.length > 0;
  return { summary, totalRows, hasMatches };
}

async function readDuplicateSummary(): Promise<DuplicateAssignmentSummary> {
  const [byCourt, byGroupMatch, byKnockoutMatch] = await Promise.all([
    prisma.$queryRaw<DuplicateByCourtRow[]>`
      SELECT
        stage,
        "courtId" AS "courtId",
        COUNT(*)::int AS count
      FROM "CourtAssignment"
      WHERE status = 'ACTIVE'::"AssignmentStatus"
      GROUP BY stage, "courtId"
      HAVING COUNT(*) > 1
      ORDER BY stage, "courtId"
    `,
    prisma.$queryRaw<DuplicateByGroupRow[]>`
      SELECT
        stage,
        "groupMatchId" AS "groupMatchId",
        COUNT(*)::int AS count
      FROM "CourtAssignment"
      WHERE status = 'ACTIVE'::"AssignmentStatus"
        AND "groupMatchId" IS NOT NULL
      GROUP BY stage, "groupMatchId"
      HAVING COUNT(*) > 1
      ORDER BY stage, "groupMatchId"
    `,
    prisma.$queryRaw<DuplicateByKnockoutRow[]>`
      SELECT
        stage,
        "knockoutMatchId" AS "knockoutMatchId",
        COUNT(*)::int AS count
      FROM "CourtAssignment"
      WHERE status = 'ACTIVE'::"AssignmentStatus"
        AND "knockoutMatchId" IS NOT NULL
      GROUP BY stage, "knockoutMatchId"
      HAVING COUNT(*) > 1
      ORDER BY stage, "knockoutMatchId"
    `,
  ]);

  return { byCourt, byGroupMatch, byKnockoutMatch };
}

export async function checkDuplicateAssignments() {
  const guard = await requireAdmin({ onFail: "return" });
  if (guard) return guard;
  const summary = await readDuplicateSummary();
  return { ok: true as const, summary };
}

export async function clearDuplicateAssignments() {
  const guard = await requireAdmin({ onFail: "return" });
  if (guard) return guard;

  const [clearedByCourt, clearedByGroup, clearedByKnockout] = await Promise.all([
    prisma.$executeRaw`
      WITH ranked AS (
        SELECT
          id,
          ROW_NUMBER() OVER (
            PARTITION BY stage, "courtId"
            ORDER BY "assignedAt" DESC, id DESC
          ) AS rn
        FROM "CourtAssignment"
        WHERE status = 'ACTIVE'::"AssignmentStatus"
      )
      UPDATE "CourtAssignment" ca
      SET
        status = 'CANCELED'::"AssignmentStatus",
        "clearedAt" = COALESCE(ca."clearedAt", NOW())
      FROM ranked
      WHERE ca.id = ranked.id
        AND ranked.rn > 1
    `,
    prisma.$executeRaw`
      WITH ranked AS (
        SELECT
          id,
          ROW_NUMBER() OVER (
            PARTITION BY stage, "groupMatchId"
            ORDER BY "assignedAt" DESC, id DESC
          ) AS rn
        FROM "CourtAssignment"
        WHERE status = 'ACTIVE'::"AssignmentStatus"
          AND "groupMatchId" IS NOT NULL
      )
      UPDATE "CourtAssignment" ca
      SET
        status = 'CANCELED'::"AssignmentStatus",
        "clearedAt" = COALESCE(ca."clearedAt", NOW())
      FROM ranked
      WHERE ca.id = ranked.id
        AND ranked.rn > 1
    `,
    prisma.$executeRaw`
      WITH ranked AS (
        SELECT
          id,
          ROW_NUMBER() OVER (
            PARTITION BY stage, "knockoutMatchId"
            ORDER BY "assignedAt" DESC, id DESC
          ) AS rn
        FROM "CourtAssignment"
        WHERE status = 'ACTIVE'::"AssignmentStatus"
          AND "knockoutMatchId" IS NOT NULL
      )
      UPDATE "CourtAssignment" ca
      SET
        status = 'CANCELED'::"AssignmentStatus",
        "clearedAt" = COALESCE(ca."clearedAt", NOW())
      FROM ranked
      WHERE ca.id = ranked.id
        AND ranked.rn > 1
    `,
  ]);

  const summary = await readDuplicateSummary();
  revalidatePath("/utilities");
  revalidatePath("/schedule");

  return {
    ok: true as const,
    cleared: {
      byCourt: Number(clearedByCourt),
      byGroup: Number(clearedByGroup),
      byKnockout: Number(clearedByKnockout),
      total: Number(clearedByCourt) + Number(clearedByGroup) + Number(clearedByKnockout),
    },
    summary,
  };
}

async function readLegacyCourtSummary(): Promise<LegacyCourtSummary> {
  const byCourt = await prisma.$queryRaw<LegacyCourtRow[]>`
    SELECT
      c.id AS "courtId",
      (
        SELECT COUNT(*)::int
        FROM "CourtStageLock" l
        WHERE l."courtId" = c.id
      ) AS "stageLockCount",
      (
        SELECT COUNT(*)::int
        FROM "CourtAssignment" a
        WHERE a."courtId" = c.id
      ) AS "assignmentCount"
    FROM "Court" c
    WHERE c.id IN ('P5', 'P6', 'P7', 'P8', 'P9')
    ORDER BY c.id
  `;

  const [legacyCourtRows, legacyStageLockRows, legacyAssignmentRows] = await Promise.all([
    prisma.court.count({ where: { id: { in: LEGACY_COURT_MAP.map((entry) => entry.legacy) } } }),
    prisma.courtStageLock.count({
      where: { courtId: { in: LEGACY_COURT_MAP.map((entry) => entry.legacy) } },
    }),
    prisma.courtAssignment.count({
      where: { courtId: { in: LEGACY_COURT_MAP.map((entry) => entry.legacy) } },
    }),
  ]);

  return {
    legacyCourtRows,
    legacyStageLockRows,
    legacyAssignmentRows,
    byCourt,
  };
}

export async function checkLegacyCourtIds() {
  const guard = await requireAdmin({ onFail: "return" });
  if (guard) return guard;
  const summary = await readLegacyCourtSummary();
  return { ok: true as const, summary };
}

export async function fixLegacyCourtIds() {
  const guard = await requireAdmin({ onFail: "return" });
  if (guard) return guard;

  const updated = await prisma.$transaction(async (tx) => {
    await tx.court.createMany({
      data: LEGACY_COURT_MAP.map((entry) => ({ id: entry.canonical })),
      skipDuplicates: true,
    });

    let canceledConflictingActiveAssignments = 0;
    let movedAssignments = 0;
    let deletedLegacyLocks = 0;
    let deletedLegacyCourts = 0;

    for (const entry of LEGACY_COURT_MAP) {
      const canceled = await tx.$executeRaw`
        UPDATE "CourtAssignment" legacy
        SET
          status = 'CANCELED'::"AssignmentStatus",
          "clearedAt" = COALESCE(legacy."clearedAt", NOW())
        FROM "CourtAssignment" canonical
        WHERE legacy."courtId" = ${entry.legacy}
          AND canonical."courtId" = ${entry.canonical}
          AND legacy.stage = canonical.stage
          AND legacy.status = 'ACTIVE'::"AssignmentStatus"
          AND canonical.status = 'ACTIVE'::"AssignmentStatus"
      `;
      canceledConflictingActiveAssignments += Number(canceled);

      const moved = await tx.$executeRaw`
        UPDATE "CourtAssignment"
        SET "courtId" = ${entry.canonical}
        WHERE "courtId" = ${entry.legacy}
      `;
      movedAssignments += Number(moved);

      const legacyLocks = await tx.courtStageLock.findMany({
        where: { courtId: entry.legacy },
        select: { stage: true, locked: true, lockReason: true },
      });
      for (const lock of legacyLocks) {
        await tx.courtStageLock.upsert({
          where: { courtId_stage: { courtId: entry.canonical, stage: lock.stage } },
          create: {
            courtId: entry.canonical,
            stage: lock.stage,
            locked: lock.locked,
            lockReason: lock.lockReason,
          },
          update: {
            locked: lock.locked,
            lockReason: lock.lockReason,
          },
        });
      }

      const deletedLocks = await tx.$executeRaw`
        DELETE FROM "CourtStageLock"
        WHERE "courtId" = ${entry.legacy}
      `;
      deletedLegacyLocks += Number(deletedLocks);

      const deletedCourts = await tx.$executeRaw`
        DELETE FROM "Court"
        WHERE "id" = ${entry.legacy}
      `;
      deletedLegacyCourts += Number(deletedCourts);
    }

    return {
      canceledConflictingActiveAssignments,
      movedAssignments,
      deletedLegacyLocks,
      deletedLegacyCourts,
    };
  });

  const summary = await readLegacyCourtSummary();
  revalidatePath("/utilities");
  revalidatePath("/schedule");
  revalidatePath("/presenting");
  revalidatePath("/referee");

  return { ok: true as const, updated, summary };
}

export async function previewTestDataCleanup() {
  const guard = await requireAdmin({ onFail: "return" });
  if (guard) return guard;
  const preview = await buildTestCleanupPreview(prisma);
  return { ok: true as const, preview };
}

export async function removeTestDataCleanup(confirmToken: string) {
  const guard = await requireAdmin({ onFail: "return" });
  if (guard) return guard;
  if (confirmToken !== TEST_CLEANUP_CONFIRM_TOKEN) {
    return { error: "Invalid confirmation token." } as const;
  }

  const deleted = await prisma.$transaction(async (tx) => {
    const targets = await resolveTestCleanupTargets(tx);

    const refereeSubmissions = await tx.refereeSubmission.deleteMany({
      where: {
        OR: [
          targets.groupMatchIds.length > 0 ? { groupMatchId: { in: targets.groupMatchIds } } : undefined,
          targets.knockoutMatchIds.length > 0
            ? { knockoutMatchId: { in: targets.knockoutMatchIds } }
            : undefined,
        ].filter(Boolean) as Prisma.RefereeSubmissionWhereInput[],
      },
    });

    const forcedMatchPriorities = await tx.forcedMatchPriority.deleteMany({
      where: {
        OR: [
          targets.groupMatchIds.length > 0
            ? { matchType: "GROUP", matchId: { in: targets.groupMatchIds } }
            : undefined,
          targets.knockoutMatchIds.length > 0
            ? { matchType: "KNOCKOUT", matchId: { in: targets.knockoutMatchIds } }
            : undefined,
        ].filter(Boolean) as Prisma.ForcedMatchPriorityWhereInput[],
      },
    });

    const blockedMatches = await tx.blockedMatch.deleteMany({
      where: {
        OR: [
          targets.groupMatchIds.length > 0 ? { groupMatchId: { in: targets.groupMatchIds } } : undefined,
          targets.knockoutMatchIds.length > 0
            ? { knockoutMatchId: { in: targets.knockoutMatchIds } }
            : undefined,
        ].filter(Boolean) as Prisma.BlockedMatchWhereInput[],
      },
    });

    const scheduleActionLogs = targets.scheduleActionLogIds.length
      ? await tx.scheduleActionLog.deleteMany({
          where: { id: { in: targets.scheduleActionLogIds } },
        })
      : { count: 0 };

    const courtAssignments = await tx.courtAssignment.deleteMany({
      where: {
        OR: [
          targets.groupMatchIds.length > 0 ? { groupMatchId: { in: targets.groupMatchIds } } : undefined,
          targets.knockoutMatchIds.length > 0
            ? { knockoutMatchId: { in: targets.knockoutMatchIds } }
            : undefined,
        ].filter(Boolean) as Prisma.CourtAssignmentWhereInput[],
      },
    });

    const knockoutGameScores = targets.knockoutMatchIds.length
      ? await tx.knockoutGameScore.deleteMany({
          where: { knockoutMatchId: { in: targets.knockoutMatchIds } },
        })
      : { count: 0 };
    const knockoutMatches = targets.knockoutMatchIds.length
      ? await tx.knockoutMatch.deleteMany({ where: { id: { in: targets.knockoutMatchIds } } })
      : { count: 0 };
    const knockoutSeeds = targets.teamIds.length
      ? await tx.knockoutSeed.deleteMany({ where: { teamId: { in: targets.teamIds } } })
      : { count: 0 };
    const seriesQualifiers = targets.teamIds.length
      ? await tx.seriesQualifier.deleteMany({ where: { teamId: { in: targets.teamIds } } })
      : { count: 0 };
    const knockoutRandomDraws = targets.knockoutComboFilters.length
      ? await tx.knockoutRandomDraw.deleteMany({ where: { OR: targets.knockoutComboFilters } })
      : { count: 0 };

    const gameScores = targets.groupMatchIds.length
      ? await tx.gameScore.deleteMany({ where: { matchId: { in: targets.groupMatchIds } } })
      : { count: 0 };
    const groupMatches = targets.groupMatchIds.length
      ? await tx.match.deleteMany({ where: { id: { in: targets.groupMatchIds } } })
      : { count: 0 };

    const groupTeams = targets.teamIds.length
      ? await tx.groupTeam.deleteMany({ where: { teamId: { in: targets.teamIds } } })
      : { count: 0 };
    const groupRandomDraws = targets.groupIds.length
      ? await tx.groupRandomDraw.deleteMany({ where: { groupId: { in: targets.groupIds } } })
      : { count: 0 };
    const groups = targets.groupIds.length
      ? await tx.group.deleteMany({
          where: {
            id: { in: targets.groupIds },
            matches: { none: {} },
            teams: { none: {} },
            seriesQualifiers: { none: {} },
            randomDraws: { none: {} },
          },
        })
      : { count: 0 };

    const teamFlags = targets.teamIds.length
      ? await tx.teamFlags.deleteMany({ where: { teamId: { in: targets.teamIds } } })
      : { count: 0 };
    const teamMembers = targets.teamIds.length
      ? await tx.teamMember.deleteMany({ where: { teamId: { in: targets.teamIds } } })
      : { count: 0 };
    const teams = targets.teamIds.length
      ? await tx.team.deleteMany({ where: { id: { in: targets.teamIds } } })
      : { count: 0 };
    const players = targets.playerIds.length
      ? await tx.player.deleteMany({
          where: { id: { in: targets.playerIds }, teams: { none: {} } },
        })
      : { count: 0 };

    return {
      players: players.count,
      teams: teams.count,
      teamMembers: teamMembers.count,
      teamFlags: teamFlags.count,
      groupTeams: groupTeams.count,
      groups: groups.count,
      groupRandomDraws: groupRandomDraws.count,
      groupMatches: groupMatches.count,
      gameScores: gameScores.count,
      knockoutMatches: knockoutMatches.count,
      knockoutGameScores: knockoutGameScores.count,
      seriesQualifiers: seriesQualifiers.count,
      knockoutSeeds: knockoutSeeds.count,
      knockoutRandomDraws: knockoutRandomDraws.count,
      refereeSubmissions: refereeSubmissions.count,
      courtAssignments: courtAssignments.count,
      blockedMatches: blockedMatches.count,
      forcedMatchPriorities: forcedMatchPriorities.count,
      scheduleActionLogs: scheduleActionLogs.count,
    } satisfies TestDataCleanupSummary;
  });

  const remaining = await buildTestCleanupPreview(prisma);
  revalidatePath("/utilities");
  revalidatePath("/schedule");
  revalidatePath("/presenting");
  revalidatePath("/referee");
  revalidatePath("/standings");
  revalidatePath("/brackets");

  return {
    ok: true as const,
    deleted,
    remaining,
  };
}
