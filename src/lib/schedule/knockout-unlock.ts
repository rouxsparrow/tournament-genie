export type KnockoutUnlockSourceMatch = {
  id: string;
  nextMatchId: string | null;
  status: "SCHEDULED" | "COMPLETED";
  winnerTeamId: string | null;
};

function isResolved(match: KnockoutUnlockSourceMatch) {
  return match.status === "COMPLETED" || Boolean(match.winnerTeamId);
}

export function buildKnockoutUnlockPotentialMap(matches: KnockoutUnlockSourceMatch[]) {
  const byNextMatch = new Map<string, KnockoutUnlockSourceMatch[]>();
  for (const match of matches) {
    if (!match.nextMatchId) continue;
    const bucket = byNextMatch.get(match.nextMatchId);
    if (bucket) {
      bucket.push(match);
    } else {
      byNextMatch.set(match.nextMatchId, [match]);
    }
  }

  const unlockPotentialMap = new Map<string, number>();
  for (const match of matches) {
    if (!match.nextMatchId) {
      unlockPotentialMap.set(match.id, 0);
      continue;
    }

    const feeders = byNextMatch.get(match.nextMatchId) ?? [];
    const siblingFeeders = feeders.filter((candidate) => candidate.id !== match.id);
    const siblingsResolved = siblingFeeders.every((candidate) => isResolved(candidate));
    unlockPotentialMap.set(match.id, siblingsResolved ? 2 : 1);
  }

  return unlockPotentialMap;
}
