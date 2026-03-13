const GLOBAL_RANKING_TIE_PRECISION = 6;

export type GlobalRankingEntry = {
  teamId: string;
  teamName: string;
  groupId: string;
  groupName: string;
  groupRank: number;
  avgPD: number;
  played: number;
};

export function compareGlobalRankingEntries(a: GlobalRankingEntry, b: GlobalRankingEntry) {
  if (a.groupRank !== b.groupRank) return a.groupRank - b.groupRank;
  if (b.avgPD !== a.avgPD) return b.avgPD - a.avgPD;
  return a.teamId.localeCompare(b.teamId);
}

export function buildGlobalRankingTieKey(entry: GlobalRankingEntry) {
  return `${entry.groupRank}:${entry.avgPD.toFixed(GLOBAL_RANKING_TIE_PRECISION)}`;
}

function applyGlobalRankingOrder(tieGroup: GlobalRankingEntry[], orderedIds: string[]) {
  const entriesById = new Map(tieGroup.map((entry) => [entry.teamId, entry]));
  const ordered = orderedIds
    .map((teamId) => entriesById.get(teamId))
    .filter((entry): entry is GlobalRankingEntry => Boolean(entry));
  const usedIds = new Set(ordered.map((entry) => entry.teamId));
  const remaining = tieGroup.filter((entry) => !usedIds.has(entry.teamId));
  return [...ordered, ...remaining.sort((a, b) => a.teamId.localeCompare(b.teamId))];
}

export async function resolveGlobalRanking(params: {
  entries: GlobalRankingEntry[];
  getRandomDrawOrder: (tieKey: string, teamIds: string[]) => Promise<string[]>;
}) {
  const sorted = [...params.entries].sort(compareGlobalRankingEntries);
  const resolved: GlobalRankingEntry[] = [];

  let index = 0;
  while (index < sorted.length) {
    let nextIndex = index + 1;
    const tieKey = buildGlobalRankingTieKey(sorted[index]);
    while (nextIndex < sorted.length && buildGlobalRankingTieKey(sorted[nextIndex]) === tieKey) {
      nextIndex += 1;
    }

    const tieGroup = sorted.slice(index, nextIndex);
    if (tieGroup.length > 1) {
      const order = await params.getRandomDrawOrder(tieKey, tieGroup.map((entry) => entry.teamId));
      resolved.push(...applyGlobalRankingOrder(tieGroup, order));
    } else {
      resolved.push(...tieGroup);
    }

    index = nextIndex;
  }

  return resolved.map((entry, resolvedIndex) => ({
    ...entry,
    globalRank: resolvedIndex + 1,
  }));
}
