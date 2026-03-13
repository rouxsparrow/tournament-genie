import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGlobalRankingOverrideTieKey,
  buildGroupStandingOverrideTieKey,
  isValidTieOrder,
} from "./ranking-tie-override";

test("group standing override key changes when avg PF changes", () => {
  const first = buildGroupStandingOverrideTieKey({
    groupId: "group-a",
    teamIds: ["b", "a"],
    wins: 2,
    avgPointDiff: 3,
    avgPointsFor: 21,
  });
  const second = buildGroupStandingOverrideTieKey({
    groupId: "group-a",
    teamIds: ["a", "b"],
    wins: 2,
    avgPointDiff: 3,
    avgPointsFor: 20,
  });

  assert.notEqual(first, second);
});

test("global ranking override key changes when avg PD changes", () => {
  const first = buildGlobalRankingOverrideTieKey({
    categoryCode: "MD",
    teamIds: ["b", "a"],
    groupRank: 1,
    avgPD: 4,
  });
  const second = buildGlobalRankingOverrideTieKey({
    categoryCode: "MD",
    teamIds: ["a", "b"],
    groupRank: 1,
    avgPD: 5,
  });

  assert.notEqual(first, second);
});

test("isValidTieOrder requires an exact permutation", () => {
  assert.equal(isValidTieOrder(["a", "b"], ["b", "a"]), true);
  assert.equal(isValidTieOrder(["a", "b"], ["a", "a"]), false);
  assert.equal(isValidTieOrder(["a", "b"], ["a"]), false);
});
