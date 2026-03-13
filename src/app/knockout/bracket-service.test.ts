import assert from "node:assert/strict";
import test from "node:test";

type MatchCreateDataModule = typeof import("./match-create-data");

const { mapKnockoutMatchCreateData } = (await eval(
  'import("./match-create-data.ts")'
)) as MatchCreateDataModule;

test("create payload defaults only Final to best-of-3", () => {
  const rows = mapKnockoutMatchCreateData({
    categoryCode: "MD",
    series: "A",
    matches: [
      { round: 2, matchNo: 1, homeTeamId: "t1", awayTeamId: "t8" },
      { round: 4, matchNo: 1, homeTeamId: null, awayTeamId: null },
      { round: 4, matchNo: 2, homeTeamId: null, awayTeamId: null },
    ],
  });

  assert.equal(rows[0]?.isBestOf3, false);
  assert.equal(rows[1]?.isBestOf3, true);
  assert.equal(rows[2]?.isBestOf3, false);
});
