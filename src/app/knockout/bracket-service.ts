import { prisma } from "@/lib/prisma";
import {
  buildSeedOrder,
  loadSeedInputs,
  loadGlobalGroupRanking,
  sortSeeds,
} from "@/app/knockout/logic";
import { buildSeriesBWithSecondChance } from "@/app/knockout/series-b-second-chance";
import { syncKnockoutPropagation } from "@/app/knockout/sync";

type CategoryCode = "MD" | "WD" | "XD";
type SeriesCode = "A" | "B";

type SeedEntry = {
  teamId: string;
  seedNo: number;
  groupId: string;
  groupRank: number;
  avgPA: number;
};

export class BracketError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function wireNextMatches(matches: { id: string; round: number; matchNo: number }[]) {
  const map = new Map(
    matches.map((match) => [`${match.round}-${match.matchNo}`, match.id])
  );
  const maxRound = Math.max(...matches.map((match) => match.round));

  return matches
    .filter((match) => match.round < maxRound)
    .map((match) => {
      const nextRound = match.round + 1;
      const nextMatchNo = Math.ceil(match.matchNo / 2);
      const nextSlot = match.matchNo % 2 === 1 ? 1 : 2;
      const nextMatchId = map.get(`${nextRound}-${nextMatchNo}`) ?? null;
      return { id: match.id, nextMatchId, nextSlot };
    });
}

function wireSeriesBPlayInMatches(params: {
  matches: { id: string; round: number; matchNo: number }[];
  playInTargets: { matchNo: number; nextRound: number; nextMatchNo: number; nextSlot: number }[];
}) {
  const map = new Map(
    params.matches.map((match) => [`${match.round}-${match.matchNo}`, match.id])
  );
  const updates: { id: string; nextMatchId: string | null; nextSlot: number | null }[] = [];

  for (const target of params.playInTargets) {
    const matchId = map.get(`1-${target.matchNo}`);
    const nextMatchId = map.get(`${target.nextRound}-${target.nextMatchNo}`) ?? null;
    if (matchId) {
      updates.push({ id: matchId, nextMatchId, nextSlot: target.nextSlot });
    }
  }

  const laterRounds = params.matches.filter((match) => match.round >= 2);
  const standardUpdates = wireNextMatches(laterRounds);
  updates.push(...standardUpdates);

  return updates;
}

async function chooseOpponentWithDraw(params: {
  categoryCode: CategoryCode;
  series: SeriesCode;
  round: number;
  high: SeedEntry;
  candidates: SeedEntry[];
}) {
  const bestTier = params.candidates[0]?.groupRank;
  if (bestTier === undefined) return null;
  const sameTierCandidates = params.candidates.filter(
    (candidate) => candidate.groupRank === bestTier
  );
  if (sameTierCandidates.length === 1) return sameTierCandidates[0];

  const maxAvgPA = Math.max(...sameTierCandidates.map((candidate) => candidate.avgPA));
  const weakestCandidates = sameTierCandidates.filter(
    (candidate) => candidate.avgPA === maxAvgPA
  );
  if (weakestCandidates.length === 1) {
    return weakestCandidates[0];
  }

  const candidateIds = weakestCandidates.map((candidate) => candidate.teamId);
  const candidateIdsSorted = [...candidateIds].sort();
  const drawKey = `${params.categoryCode}:${params.series}:${params.round}:${params.high.teamId}:${candidateIdsSorted.join(",")}`;

  const existing = await prisma.knockoutRandomDraw.findUnique({
    where: { drawKey },
  });

  if (existing && typeof existing.payload === "object" && existing.payload) {
    const payload = existing.payload as { chosenOpponentId?: string };
    const chosenId = payload.chosenOpponentId;
    const chosen = weakestCandidates.find((candidate) => candidate.teamId === chosenId);
    if (chosen) return chosen;
  }

  const chosen = weakestCandidates[Math.floor(Math.random() * weakestCandidates.length)];
  await prisma.knockoutRandomDraw.create({
    data: {
      categoryCode: params.categoryCode,
      series: params.series,
      round: params.round,
      drawKey,
      payload: {
        highTeamId: params.high.teamId,
        chosenOpponentId: chosen.teamId,
        candidateIds: candidateIdsSorted,
      },
    },
  });

  return chosen;
}

