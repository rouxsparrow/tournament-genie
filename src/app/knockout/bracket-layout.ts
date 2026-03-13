export type KnockoutSeededMatch = {
  round: number;
  matchNo: number;
  homeTeamId: string | null;
  awayTeamId: string | null;
};

export type SecondChanceHomeAssignment = {
  matchNo: number;
  homeTeamId: string;
};

const PROTECTED_SERIES_A_MATCHUPS = {
  4: [
    [1, 4],
    [2, 3],
  ],
  8: [
    [1, 8],
    [4, 5],
    [2, 7],
    [3, 6],
  ],
} as const;

const PROTECTED_SERIES_B_FOUR_TEAM_AWAY_ORDER = [1, 4, 2, 3] as const;
const SECOND_CHANCE_MATCH_ORDER_BY_STRENGTH = [2, 4, 3, 1] as const;

export function buildProtectedSeriesAFirstRound(
  seededTeamIds: string[],
  startRound: number
): KnockoutSeededMatch[] {
  const size = seededTeamIds.length;
  const matchups = PROTECTED_SERIES_A_MATCHUPS[size as 4 | 8];
  if (!matchups) {
    throw new Error(
      `Protected Series A layout supports 4 or 8 teams, received ${size}.`
    );
  }

  return matchups.map(([homeSeed, awaySeed], index) => ({
    round: startRound,
    matchNo: index + 1,
    homeTeamId: seededTeamIds[homeSeed - 1] ?? null,
    awayTeamId: seededTeamIds[awaySeed - 1] ?? null,
  }));
}

export function buildProtectedSeriesBFourTeamAwaySlots(seededTeamIds: string[]) {
  if (seededTeamIds.length !== 4) {
    throw new Error(
      `Protected Series B four-team layout requires exactly 4 teams, received ${seededTeamIds.length}.`
    );
  }

  return PROTECTED_SERIES_B_FOUR_TEAM_AWAY_ORDER.map((seedNo, index) => ({
    matchNo: index + 1,
    awayTeamId: seededTeamIds[seedNo - 1] ?? null,
  }));
}

export function buildSecondChanceHomeAssignments(
  sortedLoserTeamIds: string[]
): SecondChanceHomeAssignment[] {
  return SECOND_CHANCE_MATCH_ORDER_BY_STRENGTH.slice(
    0,
    sortedLoserTeamIds.length
  ).map((matchNo, index) => ({
    matchNo,
    homeTeamId: sortedLoserTeamIds[index] ?? "",
  }));
}
