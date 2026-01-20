"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";

type CategoryFilter = "ALL" | "MD" | "WD" | "XD";
type MatchType = "GROUP" | "KNOCKOUT";

type ScheduleMatchItem = {
  key: string;
  matchId: string;
  matchType: MatchType;
  categoryCode: "MD" | "WD" | "XD";
  label: string;
  detail: string;
  round?: number;
  matchNo?: number;
  teams: {
    homeName: string;
    awayName: string;
    homePlayers: string[];
    awayPlayers: string[];
    playerNames: string[];
    playerIds: string[];
  };
  restScore: number;
  forcedRank?: number;
  isForced?: boolean;
};

type LastBatchPayload = {
  matchKeys: string[];
  playerIds: string[];
  updatedAt: string;
};

const matchTypeSchema = z.enum(["GROUP", "KNOCKOUT"]);
const categoryFilterSchema = z.enum(["ALL", "MD", "WD", "XD"]);
const COURT_IDS = ["C1", "C2", "C3", "C4", "C5"] as const;
const SCHEDULE_DEBUG = process.env.SCHEDULE_DEBUG === "1";

function buildMatchKey(matchType: MatchType, matchId: string) {
  return `${matchType}:${matchId}`;
}

function parseMatchKey(key: string): { matchType: MatchType; matchId: string } | null {
  const [matchType, matchId] = key.split(":");
  if ((matchType === "GROUP" || matchType === "KNOCKOUT") && matchId) {
    return { matchType, matchId };
  }
  return null;
}

function ensureLastBatch(payload: unknown): LastBatchPayload {
  if (payload && typeof payload === "object") {
    const data = payload as Partial<LastBatchPayload>;
    if (Array.isArray(data.matchKeys) && Array.isArray(data.playerIds)) {
      return {
        matchKeys: data.matchKeys.slice(0, 5),
        playerIds: data.playerIds,
        updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : "",
      };
    }
  }
  return { matchKeys: [], playerIds: [], updatedAt: "" };
}

async function ensureScheduleSetup() {
  let config = await prisma.scheduleConfig.findFirst({
    orderBy: { createdAt: "desc" },
  });
  if (!config) {
    config = await prisma.scheduleConfig.create({
      data: {
        dayStartAt: new Date(),
      },
    });
  }

  const existingCourts = await prisma.court.findMany({
    select: { id: true },
  });
  const existingIds = new Set(existingCourts.map((court) => court.id));
  const toCreate = COURT_IDS.filter((id) => !existingIds.has(id)).map((id) => ({
    id,
  }));
  if (toCreate.length > 0) {
    await prisma.court.createMany({ data: toCreate, skipDuplicates: true });
  }

  return config;
}

const ACTIVE_COURT_IDS = [...COURT_IDS];

function extractTeamPlayers(team: {
  members: { player: { id: string; name: string } }[];
}) {
  const players = team.members.map((member) => member.player);
  return {
    playerIds: players.map((player) => player.id),
    playerNames: players.map((player) => player.name),
  };
}

function getPlayersForGroupMatch(match: {
  homeTeam: { members: { player: { id: string; name: string } }[] } | null;
  awayTeam: { members: { player: { id: string; name: string } }[] } | null;
}) {
  if (!match.homeTeam || !match.awayTeam) return [];
  const home = extractTeamPlayers(match.homeTeam);
  const away = extractTeamPlayers(match.awayTeam);
  return [...home.playerIds, ...away.playerIds];
}

function getPlayersForKnockoutMatch(match: {
  homeTeam: { members: { player: { id: string; name: string } }[] } | null;
  awayTeam: { members: { player: { id: string; name: string } }[] } | null;
}) {
  if (!match.homeTeam || !match.awayTeam) return [];
  const home = extractTeamPlayers(match.homeTeam);
  const away = extractTeamPlayers(match.awayTeam);
  return [...home.playerIds, ...away.playerIds];
}

function isListEligibleGroupMatch(match: {
  status: "SCHEDULED" | "COMPLETED" | "WALKOVER";
  homeTeamId: string | null;
  awayTeamId: string | null;
}) {
  return match.status === "SCHEDULED" && !!match.homeTeamId && !!match.awayTeamId;
}

function isListEligibleKnockoutMatch(match: {
  status: "SCHEDULED" | "COMPLETED" | "WALKOVER";
  homeTeamId: string | null;
  awayTeamId: string | null;
  isPublished: boolean;
}) {
  return (
    match.isPublished &&
    match.status === "SCHEDULED" &&
    !!match.homeTeamId &&
    !!match.awayTeamId
  );
}

function isCompletedMatch(match: {
  status: "SCHEDULED" | "COMPLETED" | "WALKOVER";
}) {
  return match.status === "COMPLETED" || match.status === "WALKOVER";
}

function hasInPlayPlayers(playerIds: string[], inPlayPlayerIds: Set<string>) {
  if (inPlayPlayerIds.size === 0) return false;
  return playerIds.some((playerId) => inPlayPlayerIds.has(playerId));
}

function isAssignableNow(playerIds: string[], inPlayPlayerIds: Set<string>) {
  return !hasInPlayPlayers(playerIds, inPlayPlayerIds);
}

function buildMatchItem(params: {
  matchType: MatchType;
  matchId: string;
  categoryCode: "MD" | "WD" | "XD";
  label: string;
  detail: string;
  round?: number;
  matchNo?: number;
  homeTeam: { name: string; members: { player: { id: string; name: string } }[] } | null;
  awayTeam: { name: string; members: { player: { id: string; name: string } }[] } | null;
  restScore: number;
  forcedRank?: number;
  isForced?: boolean;
}): ScheduleMatchItem {
  const home = params.homeTeam
    ? extractTeamPlayers(params.homeTeam)
    : { playerIds: [], playerNames: [] };
  const away = params.awayTeam
    ? extractTeamPlayers(params.awayTeam)
    : { playerIds: [], playerNames: [] };
  return {
    key: buildMatchKey(params.matchType, params.matchId),
    matchId: params.matchId,
    matchType: params.matchType,
    categoryCode: params.categoryCode,
    label: params.label,
    detail: params.detail,
    round: params.round,
    matchNo: params.matchNo,
    teams: {
      homeName: params.homeTeam?.name ?? "TBD",
      awayName: params.awayTeam?.name ?? "TBD",
      homePlayers: home.playerNames,
      awayPlayers: away.playerNames,
      playerNames: [...home.playerNames, ...away.playerNames],
      playerIds: [...home.playerIds, ...away.playerIds],
    },
    restScore: params.restScore,
    forcedRank: params.forcedRank,
    isForced:
      typeof params.isForced === "boolean"
        ? params.isForced
        : typeof params.forcedRank === "number",
  };
}