async function buildRoundOnePairs(params: {
  categoryCode: CategoryCode;
  series: SeriesCode;
  round: number;
  seeds: SeedEntry[];
}) {
  const unpaired = new Map(params.seeds.map((seed) => [seed.teamId, seed]));
  const ordered = params.seeds;
  const pairs: Array<{ home: SeedEntry; away: SeedEntry }> = [];

  for (const high of ordered) {
    if (!unpaired.has(high.teamId)) continue;
    const remaining = ordered
      .filter((seed) => seed.teamId !== high.teamId && unpaired.has(seed.teamId))
      .sort((a, b) => b.seedNo - a.seedNo);
    if (remaining.length === 0) break;
    const crossGroup = remaining.filter((seed) => seed.groupId !== high.groupId);
    const candidates = crossGroup.length > 0 ? crossGroup : remaining;
    const chosen = await chooseOpponentWithDraw({
      categoryCode: params.categoryCode,
      series: params.series,
      round: params.round,
      high,
      candidates,
    });
    if (!chosen) continue;
    pairs.push({ home: high, away: chosen });
    unpaired.delete(high.teamId);
    unpaired.delete(chosen.teamId);
  }

  return pairs;
}

function throwBracketError(code: string, message: string, status = 400): never {
  throw new BracketError(code, message, status);
}

async function assertGroupStageLockedOrThrow(categoryCode: CategoryCode) {
  const lock = await prisma.groupStageLock.findUnique({
    where: { categoryCode },
  });
  if (!lock?.locked) {
    throwBracketError(
      "GROUP_STAGE_UNLOCKED",
      "Group stage must be locked before generating series or brackets."
    );
  }
}

