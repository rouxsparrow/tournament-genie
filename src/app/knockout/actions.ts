"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import {
  buildSeedOrder,
  loadSeedInputs,
  loadGlobalGroupRanking,
  nextPowerOfTwo,
  sortSeeds,
} from "@/app/knockout/logic";
import { buildSeriesBWithSecondChance } from "@/app/knockout/series-b-second-chance";
import { syncKnockoutPropagation } from "@/app/knockout/sync";

const categorySchema = z.enum(["MD", "WD", "XD"], {
  required_error: "Category is required.",
  invalid_type_error: "Category is invalid.",
});

const seriesSchema = z.enum(["A", "B"], {
  required_error: "Series is required.",
  invalid_type_error: "Series is invalid.",
});

async function assertGroupStageLocked(categoryCode: "MD" | "WD" | "XD") {
  const lock = await prisma.groupStageLock.findUnique({
    where: { categoryCode },
  });
  if (!lock?.locked) {
    redirect(
      `/knockout?category=${categoryCode}&error=${encodeURIComponent(
        "Group stage must be locked before generating series or brackets."
      )}`
    );
  }
}

export async function computeSeriesQualifiers(formData: FormData) {
  const parsed = categorySchema.safeParse(formData.get("category"));
  if (!parsed.success) {
    redirect(`/knockout?error=${encodeURIComponent("Invalid category.")}`);
  }

  const categoryCode = parsed.data;
  await assertGroupStageLocked(categoryCode);

  const category = await prisma.category.findUnique({
    where: { code: categoryCode },
  });

  if (!category) {
    redirect(`/knockout?category=${categoryCode}&error=${encodeURIComponent("Category not found.")}`);
  }

  const globalRanking = await loadGlobalGroupRanking(categoryCode);
  if (globalRanking.length === 0) {
    redirect(`/knockout?category=${categoryCode}&error=${encodeURIComponent("No groups found.")}`);
  }
  const isWD = categoryCode === "WD";
  const minSeriesATeams = isWD ? 4 : 8;
  if (globalRanking.length < minSeriesATeams) {
    redirect(
      `/knockout?category=${categoryCode}&error=${encodeURIComponent(
        isWD
          ? "Series A requires at least 4 teams for Women's Doubles."
          : "Series A must have exactly 8 qualified teams. Add more teams or recompute series split."
      )}`
    );
  }

  const seriesATeamCount = isWD
    ? globalRanking.length >= 8
      ? 8
      : 4
    : 8;

  const qualifiers: {
    categoryCode: "MD" | "WD" | "XD";
    series: "A" | "B";
    groupId: string;
    teamId: string;
    groupRank: number;
  }[] = globalRanking.map((entry) => ({
    categoryCode,
    series: entry.globalRank <= seriesATeamCount ? "A" : "B",
    groupId: entry.groupId,
    teamId: entry.teamId,
    groupRank: entry.groupRank,
  }));

  await prisma.$transaction([
    prisma.seriesQualifier.deleteMany({ where: { categoryCode } }),
    prisma.seriesQualifier.createMany({
      data: isWD
        ? qualifiers.filter((entry) => entry.series === "A")
        : qualifiers,
    }),
  ]);

  revalidatePath("/knockout");
  redirect(`/knockout?category=${categoryCode}`);
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

type SeedEntry = {
  teamId: string;
  seedNo: number;
  groupId: string;
  groupRank: number;
  avgPA: number;
};

async function chooseOpponentWithDraw(params: {
  categoryCode: "MD" | "WD" | "XD";
  series: "A" | "B";
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
  categoryCode: "MD" | "WD" | "XD";
  series: "A" | "B";
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

export async function generateKnockoutBracket(formData: FormData) {
  // Round model update: clear/regenerate existing knockout matches to apply new round numbering.
  const categoryParsed = categorySchema.safeParse(formData.get("category"));
  const seriesParsed = seriesSchema.safeParse(formData.get("series"));

  if (!categoryParsed.success || !seriesParsed.success) {
    redirect(`/knockout?error=${encodeURIComponent("Invalid bracket request.")}`);
  }

  const categoryCode = categoryParsed.data;
  const series = seriesParsed.data;

  await assertGroupStageLocked(categoryCode);

  const qualifierCount = await prisma.seriesQualifier.count({
    where: { categoryCode, series },
  });

  if (qualifierCount === 0) {
    redirect(`/knockout?category=${categoryCode}&error=${encodeURIComponent("Compute series split first.")}`);
  }

  let qualifiedTeamIds: Set<string> | null = null;
  let orderedTeamIds: string[] = [];
  let orderedSeedEntries: SeedEntry[] = [];

  if (series === "A") {
    const globalRanking = await loadGlobalGroupRanking(categoryCode);
    const isWD = categoryCode === "WD";
    const seriesATeamCount = isWD
      ? globalRanking.length >= 8
        ? 8
        : 4
      : 8;
    const topSeriesA = globalRanking.slice(0, seriesATeamCount);
    if (topSeriesA.length !== seriesATeamCount) {
      redirect(
        `/knockout?category=${categoryCode}&error=${encodeURIComponent(
          isWD
            ? "Series A requires at least 4 teams for Women's Doubles. Recompute series split."
            : "Series A must have exactly 8 qualified teams. Recompute series split."
        )}`
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
      redirect(
        `/knockout?category=${categoryCode}&error=${encodeURIComponent(
          isWD
            ? "Recompute Series Split (Series A = top 4/8 global ranking)."
            : "Recompute Series Split (Series A = top 8 global ranking)."
        )}`
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
      redirect(
        `/knockout?category=${categoryCode}&error=${encodeURIComponent(
          "Series B is not available for Women's Doubles."
        )}`
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
      redirect(
        `/knockout?category=${categoryCode}&error=${encodeURIComponent(
          "Series A seeds include a non-qualified team. Recompute series split."
        )}`
      );
    }
  }

  const categoryConfig = await prisma.categoryConfig.findUnique({
    where: { categoryCode },
  });

  const useSecondChance =
    categoryCode === "WD" ? false : categoryConfig?.secondChanceEnabled ?? false;

  let baseMatches: { round: number; matchNo: number; homeTeamId: string | null; awayTeamId: string | null }[];
  let playInTargets: { matchNo: number; nextRound: number; nextMatchNo: number; nextSlot: number }[] = [];

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
      redirect(
        `/knockout?category=${categoryCode}&error=${encodeURIComponent(message)}`
      );
    }
    if (!seriesB) {
      redirect(
        `/knockout?category=${categoryCode}&error=${encodeURIComponent(
          "Series B second chance bracket could not be built."
        )}`
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
      redirect(
        `/knockout?category=${categoryCode}&error=${encodeURIComponent(
          "Series B requires Second Chance to run play-ins. Enable Second Chance or adjust team count."
        )}`
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
      redirect(
        `/knockout?category=${categoryCode}&error=${encodeURIComponent(
          "Series A must have 4 or 8 teams. Recompute series split."
        )}`
      );
    }
    if (isPowerOfTwo) {
      const startRound = 2;
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
      redirect(
        `/knockout?category=${categoryCode}&error=${encodeURIComponent(
          categoryCode === "WD"
            ? "Series A bracket contains non-qualified teams. Recompute series split."
            : "Series A bracket contains non-qualified teams. Recompute series split."
        )}`
      );
    }
  }

  if (series === "A" && baseMatches.some((match) => match.round === 1)) {
    console.error(
      "[knockout][error] Attempted to create Series A Play-in match (round=1). This is invalid."
    );
    throw new Error(
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

  revalidatePath("/knockout");
  redirect(`/knockout?category=${categoryCode}`);
}

export async function applySecondChanceDrop(formData: FormData) {
  const parsed = categorySchema.safeParse(formData.get("category"));
  if (!parsed.success) {
    redirect(`/knockout?error=${encodeURIComponent("Invalid category.")}`);
  }
  const categoryCode = parsed.data;
  if (categoryCode === "WD") {
    redirect(
      `/knockout?category=${categoryCode}&error=${encodeURIComponent(
        "Second chance is not available for Women's Doubles."
      )}`
    );
  }

  const config = await prisma.categoryConfig.findUnique({
    where: { categoryCode },
  });
  if (!config?.secondChanceEnabled) {
    redirect(`/knockout?category=${categoryCode}&error=${encodeURIComponent("Second chance is not enabled.")}`);
  }

  await assertGroupStageLocked(categoryCode);

  const roundOneMatches = await prisma.knockoutMatch.findMany({
    where: { categoryCode, series: "A", round: 2 },
    select: {
      id: true,
      status: true,
      winnerTeamId: true,
      homeTeamId: true,
      awayTeamId: true,
    },
    orderBy: { matchNo: "asc" },
  });

  if (roundOneMatches.length === 0) {
    redirect(`/knockout?category=${categoryCode}&error=${encodeURIComponent("Generate Series A bracket first.")}`);
  }

  if (roundOneMatches.some((match) => match.status !== "COMPLETED")) {
    redirect(`/knockout?category=${categoryCode}&error=${encodeURIComponent("Complete all Series A Quarterfinals first.")}`);
  }

  const losers: string[] = [];
  for (const match of roundOneMatches) {
    if (!match.winnerTeamId || !match.homeTeamId || !match.awayTeamId) continue;
    const loser = match.winnerTeamId === match.homeTeamId ? match.awayTeamId : match.homeTeamId;
    losers.push(loser);
  }

  const loserSeeds = await prisma.knockoutSeed.findMany({
    where: { categoryCode, series: "A", teamId: { in: losers } },
    orderBy: { seedNo: "asc" },
  });

  const orderedLosers = loserSeeds.map((seed) => seed.teamId);

  const qfMatches = await prisma.knockoutMatch.findMany({
    where: { categoryCode, series: "B", round: 2 },
    select: { id: true, matchNo: true },
    orderBy: { matchNo: "asc" },
  });

  const seriesASeeds = await prisma.knockoutSeed.findMany({
    where: { categoryCode, series: "A", teamId: { in: losers } },
    orderBy: { seedNo: "asc" },
  });

  if (seriesASeeds.length !== 4 || qfMatches.length !== 4) {
    redirect(
      `/knockout?category=${categoryCode}&error=${encodeURIComponent(
        "Series B Quarterfinals require 4 A-drop losers and 4 matches."
      )}`
    );
  }

  await prisma.$transaction(
    qfMatches.map((match, index) => {
      const aDrop = seriesASeeds[index];
      return prisma.knockoutMatch.update({
        where: { id: match.id },
        data: {
          homeTeamId: aDrop?.teamId ?? null,
        },
      });
    })
  );

  revalidatePath("/knockout");
  redirect(`/knockout?category=${categoryCode}`);
}

export async function toggleSecondChanceEnabled(formData: FormData) {
  const parsed = categorySchema.safeParse(formData.get("category"));
  if (!parsed.success) {
    redirect(`/knockout?error=${encodeURIComponent("Invalid category.")}`);
  }

  const categoryCode = parsed.data;
  if (categoryCode === "WD") {
    redirect(
      `/knockout?category=${categoryCode}&error=${encodeURIComponent(
        "Second chance is not available for Women's Doubles."
      )}`
    );
  }
  const enabled = formData.get("secondChanceEnabled") === "on";

  await prisma.categoryConfig.upsert({
    where: { categoryCode },
    create: { categoryCode, secondChanceEnabled: enabled },
    update: { secondChanceEnabled: enabled },
  });

  revalidatePath("/knockout");
  redirect(`/knockout?category=${categoryCode}`);
}
