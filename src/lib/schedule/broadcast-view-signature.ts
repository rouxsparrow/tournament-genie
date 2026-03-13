import { prisma } from "@/lib/prisma";
import {
  buildGroupRemainingLoadMap,
  buildUpcomingFromSortedQueue,
  computeGroupBottleneckForPlayers,
  sortQueueMatches,
} from "@/lib/schedule/group-priority";
import { buildKnockoutUnlockPotentialMap } from "@/lib/schedule/knockout-unlock";

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
  unlockPotential?: number;
  bottleneckMaxLoad: number;
  bottleneckSumLoad: number;
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

function hasUncheckedPlayers(playerIds: string[], uncheckedPlayerIds: Set<string>) {
  if (uncheckedPlayerIds.size === 0) return false;
  return playerIds.some((playerId) => uncheckedPlayerIds.has(playerId));
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

function sortEligible(
  matches: EligibleMatch[],
  stage: ScheduleStage,
  inPlayPlayerIds: Set<string>
) {
  return sortQueueMatches(matches, { stage, inPlayPlayerIds });
}

function buildUpcoming(
  queueMatches: EligibleMatch[],
  playingPlayerIds: Set<string>,
  stage: ScheduleStage,
  limit = 5
) {
  return buildUpcomingFromSortedQueue(queueMatches, {
    stage,
    inPlayPlayerIds: playingPlayerIds,
    limit,
  });
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

async function getUncheckedPlayerIds() {
  const unchecked = await prisma.player.findMany({
    where: { checkedIn: false },
    select: { id: true },
  });
  return new Set(unchecked.map((player) => player.id));
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
  const [forcedData, blocked, context, recentlyPlayedIds, uncheckedPlayerIds] = await Promise.all([
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
    getUncheckedPlayerIds(),
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
    const groupRemainingLoadMap = buildGroupRemainingLoadMap(
      groupMatches.map((match) => ({
        status: match.status,
        homeTeamId: match.homeTeamId,
        awayTeamId: match.awayTeamId,
        playerIds: [
          ...(match.homeTeam?.members.map((member) => member.playerId) ?? []),
          ...(match.awayTeam?.members.map((member) => member.playerId) ?? []),
        ],
      }))
    );

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
      const bottleneck = computeGroupBottleneckForPlayers(playerIds, groupRemainingLoadMap);
      if (hasUncheckedPlayers(playerIds, uncheckedPlayerIds)) continue;
      eligible.push({
        key,
        matchId: match.id,
        matchType: "GROUP",
        restScore: computeRestScore(
          playerIds,
          context.inPlayPlayerIds,
          recentlyPlayedIds
        ),
        bottleneckMaxLoad: bottleneck.bottleneckMaxLoad,
        bottleneckSumLoad: bottleneck.bottleneckSumLoad,
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
    const knockoutUnlockPotentialMap = buildKnockoutUnlockPotentialMap(
      knockoutMatches.map((match) => ({
        id: match.id,
        nextMatchId: match.nextMatchId,
        status: match.status,
        winnerTeamId: match.winnerTeamId,
      }))
    );

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
      if (hasUncheckedPlayers(playerIds, uncheckedPlayerIds)) continue;
      eligible.push({
        key,
        matchId: match.id,
        matchType: "KNOCKOUT",
        restScore: computeRestScore(
          playerIds,
          context.inPlayPlayerIds,
          recentlyPlayedIds
        ),
        unlockPotential: knockoutUnlockPotentialMap.get(match.id) ?? 0,
        bottleneckMaxLoad: 0,
        bottleneckSumLoad: 0,
        forcedRank: forcedData.rankMap.get(key),
        isForced: forcedData.forcedSet.has(key),
        series: match.series,
        round: match.round,
        matchNo: match.matchNo,
        teams: { playerIds },
      });
    }
  }

  const sorted = sortEligible(eligible, stage, context.inPlayPlayerIds);
  const upcoming = buildUpcoming(sorted, context.inPlayPlayerIds, stage, 5);
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
