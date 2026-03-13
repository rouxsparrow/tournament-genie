export type SeriesBRankingEntry = {
  teamId: string;
  groupRank: number;
  avgPD: number;
  groupId: string;
};

export function compareSeriesBRankingEntries(
  a: SeriesBRankingEntry,
  b: SeriesBRankingEntry,
  rankingMap: Map<string, number>
) {
  const rankA = rankingMap.get(a.teamId) ?? Number.MAX_SAFE_INTEGER;
  const rankB = rankingMap.get(b.teamId) ?? Number.MAX_SAFE_INTEGER;
  if (rankA !== rankB) return rankA - rankB;
  if (a.groupRank !== b.groupRank) return a.groupRank - b.groupRank;
  if (b.avgPD !== a.avgPD) return b.avgPD - a.avgPD;
  return a.teamId.localeCompare(b.teamId);
}

export function sortSeriesBRankingEntries(
  entries: SeriesBRankingEntry[],
  rankingMap: Map<string, number>
) {
  return [...entries].sort((a, b) => compareSeriesBRankingEntries(a, b, rankingMap));
}
