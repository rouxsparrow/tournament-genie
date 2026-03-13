import assert from "node:assert/strict";
import test from "node:test";
import {
  finalizeStandingMetrics,
  resolveStandingRows,
  type StandingRow,
} from "./logic";

function makeRow(params: {
  teamId: string;
  teamName?: string;
  wins: number;
  losses?: number;
  played: number;
  pointsFor: number;
  pointsAgainst: number;
}): StandingRow {
  return finalizeStandingMetrics({
    teamId: params.teamId,
    teamName: params.teamName ?? params.teamId,
    wins: params.wins,
    losses: params.losses ?? Math.max(params.played - params.wins, 0),
    played: params.played,
    pointsFor: params.pointsFor,
    pointsAgainst: params.pointsAgainst,
    pointDiff: 0,
    avgPointDiff: 0,
    avgPointsFor: 0,
  });
}

function resolveRowsForTest(rows: StandingRow[], options?: {
  completedMatches?: {
    winnerTeamId: string | null;
    homeTeamId: string | null;
    awayTeamId: string | null;
  }[];
  getFallbackOrder?: (teamIds: string[]) => Promise<string[]>;
}) {
  return resolveStandingRows({
    rows,
    completedMatches: options?.completedMatches ?? [],
    buildTieKey: (tieGroup) => tieGroup.map((row) => row.teamId).sort().join(","),
    getFallbackOrder: async (tie) => ({
      orderedTeamIds: options?.getFallbackOrder
        ? await options.getFallbackOrder(tie.teamIds)
        : tie.teamIds,
      source: "random",
    }),
  });
}

test("standings order uses avg PD when teams played different match counts", async () => {
  const rows = await resolveRowsForTest([
      makeRow({
        teamId: "team-b",
        wins: 2,
        played: 3,
        pointsFor: 63,
        pointsAgainst: 45,
      }),
      makeRow({
        teamId: "team-a",
        wins: 2,
        played: 1,
        pointsFor: 21,
        pointsAgainst: 9,
      }),
    ]);

  assert.deepEqual(
    rows.map((row) => row.teamId),
    ["team-a", "team-b"]
  );
});

test("standings tie-break uses avg PD before avg PF", async () => {
  const rows = await resolveRowsForTest([
      makeRow({
        teamId: "higher-avg-pd",
        wins: 2,
        played: 2,
        pointsFor: 42,
        pointsAgainst: 20,
      }),
      makeRow({
        teamId: "lower-avg-pd",
        wins: 2,
        played: 2,
        pointsFor: 50,
        pointsAgainst: 32,
      }),
    ]);

  assert.deepEqual(
    rows.map((row) => row.teamId),
    ["higher-avg-pd", "lower-avg-pd"]
  );
});

test("standings tie-break uses avg PF when wins and avg PD are equal", async () => {
  const rows = await resolveRowsForTest([
      makeRow({
        teamId: "higher-avg-pf",
        wins: 1,
        played: 2,
        pointsFor: 50,
        pointsAgainst: 30,
      }),
      makeRow({
        teamId: "lower-avg-pf",
        wins: 1,
        played: 1,
        pointsFor: 21,
        pointsAgainst: 11,
      }),
    ]);

  assert.deepEqual(
    rows.map((row) => row.teamId),
    ["higher-avg-pf", "lower-avg-pf"]
  );
});

test("standings use head-to-head for a two-team tie after avg metrics match", async () => {
  const rows = await resolveRowsForTest([
      makeRow({
        teamId: "team-a",
        wins: 1,
        played: 2,
        pointsFor: 42,
        pointsAgainst: 42,
      }),
      makeRow({
        teamId: "team-b",
        wins: 1,
        played: 2,
        pointsFor: 42,
        pointsAgainst: 42,
      }),
    ], {
    completedMatches: [
      {
        homeTeamId: "team-a",
        awayTeamId: "team-b",
        winnerTeamId: "team-b",
      },
    ],
    getFallbackOrder: async () => {
      throw new Error("random draw should not run");
    },
  });

  assert.deepEqual(
    rows.map((row) => row.teamId),
    ["team-b", "team-a"]
  );
});

test("standings fall back to stored random draw for unresolved multi-team ties", async () => {
  const rows = await resolveRowsForTest([
      makeRow({
        teamId: "team-a",
        wins: 1,
        played: 1,
        pointsFor: 21,
        pointsAgainst: 11,
      }),
      makeRow({
        teamId: "team-b",
        wins: 1,
        played: 1,
        pointsFor: 21,
        pointsAgainst: 11,
      }),
      makeRow({
        teamId: "team-c",
        wins: 1,
        played: 1,
        pointsFor: 21,
        pointsAgainst: 11,
      }),
    ], {
    getFallbackOrder: async () => ["team-c", "team-a", "team-b"],
  });

  assert.deepEqual(
    rows.map((row) => row.teamId),
    ["team-c", "team-a", "team-b"]
  );
});

test("standings can use a manual override before random draw", async () => {
  let source: string | null = null;

  const rows = await resolveStandingRows({
    rows: [
      makeRow({
        teamId: "team-a",
        wins: 1,
        played: 1,
        pointsFor: 21,
        pointsAgainst: 11,
      }),
      makeRow({
        teamId: "team-b",
        wins: 1,
        played: 1,
        pointsFor: 21,
        pointsAgainst: 11,
      }),
    ],
    completedMatches: [],
    buildTieKey: (tieGroup) => tieGroup.map((row) => row.teamId).sort().join(","),
    getFallbackOrder: async () => ({
      orderedTeamIds: ["team-b", "team-a"],
      source: "manual",
    }),
    onFallbackResolved: (tie) => {
      source = tie.source;
    },
  });

  assert.deepEqual(
    rows.map((row) => row.teamId),
    ["team-b", "team-a"]
  );
  assert.equal(source, "manual");
});
