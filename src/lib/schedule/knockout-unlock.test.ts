import assert from "node:assert/strict";
import test from "node:test";
import { buildKnockoutUnlockPotentialMap } from "./knockout-unlock";

test("unlockPotential is 2 when sibling feeder is resolved", () => {
  const map = buildKnockoutUnlockPotentialMap([
    {
      id: "sf1",
      nextMatchId: "final",
      status: "SCHEDULED",
      winnerTeamId: null,
    },
    {
      id: "sf2",
      nextMatchId: "final",
      status: "COMPLETED",
      winnerTeamId: "team-2",
    },
  ]);

  assert.equal(map.get("sf1"), 2);
  assert.equal(map.get("sf2"), 1);
});

test("unlockPotential is 1 when sibling feeder is unresolved", () => {
  const map = buildKnockoutUnlockPotentialMap([
    {
      id: "sf1",
      nextMatchId: "final",
      status: "SCHEDULED",
      winnerTeamId: null,
    },
    {
      id: "sf2",
      nextMatchId: "final",
      status: "SCHEDULED",
      winnerTeamId: null,
    },
  ]);

  assert.equal(map.get("sf1"), 1);
  assert.equal(map.get("sf2"), 1);
});

test("unlockPotential is 0 when match has no nextMatchId", () => {
  const map = buildKnockoutUnlockPotentialMap([
    {
      id: "final",
      nextMatchId: null,
      status: "SCHEDULED",
      winnerTeamId: null,
    },
  ]);

  assert.equal(map.get("final"), 0);
});
