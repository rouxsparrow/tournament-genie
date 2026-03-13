import assert from "node:assert/strict";
import test from "node:test";
import { sortSeriesBRankingEntries } from "./series-b-ranking";

test("series B fallback ordering uses avg PD descending within the same group rank", () => {
  const sorted = sortSeriesBRankingEntries(
    [
      { teamId: "team-low", groupRank: 1, avgPD: 2, groupId: "G1" },
      { teamId: "team-high", groupRank: 1, avgPD: 8, groupId: "G2" },
      { teamId: "team-mid", groupRank: 1, avgPD: 5, groupId: "G3" },
      { teamId: "team-rank-2", groupRank: 2, avgPD: 20, groupId: "G4" },
    ],
    new Map()
  );

  assert.deepEqual(
    sorted.map((entry) => entry.teamId),
    ["team-high", "team-mid", "team-low", "team-rank-2"]
  );
});