function buildUpcoming(
  queueMatches: ScheduleMatchItem[],
  playingPlayerIds: Set<string>,
  limit = 5
) {
  const forcedCandidates = queueMatches.filter((match) => match.isForced);
  const normalCandidates = queueMatches.filter((match) => !match.isForced);
  const upcoming: ScheduleMatchItem[] = [];
  const pickedPlayerIds = new Set<string>();

  if (SCHEDULE_DEBUG) {
    console.log("[schedule][debug] upcoming candidates", {
      forcedCount: forcedCandidates.length,
      normalCount: normalCandidates.length,
      playingCount: playingPlayerIds.size,
      limit,
    });
  }

  const logConsider = (
    tier: string,
    match: ScheduleMatchItem,
    overlapsPicked: boolean,
    overlapsPlaying: boolean,
    decision: "PICK" | "SKIP",
    reason?: string
  ) => {
    if (!SCHEDULE_DEBUG) return;
    console.log(
      `[schedule][debug] ${tier} key=${match.key} forced=${match.isForced ? "y" : "n"} ` +
        `overlapsPicked=${overlapsPicked ? "y" : "n"} overlapsPlaying=${overlapsPlaying ? "y" : "n"} ` +
        `=> ${decision}${reason ? `(${reason})` : ""}`
    );
  };

  const pickFrom = (
    candidates: ScheduleMatchItem[],
    requireAssignable: boolean,
    tierLabel: string
  ) => {
    let tierCount = 0;
    let logCount = 0;
    for (const match of candidates) {
      const overlapsPicked = hasInPlayPlayers(match.teams.playerIds, pickedPlayerIds);
      const overlapsPlaying = hasInPlayPlayers(match.teams.playerIds, playingPlayerIds);
      if (upcoming.length >= limit) {
        if (SCHEDULE_DEBUG && logCount < 30) {
          logConsider(tierLabel, match, overlapsPicked, overlapsPlaying, "SKIP", "full");
          logCount += 1;
        }
        break;
      }
      if (overlapsPicked) {
        if (SCHEDULE_DEBUG && logCount < 30) {
          logConsider(tierLabel, match, overlapsPicked, overlapsPlaying, "SKIP", "pickedPlayers");
          logCount += 1;
        }
        continue;
      }
      if (requireAssignable && overlapsPlaying) {
        if (SCHEDULE_DEBUG && logCount < 30) {
          logConsider(tierLabel, match, overlapsPicked, overlapsPlaying, "SKIP", "playingConflict");
          logCount += 1;
        }
        continue;
      }
      if (SCHEDULE_DEBUG && logCount < 30) {
        logConsider(
          tierLabel,
          match,
          overlapsPicked,
          overlapsPlaying,
          "PICK",
          overlapsPlaying ? "waiting" : "assignable"
        );
        logCount += 1;
      }
      upcoming.push(match);
      match.teams.playerIds.forEach((id) => pickedPlayerIds.add(id));
      tierCount += 1;
    }
    if (SCHEDULE_DEBUG) {
      console.log(`[schedule][debug] ${tierLabel} picked=${tierCount}`);
    }
  };

  pickFrom(forcedCandidates, true, "tier1 forced+assignable");
  pickFrom(forcedCandidates, false, "tier2 forced+waiting");
  pickFrom(normalCandidates, true, "tier3 normal+assignable");
  pickFrom(normalCandidates, false, "tier4 normal+waiting");

  if (SCHEDULE_DEBUG) {
    console.log(
      "[schedule][debug] upcoming",
      upcoming.map((match) => ({
        key: match.key,
        forced: match.isForced ?? false,
        waiting: hasInPlayPlayers(match.teams.playerIds, playingPlayerIds),
      }))
    );
  }

  return upcoming;
}

function isPlayerRested(
  playerId: string,
  playingSet: Set<string>,
  recentlyPlayedSet: Set<string>
) {
  return !playingSet.has(playerId) && !recentlyPlayedSet.has(playerId);
}

function computeRestScore(
  playerIds: string[],
  playingSet: Set<string>,
  recentlyPlayedSet: Set<string>
) {
  if (playerIds.length === 0) return 0;
  let rested = 0;
  for (const id of playerIds) {
    if (isPlayerRested(id, playingSet, recentlyPlayedSet)) rested += 1;
  }
  return rested;
}

function sortEligible(matches: ScheduleMatchItem[]) {
  return [...matches].sort((a, b) => {
    const aForced = a.forcedRank ?? Number.POSITIVE_INFINITY;
    const bForced = b.forcedRank ?? Number.POSITIVE_INFINITY;
    if (aForced !== bForced) return aForced - bForced;

    const aType = a.matchType === "GROUP" ? 0 : 1;
    const bType = b.matchType === "GROUP" ? 0 : 1;
    if (aType !== bType) return aType - bType;
    if (a.restScore !== b.restScore) return b.restScore - a.restScore;
    if (a.categoryCode !== b.categoryCode) return a.categoryCode.localeCompare(b.categoryCode);
    if (a.round !== b.round) return (b.round ?? 0) - (a.round ?? 0);
    if (a.matchNo !== b.matchNo) return (a.matchNo ?? 0) - (b.matchNo ?? 0);
    return a.matchId.localeCompare(b.matchId);
  });
}

async function buildLastBatchData(matchKeys: string[]): Promise<LastBatchPayload> {
  const parsed = matchKeys.map(parseMatchKey).filter(Boolean) as {
    matchType: MatchType;
    matchId: string;
  }[];
  const groupIds = parsed
    .filter((entry) => entry.matchType === "GROUP")
    .map((entry) => entry.matchId);
  const knockoutIds = parsed
    .filter((entry) => entry.matchType === "KNOCKOUT")
    .map((entry) => entry.matchId);

  const [groupMatches, knockoutMatches] = await Promise.all([
    groupIds.length
      ? prisma.match.findMany({
          where: { id: { in: groupIds } },
          include: {
            homeTeam: { include: { members: { include: { player: true } } } },
            awayTeam: { include: { members: { include: { player: true } } } },
          },
        })
      : Promise.resolve([]),
    knockoutIds.length
      ? prisma.knockoutMatch.findMany({
          where: { id: { in: knockoutIds } },
          include: {
            homeTeam: { include: { members: { include: { player: true } } } },
            awayTeam: { include: { members: { include: { player: true } } } },
          },
        })
      : Promise.resolve([]),
  ]);

  const playerIds = new Set<string>();
  for (const match of groupMatches) {
    for (const id of getPlayersForGroupMatch(match)) playerIds.add(id);
  }
  for (const match of knockoutMatches) {
    for (const id of getPlayersForKnockoutMatch(match)) playerIds.add(id);
  }

  return {
    matchKeys,
    playerIds: Array.from(playerIds),
    updatedAt: new Date().toISOString(),
  };
}

