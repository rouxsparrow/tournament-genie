import { prisma } from "@/lib/prisma";

type ScheduleStage = "GROUP" | "KNOCKOUT";
type MatchType = "GROUP" | "KNOCKOUT";

type ForcedData = {
  rankMap: Map<string, number>;
  forcedSet: Set<string>;
};

type EligibleMatch = {
  key: string;
  matchId: string;
  matchType: MatchType;
  restScore: number;
  forcedRank?: number;
  isForced?: boolean;
  series?: "A" | "B";
  round?: number;
  matchNo?: number | null;
  teams: {
    playerIds: string[];
  };
};

export type BroadcastViewSignature = {
  assignmentSig: string;
  upcomingSig: string;
};

export type BroadcastViewChangeType = "assignment" | "upcoming" | "both";

function buildMatchKey(matchType: MatchType, matchId: string) {
  return `${matchType}:${matchId}`;
}

function hasInPlayPlayers(playerIds: string[], inPlayPlayerIds: Set<string>) {
  if (inPlayPlayerIds.size === 0) return false;
  return playerIds.some((playerId) => inPlayPlayerIds.has(playerId));
}

function computeRestScore(
  playerIds: string[],
  inPlayPlayerIds: Set<string>,
  recentlyPlayedIds: Set<string>
) {
  if (playerIds.length === 0) return 0;
  let rested = 0;
  for (const playerId of playerIds) {
    if (!inPlayPlayerIds.has(playerId) && !recentlyPlayedIds.has(playerId)) {
      rested += 1;
    }
  }
  return rested;
}

function sortEligible(matches: EligibleMatch[]) {
  return [...matches].sort((a, b) => {
    const aForced = a.forcedRank ?? Number.POSITIVE_INFINITY;
    const bForced = b.forcedRank ?? Number.POSITIVE_INFINITY;
    if (aForced !== bForced) return aForced - bForced;

    const aType = a.matchType === "GROUP" ? 0 : 1;
    const bType = b.matchType === "GROUP" ? 0 : 1;
    if (aType !== bType) return aType - bType;
    if (a.restScore !== b.restScore) return b.restScore - a.restScore;

    if (a.matchType === "KNOCKOUT" && b.matchType === "KNOCKOUT" && a.round !== b.round) {
      return (a.round ?? 0) - (b.round ?? 0);
    }
    if (a.matchType === "KNOCKOUT" && b.matchType === "KNOCKOUT" && a.series !== b.series) {
      const seriesRank: Record<string, number> = { B: 0, A: 1 };
      const aSeries = a.series ? seriesRank[a.series] ?? 2 : 2;
      const bSeries = b.series ? seriesRank[b.series] ?? 2 : 2;
      if (aSeries !== bSeries) return aSeries - bSeries;
    }
    if (a.matchNo !== b.matchNo) return (a.matchNo ?? 0) - (b.matchNo ?? 0);
    return a.matchId.localeCompare(b.matchId);
  });
}

function buildUpcoming(
  queueMatches: EligibleMatch[],
  playingPlayerIds: Set<string>,
  limit = 5
) {
  const forcedCandidates = queueMatches.filter((match) => match.isForced);
  const normalCandidates = queueMatches.filter((match) => !match.isForced);
  const upcoming: EligibleMatch[] = [];
  const pickedPlayerIds = new Set<string>();

  const pickFrom = (candidates: EligibleMatch[], requireAssignable: boolean) => {
    for (const match of candidates) {
      if (upcoming.length >= limit) break;
      const overlapsPicked = hasInPlayPlayers(match.teams.playerIds, pickedPlayerIds);
      if (overlapsPicked) continue;
      const overlapsPlaying = hasInPlayPlayers(match.teams.playerIds, playingPlayerIds);
      if (requireAssignable && overlapsPlaying) continue;
      upcoming.push(match);
      match.teams.playerIds.forEach((id) => pickedPlayerIds.add(id));
    }
  };

  pickFrom(forcedCandidates, true);
  pickFrom(forcedCandidates, false);
  pickFrom(normalCandidates, true);
  pickFrom(normalCandidates, false);

  return upcoming;
}

