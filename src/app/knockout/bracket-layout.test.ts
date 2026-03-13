import assert from "node:assert/strict";
import test from "node:test";
type LayoutModule = typeof import("./bracket-layout");

const {
  buildProtectedSeriesAFirstRound,
  buildProtectedSeriesBFourTeamAwaySlots,
  buildSecondChanceHomeAssignments,
} = (await eval('import("./bracket-layout.ts")')) as LayoutModule;

test("8-team Series A uses the protected quarterfinal layout", () => {
  const matches = buildProtectedSeriesAFirstRound(
    ["#1", "#2", "#3", "#4", "#5", "#6", "#7", "#8"],
    2
  );

  assert.deepEqual(matches, [
    { round: 2, matchNo: 1, homeTeamId: "#1", awayTeamId: "#8" },
    { round: 2, matchNo: 2, homeTeamId: "#4", awayTeamId: "#5" },
    { round: 2, matchNo: 3, homeTeamId: "#2", awayTeamId: "#7" },
    { round: 2, matchNo: 4, homeTeamId: "#3", awayTeamId: "#6" },
  ]);
});

test("4-team Series A keeps the seeded semifinal layout", () => {
  const matches = buildProtectedSeriesAFirstRound(["#1", "#2", "#3", "#4"], 3);

  assert.deepEqual(matches, [
    { round: 3, matchNo: 1, homeTeamId: "#1", awayTeamId: "#4" },
    { round: 3, matchNo: 2, homeTeamId: "#2", awayTeamId: "#3" },
  ]);
});

test("4-team Series B waiting slots keep #9 and #10 on opposite halves", () => {
  const slots = buildProtectedSeriesBFourTeamAwaySlots([
    "#9",
    "#10",
    "#11",
    "#12",
  ]);

  assert.deepEqual(slots, [
    { matchNo: 1, awayTeamId: "#9" },
    { matchNo: 2, awayTeamId: "#12" },
    { matchNo: 3, awayTeamId: "#10" },
    { matchNo: 4, awayTeamId: "#11" },
  ]);
});

test("second-chance loser remap uses seed strength instead of AQF index", () => {
  const assignments = buildSecondChanceHomeAssignments([
    "best",
    "second",
    "third",
    "weakest",
  ]);
  const assignmentByMatchNo = new Map(
    assignments.map((assignment) => [assignment.matchNo, assignment.homeTeamId])
  );

  assert.deepEqual(assignments, [
    { matchNo: 2, homeTeamId: "best" },
    { matchNo: 4, homeTeamId: "second" },
    { matchNo: 3, homeTeamId: "third" },
    { matchNo: 1, homeTeamId: "weakest" },
  ]);
  assert.deepEqual(
    [1, 2, 3, 4].map((matchNo) => assignmentByMatchNo.get(matchNo) ?? null),
    ["weakest", "best", "third", "second"]
  );
});