async function updateLastBatch(configId: string, matchKey: string) {
  const config = await prisma.scheduleConfig.findUnique({ where: { id: configId } });
  if (!config) return;
  const existing = ensureLastBatch(config.lastBatch);
  const nextKeys = [matchKey, ...existing.matchKeys.filter((key) => key !== matchKey)];
  const trimmed = nextKeys.slice(0, 5);
  const payload = await buildLastBatchData(trimmed);
  await prisma.scheduleConfig.update({
    where: { id: configId },
    data: { lastBatch: payload },
  });
}

async function getInPlayPlayerIds() {
  const assignments = await prisma.courtAssignment.findMany({
    where: { status: "ACTIVE" },
    include: {
      groupMatch: {
        include: {
          homeTeam: { include: { members: { include: { player: true } } } },
          awayTeam: { include: { members: { include: { player: true } } } },
        },
      },
      knockoutMatch: {
        include: {
          homeTeam: { include: { members: { include: { player: true } } } },
          awayTeam: { include: { members: { include: { player: true } } } },
        },
      },
    },
  });

  const playerIds = new Set<string>();
  for (const assignment of assignments) {
    if (assignment.matchType === "GROUP" && assignment.groupMatch) {
      getPlayersForGroupMatch(assignment.groupMatch).forEach((id) => playerIds.add(id));
    }
    if (assignment.matchType === "KNOCKOUT" && assignment.knockoutMatch) {
      getPlayersForKnockoutMatch(assignment.knockoutMatch).forEach((id) =>
        playerIds.add(id)
      );
    }
  }
  return playerIds;
}

async function getRecentCompletedPlayerIds(limit = 5) {
  const [groupMatches, knockoutMatches] = await Promise.all([
    prisma.match.findMany({
      where: { status: "COMPLETED" },
      orderBy: { completedAt: "desc" },
      take: limit,
      include: {
        homeTeam: { include: { members: { include: { player: true } } } },
        awayTeam: { include: { members: { include: { player: true } } } },
      },
    }),
    prisma.knockoutMatch.findMany({
      where: { status: "COMPLETED" },
      orderBy: { completedAt: "desc" },
      take: limit,
      include: {
        homeTeam: { include: { members: { include: { player: true } } } },
        awayTeam: { include: { members: { include: { player: true } } } },
      },
    }),
  ]);

  const combined = [
    ...groupMatches.map((match) => ({
      completedAt: match.completedAt ?? new Date(0),
      playerIds: getPlayersForGroupMatch(match),
    })),
    ...knockoutMatches.map((match) => ({
      completedAt: match.completedAt ?? new Date(0),
      playerIds: getPlayersForKnockoutMatch(match),
    })),
  ];

  combined.sort((a, b) => b.completedAt.getTime() - a.completedAt.getTime());
  const latest = combined.slice(0, limit);

  const playerIds = new Set<string>();
  for (const entry of latest) {
    entry.playerIds.forEach((id) => playerIds.add(id));
  }
  return playerIds;
}

async function getLastBatchFromAssignments() {
  const assignments = await prisma.courtAssignment.findMany({
    where: { status: { in: ["ACTIVE", "CLEARED"] } },
    orderBy: { assignedAt: "desc" },
    take: 5,
    include: {
      groupMatch: {
        include: {
          homeTeam: { include: { members: { include: { player: true } } } },
          awayTeam: { include: { members: { include: { player: true } } } },
        },
      },
      knockoutMatch: {
        include: {
          homeTeam: { include: { members: { include: { player: true } } } },
          awayTeam: { include: { members: { include: { player: true } } } },
        },
      },
    },
  });

  const matchKeys: string[] = [];
  const playerIds = new Set<string>();

  for (const assignment of assignments) {
    const matchKey =
      assignment.matchType === "GROUP" && assignment.groupMatchId
        ? buildMatchKey("GROUP", assignment.groupMatchId)
        : assignment.matchType === "KNOCKOUT" && assignment.knockoutMatchId
          ? buildMatchKey("KNOCKOUT", assignment.knockoutMatchId)
          : null;
    if (!matchKey) continue;
    matchKeys.push(matchKey);

    if (assignment.matchType === "GROUP" && assignment.groupMatch) {
      getPlayersForGroupMatch(assignment.groupMatch).forEach((id) => playerIds.add(id));
    }
    if (assignment.matchType === "KNOCKOUT" && assignment.knockoutMatch) {
      getPlayersForKnockoutMatch(assignment.knockoutMatch).forEach((id) =>
        playerIds.add(id)
      );
    }
  }

  return {
    matchKeys,
    playerIds: Array.from(playerIds),
    updatedAt: new Date().toISOString(),
  } satisfies LastBatchPayload;
}

async function loadScheduleMatches(category: CategoryFilter) {
  const groupMatches = await prisma.match.findMany({
    where: {
      stage: "GROUP",
      ...(category !== "ALL" ? { group: { category: { code: category } } } : {}),
    },
    include: {
      group: { include: { category: true } },
      homeTeam: { include: { members: { include: { player: true } } } },
      awayTeam: { include: { members: { include: { player: true } } } },
    },
    orderBy: [{ group: { name: "asc" } }, { createdAt: "asc" }],
  });

  const knockoutMatches = await prisma.knockoutMatch.findMany({
    where: {
      ...(category !== "ALL" ? { categoryCode: category } : {}),
      isPublished: true,
    },
    include: {
      homeTeam: { include: { members: { include: { player: true } } } },
      awayTeam: { include: { members: { include: { player: true } } } },
    },
    orderBy: [{ series: "asc" }, { round: "asc" }, { matchNo: "asc" }],
  });

  return { groupMatches, knockoutMatches };
}

async function loadForcedPriorities() {
  const forced = await prisma.forcedMatchPriority.findMany({
    orderBy: { createdAt: "desc" },
  });
  const rankMap = new Map<string, number>();
  const forcedSet = new Set<string>();
  forced.forEach((entry, index) => {
    const key = buildMatchKey(entry.matchType, entry.matchId);
    rankMap.set(key, index + 1);
    forcedSet.add(key);
  });
  return { forced, rankMap, forcedSet };
}

