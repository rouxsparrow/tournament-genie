import assert from "node:assert/strict";
import test from "node:test";
import { buildAssignModalSections } from "./assign-modal";

type FakeMatch = {
  key: string;
  teams: {
    playerIds: string[];
  };
};

function makeMatch(key: string, playerIds: string[]): FakeMatch {
  return {
    key,
    teams: {
      playerIds,
    },
  };
}

test("assignable upcoming preserves upcoming order", () => {
  const sections = buildAssignModalSections({
    upcomingMatches: [
      makeMatch("u1", ["p1", "p2", "p3", "p4"]),
      makeMatch("u2", ["p5", "p6", "p7", "p8"]),
      makeMatch("u3", ["p9", "p10", "p11", "p12"]),
    ],
    queueMatches: [],
    inPlayPlayerIds: new Set<string>(),
  });

  assert.deepEqual(
    sections.assignableUpcoming.map((match) => match.key),
    ["u1", "u2", "u3"]
  );
});

test("queue overflow excludes matches already present in upcoming section", () => {
  const sections = buildAssignModalSections({
    upcomingMatches: [
      makeMatch("u1", ["p1", "p2", "p3", "p4"]),
      makeMatch("u2", ["p5", "p6", "p7", "p8"]),
    ],
    queueMatches: [
      makeMatch("u1", ["p1", "p2", "p3", "p4"]),
      makeMatch("q1", ["p9", "p10", "p11", "p12"]),
      makeMatch("u2", ["p5", "p6", "p7", "p8"]),
      makeMatch("q2", ["p13", "p14", "p15", "p16"]),
    ],
    inPlayPlayerIds: new Set<string>(),
  });

  assert.deepEqual(
    sections.assignableQueueOverflow.map((match) => match.key),
    ["q1", "q2"]
  );
});

test("waiting matches are excluded from both sections", () => {
  const sections = buildAssignModalSections({
    upcomingMatches: [
      makeMatch("u-waiting", ["p1", "p2", "p3", "p4"]),
      makeMatch("u-ok", ["p5", "p6", "p7", "p8"]),
    ],
    queueMatches: [
      makeMatch("q-waiting", ["p9", "p10", "p11", "p12"]),
      makeMatch("q-ok", ["p13", "p14", "p15", "p16"]),
    ],
    inPlayPlayerIds: new Set<string>(["p1", "p10"]),
  });

  assert.deepEqual(
    sections.assignableUpcoming.map((match) => match.key),
    ["u-ok"]
  );
  assert.deepEqual(
    sections.assignableQueueOverflow.map((match) => match.key),
    ["q-ok"]
  );
});

test("works correctly with upstream filtered inputs", () => {
  const sections = buildAssignModalSections({
    upcomingMatches: [
      makeMatch("md-u1", ["p1", "p2", "p3", "p4"]),
      makeMatch("md-u2", ["p5", "p6", "p7", "p8"]),
    ],
    queueMatches: [
      makeMatch("md-u1", ["p1", "p2", "p3", "p4"]),
      makeMatch("md-q1", ["p9", "p10", "p11", "p12"]),
      makeMatch("md-q2", ["p13", "p14", "p15", "p16"]),
    ],
    inPlayPlayerIds: new Set<string>(),
  });

  assert.deepEqual(
    sections.assignableUpcoming.map((match) => match.key),
    ["md-u1", "md-u2"]
  );
  assert.deepEqual(
    sections.assignableQueueOverflow.map((match) => match.key),
    ["md-q1", "md-q2"]
  );
});

test("default selected key prefers upcoming then queue overflow", () => {
  const fromUpcoming = buildAssignModalSections({
    upcomingMatches: [
      makeMatch("u1", ["p1", "p2", "p3", "p4"]),
      makeMatch("u2", ["p5", "p6", "p7", "p8"]),
    ],
    queueMatches: [makeMatch("q1", ["p9", "p10", "p11", "p12"])],
    inPlayPlayerIds: new Set<string>(),
  });
  assert.equal(fromUpcoming.defaultSelectedKey, "u1");

  const fromQueueOverflow = buildAssignModalSections({
    upcomingMatches: [makeMatch("u-waiting", ["p1", "p2", "p3", "p4"])],
    queueMatches: [makeMatch("q1", ["p5", "p6", "p7", "p8"])],
    inPlayPlayerIds: new Set<string>(["p1"]),
  });
  assert.equal(fromQueueOverflow.defaultSelectedKey, "q1");

  const empty = buildAssignModalSections({
    upcomingMatches: [makeMatch("u-waiting", ["p1", "p2", "p3", "p4"])],
    queueMatches: [makeMatch("q-waiting", ["p5", "p6", "p7", "p8"])],
    inPlayPlayerIds: new Set<string>(["p1", "p6"]),
  });
  assert.equal(empty.defaultSelectedKey, "");
});
