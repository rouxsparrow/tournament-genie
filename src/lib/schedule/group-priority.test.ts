import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGroupRemainingLoadMap,
  buildUpcomingFromSortedQueue,
  computeGroupBottleneckForPlayers,
  sortQueueMatches,
  type QueuePriorityMatch,
} from "./group-priority";

function makeMatch(params: {
  matchId: string;
  matchType?: "GROUP" | "KNOCKOUT";
  restScore?: number;
  forcedRank?: number;
  isForced?: boolean;
  series?: "A" | "B";
  round?: number;
  matchNo?: number | null;
  bottleneckMaxLoad?: number;
  bottleneckSumLoad?: number;
  playerIds: string[];
}): QueuePriorityMatch {
  return {
    matchId: params.matchId,
    matchType: params.matchType ?? "GROUP",
    restScore: params.restScore ?? 0,
    forcedRank: params.forcedRank,
    isForced: params.isForced ?? false,
    series: params.series,
    round: params.round,
    matchNo: params.matchNo,
    bottleneckMaxLoad: params.bottleneckMaxLoad ?? 0,
    bottleneckSumLoad: params.bottleneckSumLoad ?? 0,
    teams: {
      playerIds: params.playerIds,
    },
  };
}

test("Group queue keeps strict rest priority", () => {
  const sorted = sortQueueMatches(
    [
      makeMatch({ matchId: "m-rest3", restScore: 3, playerIds: ["a", "b", "c", "d"] }),
      makeMatch({ matchId: "m-rest4", restScore: 4, playerIds: ["e", "f", "g", "h"] }),
    ],
    { stage: "GROUP", inPlayPlayerIds: new Set<string>() }
  );

  assert.equal(sorted[0].matchId, "m-rest4");
  assert.equal(sorted[1].matchId, "m-rest3");
});

test("Group queue prefers assignable-now inside same rest bucket", () => {
  const sorted = sortQueueMatches(
    [
      makeMatch({ matchId: "waiting", restScore: 4, playerIds: ["p1", "b", "c", "d"] }),
      makeMatch({ matchId: "assignable", restScore: 4, playerIds: ["e", "f", "g", "h"] }),
    ],
    { stage: "GROUP", inPlayPlayerIds: new Set<string>(["p1"]) }
  );

  assert.equal(sorted[0].matchId, "assignable");
  assert.equal(sorted[1].matchId, "waiting");
});

test("Group queue uses bottleneck max then sum as tie-break", () => {
  const byMax = sortQueueMatches(
    [
      makeMatch({
        matchId: "max-5",
        restScore: 4,
        bottleneckMaxLoad: 5,
        bottleneckSumLoad: 12,
        playerIds: ["a1", "a2", "a3", "a4"],
      }),
      makeMatch({
        matchId: "max-4",
        restScore: 4,
        bottleneckMaxLoad: 4,
        bottleneckSumLoad: 20,
        playerIds: ["b1", "b2", "b3", "b4"],
      }),
    ],
    { stage: "GROUP", inPlayPlayerIds: new Set<string>() }
  );
  assert.equal(byMax[0].matchId, "max-5");

  const bySum = sortQueueMatches(
    [
      makeMatch({
        matchId: "sum-11",
        restScore: 4,
        bottleneckMaxLoad: 5,
        bottleneckSumLoad: 11,
        playerIds: ["c1", "c2", "c3", "c4"],
      }),
      makeMatch({
        matchId: "sum-13",
        restScore: 4,
        bottleneckMaxLoad: 5,
        bottleneckSumLoad: 13,
        playerIds: ["d1", "d2", "d3", "d4"],
      }),
    ],
    { stage: "GROUP", inPlayPlayerIds: new Set<string>() }
  );
  assert.equal(bySum[0].matchId, "sum-13");
});

test("Group upcoming lookahead can beat greedy packing", () => {
  const queue = [
    makeMatch({ matchId: "m1", restScore: 4, playerIds: ["A", "B", "C", "D"] }),
    makeMatch({ matchId: "m2", restScore: 4, playerIds: ["A", "E", "F", "G"] }),
    makeMatch({ matchId: "m3", restScore: 4, playerIds: ["B", "H", "I", "J"] }),
    makeMatch({ matchId: "m4", restScore: 4, playerIds: ["K", "L", "M", "N"] }),
  ];

  const upcoming = buildUpcomingFromSortedQueue(queue, {
    stage: "GROUP",
    inPlayPlayerIds: new Set<string>(),
    limit: 3,
  });

  assert.equal(upcoming.length, 3);
  assert.deepEqual(
    upcoming.map((match) => match.matchId),
    ["m2", "m3", "m4"]
  );
});

test("Upcoming preserves force tier ordering", () => {
  const queue = [
    makeMatch({
      matchId: "forced-waiting",
      restScore: 4,
      isForced: true,
      forcedRank: 1,
      playerIds: ["p1", "f2", "f3", "f4"],
    }),
    makeMatch({
      matchId: "forced-assignable",
      restScore: 4,
      isForced: true,
      forcedRank: 2,
      playerIds: ["a1", "a2", "a3", "a4"],
    }),
    makeMatch({
      matchId: "normal-assignable",
      restScore: 4,
      isForced: false,
      playerIds: ["n1", "n2", "n3", "n4"],
    }),
  ];

  const upcoming = buildUpcomingFromSortedQueue(queue, {
    stage: "GROUP",
    inPlayPlayerIds: new Set<string>(["p1"]),
    limit: 3,
  });

  assert.deepEqual(
    upcoming.map((match) => match.matchId),
    ["forced-assignable", "forced-waiting", "normal-assignable"]
  );
});

test("KO sort stays progression-first (round tie-break) and ignores assignable-first rule", () => {
  const sorted = sortQueueMatches(
    [
      makeMatch({
        matchId: "ko-r2",
        matchType: "KNOCKOUT",
        restScore: 4,
        round: 2,
        series: "A",
        matchNo: 1,
        playerIds: ["x1", "x2", "x3", "x4"],
      }),
      makeMatch({
        matchId: "ko-r1-waiting",
        matchType: "KNOCKOUT",
        restScore: 4,
        round: 1,
        series: "A",
        matchNo: 1,
        playerIds: ["p1", "y2", "y3", "y4"],
      }),
    ],
    { stage: "KNOCKOUT", inPlayPlayerIds: new Set<string>(["p1"]) }
  );

  assert.equal(sorted[0].matchId, "ko-r1-waiting");
  assert.equal(sorted[1].matchId, "ko-r2");
});

test("Group remaining-load map and bottleneck metrics are computed correctly", () => {
  const loadMap = buildGroupRemainingLoadMap([
    {
      status: "SCHEDULED",
      homeTeamId: "h1",
      awayTeamId: "a1",
      playerIds: ["p1", "p2", "p3", "p4"],
    },
    {
      status: "SCHEDULED",
      homeTeamId: "h2",
      awayTeamId: "a2",
      playerIds: ["p1", "p5", "p6", "p7"],
    },
    {
      status: "COMPLETED",
      homeTeamId: "h3",
      awayTeamId: "a3",
      playerIds: ["p1", "p8", "p9", "p10"],
    },
  ]);

  const bottleneck = computeGroupBottleneckForPlayers(["p1", "p2", "p5", "p11"], loadMap);
  assert.equal(bottleneck.bottleneckMaxLoad, 2);
  assert.equal(bottleneck.bottleneckSumLoad, 4);
});