async function buildListEligibleMatches(params: {
  category: CategoryFilter;
  showKo: boolean;
  excludeAssigned: boolean;
  playingSet: Set<string>;
  recentlyPlayedSet: Set<string>;
}) {
  const { groupMatches, knockoutMatches } = await loadScheduleMatches(params.category);
  const blocked = await prisma.blockedMatch.findMany();
  const forcedData = await loadForcedPriorities();
  const playingSet = params.playingSet;
  const recentlyPlayedSet = params.recentlyPlayedSet;

  const blockedKeys = new Set(
    blocked
      .map((entry) => {
        const matchId =
          entry.matchType === "GROUP" ? entry.groupMatchId : entry.knockoutMatchId;
        if (!matchId) return null;
        return buildMatchKey(entry.matchType, matchId);
      })
      .filter((key): key is string => Boolean(key))
  );

  const assignedMatchKeys = params.excludeAssigned
    ? new Set(
        (await prisma.courtAssignment.findMany({
          where: { status: "ACTIVE" },
          select: { groupMatchId: true, knockoutMatchId: true, matchType: true },
        }))
          .map((entry) => {
            if (entry.matchType === "GROUP" && entry.groupMatchId) {
              return buildMatchKey("GROUP", entry.groupMatchId);
            }
            if (entry.matchType === "KNOCKOUT" && entry.knockoutMatchId) {
              return buildMatchKey("KNOCKOUT", entry.knockoutMatchId);
            }
            return null;
          })
          .filter((key): key is string => Boolean(key))
      )
    : new Set<string>();

  const eligible: ScheduleMatchItem[] = [];

  for (const match of groupMatches) {
    if (!match.group || !match.group.category) continue;
    const matchKey = buildMatchKey("GROUP", match.id);
    if (assignedMatchKeys.has(matchKey)) continue;
    if (blockedKeys.has(matchKey)) continue;
    if (!isListEligibleGroupMatch(match)) continue;
    eligible.push(
      buildMatchItem({
        matchType: "GROUP",
        matchId: match.id,
        categoryCode: match.group.category.code,
        label: `Group ${match.group.name}`,
        detail: "Group Match",
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
        restScore: computeRestScore(
          getPlayersForGroupMatch(match),
          playingSet,
          recentlyPlayedSet
        ),
        forcedRank: forcedData.rankMap.get(matchKey),
        isForced: forcedData.forcedSet.has(matchKey),
      })
    );
  }

  if (params.showKo) {
    for (const match of knockoutMatches) {
      const matchKey = buildMatchKey("KNOCKOUT", match.id);
      if (assignedMatchKeys.has(matchKey)) continue;
      if (blockedKeys.has(matchKey)) continue;
      if (!isListEligibleKnockoutMatch(match)) continue;
      eligible.push(
        buildMatchItem({
          matchType: "KNOCKOUT",
          matchId: match.id,
          categoryCode: match.categoryCode,
          label: `Series ${match.series}`,
          detail: `Round ${match.round} • Match ${match.matchNo}`,
          round: match.round,
          matchNo: match.matchNo,
          homeTeam: match.homeTeam,
          awayTeam: match.awayTeam,
          restScore: computeRestScore(
            getPlayersForKnockoutMatch(match),
            playingSet,
            recentlyPlayedSet
          ),
          forcedRank: forcedData.rankMap.get(matchKey),
          isForced: forcedData.forcedSet.has(matchKey),
        })
      );
    }
  }

  return sortEligible(eligible);
}

async function clearInvalidAssignments(params: {
  assignments: {
    id: string;
    matchType: MatchType;
    groupMatchId: string | null;
    knockoutMatchId: string | null;
  }[];
  blockedKeys: Set<string>;
}) {
  const invalidAssignmentIds: string[] = [];

  const groupIds = params.assignments
    .filter((assignment) => assignment.matchType === "GROUP" && assignment.groupMatchId)
    .map((assignment) => assignment.groupMatchId as string);
  const knockoutIds = params.assignments
    .filter((assignment) => assignment.matchType === "KNOCKOUT" && assignment.knockoutMatchId)
    .map((assignment) => assignment.knockoutMatchId as string);

  const [groupMatches, knockoutMatches] = await Promise.all([
    groupIds.length
      ? prisma.match.findMany({ where: { id: { in: groupIds } } })
      : Promise.resolve([]),
    knockoutIds.length
      ? prisma.knockoutMatch.findMany({ where: { id: { in: knockoutIds } } })
      : Promise.resolve([]),
  ]);

  const groupById = new Map(groupMatches.map((match) => [match.id, match]));
  const knockoutById = new Map(knockoutMatches.map((match) => [match.id, match]));

  for (const assignment of params.assignments) {
    if (assignment.matchType === "GROUP" && assignment.groupMatchId) {
      const match = groupById.get(assignment.groupMatchId);
      const key = buildMatchKey("GROUP", assignment.groupMatchId);
      if (!match || isCompletedMatch(match) || !isListEligibleGroupMatch(match)) {
        invalidAssignmentIds.push(assignment.id);
      } else if (params.blockedKeys.has(key)) {
        invalidAssignmentIds.push(assignment.id);
      }
    }

    if (assignment.matchType === "KNOCKOUT" && assignment.knockoutMatchId) {
      const match = knockoutById.get(assignment.knockoutMatchId);
      const key = buildMatchKey("KNOCKOUT", assignment.knockoutMatchId);
      if (!match || isCompletedMatch(match) || !isListEligibleKnockoutMatch(match)) {
        invalidAssignmentIds.push(assignment.id);
      } else if (params.blockedKeys.has(key)) {
        invalidAssignmentIds.push(assignment.id);
      }
    }
  }

  if (invalidAssignmentIds.length > 0) {
    await prisma.courtAssignment.updateMany({
      where: { id: { in: invalidAssignmentIds } },
      data: { status: "CLEARED", clearedAt: new Date() },
    });
  }

  return invalidAssignmentIds;
}