async function getForcedData(stage: ScheduleStage): Promise<ForcedData> {
  const forced = await prisma.forcedMatchPriority.findMany({
    where: { matchType: stage === "GROUP" ? "GROUP" : "KNOCKOUT" },
    orderBy: { createdAt: "desc" },
  });
  const rankMap = new Map<string, number>();
  const forcedSet = new Set<string>();
  forced.forEach((entry, index) => {
    const key = buildMatchKey(entry.matchType, entry.matchId);
    rankMap.set(key, index + 1);
    forcedSet.add(key);
  });
  return { rankMap, forcedSet };
}

async function getRecentCompletedPlayerIds(stage: ScheduleStage) {
  if (stage === "GROUP") {
    const groupMatches = await prisma.match.findMany({
      where: { status: "COMPLETED", stage: "GROUP" },
      orderBy: { completedAt: "desc" },
      take: 5,
      include: {
        homeTeam: { select: { members: { select: { playerId: true } } } },
        awayTeam: { select: { members: { select: { playerId: true } } } },
      },
    });
    const playerIds = new Set<string>();
    for (const match of groupMatches) {
      match.homeTeam?.members.forEach((member) => playerIds.add(member.playerId));
      match.awayTeam?.members.forEach((member) => playerIds.add(member.playerId));
    }
    return playerIds;
  }

  const knockoutMatches = await prisma.knockoutMatch.findMany({
    where: { status: "COMPLETED" },
    orderBy: { completedAt: "desc" },
    take: 5,
    include: {
      homeTeam: { select: { members: { select: { playerId: true } } } },
      awayTeam: { select: { members: { select: { playerId: true } } } },
    },
  });
  const playerIds = new Set<string>();
  for (const match of knockoutMatches) {
    match.homeTeam?.members.forEach((member) => playerIds.add(member.playerId));
    match.awayTeam?.members.forEach((member) => playerIds.add(member.playerId));
  }
  return playerIds;
}

async function getAssignmentContext(stage: ScheduleStage) {
  const assignments = await prisma.courtAssignment.findMany({
    where: { status: "ACTIVE", stage },
    include: {
      groupMatch: {
        include: {
          homeTeam: { select: { members: { select: { playerId: true } } } },
          awayTeam: { select: { members: { select: { playerId: true } } } },
        },
      },
      knockoutMatch: {
        include: {
          homeTeam: { select: { members: { select: { playerId: true } } } },
          awayTeam: { select: { members: { select: { playerId: true } } } },
        },
      },
    },
  });

  const inPlayPlayerIds = new Set<string>();
  const assignedMatchKeys = new Set<string>();
  for (const assignment of assignments) {
    if (assignment.matchType === "GROUP" && assignment.groupMatchId) {
      assignedMatchKeys.add(buildMatchKey("GROUP", assignment.groupMatchId));
      assignment.groupMatch?.homeTeam?.members.forEach((member) =>
        inPlayPlayerIds.add(member.playerId)
      );
      assignment.groupMatch?.awayTeam?.members.forEach((member) =>
        inPlayPlayerIds.add(member.playerId)
      );
    }
    if (assignment.matchType === "KNOCKOUT" && assignment.knockoutMatchId) {
      assignedMatchKeys.add(buildMatchKey("KNOCKOUT", assignment.knockoutMatchId));
      assignment.knockoutMatch?.homeTeam?.members.forEach((member) =>
        inPlayPlayerIds.add(member.playerId)
      );
      assignment.knockoutMatch?.awayTeam?.members.forEach((member) =>
        inPlayPlayerIds.add(member.playerId)
      );
    }
  }

  return { assignedMatchKeys, inPlayPlayerIds };
}

export async function getActiveAssignmentSignature(stage: ScheduleStage) {
  const assignments = await prisma.courtAssignment.findMany({
    where: {
      status: "ACTIVE",
      stage,
    },
    select: {
      courtId: true,
      matchType: true,
      groupMatchId: true,
      knockoutMatchId: true,
    },
  });

  const normalized = assignments
    .map((assignment) => {
      const matchId =
        assignment.matchType === "GROUP"
          ? assignment.groupMatchId ?? ""
          : assignment.knockoutMatchId ?? "";
      return `${assignment.courtId}|${assignment.matchType}|${matchId}`;
    })
    .sort();

  return normalized.join("||");
}

