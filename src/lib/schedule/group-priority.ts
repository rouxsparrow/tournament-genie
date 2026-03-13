type ScheduleStage = "GROUP" | "KNOCKOUT";
type MatchType = "GROUP" | "KNOCKOUT";

export const GROUP_UPCOMING_LOOKAHEAD_LIMIT = 14;

export type QueuePriorityMatch = {
  matchId: string;
  matchType: MatchType;
  restScore: number;
  forcedRank?: number;
  isForced?: boolean;
  series?: "A" | "B";
  round?: number;
  matchNo?: number | null;
  bottleneckMaxLoad?: number;
  bottleneckSumLoad?: number;
  teams: {
    playerIds: string[];
  };
};

export type GroupLoadSourceMatch = {
  status: "SCHEDULED" | "COMPLETED";
  homeTeamId: string | null;
  awayTeamId: string | null;
  playerIds: string[];
};

function hasOverlap(playerIds: string[], blockedPlayerIds: Set<string>) {
  if (blockedPlayerIds.size === 0) return false;
  return playerIds.some((playerId) => blockedPlayerIds.has(playerId));
}

function normalizeRestScore(restScore: number) {
  if (!Number.isFinite(restScore)) return 0;
  const rounded = Math.round(restScore);
  if (rounded <= 0) return 0;
  if (rounded >= 4) return 4;
  return rounded;
}

function compareRestHistogram(a: number[], b: number[]) {
  for (let rest = 4; rest >= 0; rest -= 1) {
    if (a[rest] !== b[rest]) return a[rest] - b[rest];
  }
  return 0;
}

function compareQueuePosition(a: number[], b: number[]) {
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i += 1) {
    const aValue = a[i] ?? Number.POSITIVE_INFINITY;
    const bValue = b[i] ?? Number.POSITIVE_INFINITY;
    if (aValue !== bValue) return bValue - aValue;
  }
  return 0;
}

function findBestPackInWindow<T extends QueuePriorityMatch>(
  candidates: T[],
  maxPicks: number
) {
  if (maxPicks <= 0 || candidates.length === 0) return [] as T[];

  let bestIndices: number[] = [];
  let bestRestHistogram = [0, 0, 0, 0, 0];
  let bestMaxTotal = 0;
  let bestSumTotal = 0;

  const chosenIndices: number[] = [];
  const chosenRestHistogram = [0, 0, 0, 0, 0];
  let chosenMaxTotal = 0;
  let chosenSumTotal = 0;
  const usedPlayerIds = new Set<string>();

  const evaluateCurrent = () => {
    const histogramCompare = compareRestHistogram(chosenRestHistogram, bestRestHistogram);
    if (histogramCompare !== 0) {
      if (histogramCompare < 0) return;
      bestIndices = [...chosenIndices];
      bestRestHistogram = [...chosenRestHistogram];
      bestMaxTotal = chosenMaxTotal;
      bestSumTotal = chosenSumTotal;
      return;
    }

    if (chosenMaxTotal !== bestMaxTotal) {
      if (chosenMaxTotal < bestMaxTotal) return;
      bestIndices = [...chosenIndices];
      bestRestHistogram = [...chosenRestHistogram];
      bestMaxTotal = chosenMaxTotal;
      bestSumTotal = chosenSumTotal;
      return;
    }

    if (chosenSumTotal !== bestSumTotal) {
      if (chosenSumTotal < bestSumTotal) return;
      bestIndices = [...chosenIndices];
      bestRestHistogram = [...chosenRestHistogram];
      bestMaxTotal = chosenMaxTotal;
      bestSumTotal = chosenSumTotal;
      return;
    }

    if (compareQueuePosition(chosenIndices, bestIndices) > 0) {
      bestIndices = [...chosenIndices];
      bestRestHistogram = [...chosenRestHistogram];
      bestMaxTotal = chosenMaxTotal;
      bestSumTotal = chosenSumTotal;
    }
  };

  const dfs = (startIndex: number) => {
    evaluateCurrent();
    if (chosenIndices.length >= maxPicks) return;

    for (let index = startIndex; index < candidates.length; index += 1) {
      const match = candidates[index];
      if (hasOverlap(match.teams.playerIds, usedPlayerIds)) continue;

      chosenIndices.push(index);
      chosenRestHistogram[normalizeRestScore(match.restScore)] += 1;
      chosenMaxTotal += match.bottleneckMaxLoad ?? 0;
      chosenSumTotal += match.bottleneckSumLoad ?? 0;
      match.teams.playerIds.forEach((playerId) => usedPlayerIds.add(playerId));

      dfs(index + 1);

      chosenIndices.pop();
      chosenRestHistogram[normalizeRestScore(match.restScore)] -= 1;
      chosenMaxTotal -= match.bottleneckMaxLoad ?? 0;
      chosenSumTotal -= match.bottleneckSumLoad ?? 0;
      match.teams.playerIds.forEach((playerId) => {
        let stillUsed = false;
        for (const chosenIndex of chosenIndices) {
          if (candidates[chosenIndex].teams.playerIds.includes(playerId)) {
            stillUsed = true;
            break;
          }
        }
        if (!stillUsed) usedPlayerIds.delete(playerId);
      });
    }
  };

  dfs(0);
  return bestIndices.map((index) => candidates[index]);
}

export function isAssignableNow(playerIds: string[], inPlayPlayerIds: Set<string>) {
  return !hasOverlap(playerIds, inPlayPlayerIds);
}