async function applyAutoSchedule(params: {
  configId: string;
  autoEnabled: boolean;
  eligible: ScheduleMatchItem[];
  activeCourtIds: string[];
}) {
  if (!params.autoEnabled) return;

  let assignedCount = 0;
  let loopGuard = 0;

  while (loopGuard < 10) {
    loopGuard += 1;

    const [courts, assignments, inPlayPlayerIds, recentlyPlayedSet, eligibleSource, blocked, forcedData] =
      await Promise.all([
        prisma.court.findMany({ where: { id: { in: params.activeCourtIds } } }),
        prisma.courtAssignment.findMany({
          where: { status: "ACTIVE", courtId: { in: params.activeCourtIds } },
          select: { courtId: true },
        }),
        getInPlayPlayerIds(),
        getRecentCompletedPlayerIds(),
        loadScheduleMatches("ALL"),
        prisma.blockedMatch.findMany(),
        loadForcedPriorities(),
      ]);

    const assignedCourtIds = new Set(assignments.map((entry) => entry.courtId));
    const freeCourts = courts
      .filter((court) => !court.isLocked && !assignedCourtIds.has(court.id))
      .sort((a, b) => a.id.localeCompare(b.id));

    const activeCount = courts.length;
    const freeCount = freeCourts.length;

    const assignedMatchKeys = new Set(
      (await prisma.courtAssignment.findMany({
        where: { status: "ACTIVE" },
        select: { groupMatchId: true, knockoutMatchId: true, matchType: true },
      }))
        .map((entry) => {
          if (entry.matchType === "GROUP" && entry.groupMatchId) {
            return buildMatchKey("GROUP", entry.groupMatchId);
          }
          if (entry.matchType === "KNOCKOUT" && entry.knockoutMatchId) {
            return buildMatchKey("KNOCKOUT", entry.knockoutMatchId);
          }
          return null;
        })
        .filter((key): key is string => Boolean(key))
    );

    const lastBatchPlayerIds = recentlyPlayedSet;
    const blockedKeys = new Set(
      blocked
        .map((entry) => {
          const matchId =
            entry.matchType === "GROUP" ? entry.groupMatchId : entry.knockoutMatchId;
          if (!matchId) return null;
          return buildMatchKey(entry.matchType, matchId);
        })
        .filter((key): key is string => Boolean(key))
    );
    const eligible: ScheduleMatchItem[] = [];

    for (const match of eligibleSource.groupMatches) {
      if (!match.group || !match.group.category) continue;
      const matchKey = buildMatchKey("GROUP", match.id);
      if (assignedMatchKeys.has(matchKey)) continue;
      if (blockedKeys.has(matchKey)) continue;
      if (!isListEligibleGroupMatch(match)) continue;
      eligible.push(
        buildMatchItem({
          matchType: "GROUP",
          matchId: match.id,
          categoryCode: match.group.category.code,
          label: `Group ${match.group.name}`,
          detail: "Group Match",
          homeTeam: match.homeTeam,
          awayTeam: match.awayTeam,
          restScore: computeRestScore(
            getPlayersForGroupMatch(match),
            inPlayPlayerIds,
            lastBatchPlayerIds
          ),
          forcedRank: forcedData.rankMap.get(matchKey),
        })
      );
    }

    for (const match of eligibleSource.knockoutMatches) {
      const matchKey = buildMatchKey("KNOCKOUT", match.id);
      if (assignedMatchKeys.has(matchKey)) continue;
      if (blockedKeys.has(matchKey)) continue;
      if (!isListEligibleKnockoutMatch(match)) continue;
      eligible.push(
        buildMatchItem({
          matchType: "KNOCKOUT",
          matchId: match.id,
          categoryCode: match.categoryCode,
          label: `Series ${match.series}`,
          detail: `Round ${match.round} • Match ${match.matchNo}`,
          round: match.round,
          matchNo: match.matchNo,
          homeTeam: match.homeTeam,
          awayTeam: match.awayTeam,
          restScore: computeRestScore(
            getPlayersForKnockoutMatch(match),
            inPlayPlayerIds,
            lastBatchPlayerIds
          ),
          forcedRank: forcedData.rankMap.get(matchKey),
        })
      );
    }

    const eligibleSorted = sortEligible(eligible);
    const assignableNow = eligibleSorted.filter((match) =>
      isAssignableNow(match.teams.playerIds, inPlayPlayerIds)
    );
    const eligibleCount = eligibleSorted.length;

    const firstSkippedReason =
      eligibleSorted.length > 0 && assignableNow.length === 0
        ? {
            matchKey: eligibleSorted[0].key,
            overlapPlayerIds: eligibleSorted[0].teams.playerIds.filter((id) =>
              inPlayPlayerIds.has(id)
            ),
          }
        : null;

    console.log("[schedule] auto", {
      activeCourtsCount: activeCount,
      freeCourtsCount: freeCount,
      eligibleCount,
      assignableCount: assignableNow.length,
      assignedCount,
      firstSkippedReason,
    });

    if (freeCourts.length === 0 || eligibleSorted.length === 0) break;

    const targetCourt = freeCourts[0];
    const next = assignableNow[0];
    if (!next) break;
    const assignment = {
      courtId: targetCourt.id,
      matchType: next.matchType,
      groupMatchId: next.matchType === "GROUP" ? next.matchId : null,
      knockoutMatchId: next.matchType === "KNOCKOUT" ? next.matchId : null,
    };

    await prisma.$transaction(async (tx) => {
      await tx.courtAssignment.create({ data: assignment });
      await tx.scheduleActionLog.create({
        data: { action: "AUTO_ASSIGN", payload: assignment },
      });
    });

    const matchKey = buildMatchKey(
      assignment.matchType,
      assignment.matchType === "GROUP"
        ? (assignment.groupMatchId as string)
        : (assignment.knockoutMatchId as string)
    );
    await updateLastBatch(params.configId, matchKey);
    assignedCount += 1;
  }
}

