import assert from "node:assert/strict";
import test from "node:test";
import { resolveGlobalRanking, type GlobalRankingEntry } from "./ranking";

function makeEntry(params: {
  teamId: string;
  groupRank: number;
  avgPD: number;
}): GlobalRankingEntry {
  return {
    teamId: params.teamId,
    teamName: params.teamId,
    groupId: `${params.teamId}-group`,
    groupName: `${params.teamId}-group`,
    groupRank: params.groupRank,
    avgPD: params.avgPD,
    played: 1,
  };
}

test("global ranking orders same group rank by avg PD descending", async () => {
  const ranking = await resolveGlobalRanking({
    entries: [
      makeEntry({ teamId: "rank-2-low", groupRank: 2, avgPD: 3 }),
      makeEntry({ teamId: "rank-1", groupRank: 1, avgPD: -2 }),
      makeEntry({ teamId: "rank-2-high", groupRank: 2, avgPD: 7 }),
    ],
    getRandomDrawOrder: async (tieKey, teamIds) => {
      throw new Error(`random draw should not run for ${tieKey}: ${teamIds.join(",")}`);
    },
  });

  assert.deepEqual(
    ranking.map((entry) => entry.teamId),
    ["rank-1", "rank-2-high", "rank-2-low"]
  );
});

test("global ranking uses stored draw when group rank and avg PD are tied", async () => {
  const ranking = await resolveGlobalRanking({
    entries: [
      makeEntry({ teamId: "team-a", groupRank: 1, avgPD: 4.5 }),
      makeEntry({ teamId: "team-b", groupRank: 1, avgPD: 4.5 }),
    ],
    getRandomDrawOrder: async () => ["team-b", "team-a"],
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
