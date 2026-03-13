import type {
  PublicStandingRow,
  PublicStandingsSummary,
} from "@/lib/public-read-models/types";

type PartialStandingRow = Omit<PublicStandingRow, "avgPointDiff" | "avgPointsFor"> &
  Partial<Pick<PublicStandingRow, "avgPointDiff" | "avgPointsFor">>;

type PartialStandingsSummary = Omit<PublicStandingsSummary, "groups"> & {
  groups: Array<
    Omit<PublicStandingsSummary["groups"][number], "standings"> & {
      standings: PartialStandingRow[];
    }
  >;
};

function computeAverageMetric(total: number, played: number) {
  return played > 0 ? total / played : 0;
}

export function normalizeStandingRow(row: PartialStandingRow): PublicStandingRow {
  const played = typeof row.played === "number" && row.played > 0 ? row.played : 0;
  const pointDiff =
    typeof row.pointDiff === "number"
      ? row.pointDiff
      : (row.pointsFor ?? 0) - (row.pointsAgainst ?? 0);

  return {
    ...row,
    pointDiff,
    avgPointDiff:
      typeof row.avgPointDiff === "number"
        ? row.avgPointDiff
        : computeAverageMetric(pointDiff, played),
    avgPointsFor:
      typeof row.avgPointsFor === "number"
        ? row.avgPointsFor
        : computeAverageMetric(row.pointsFor ?? 0, played),
  };
}

export function normalizeStandingsSummary(
  summary: PartialStandingsSummary
): PublicStandingsSummary {
  return {
    ...summary,
    groups: summary.groups.map((group) => ({
      ...group,
      standings: group.standings.map(normalizeStandingRow),
    })),
  };
}
