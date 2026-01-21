type SeriesBRankingEntry = {
  teamId: string;
  groupRank: number;
  avgPA: number;
  groupId: string;
};

type SeriesBPlayInMatch = {
  round: 1;
  matchNo: number;
  homeTeamId: string | null;
  awayTeamId: string | null;
};

type SeriesBBaseSeed =
  | { teamId: string; playInMatchNo?: undefined }
  | { teamId?: undefined; playInMatchNo: number };

type SeriesBQFMatch = {
  round: 2;
  matchNo: number;
  homeTeamId: null;
  awayTeamId: string | null;
};

type SeriesBSecondChanceResult = {
  playInMatches: SeriesBPlayInMatch[];
  baseQFSeeds: SeriesBBaseSeed[];
  bqfMatches: SeriesBQFMatch[];
  playInTargets: { matchNo: number; nextRound: number; nextMatchNo: number; nextSlot: number }[];
};

function devWarn(message: string) {
  if (process.env.NODE_ENV !== "production") {
    console.warn(message);
  }
}

export function buildSeriesBWithSecondChance(
  teamsB: SeriesBRankingEntry[],
  rankingMap: Map<string, number>,
  secondChanceEnabled: boolean
): SeriesBSecondChanceResult | null {
  if (!secondChanceEnabled) return null;

  const ranked = [...teamsB].sort((a, b) => {
    const rankA = rankingMap.get(a.teamId) ?? Number.MAX_SAFE_INTEGER;
    const rankB = rankingMap.get(b.teamId) ?? Number.MAX_SAFE_INTEGER;
    if (rankA !== rankB) return rankA - rankB;
    if (a.groupRank !== b.groupRank) return a.groupRank - b.groupRank;
    if (a.avgPA !== b.avgPA) return a.avgPA - b.avgPA;
    return a.teamId.localeCompare(b.teamId);
  });

  const teamCount = ranked.length;
  if (teamCount < 4 || teamCount > 8) {
    throw new Error(
      `Series B second chance requires 4-8 teams, received ${teamCount}.`
    );
  }

  const autoAdvanceCount = Math.max(0, 8 - teamCount);
  const autoAdvance = ranked.slice(0, autoAdvanceCount);
  const playInTeams = ranked.slice(autoAdvanceCount);

  const playInMatches: SeriesBPlayInMatch[] = [];
  let left = 0;
  let right = playInTeams.length - 1;
  let matchNo = 1;
  while (left < right) {
    playInMatches.push({
      round: 1,
      matchNo,
      homeTeamId: playInTeams[left]?.teamId ?? null,
      awayTeamId: playInTeams[right]?.teamId ?? null,
    });
    left += 1;
    right -= 1;
    matchNo += 1;
  }

  const baseQFSeeds: SeriesBBaseSeed[] = [
    ...autoAdvance.map((entry) => ({ teamId: entry.teamId })),
    ...playInMatches.map((match) => ({ playInMatchNo: match.matchNo })),
  ];

  if (baseQFSeeds.length !== 4) {
    devWarn(
      `Series B base QF seeds expected 4, received ${baseQFSeeds.length}.`
    );
  }

  const bqfMatches: SeriesBQFMatch[] = [];
  for (let index = 0; index < 4; index += 1) {
    const seed = baseQFSeeds[index];
    bqfMatches.push({
      round: 2,
      matchNo: index + 1,
      homeTeamId: null,
      awayTeamId: seed && "teamId" in seed && seed.teamId ? seed.teamId : null,
    });
  }

  if (bqfMatches.length !== 4) {
    devWarn(
      `Series B QF matches expected 4, received ${bqfMatches.length}.`
    );
  }
  if (bqfMatches.some((match) => match.homeTeamId)) {
    devWarn("Series B QF home slots should remain empty for A-drop losers.");
  }

  const playInTargets = baseQFSeeds.flatMap((seed, index) => {
    if (!("playInMatchNo" in seed) || typeof seed.playInMatchNo !== "number") {
      return [];
    }
    return [
      {
        matchNo: seed.playInMatchNo,
        nextRound: 2,
        nextMatchNo: index + 1,
        nextSlot: 2,
      },
    ];
  });

  return { playInMatches, baseQFSeeds, bqfMatches, playInTargets };
}

export function runSeriesBSecondChanceDevTest() {
  const sizes = [8, 7, 6, 5, 4];
  const results: string[] = [];

  sizes.forEach((size) => {
    const teams = Array.from({ length: size }, (_, index) => ({
      teamId: `XD${size}-${index + 1}`,
      groupRank: Math.floor(index / 2) + 1,
      avgPA: index + 1,
      groupId: `G${Math.floor(index / 2) + 1}`,
    }));
    const rankingMap = new Map(
      teams.map((team, index) => [team.teamId, index])
    );

    const built = buildSeriesBWithSecondChance(teams, rankingMap, true);
    if (!built) throw new Error(`Expected build result for size ${size}.`);

    const expectedPlayIns = size - 4;
    if (built.playInMatches.length !== expectedPlayIns) {
      throw new Error(
        `Size ${size}: expected ${expectedPlayIns} play-ins, got ${built.playInMatches.length}.`
      );
    }
    if (built.baseQFSeeds.length !== 4) {
      throw new Error(
        `Size ${size}: expected 4 base QF seeds, got ${built.baseQFSeeds.length}.`
      );
    }
    if (built.bqfMatches.length !== 4) {
      throw new Error(
        `Size ${size}: expected 4 BQF matches, got ${built.bqfMatches.length}.`
      );
    }

    const bqfSlots = new Map<number, { home: string | null; away: string | null }>(
      built.bqfMatches.map((match) => [
        match.matchNo,
        { home: match.homeTeamId, away: match.awayTeamId },
      ])
    );

    built.playInMatches.forEach((match) => {
      const target = built.playInTargets.find(
        (target) => target.matchNo === match.matchNo
      );
      if (!target) return;
      const winner = match.homeTeamId ?? match.awayTeamId;
      const slot = bqfSlots.get(target.nextMatchNo);
      if (slot && target.nextSlot === 2) {
        slot.away = winner ?? null;
      }
    });

    for (let index = 0; index < 4; index += 1) {
      const slot = bqfSlots.get(index + 1);
      if (slot) slot.home = `AQF${index + 1}`;
    }

    results.push(`size ${size}: ok`);
  });

  return results;
}