export async function getScheduleState(filters?: {
  category?: CategoryFilter;
  showKo?: boolean;
}) {
  const category =
    filters?.category && categoryFilterSchema.safeParse(filters.category).success
      ? filters.category
      : "ALL";
  const showKo = filters?.showKo ?? true;

  const config = await ensureScheduleSetup();
  const activeCourtIds = ACTIVE_COURT_IDS;

  const [courts, assignments, blocked, forcedData] = await Promise.all([
    prisma.court.findMany({ orderBy: { id: "asc" } }),
    prisma.courtAssignment.findMany({
      where: { status: "ACTIVE" },
      include: {
        groupMatch: {
          include: {
            group: { include: { category: true } },
            homeTeam: { include: { members: { include: { player: true } } } },
            awayTeam: { include: { members: { include: { player: true } } } },
          },
        },
        knockoutMatch: {
          include: {
            homeTeam: { include: { members: { include: { player: true } } } },
            awayTeam: { include: { members: { include: { player: true } } } },
          },
        },
      },
    }),
    prisma.blockedMatch.findMany(),
    loadForcedPriorities(),
  ]);

  const blockedKeys = new Set(
    blocked
      .map((entry) => {
        const matchId = entry.matchType === "GROUP" ? entry.groupMatchId : entry.knockoutMatchId;
        if (!matchId) return null;
        return buildMatchKey(entry.matchType, matchId);
      })
      .filter((key): key is string => Boolean(key))
  );

  await clearInvalidAssignments({
    assignments: assignments.map((assignment) => ({
      id: assignment.id,
      matchType: assignment.matchType,
      groupMatchId: assignment.groupMatchId,
      knockoutMatchId: assignment.knockoutMatchId,
    })),
    blockedKeys,
  });

  const activeAssignments = await prisma.courtAssignment.findMany({
    where: { status: "ACTIVE" },
    include: {
      groupMatch: {
        include: {
          group: { include: { category: true } },
          homeTeam: { include: { members: { include: { player: true } } } },
          awayTeam: { include: { members: { include: { player: true } } } },
        },
      },
      knockoutMatch: {
        include: {
          homeTeam: { include: { members: { include: { player: true } } } },
          awayTeam: { include: { members: { include: { player: true } } } },
        },
      },
    },
  });

  const assignedMatchKeys = new Set(
    activeAssignments
      .map((assignment) =>
        assignment.matchType === "GROUP"
          ? assignment.groupMatchId
            ? buildMatchKey("GROUP", assignment.groupMatchId)
            : null
          : assignment.knockoutMatchId
            ? buildMatchKey("KNOCKOUT", assignment.knockoutMatchId)
            : null
      )
      .filter((key): key is string => Boolean(key))
  );

  const inPlayPlayerIds = await getInPlayPlayerIds();
  const lastBatch = await getLastBatchFromAssignments();
  const recentlyPlayedSet = await getRecentCompletedPlayerIds();
  const eligibleSorted = await buildListEligibleMatches({
    category,
    showKo,
    excludeAssigned: true,
    playingSet: inPlayPlayerIds,
    recentlyPlayedSet,
  });

  const invalidForcedKeys = forcedData.forced
    .map((entry) => buildMatchKey(entry.matchType, entry.matchId))
    .filter((key) => !eligibleSorted.find((match) => match.key === key));
  if (invalidForcedKeys.length > 0) {
    await prisma.forcedMatchPriority.deleteMany({
      where: {
        OR: invalidForcedKeys.map((key) => {
          const parsed = parseMatchKey(key);
          return parsed
            ? { matchType: parsed.matchType, matchId: parsed.matchId }
            : undefined;
        }).filter(Boolean) as { matchType: MatchType; matchId: string }[],
      },
    });
  }

  await applyAutoSchedule({
    configId: config.id,
    autoEnabled: config.autoScheduleEnabled,
    eligible: eligibleSorted,
    activeCourtIds,
  });

  const refreshedAssignments = await prisma.courtAssignment.findMany({
    where: { status: "ACTIVE" },
    include: {
      groupMatch: {
        include: {
          group: { include: { category: true } },
          homeTeam: { include: { members: { include: { player: true } } } },
          awayTeam: { include: { members: { include: { player: true } } } },
        },
      },
      knockoutMatch: {
        include: {
          homeTeam: { include: { members: { include: { player: true } } } },
          awayTeam: { include: { members: { include: { player: true } } } },
        },
      },
    },
  });

  const playingByCourt = new Map(
    refreshedAssignments
      .map((assignment) => {
        const match =
          assignment.matchType === "GROUP" ? assignment.groupMatch : assignment.knockoutMatch;
        if (!match) return null;
        const matchKey =
          assignment.matchType === "GROUP" && assignment.groupMatchId
            ? buildMatchKey("GROUP", assignment.groupMatchId)
            : assignment.matchType === "KNOCKOUT" && assignment.knockoutMatchId
              ? buildMatchKey("KNOCKOUT", assignment.knockoutMatchId)
              : null;
        if (!matchKey) return null;

        const detail =
          assignment.matchType === "GROUP"
            ? match.group
              ? `Group ${match.group.name}`
              : "Group Match"
            : `Series ${match.series} • R${match.round} M${match.matchNo}`;

        const homeTeam = match.homeTeam
          ? {
              name: match.homeTeam.name,
              players: match.homeTeam.members.map((member) => member.player.name),
            }
          : null;
        const awayTeam = match.awayTeam
          ? {
              name: match.awayTeam.name,
              players: match.awayTeam.members.map((member) => member.player.name),
            }
          : null;

        return [
          assignment.courtId,
          {
            matchKey,
            matchType: assignment.matchType,
            categoryCode:
              assignment.matchType === "GROUP" && match.group
                ? match.group.category.code
                : assignment.matchType === "KNOCKOUT"
                  ? match.categoryCode
                  : "MD",
            detail,
            homeTeam,
            awayTeam,
          },
        ] as const;
      })
      .filter((entry): entry is [string, unknown] => Boolean(entry))
  );

  const assignedAfterAuto = new Set(
    refreshedAssignments
      .map((assignment) =>
        assignment.matchType === "GROUP"
          ? assignment.groupMatchId
            ? buildMatchKey("GROUP", assignment.groupMatchId)
            : null
          : assignment.knockoutMatchId
            ? buildMatchKey("KNOCKOUT", assignment.knockoutMatchId)
            : null
      )
      .filter((key): key is string => Boolean(key))
  );
  const eligibleFinal = eligibleSorted.filter((match) => !assignedAfterAuto.has(match.key));
  const assignableCount = eligibleFinal.filter((match) =>
    isAssignableNow(match.teams.playerIds, inPlayPlayerIds)
  ).length;
  const upcomingAssignableCount = buildUpcoming(
    eligibleFinal,
    inPlayPlayerIds,
    5
  ).filter((match) => isAssignableNow(match.teams.playerIds, inPlayPlayerIds)).length;

  const blockedList = await Promise.all(
    blocked
      .filter((entry) => {
        if (entry.matchType === "GROUP" && entry.groupMatchId) return true;
        if (entry.matchType === "KNOCKOUT" && entry.knockoutMatchId) return true;
        return false;
      })
      .map(async (entry) => {
        if (entry.matchType === "GROUP" && entry.groupMatchId) {
          const match = await prisma.match.findUnique({
            where: { id: entry.groupMatchId },
            include: {
              group: { include: { category: true } },
              homeTeam: { include: { members: { include: { player: true } } } },
              awayTeam: { include: { members: { include: { player: true } } } },
            },
          });
          if (!match || !match.group || !match.group.category) return null;
          return buildMatchItem({
            matchType: "GROUP",
            matchId: match.id,
            categoryCode: match.group.category.code,
            label: `Group ${match.group.name}`,
            detail: "Group Match",
            homeTeam: match.homeTeam,
            awayTeam: match.awayTeam,
            restScore: 0,
          });
        }

        if (entry.matchType === "KNOCKOUT" && entry.knockoutMatchId) {
          const match = await prisma.knockoutMatch.findUnique({
            where: { id: entry.knockoutMatchId },
            include: {
              homeTeam: { include: { members: { include: { player: true } } } },
              awayTeam: { include: { members: { include: { player: true } } } },
            },
          });
          if (!match) return null;
          return buildMatchItem({
            matchType: "KNOCKOUT",
            matchId: match.id,
            categoryCode: match.categoryCode,
            label: `Series ${match.series}`,
            detail: `Round ${match.round} • Match ${match.matchNo}`,
            round: match.round,
            matchNo: match.matchNo,
            homeTeam: match.homeTeam,
            awayTeam: match.awayTeam,
            restScore: 0,
          });
        }
        return null;
      })
  );

  const upcoming = config.autoScheduleEnabled
    ? buildUpcoming(eligibleFinal, inPlayPlayerIds, 5)
    : [];

  if (SCHEDULE_DEBUG) {
    console.log(
      "[schedule][debug] forcedKeys",
      `count=${eligibleFinal.filter((match) => match.isForced).length}`,
      eligibleFinal.filter((match) => match.isForced).slice(0, 20).map((match) => match.key)
    );
    console.log(
      "[schedule][debug] queue-top",
      eligibleFinal.slice(0, 15).map((match, index) => ({
        idx: index,
        key: match.key,
        forced: match.isForced ?? false,
        rest: `${match.restScore}/4`,
        players: match.teams.playerIds,
        label: match.label,
      }))
    );
  }

  return {
    config: {
      id: config.id,
      autoScheduleEnabled: config.autoScheduleEnabled,
      lastBatch,
    },
    courts: courts.map((court) => ({
      id: court.id,
      isLocked: court.isLocked,
      lockReason: court.lockReason,
      playing: playingByCourt.get(court.id) ?? null,
    })),
    eligibleMatches: eligibleFinal,
    upcomingMatches: upcoming,
    blockedMatches: blockedList.filter(Boolean) as ScheduleMatchItem[],
    inPlayPlayerIds: Array.from(inPlayPlayerIds),
    assignableCount,
    upcomingAssignableCount,
  };
}