export async function generateKnockoutBracketInternal(params: {
  categoryCode: CategoryCode;
  series: SeriesCode;
}) {
  const { categoryCode, series } = params;

  await assertGroupStageLockedOrThrow(categoryCode);

  const existing = await prisma.knockoutMatch.findFirst({
    where: { categoryCode, series },
    select: { id: true },
  });
  if (existing) {
    throwBracketError(
      "BRACKET_EXISTS",
      `Bracket already exists for ${categoryCode} Series ${series}.`,
      409
    );
  }

  const qualifierCount = await prisma.seriesQualifier.count({
    where: { categoryCode, series },
  });

  if (qualifierCount === 0) {
    throwBracketError("MISSING_SERIES_SPLIT", "Compute series split first.");
  }

  let qualifiedTeamIds: Set<string> | null = null;
  let orderedTeamIds: string[] = [];
  let orderedSeedEntries: SeedEntry[] = [];

  if (series === "A") {
    const globalRanking = await loadGlobalGroupRanking(categoryCode);
    const isWD = categoryCode === "WD";
    const seriesATeamCount = isWD ? (globalRanking.length >= 8 ? 8 : 4) : 8;
    const topSeriesA = globalRanking.slice(0, seriesATeamCount);
    if (topSeriesA.length !== seriesATeamCount) {
      throwBracketError(
        "SERIES_A_TEAM_COUNT",
        isWD
          ? "Series A requires at least 4 teams for Women's Doubles. Recompute series split."
          : "Series A must have exactly 8 qualified teams. Recompute series split."
      );
    }

    const qualifiers = await prisma.seriesQualifier.findMany({
      where: { categoryCode, series },
      select: { teamId: true },
      orderBy: { teamId: "asc" },
    });
    const qualifierIds = new Set(qualifiers.map((qualifier) => qualifier.teamId));
    const topSeriesAIds = new Set(topSeriesA.map((entry) => entry.teamId));
    const mismatch = topSeriesA.some((entry) => !qualifierIds.has(entry.teamId));
    if (qualifiers.length !== seriesATeamCount || mismatch) {
      throwBracketError(
        "SERIES_A_MISMATCH",
        isWD
          ? "Recompute Series Split (Series A = top 4/8 global ranking)."
          : "Recompute Series Split (Series A = top 8 global ranking)."
      );
    }

    qualifiedTeamIds = topSeriesAIds;
    orderedTeamIds = topSeriesA.map((entry) => entry.teamId);
    orderedSeedEntries = topSeriesA.map((entry, index) => ({
      teamId: entry.teamId,
      seedNo: index + 1,
      groupId: entry.groupId,
      groupRank: entry.groupRank,
      avgPA: entry.avgPA,
    }));
  } else {
    if (categoryCode === "WD") {
      throwBracketError(
        "SERIES_B_NOT_AVAILABLE",
        "Series B is not available for Women's Doubles."
      );
    }
    const seeds = await loadSeedInputs(categoryCode, series);
    const orderedSeeds = sortSeeds(seeds);
    orderedTeamIds = orderedSeeds.map((seed) => seed.teamId);
    orderedSeedEntries = orderedSeeds.map((seed, index) => ({
      teamId: seed.teamId,
      seedNo: index + 1,
      groupId: seed.groupId,
      groupRank: seed.groupRank,
      avgPA: seed.avgPA,
    }));
  }

  if (qualifiedTeamIds) {
    const invalidSeed = orderedTeamIds.find((teamId) => !qualifiedTeamIds?.has(teamId));
    if (invalidSeed) {
      throwBracketError(
        "SEED_NON_QUALIFIED",
        "Series A seeds include a non-qualified team. Recompute series split."
      );
    }
  }

  const categoryConfig = await prisma.categoryConfig.findUnique({
    where: { categoryCode },
  });

  const useSecondChance =
    categoryCode === "WD" ? false : categoryConfig?.secondChanceEnabled ?? false;

  let baseMatches: {
    round: number;
    matchNo: number;
    homeTeamId: string | null;
    awayTeamId: string | null;
  }[];
  let playInTargets: {
    matchNo: number;
    nextRound: number;
    nextMatchNo: number;
    nextSlot: number;
  }[] = [];

  if (useSecondChance && series === "B") {
    const seriesBSeeds = orderedSeedEntries;
    const globalRanking = await loadGlobalGroupRanking(categoryCode);
    const rankingMap = new Map(
      globalRanking.map((entry, index) => [entry.teamId, index])
    );
    const rankedB = seriesBSeeds.map((seed) => ({
      teamId: seed.teamId,
      groupRank: seed.groupRank,
      avgPA: seed.avgPA,
      groupId: seed.groupId,
    }));

    let seriesB = null;
    try {
      seriesB = buildSeriesBWithSecondChance(rankedB, rankingMap, true);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Series B second chance bracket could not be built.";
      throwBracketError("SERIES_B_SECOND_CHANCE", message);
    }
    if (!seriesB) {
      throwBracketError(
        "SERIES_B_SECOND_CHANCE",
        "Series B second chance bracket could not be built."
      );
    }

    baseMatches = [];
    baseMatches.push(...seriesB.playInMatches);
    baseMatches.push(...seriesB.bqfMatches);

    playInTargets = seriesB.playInTargets;

    for (let matchNo = 1; matchNo <= 2; matchNo += 1) {
      baseMatches.push({ round: 3, matchNo, homeTeamId: null, awayTeamId: null });
    }
    baseMatches.push({ round: 4, matchNo: 1, homeTeamId: null, awayTeamId: null });
  } else if (series === "B") {
    const teamCount = orderedSeedEntries.length;
    const isPowerOfTwo = (teamCount & (teamCount - 1)) === 0;
    if (!isPowerOfTwo) {
      throwBracketError(
        "SERIES_B_NEEDS_SECOND_CHANCE",
        "Series B requires Second Chance to run play-ins. Enable Second Chance or adjust team count."
      );
    }

    baseMatches = [];
    const startRound = 2;
    const topSeeds = orderedSeedEntries;

    const seedSlots = buildSeedOrder(teamCount).map((seed, index) => ({
      seedNo: seed,
      matchNo: Math.floor(index / 2) + 1,
      slot: (index % 2 === 0 ? 1 : 2) as 1 | 2,
      teamId: null as string | null,
    }));

    topSeeds.forEach((seed, index) => {
      const seedNo = index + 1;
      const slot = seedSlots.find((entry) => entry.seedNo === seedNo);
      if (slot) slot.teamId = seed.teamId;
    });

    const rounds = Math.log2(teamCount);
    for (let roundOffset = 0; roundOffset < rounds; roundOffset += 1) {
      const round = startRound + roundOffset;
      const matchCount = teamCount / Math.pow(2, roundOffset + 1);
      for (let matchNo = 1; matchNo <= matchCount; matchNo += 1) {
        if (roundOffset === 0) {
          const homeTeamId =
            seedSlots.find((slot) => slot.matchNo === matchNo && slot.slot === 1)?.teamId ??
            null;
          const awayTeamId =
            seedSlots.find((slot) => slot.matchNo === matchNo && slot.slot === 2)?.teamId ??
            null;
          baseMatches.push({ round, matchNo, homeTeamId, awayTeamId });
        } else {
          baseMatches.push({ round, matchNo, homeTeamId: null, awayTeamId: null });
        }
      }
    }
  } else {
    const teamCount = orderedSeedEntries.length;
    const isPowerOfTwo = (teamCount & (teamCount - 1)) === 0;
    if (!isPowerOfTwo) {
      throwBracketError(
        "SERIES_A_TEAM_COUNT",
        "Series A must have 4 or 8 teams. Recompute series split."
      );
    }
    if (isPowerOfTwo) {
      const startRound = categoryCode === "WD" && teamCount === 4 ? 3 : 2;
      const pairs = await buildRoundOnePairs({
        categoryCode,
        series,
        round: startRound,
        seeds: orderedSeedEntries,
      });
      baseMatches = pairs.map((pair, index) => ({
        round: startRound,
        matchNo: index + 1,
        homeTeamId: pair.home.teamId,
        awayTeamId: pair.away.teamId,
      }));
      const rounds = Math.log2(teamCount);
      for (let roundOffset = 1; roundOffset < rounds; roundOffset += 1) {
        const round = startRound + roundOffset;
        const matchCount = teamCount / Math.pow(2, roundOffset + 1);
        for (let matchNo = 1; matchNo <= matchCount; matchNo += 1) {
          baseMatches.push({ round, matchNo, homeTeamId: null, awayTeamId: null });
        }
      }
    }
  }

  if (qualifiedTeamIds) {
    const allMatchTeams = baseMatches.flatMap((match) =>
      [match.homeTeamId, match.awayTeamId].filter(
        (teamId): teamId is string => Boolean(teamId)
      )
    );
    const invalidMatchTeam = allMatchTeams.find(
      (teamId) => !qualifiedTeamIds?.has(teamId)
    );
    if (invalidMatchTeam) {
      throwBracketError(
        "SERIES_A_NON_QUALIFIED",
        categoryCode === "WD"
          ? "Series A bracket contains non-qualified teams. Recompute series split."
          : "Series A bracket contains non-qualified teams. Recompute series split."
      );
    }
  }

  if (series === "A" && baseMatches.some((match) => match.round === 1)) {
    console.error(
      "[knockout][error] Attempted to create Series A Play-in match (round=1). This is invalid."
    );
    throwBracketError(
      "SERIES_A_PLAYIN_INVALID",
      "Series A Play-in match creation is invalid. Clear and regenerate brackets."
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.knockoutMatch.deleteMany({
      where: { categoryCode, series },
    });
    await tx.knockoutSeed.deleteMany({
      where: { categoryCode, series },
    });

    await tx.knockoutMatch.createMany({
      data: baseMatches.map((match) => ({
        categoryCode,
        series,
        round: match.round,
        matchNo: match.matchNo,
        homeTeamId: match.homeTeamId,
        awayTeamId: match.awayTeamId,
        isPublished: false,
      })),
    });

    if (orderedTeamIds.length > 0) {
      await tx.knockoutSeed.createMany({
        data: orderedTeamIds.map((teamId, index) => ({
          categoryCode,
          series,
          teamId,
          seedNo: index + 1,
        })),
      });
    }

    const created = await tx.knockoutMatch.findMany({
      where: { categoryCode, series },
      select: { id: true, round: true, matchNo: true },
    });

    const updates =
      useSecondChance && series === "B"
        ? wireSeriesBPlayInMatches({
            matches: created,
            playInTargets,
          })
        : playInTargets.length > 0
          ? wireSeriesBPlayInMatches({
              matches: created,
              playInTargets,
            })
          : wireNextMatches(created);
    for (const update of updates) {
      await tx.knockoutMatch.update({
        where: { id: update.id },
        data: {
          nextMatchId: update.nextMatchId,
          nextSlot: update.nextSlot,
        },
      });
    }
  });

  await syncKnockoutPropagation(categoryCode);

  return { ok: true };
}
