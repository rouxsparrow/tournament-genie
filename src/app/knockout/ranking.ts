import type { RankingTieOrderSource } from "@/lib/ranking-tie-override";

export type GlobalRankingEntry = {
  teamId: string;
  teamName: string;
  groupId: string;
  groupName: string;
  groupRank: number;
  avgPD: number;
  avgPF: number;
  played: number;
};

export type GlobalRankingFallbackTie = {
  entries: GlobalRankingEntry[];
  teamIds: string[];
  tieKey: string;
};

const GLOBAL_RANKING_TIE_PRECISION = 6;

export function compareGlobalRankingEntries(a: GlobalRankingEntry, b: GlobalRankingEntry) {
  if (a.groupRank !== b.groupRank) return a.groupRank - b.groupRank;
  if (b.avgPD !== a.avgPD) return b.avgPD - a.avgPD;
  return a.teamId.localeCompare(b.teamId);
}

function buildGlobalRankingComparisonKey(entry: GlobalRankingEntry) {
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
  buildTieKey: (tieGroup: GlobalRankingEntry[]) => string;
  getFallbackOrder: (
    tie: GlobalRankingFallbackTie
  ) => Promise<{ orderedTeamIds: string[]; source: RankingTieOrderSource }>;
  onFallbackResolved?: (
    tie: GlobalRankingFallbackTie & {
      orderedTeamIds: string[];
      source: RankingTieOrderSource;
    }
  ) => void | Promise<void>;
}) {
  const sorted = [...params.entries].sort(compareGlobalRankingEntries);
  const resolved: GlobalRankingEntry[] = [];

  let index = 0;
  while (index < sorted.length) {
    let nextIndex = index + 1;
    const comparisonKey = buildGlobalRankingComparisonKey(sorted[index] as GlobalRankingEntry);
    while (
      nextIndex < sorted.length &&
      buildGlobalRankingComparisonKey(sorted[nextIndex] as GlobalRankingEntry) === comparisonKey
    ) {
      nextIndex += 1;
    }

    const tieGroup = sorted.slice(index, nextIndex);
    if (tieGroup.length > 1) {
      const fallbackTie: GlobalRankingFallbackTie = {
        entries: tieGroup,
        teamIds: tieGroup.map((entry) => entry.teamId),
        tieKey: params.buildTieKey(tieGroup),
      };
      const fallbackOrder = await params.getFallbackOrder(fallbackTie);
      const orderedEntries = applyGlobalRankingOrder(tieGroup, fallbackOrder.orderedTeamIds);
      await params.onFallbackResolved?.({
        ...fallbackTie,
        orderedTeamIds: fallbackOrder.orderedTeamIds,
        source: fallbackOrder.source,
      });
      resolved.push(...orderedEntries);
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