export async function toggleAutoSchedule(enabled: boolean) {
  const config = await ensureScheduleSetup();
  await prisma.scheduleConfig.update({
    where: { id: config.id },
    data: { autoScheduleEnabled: enabled },
  });
  await prisma.scheduleActionLog.create({
    data: { action: "AUTO_SCHEDULE", payload: { enabled } },
  });
  if (enabled) {
    await getScheduleState();
  }
  revalidatePath("/schedule");
  return { ok: true };
}

export async function lockCourt(courtId: string, locked: boolean) {
  await ensureScheduleSetup();
  await prisma.court.update({
    where: { id: courtId },
    data: { isLocked: locked, lockReason: locked ? "Manual lock" : null },
  });
  await prisma.scheduleActionLog.create({
    data: { action: locked ? "COURT_LOCK" : "COURT_UNLOCK", payload: { courtId } },
  });
  revalidatePath("/schedule");
  return { ok: true };
}

export async function backToQueue(courtId: string) {
  const config = await ensureScheduleSetup();
  const assignment = await prisma.courtAssignment.findFirst({
    where: { courtId, status: "ACTIVE" },
  });
  if (!assignment) return { ok: true };

  if (!config.autoScheduleEnabled) {
    await prisma.courtAssignment.update({
      where: { id: assignment.id },
      data: { status: "CANCELED", clearedAt: new Date() },
    });
    await prisma.scheduleActionLog.create({
      data: { action: "BACK_TO_QUEUE", payload: { courtId } },
    });
    revalidatePath("/schedule");
    return { ok: true };
  }

  return swapBackToQueue(courtId);
}

export async function swapBackToQueue(courtId: string) {
  const config = await ensureScheduleSetup();
  const assignment = await prisma.courtAssignment.findFirst({
    where: { courtId, status: "ACTIVE" },
  });
  if (!assignment) return { ok: true };

  const inPlayPlayerIds = await getInPlayPlayerIds();
  if (assignment.matchType === "GROUP" && assignment.groupMatchId) {
    const match = await prisma.match.findUnique({
      where: { id: assignment.groupMatchId },
      include: {
        homeTeam: { include: { members: { include: { player: true } } } },
        awayTeam: { include: { members: { include: { player: true } } } },
      },
    });
    if (match) {
      getPlayersForGroupMatch(match).forEach((id) => inPlayPlayerIds.delete(id));
    }
  }
  if (assignment.matchType === "KNOCKOUT" && assignment.knockoutMatchId) {
    const match = await prisma.knockoutMatch.findUnique({
      where: { id: assignment.knockoutMatchId },
      include: {
        homeTeam: { include: { members: { include: { player: true } } } },
        awayTeam: { include: { members: { include: { player: true } } } },
      },
    });
    if (match) {
      getPlayersForKnockoutMatch(match).forEach((id) => inPlayPlayerIds.delete(id));
    }
  }

  const eligibleSorted = await buildListEligibleMatches({
    category: "ALL",
    showKo: true,
    excludeAssigned: true,
    playingSet: inPlayPlayerIds,
    recentlyPlayedSet: await getRecentCompletedPlayerIds(),
  });
  const next = eligibleSorted.find((match) =>
    isAssignableNow(match.teams.playerIds, inPlayPlayerIds)
  );

  await prisma.courtAssignment.update({
    where: { id: assignment.id },
    data: { status: "CANCELED", clearedAt: new Date() },
  });

  if (!next) {
    await prisma.scheduleActionLog.create({
      data: { action: "BACK_TO_QUEUE_EMPTY", payload: { courtId } },
    });
    revalidatePath("/schedule");
    return { error: "No assignable match available; court is now empty." };
  }

  await prisma.courtAssignment.create({
    data: {
      courtId,
      matchType: next.matchType,
      groupMatchId: next.matchType === "GROUP" ? next.matchId : null,
      knockoutMatchId: next.matchType === "KNOCKOUT" ? next.matchId : null,
    },
  });

  await prisma.scheduleActionLog.create({
    data: {
      action: "BACK_TO_QUEUE_SWAP",
      payload: { courtId, matchType: next.matchType, matchId: next.matchId },
    },
  });

  await updateLastBatch(config.id, buildMatchKey(next.matchType, next.matchId));
  revalidatePath("/schedule");
  return { ok: true };
}

export async function blockMatch(matchType: MatchType, matchId: string) {
  const parsed = matchTypeSchema.safeParse(matchType);
  if (!parsed.success) return { error: "Invalid match type." };

  await prisma.blockedMatch.deleteMany({
    where:
      matchType === "GROUP"
        ? { matchType, groupMatchId: matchId }
        : { matchType, knockoutMatchId: matchId },
  });
  await prisma.blockedMatch.create({
    data:
      matchType === "GROUP"
        ? { matchType, groupMatchId: matchId, reason: "injury / absent" }
        : { matchType, knockoutMatchId: matchId, reason: "injury / absent" },
  });

  await prisma.courtAssignment.updateMany({
    where:
      matchType === "GROUP"
        ? { status: "ACTIVE", groupMatchId: matchId }
        : { status: "ACTIVE", knockoutMatchId: matchId },
    data: { status: "CANCELED", clearedAt: new Date() },
  });

  await prisma.scheduleActionLog.create({
    data: { action: "BLOCK_MATCH", payload: { matchType, matchId } },
  });
  const state = await getScheduleState();
  if (state.config.autoScheduleEnabled) {
    await applyAutoSchedule({
      configId: state.config.id,
      autoEnabled: state.config.autoScheduleEnabled,
      eligible: state.eligibleMatches,
      activeCourtIds: ACTIVE_COURT_IDS,
    });
  }
  revalidatePath("/schedule");
  return { ok: true };
}

export async function unblockMatch(matchType: MatchType, matchId: string) {
  const parsed = matchTypeSchema.safeParse(matchType);
  if (!parsed.success) return { error: "Invalid match type." };

  await prisma.blockedMatch.deleteMany({
    where:
      matchType === "GROUP"
        ? { matchType, groupMatchId: matchId }
        : { matchType, knockoutMatchId: matchId },
  });
  await prisma.scheduleActionLog.create({
    data: { action: "UNBLOCK_MATCH", payload: { matchType, matchId } },
  });
  revalidatePath("/schedule");
  return { ok: true };
}