export async function getUpcomingSignature(stage: ScheduleStage) {
  const [forcedData, blocked, context, recentlyPlayedIds] = await Promise.all([
    getForcedData(stage),
    prisma.blockedMatch.findMany({
      where: { matchType: stage === "GROUP" ? "GROUP" : "KNOCKOUT" },
      select: {
        matchType: true,
        groupMatchId: true,
        knockoutMatchId: true,
      },
    }),
    getAssignmentContext(stage),
    getRecentCompletedPlayerIds(stage),
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

  const eligible: EligibleMatch[] = [];

  if (stage === "GROUP") {
    const groupMatches = await prisma.match.findMany({
      where: { stage: "GROUP" },
      include: {
        homeTeam: { select: { members: { select: { playerId: true } } } },
        awayTeam: { select: { members: { select: { playerId: true } } } },
      },
      orderBy: [{ group: { name: "asc" } }, { createdAt: "asc" }],
    });

    for (const match of groupMatches) {
      if (
        match.status !== "SCHEDULED" ||
        !match.homeTeamId ||
        !match.awayTeamId
      ) {
        continue;
      }
      const key = buildMatchKey("GROUP", match.id);
      if (blockedKeys.has(key) || context.assignedMatchKeys.has(key)) continue;

      const playerIds = [
        ...(match.homeTeam?.members.map((member) => member.playerId) ?? []),
        ...(match.awayTeam?.members.map((member) => member.playerId) ?? []),
      ];
      eligible.push({
        key,
        matchId: match.id,
        matchType: "GROUP",
        restScore: computeRestScore(
          playerIds,
          context.inPlayPlayerIds,
          recentlyPlayedIds
        ),
        forcedRank: forcedData.rankMap.get(key),
        isForced: forcedData.forcedSet.has(key),
        teams: { playerIds },
      });
    }
  } else {
    const knockoutMatches = await prisma.knockoutMatch.findMany({
      where: { isPublished: true },
      include: {
        homeTeam: { select: { members: { select: { playerId: true } } } },
        awayTeam: { select: { members: { select: { playerId: true } } } },
      },
      orderBy: [{ series: "asc" }, { round: "asc" }, { matchNo: "asc" }],
    });

    for (const match of knockoutMatches) {
      if (
        !match.isPublished ||
        match.status !== "SCHEDULED" ||
        !match.homeTeamId ||
        !match.awayTeamId
      ) {
        continue;
      }
      const key = buildMatchKey("KNOCKOUT", match.id);
      if (blockedKeys.has(key) || context.assignedMatchKeys.has(key)) continue;

      const playerIds = [
        ...(match.homeTeam?.members.map((member) => member.playerId) ?? []),
        ...(match.awayTeam?.members.map((member) => member.playerId) ?? []),
      ];
      eligible.push({
        key,
        matchId: match.id,
        matchType: "KNOCKOUT",
        restScore: computeRestScore(
          playerIds,
          context.inPlayPlayerIds,
          recentlyPlayedIds
        ),
        forcedRank: forcedData.rankMap.get(key),
        isForced: forcedData.forcedSet.has(key),
        series: match.series,
        round: match.round,
        matchNo: match.matchNo,
        teams: { playerIds },
      });
    }
  }

  const upcoming = buildUpcoming(sortEligible(eligible), context.inPlayPlayerIds, 5);
  return upcoming
    .map((match) => `${match.key}|${match.forcedRank ?? ""}`)
    .join("||");
}

export async function getBroadcastViewSignature(
  stage: ScheduleStage
): Promise<BroadcastViewSignature> {
  const [assignmentSig, upcomingSig] = await Promise.all([
    getActiveAssignmentSignature(stage),
    getUpcomingSignature(stage),
  ]);
  return { assignmentSig, upcomingSig };
}

export function getBroadcastViewChangeType(
  before: BroadcastViewSignature,
  after: BroadcastViewSignature
): BroadcastViewChangeType | null {
  const assignmentChanged = before.assignmentSig !== after.assignmentSig;
  const upcomingChanged = before.upcomingSig !== after.upcomingSig;

  if (assignmentChanged && upcomingChanged) return "both";
  if (assignmentChanged) return "assignment";
  if (upcomingChanged) return "upcoming";
  return null;
}
