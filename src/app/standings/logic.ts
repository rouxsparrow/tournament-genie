import type { RankingTieOrderSource } from "@/lib/ranking-tie-override";

export type StandingRow = {
  teamId: string;
  teamName: string;
  wins: number;
  losses: number;
  played: number;
  pointsFor: number;
  pointsAgainst: number;
  pointDiff: number;
  avgPointDiff: number;
  avgPointsFor: number;
};

export type StandingTieMatch = {
  winnerTeamId: string | null;
  homeTeamId: string | null;
  awayTeamId: string | null;
};

export type StandingFallbackTie = {
  rows: StandingRow[];
  teamIds: string[];
  tieKey: string;
};

const STANDING_TIE_PRECISION = 6;

export function computeAverageMetric(total: number, played: number) {
  return played > 0 ? total / played : 0;
}

export function finalizeStandingMetrics(row: StandingRow): StandingRow {
  const pointDiff = row.pointsFor - row.pointsAgainst;
  return {
    ...row,
    pointDiff,
    avgPointDiff: computeAverageMetric(pointDiff, row.played),
    avgPointsFor: computeAverageMetric(row.pointsFor, row.played),
  };
}

export function compareStandingRows(a: StandingRow, b: StandingRow) {
  if (b.wins !== a.wins) return b.wins - a.wins;
  if (b.avgPointDiff !== a.avgPointDiff) return b.avgPointDiff - a.avgPointDiff;
  if (b.avgPointsFor !== a.avgPointsFor) return b.avgPointsFor - a.avgPointsFor;
  return a.teamName.localeCompare(b.teamName);
}

export function buildStandingTieKey(row: StandingRow) {
  return [
    row.wins,
    row.avgPointDiff.toFixed(STANDING_TIE_PRECISION),
    row.avgPointsFor.toFixed(STANDING_TIE_PRECISION),
  ].join(":");
}

export function areStandingRowsTied(a: StandingRow, b: StandingRow) {
  return buildStandingTieKey(a) === buildStandingTieKey(b);
}

function applyStandingOrder(tieGroup: StandingRow[], orderedIds: string[]) {
  const rowsById = new Map(tieGroup.map((row) => [row.teamId, row]));
  const ordered = orderedIds
    .map((teamId) => rowsById.get(teamId))
    .filter((row): row is StandingRow => Boolean(row));
  const usedIds = new Set(ordered.map((row) => row.teamId));
  const remaining = tieGroup.filter((row) => !usedIds.has(row.teamId));
  return [...ordered, ...remaining.sort((a, b) => a.teamName.localeCompare(b.teamName))];
}

export async function resolveStandingRows(params: {
  rows: StandingRow[];
  completedMatches: StandingTieMatch[];
  buildTieKey: (tieGroup: StandingRow[]) => string;
  getFallbackOrder: (
    tie: StandingFallbackTie
  ) => Promise<{ orderedTeamIds: string[]; source: RankingTieOrderSource }>;
  onFallbackResolved?: (
    tie: StandingFallbackTie & {
      orderedTeamIds: string[];
      source: RankingTieOrderSource;
    }
  ) => void | Promise<void>;
}) {
  const baseSorted = [...params.rows].sort(compareStandingRows);
  const resolved: StandingRow[] = [];

  let index = 0;
  while (index < baseSorted.length) {
    let nextIndex = index + 1;
    while (nextIndex < baseSorted.length && areStandingRowsTied(baseSorted[index], baseSorted[nextIndex])) {
      nextIndex += 1;
    }

    const tieGroup = baseSorted.slice(index, nextIndex);
    const fallbackTie: StandingFallbackTie = {
      rows: tieGroup,
      teamIds: tieGroup.map((row) => row.teamId),
      tieKey: params.buildTieKey(tieGroup),
    };

    if (tieGroup.length === 2) {
      const [first, second] = tieGroup;
      const headToHead = params.completedMatches.find(
        (match) =>
          (match.homeTeamId === first.teamId && match.awayTeamId === second.teamId) ||
          (match.homeTeamId === second.teamId && match.awayTeamId === first.teamId)
      );

      if (headToHead?.winnerTeamId === first.teamId) {
        resolved.push(first, second);
      } else if (headToHead?.winnerTeamId === second.teamId) {
        resolved.push(second, first);
      } else {
        const fallbackOrder = await params.getFallbackOrder(fallbackTie);
        const orderedRows = applyStandingOrder(tieGroup, fallbackOrder.orderedTeamIds);
        await params.onFallbackResolved?.({
          ...fallbackTie,
          orderedTeamIds: fallbackOrder.orderedTeamIds,
          source: fallbackOrder.source,
        });
        resolved.push(...orderedRows);
      }
    } else if (tieGroup.length > 2) {
      const fallbackOrder = await params.getFallbackOrder(fallbackTie);
      const orderedRows = applyStandingOrder(tieGroup, fallbackOrder.orderedTeamIds);
      await params.onFallbackResolved?.({
        ...fallbackTie,
        orderedTeamIds: fallbackOrder.orderedTeamIds,
        source: fallbackOrder.source,
      });
      resolved.push(...orderedRows);
    } else {
      resolved.push(...tieGroup);
    }

    index = nextIndex;
  }

  return resolved;
}