export async function markCompleted(courtId: string) {
  const config = await ensureScheduleSetup();
  const assignment = await prisma.courtAssignment.findFirst({
    where: { courtId, status: "ACTIVE" },
  });
  if (!assignment) return { ok: true };

  if (assignment.matchType === "GROUP" && assignment.groupMatchId) {
    const match = await prisma.match.findUnique({
      where: { id: assignment.groupMatchId },
    });
    if (!match || !isCompletedMatch(match)) {
      return { error: "Match not completed yet." };
    }
  }

  if (assignment.matchType === "KNOCKOUT" && assignment.knockoutMatchId) {
    const match = await prisma.knockoutMatch.findUnique({
      where: { id: assignment.knockoutMatchId },
    });
    if (!match || !isCompletedMatch(match)) {
      return { error: "Match not completed yet." };
    }
  }

  await prisma.courtAssignment.update({
    where: { id: assignment.id },
    data: { status: "CLEARED", clearedAt: new Date() },
  });
  await prisma.scheduleActionLog.create({
    data: { action: "MARK_COMPLETED", payload: { courtId } },
  });

  if (config.autoScheduleEnabled) {
    const state = await getScheduleState();
    await applyAutoSchedule({
      configId: state.config.id,
      autoEnabled: state.config.autoScheduleEnabled,
      eligible: state.eligibleMatches,
      activeCourtIds: ACTIVE_COURT_IDS,
    });
  }

  revalidatePath("/schedule");
  return { ok: true };
}

export async function assignNext(params: {
  courtId: string;
  matchType: MatchType;
  matchId: string;
}) {
  const parsed = matchTypeSchema.safeParse(params.matchType);
  if (!parsed.success) return { error: "Invalid match type." };

  const config = await ensureScheduleSetup();
  const court = await prisma.court.findUnique({ where: { id: params.courtId } });
  if (!court || court.isLocked) return { error: "Court is locked." };

  await prisma.courtAssignment.updateMany({
    where: { courtId: params.courtId, status: "ACTIVE" },
    data: { status: "CANCELED", clearedAt: new Date() },
  });

  const inPlayPlayerIds = await getInPlayPlayerIds();

  const blocked = await prisma.blockedMatch.findFirst({
    where:
      params.matchType === "GROUP"
        ? { matchType: params.matchType, groupMatchId: params.matchId }
        : { matchType: params.matchType, knockoutMatchId: params.matchId },
  });
  if (blocked) return { error: "Match is blocked." };

  if (params.matchType === "GROUP") {
    const match = await prisma.match.findUnique({
      where: { id: params.matchId },
      include: {
        homeTeam: { include: { members: { include: { player: true } } } },
        awayTeam: { include: { members: { include: { player: true } } } },
      },
    });
    if (!match || !isListEligibleGroupMatch(match)) return { error: "Match not eligible." };
    if (!isAssignableNow(getPlayersForGroupMatch(match), inPlayPlayerIds)) {
      return { error: "Match has players already on court." };
    }
    if (hasInPlayPlayers(getPlayersForGroupMatch(match), inPlayPlayerIds)) {
      return { error: "Match has players already on court." };
    }
  } else {
    const match = await prisma.knockoutMatch.findUnique({
      where: { id: params.matchId },
      include: {
        homeTeam: { include: { members: { include: { player: true } } } },
        awayTeam: { include: { members: { include: { player: true } } } },
      },
    });
    if (!match || !isListEligibleKnockoutMatch(match)) return { error: "Match not eligible." };
    if (!isAssignableNow(getPlayersForKnockoutMatch(match), inPlayPlayerIds)) {
      return { error: "Match has players already on court." };
    }
    if (hasInPlayPlayers(getPlayersForKnockoutMatch(match), inPlayPlayerIds)) {
      return { error: "Match has players already on court." };
    }
  }

  const existing = await prisma.courtAssignment.findFirst({
    where: {
      status: "ACTIVE",
      ...(params.matchType === "GROUP"
        ? { groupMatchId: params.matchId }
        : { knockoutMatchId: params.matchId }),
    },
  });
  if (existing) return { error: "Match already assigned." };

  await prisma.courtAssignment.create({
    data: {
      courtId: params.courtId,
      matchType: params.matchType,
      groupMatchId: params.matchType === "GROUP" ? params.matchId : null,
      knockoutMatchId: params.matchType === "KNOCKOUT" ? params.matchId : null,
    },
  });

  await prisma.scheduleActionLog.create({
    data: {
      action: "ASSIGN_NEXT",
      payload: { courtId: params.courtId, matchType: params.matchType, matchId: params.matchId },
    },
  });

  await updateLastBatch(config.id, buildMatchKey(params.matchType, params.matchId));
  revalidatePath("/schedule");
  return { ok: true };
}

export async function forceNext(matchType: MatchType, matchId: string) {
  const parsed = matchTypeSchema.safeParse(matchType);
  if (!parsed.success) return { error: "Invalid match type." };

  const inPlayPlayerIds = await getInPlayPlayerIds();

  if (matchType === "GROUP") {
    const match = await prisma.match.findUnique({
      where: { id: matchId },
      include: {
        homeTeam: { include: { members: { include: { player: true } } } },
        awayTeam: { include: { members: { include: { player: true } } } },
      },
    });
    if (!match || !isListEligibleGroupMatch(match)) {
      return { error: "Match not eligible." };
    }
  } else {
    const match = await prisma.knockoutMatch.findUnique({
      where: { id: matchId },
      include: {
        homeTeam: { include: { members: { include: { player: true } } } },
        awayTeam: { include: { members: { include: { player: true } } } },
      },
    });
    if (!match || !isListEligibleKnockoutMatch(match)) {
      return { error: "Match not eligible." };
    }
  }

  await prisma.forcedMatchPriority.upsert({
    where: { matchType_matchId: { matchType, matchId } },
    update: { createdAt: new Date() },
    create: { matchType, matchId },
  });

  await prisma.scheduleActionLog.create({
    data: { action: "FORCE_NEXT", payload: { matchType, matchId } },
  });
  revalidatePath("/schedule");
  return { ok: true };
}

export async function clearForcedPriority(matchType: MatchType, matchId: string) {
  const parsed = matchTypeSchema.safeParse(matchType);
  if (!parsed.success) return { error: "Invalid match type." };

  await prisma.forcedMatchPriority.deleteMany({
    where: { matchType, matchId },
  });
  await prisma.scheduleActionLog.create({
    data: { action: "FORCE_CLEAR", payload: { matchType, matchId } },
  });
  revalidatePath("/schedule");
  return { ok: true };
}

export async function resetQueueForcedPriorities() {
  await prisma.forcedMatchPriority.deleteMany();
  await prisma.scheduleActionLog.create({
    data: { action: "FORCE_RESET", payload: {} },
  });
  revalidatePath("/schedule");
  return { ok: true };
}
