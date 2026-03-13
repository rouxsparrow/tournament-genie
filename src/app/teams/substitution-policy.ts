export type TeamEditCategoryCode = "MD" | "WD" | "XD";

export type TeamEditMatchState = {
  generatedGroupCount: number;
  generatedKnockoutCount: number;
  playedGroupCount: number;
  playedKnockoutCount: number;
};

export type TeamEditRestrictionInput = {
  currentCategoryCode: TeamEditCategoryCode;
  nextCategoryCode: TeamEditCategoryCode;
  currentPlayerIds: [string, string];
  nextPlayerIds: [string, string];
  matchState: TeamEditMatchState;
};

export function hasGeneratedMatches(state: TeamEditMatchState) {
  return state.generatedGroupCount + state.generatedKnockoutCount > 0;
}

export function hasPlayedMatches(state: TeamEditMatchState) {
  return state.playedGroupCount + state.playedKnockoutCount > 0;
}

export function evaluateTeamEditRestriction(input: TeamEditRestrictionInput): string | null {
  if (hasPlayedMatches(input.matchState)) {
    return "This team already has completed matches. Team members cannot be changed.";
  }

  if (!hasGeneratedMatches(input.matchState)) {
    return null;
  }

  if (input.nextCategoryCode !== input.currentCategoryCode) {
    return "Category cannot be changed after matches are generated for this team.";
  }

  const currentPlayerIds = new Set(input.currentPlayerIds);
  const retainedCount = input.nextPlayerIds.filter((playerId) =>
    currentPlayerIds.has(playerId)
  ).length;

  if (retainedCount !== 1) {
    return "Exactly one player must be replaced once matches are generated for this team.";
  }

  return null;
}
