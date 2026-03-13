export type RankingTieScope = "GROUP_STANDINGS" | "GLOBAL_GROUP_RANKING";
export type RankingTieOrderSource = "manual" | "random";
export type RankingTieCategoryCode = "MD" | "WD" | "XD";

const TIE_KEY_PRECISION = 6;

function sortedTeamIds(teamIds: string[]) {
  return [...teamIds].sort();
}

export function buildGroupRandomDrawTieKey(groupId: string, teamIds: string[]) {
  return `${groupId}:${sortedTeamIds(teamIds).join(",")}`;
}

export function buildGroupStandingOverrideTieKey(params: {
  groupId: string;
  teamIds: string[];
  wins: number;
  avgPointDiff: number;
  avgPointsFor: number;
}) {
  return [
    "GROUP_STANDINGS",
    params.groupId,
    params.wins,
    params.avgPointDiff.toFixed(TIE_KEY_PRECISION),
    params.avgPointsFor.toFixed(TIE_KEY_PRECISION),
    sortedTeamIds(params.teamIds).join(","),
  ].join(":");
}

export function buildGlobalRankingRandomTieKey(params: {
  groupRank: number;
  avgPD: number;
}) {
  return `${params.groupRank}:${params.avgPD.toFixed(TIE_KEY_PRECISION)}`;
}

export function buildGlobalRankingOverrideTieKey(params: {
  categoryCode: RankingTieCategoryCode;
  teamIds: string[];
  groupRank: number;
  avgPD: number;
}) {
  return [
    "GLOBAL_GROUP_RANKING",
    params.categoryCode,
    params.groupRank,
    params.avgPD.toFixed(TIE_KEY_PRECISION),
    sortedTeamIds(params.teamIds).join(","),
  ].join(":");
}

export function buildGlobalRandomDrawKey(
  categoryCode: RankingTieCategoryCode,
  tieKey: string,
  teamIds: string[]
) {
  return `global:${categoryCode}:${tieKey}:${sortedTeamIds(teamIds).join(",")}`;
}

export function normalizeOrderedTeamIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

export function isValidTieOrder(expectedTeamIds: string[], orderedTeamIds: string[]) {
  if (expectedTeamIds.length !== orderedTeamIds.length) return false;
  const expected = sortedTeamIds(expectedTeamIds);
  const received = sortedTeamIds(orderedTeamIds);
  return expected.every((teamId, index) => teamId === received[index]);
}
