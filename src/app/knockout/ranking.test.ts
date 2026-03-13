import assert from "node:assert/strict";
import test from "node:test";
import { resolveGlobalRanking, type GlobalRankingEntry } from "./ranking";

function makeEntry(params: {
  teamId: string;
  groupRank: number;
  avgPD: number;
  avgPF?: number;
}): GlobalRankingEntry {
  return {
    teamId: params.teamId,
    teamName: params.teamId,
    groupId: `${params.teamId}-group`,
    groupName: `${params.teamId}-group`,
    groupRank: params.groupRank,
    avgPD: params.avgPD,
    avgPF: params.avgPF ?? 0,
    played: 1,
  };
}

function resolveRankingForTest(entries: GlobalRankingEntry[], options?: {
  getFallbackOrder?: (teamIds: string[]) => Promise<string[]>;
}) {
  return resolveGlobalRanking({
    entries,
    buildTieKey: (tieGroup) => tieGroup.map((entry) => entry.teamId).sort().join(","),
    getFallbackOrder: async (tie) => ({
      orderedTeamIds: options?.getFallbackOrder
        ? await options.getFallbackOrder(tie.teamIds)
        : tie.teamIds,
      source: "random",
    }),
  });
}

test("global ranking orders same group rank by avg PD descending", async () => {
  const ranking = await resolveRankingForTest([
      makeEntry({ teamId: "rank-2-low", groupRank: 2, avgPD: 3 }),
      makeEntry({ teamId: "rank-1", groupRank: 1, avgPD: -2 }),
      makeEntry({ teamId: "rank-2-high", groupRank: 2, avgPD: 7 }),
    ], {
    getFallbackOrder: async (teamIds) => {
      throw new Error(`random draw should not run for ${teamIds.join(",")}`);
    },
  });

  assert.deepEqual(
    ranking.map((entry) => entry.teamId),
    ["rank-1", "rank-2-high", "rank-2-low"]
  );
});

test("global ranking uses stored draw when group rank and avg PD are tied", async () => {
  const ranking = await resolveRankingForTest([
      makeEntry({ teamId: "team-a", groupRank: 1, avgPD: 4.5 }),
      makeEntry({ teamId: "team-b", groupRank: 1, avgPD: 4.5 }),
    ], {
    getFallbackOrder: async () => ["team-b", "team-a"],
  });

  assert.deepEqual(
    ranking.map((entry) => entry.teamId),
    ["team-b", "team-a"]
  );
  assert.deepEqual(
    ranking.map((entry) => entry.globalRank),
    [1, 2]
  );
});

test("global ranking can use a manual override before random draw", async () => {
  let source: string | null = null;

  const ranking = await resolveGlobalRanking({
    entries: [
      makeEntry({ teamId: "team-a", groupRank: 1, avgPD: 4.5 }),
      makeEntry({ teamId: "team-b", groupRank: 1, avgPD: 4.5 }),
    ],
    buildTieKey: (tieGroup) => tieGroup.map((entry) => entry.teamId).sort().join(","),
    getFallbackOrder: async () => ({
      orderedTeamIds: ["team-b", "team-a"],
      source: "manual",
    }),
    onFallbackResolved: (tie) => {
      source = tie.source;
    },
  });

  assert.deepEqual(
    ranking.map((entry) => entry.teamId),
    ["team-b", "team-a"]
  );
  assert.equal(source, "manual");
});