export function buildGroupRemainingLoadMap(matches: GroupLoadSourceMatch[]) {
  const loadMap = new Map<string, number>();
  for (const match of matches) {
    if (
      match.status !== "SCHEDULED" ||
      !match.homeTeamId ||
      !match.awayTeamId ||
      match.playerIds.length === 0
    ) {
      continue;
    }
    for (const playerId of match.playerIds) {
      loadMap.set(playerId, (loadMap.get(playerId) ?? 0) + 1);
    }
  }
  return loadMap;
}

export function computeGroupBottleneckForPlayers(
  playerIds: string[],
  remainingLoadMap: Map<string, number>
) {
  if (playerIds.length === 0) {
    return { bottleneckMaxLoad: 0, bottleneckSumLoad: 0 };
  }

  let bottleneckMaxLoad = 0;
  let bottleneckSumLoad = 0;
  for (const playerId of playerIds) {
    const load = remainingLoadMap.get(playerId) ?? 0;
    if (load > bottleneckMaxLoad) bottleneckMaxLoad = load;
    bottleneckSumLoad += load;
  }
  return { bottleneckMaxLoad, bottleneckSumLoad };
}

export function sortQueueMatches<T extends QueuePriorityMatch>(
  matches: T[],
  params: {
    stage: ScheduleStage;
    inPlayPlayerIds?: Set<string>;
  }
) {
  const inPlayPlayerIds = params.inPlayPlayerIds ?? new Set<string>();
  return [...matches].sort((a, b) => {
    const aForced = a.forcedRank ?? Number.POSITIVE_INFINITY;
    const bForced = b.forcedRank ?? Number.POSITIVE_INFINITY;
    if (aForced !== bForced) return aForced - bForced;

    const aType = a.matchType === "GROUP" ? 0 : 1;
    const bType = b.matchType === "GROUP" ? 0 : 1;
    if (aType !== bType) return aType - bType;
    if (a.restScore !== b.restScore) return b.restScore - a.restScore;

    if (
      params.stage === "GROUP" &&
      a.matchType === "GROUP" &&
      b.matchType === "GROUP"
    ) {
      const aAssignable = isAssignableNow(a.teams.playerIds, inPlayPlayerIds);
      const bAssignable = isAssignableNow(b.teams.playerIds, inPlayPlayerIds);
      if (aAssignable !== bAssignable) return aAssignable ? -1 : 1;

      const aMaxLoad = a.bottleneckMaxLoad ?? 0;
      const bMaxLoad = b.bottleneckMaxLoad ?? 0;
      if (aMaxLoad !== bMaxLoad) return bMaxLoad - aMaxLoad;

      const aSumLoad = a.bottleneckSumLoad ?? 0;
      const bSumLoad = b.bottleneckSumLoad ?? 0;
      if (aSumLoad !== bSumLoad) return bSumLoad - aSumLoad;
    }

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

export function buildUpcomingFromSortedQueue<T extends QueuePriorityMatch>(
  queueMatches: T[],
  params: {
    stage: ScheduleStage;
    inPlayPlayerIds: Set<string>;
    limit?: number;
    lookaheadLimit?: number;
  }
) {
  const limit = params.limit ?? 5;
  const lookaheadLimit = Math.max(1, params.lookaheadLimit ?? GROUP_UPCOMING_LOOKAHEAD_LIMIT);
  const forcedCandidates = queueMatches.filter((match) => match.isForced);
  const normalCandidates = queueMatches.filter((match) => !match.isForced);
  const upcoming: T[] = [];
  const pickedPlayerIds = new Set<string>();

  const pickGreedy = (candidates: T[], requireAssignable: boolean) => {
    for (const match of candidates) {
      if (upcoming.length >= limit) break;
      if (hasOverlap(match.teams.playerIds, pickedPlayerIds)) continue;
      if (requireAssignable && !isAssignableNow(match.teams.playerIds, params.inPlayPlayerIds)) {
        continue;
      }
      upcoming.push(match);
      match.teams.playerIds.forEach((playerId) => pickedPlayerIds.add(playerId));
    }
  };

  const pickGroupLookahead = (candidates: T[], requireAssignable: boolean) => {
    const remainingSlots = limit - upcoming.length;
    if (remainingSlots <= 0) return;

    const filtered = candidates.filter((match) => {
      if (hasOverlap(match.teams.playerIds, pickedPlayerIds)) return false;
      if (requireAssignable && !isAssignableNow(match.teams.playerIds, params.inPlayPlayerIds)) {
        return false;
      }
      return true;
    });
    if (filtered.length === 0) return;

    const window = filtered.slice(0, lookaheadLimit);
    const selected = findBestPackInWindow(window, remainingSlots);
    const selectedSet = new Set(selected);

    for (const match of selected) {
      if (upcoming.length >= limit) break;
      if (hasOverlap(match.teams.playerIds, pickedPlayerIds)) continue;
      upcoming.push(match);
      match.teams.playerIds.forEach((playerId) => pickedPlayerIds.add(playerId));
    }

    if (upcoming.length >= limit) return;

    for (const match of filtered) {
      if (upcoming.length >= limit) break;
      if (selectedSet.has(match)) continue;
      if (hasOverlap(match.teams.playerIds, pickedPlayerIds)) continue;
      upcoming.push(match);
      match.teams.playerIds.forEach((playerId) => pickedPlayerIds.add(playerId));
    }
  };

  const pickFrom = params.stage === "GROUP" ? pickGroupLookahead : pickGreedy;

  pickFrom(forcedCandidates, true);
  pickFrom(forcedCandidates, false);
  pickFrom(normalCandidates, true);
  pickFrom(normalCandidates, false);

  return upcoming;
}
