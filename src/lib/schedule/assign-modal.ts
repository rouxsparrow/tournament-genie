type AssignModalMatchLike = {
  key: string;
  teams: {
    playerIds: string[];
  };
};

export type AssignModalSections<T extends AssignModalMatchLike> = {
  assignableUpcoming: T[];
  assignableQueueOverflow: T[];
  defaultSelectedKey: string;
};

function isAssignableNow(playerIds: string[], inPlayPlayerIds: Set<string>) {
  return !playerIds.some((playerId) => inPlayPlayerIds.has(playerId));
}

export function buildAssignModalSections<T extends AssignModalMatchLike>(params: {
  upcomingMatches: T[];
  queueMatches: T[];
  inPlayPlayerIds: Set<string>;
}): AssignModalSections<T> {
  const assignableUpcoming = params.upcomingMatches.filter((match) =>
    isAssignableNow(match.teams.playerIds, params.inPlayPlayerIds)
  );
  const seenKeys = new Set(assignableUpcoming.map((match) => match.key));
  const assignableQueueOverflow = params.queueMatches.filter((match) => {
    if (seenKeys.has(match.key)) return false;
    return isAssignableNow(match.teams.playerIds, params.inPlayPlayerIds);
  });
  const defaultSelectedKey =
    assignableUpcoming[0]?.key ?? assignableQueueOverflow[0]?.key ?? "";

  return {
    assignableUpcoming,
    assignableQueueOverflow,
    defaultSelectedKey,
  };
}
