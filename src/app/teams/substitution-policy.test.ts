import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateTeamEditRestriction,
  type TeamEditRestrictionInput,
} from "./substitution-policy";

function makeInput(overrides?: Partial<TeamEditRestrictionInput>): TeamEditRestrictionInput {
  return {
    currentCategoryCode: "MD",
    nextCategoryCode: "MD",
    currentPlayerIds: ["p1", "p2"],
    nextPlayerIds: ["p1", "p3"],
    matchState: {
      generatedGroupCount: 1,
      generatedKnockoutCount: 0,
      playedGroupCount: 0,
      playedKnockoutCount: 0,
    },
    ...overrides,
  };
}

test("rejects edit when a completed group match exists", () => {
  const error = evaluateTeamEditRestriction(
    makeInput({
      matchState: {
        generatedGroupCount: 1,
        generatedKnockoutCount: 0,
        playedGroupCount: 1,
        playedKnockoutCount: 0,
      },
    })
  );

  assert.equal(
    error,
    "This team already has completed matches. Team members cannot be changed."
  );
});

test("rejects edit when a completed knockout match exists", () => {
  const error = evaluateTeamEditRestriction(
    makeInput({
      matchState: {
        generatedGroupCount: 0,
        generatedKnockoutCount: 1,
        playedGroupCount: 0,
        playedKnockoutCount: 1,
      },
    })
  );

  assert.equal(
    error,
    "This team already has completed matches. Team members cannot be changed."
  );
});

test("allows one-member substitution when generated matches are unplayed", () => {
  const error = evaluateTeamEditRestriction(
    makeInput({
      matchState: {
        generatedGroupCount: 1,
        generatedKnockoutCount: 1,
        playedGroupCount: 0,
        playedKnockoutCount: 0,
      },
      nextPlayerIds: ["p2", "p3"],
    })
  );

  assert.equal(error, null);
});

test("rejects category change when matches are generated", () => {
  const error = evaluateTeamEditRestriction(
    makeInput({
      nextCategoryCode: "XD",
    })
  );

  assert.equal(error, "Category cannot be changed after matches are generated for this team.");
});

test("rejects replacing both players when matches are generated", () => {
  const error = evaluateTeamEditRestriction(
    makeInput({
      nextPlayerIds: ["p3", "p4"],
    })
  );

  assert.equal(
    error,
    "Exactly one player must be replaced once matches are generated for this team."
  );
});
