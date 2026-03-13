import assert from "node:assert/strict";
import test from "node:test";
import { normalizeStandingsSummary } from "./standings-normalization";

test("normalizeStandingsSummary derives avg metrics for legacy rows", () => {
  const summary = normalizeStandingsSummary({
    categoryCode: "MD",
    groups: [
      {
        group: {
          id: "g1",
          name: "A",
          teamCount: 2,
        },
        standings: [
          {
            teamId: "t1",
            teamName: "Team 1",
            wins: 2,
            losses: 1,
            played: 3,
            pointsFor: 63,
            pointsAgainst: 45,
            pointDiff: 18,
          },
        ],
        completedCount: 3,
      },
    ],
  });

  assert.equal(summary.groups[0]?.standings[0]?.avgPointDiff, 6);
  assert.equal(summary.groups[0]?.standings[0]?.avgPointsFor, 21);
});
