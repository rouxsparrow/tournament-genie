export type BaseMatch = {
  round: number;
  matchNo: number;
  homeTeamId: string | null;
  awayTeamId: string | null;
};

export function mapKnockoutMatchCreateData(params: {
  categoryCode: "MD" | "WD" | "XD";
  series: "A" | "B";
  matches: BaseMatch[];
}) {
  const { categoryCode, series, matches } = params;
  return matches.map((match) => ({
    categoryCode,
    series,
    round: match.round,
    matchNo: match.matchNo,
    homeTeamId: match.homeTeamId,
    awayTeamId: match.awayTeamId,
    isPublished: false,
    isBestOf3: match.round === 4 && match.matchNo === 1,
  }));
}
