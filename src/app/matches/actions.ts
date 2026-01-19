"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { syncKnockoutPropagation } from "@/app/knockout/sync";

const categorySchema = z.enum(["MD", "WD", "XD"], {
  required_error: "Category is required.",
  invalid_type_error: "Category is invalid.",
});

const seriesFilterSchema = z.enum(["A", "B", "ALL"], {
  required_error: "Series is required.",
  invalid_type_error: "Series is invalid.",
});

const scoreSchema = z.object({
  matchId: z.string().min(1, "Match is required."),
  winnerTeamId: z.string().optional(),
  game1Home: z.number().int().nonnegative().optional(),
  game1Away: z.number().int().nonnegative().optional(),
  game2Home: z.number().int().nonnegative().optional(),
  game2Away: z.number().int().nonnegative().optional(),
  game3Home: z.number().int().nonnegative().optional(),
  game3Away: z.number().int().nonnegative().optional(),
});

function parseNumber(value: FormDataEntryValue | null) {
  if (value === null || value === "") return undefined;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function getScoringMode() {
  const settings = await prisma.tournamentSettings.findFirst({
    orderBy: { createdAt: "desc" },
  });
  return settings?.scoringMode ?? "SINGLE_GAME_21";
}

async function assertGroupStageUnlocked(categoryCode: "MD" | "WD" | "XD") {
  const lock = await prisma.groupStageLock.findUnique({
    where: { categoryCode },
  });
  if (lock?.locked) {
    redirect(
      `/matches?category=${categoryCode}&error=${encodeURIComponent(
        "Group stage is locked for this category."
      )}`
    );
  }
}

async function assertGroupAssignmentLocked(categoryCode: "MD" | "WD" | "XD") {
  const lock = await prisma.groupAssignmentLock.findUnique({
    where: { categoryCode },
  });
  if (!lock?.locked) {
    redirect(
      `/matches?category=${categoryCode}&error=${encodeURIComponent(
        "Group assignment must be locked before generating matches."
      )}`
    );
  }
}

type MatchesRedirectOptions = {
  view?: "group" | "knockout";
  groupId?: string;
  search?: string;
  error?: string;
};

function buildMatchesRedirect(
  categoryCode: "MD" | "WD" | "XD",
  options?: MatchesRedirectOptions
) {
  const params = new URLSearchParams();
  params.set("category", categoryCode);
  if (options?.view) params.set("view", options.view);
  if (options?.groupId) params.set("group", options.groupId);
  if (options?.search) params.set("search", options.search);
  if (options?.error) params.set("error", options.error);
  return `/matches?${params.toString()}`;
}

function readMatchFilterRedirectOptions(formData: FormData): MatchesRedirectOptions {
  const view = formData.get("filterView");
  const groupId = formData.get("filterGroupId");
  const search = formData.get("filterSearch");

  return {
    view: view === "group" || view === "knockout" ? view : "group",
    groupId: typeof groupId === "string" && groupId ? groupId : undefined,
    search: typeof search === "string" && search ? search : undefined,
  };
}

function parseSeriesFilter(value: FormDataEntryValue | null) {
  const parsed = seriesFilterSchema.safeParse(value);
  if (!parsed.success) return null;
  return parsed.data === "ALL" ? null : parsed.data;
}

function randomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomLoserScore() {
  return randomInt(5, 20);
}

function buildSingleGameScore(winner: "home" | "away") {
  const loserScore = randomLoserScore();
  return winner === "home"
    ? { homePoints: 21, awayPoints: loserScore }
    : { homePoints: loserScore, awayPoints: 21 };
}

function buildBestOfThreeScores(winner: "home" | "away") {
  const loserGames = Math.random() < 0.5 ? 0 : 1;
  const winnerGames = 2;
  const gamesNeeded = loserGames === 0 ? 2 : 3;
  const games: { homePoints: number; awayPoints: number }[] = [];

  for (let index = 0; index < gamesNeeded; index += 1) {
    const winnerIsHome =
      winner === "home"
        ? index < winnerGames
        : index >= loserGames;
    const score = buildSingleGameScore(winnerIsHome ? "home" : "away");
    games.push(score);
  }

  return games;
}

async function clearDownstreamSlot(
  tx: typeof prisma,
  matchId: string,
  clearedTeamId: string
) {
  const match = await tx.knockoutMatch.findUnique({
    where: { id: matchId },
  });
  if (!match?.nextMatchId || !match.nextSlot) return;

  const nextMatch = await tx.knockoutMatch.findUnique({
    where: { id: match.nextMatchId },
  });
  if (!nextMatch) return;

  const slotField = match.nextSlot == 1 ? "homeTeamId" : "awayTeamId";
  const currentSlot = nextMatch[slotField];
  if (currentSlot != clearedTeamId) return;

  const previousWinner = nextMatch.winnerTeamId;
  const updates: {
    homeTeamId?: string | null;
    awayTeamId?: string | null;
    winnerTeamId?: string | null;
    status?: "SCHEDULED";
  } = {
    [slotField]: null,
  };

  const shouldReset =
    previousWinner == clearedTeamId ||
    !nextMatch.homeTeamId ||
    !nextMatch.awayTeamId;
  if (shouldReset) {
    updates.winnerTeamId = null;
    updates.status = "SCHEDULED";
    await tx.knockoutGameScore.deleteMany({
      where: { knockoutMatchId: nextMatch.id },
    });
  }

  await tx.knockoutMatch.update({
    where: { id: nextMatch.id },
    data: updates,
  });

  if (shouldReset && previousWinner) {
    await clearDownstreamSlot(tx, nextMatch.id, previousWinner);
  }
}

async function applyWinnerToNextMatch(
  tx: typeof prisma,
  matchId: string,
  winnerTeamId: string
) {
  const match = await tx.knockoutMatch.findUnique({
    where: { id: matchId },
  });
  if (!match?.nextMatchId || !match.nextSlot) return;

  const nextMatch = await tx.knockoutMatch.findUnique({
    where: { id: match.nextMatchId },
  });
  if (!nextMatch) return;

  const slotField = match.nextSlot == 1 ? "homeTeamId" : "awayTeamId";
  const currentSlot = nextMatch[slotField];
  if (currentSlot == winnerTeamId) return;

  const previousWinner = nextMatch.winnerTeamId;
  const updates: {
    homeTeamId?: string | null;
    awayTeamId?: string | null;
    winnerTeamId?: string | null;
    status?: "SCHEDULED";
  } = {
    [slotField]: winnerTeamId,
  };

  if (currentSlot && currentSlot != winnerTeamId) {
    updates.winnerTeamId = null;
    updates.status = "SCHEDULED";
    await tx.knockoutGameScore.deleteMany({
      where: { knockoutMatchId: nextMatch.id },
    });
  }

  await tx.knockoutMatch.update({
    where: { id: nextMatch.id },
    data: updates,
  });

  if (currentSlot && currentSlot != winnerTeamId && previousWinner) {
    await clearDownstreamSlot(tx, nextMatch.id, previousWinner);
  }
}

async function applySecondChanceDrop(
  tx: typeof prisma,
  match: {
    id: string;
    categoryCode: "MD" | "WD" | "XD";
    series: "A" | "B";
    round: number;
    matchNo: number;
    winnerTeamId: string | null;
    homeTeamId: string | null;
    awayTeamId: string | null;
  },
  winnerTeamId: string
) {
  if (match.series !== "A" || match.categoryCode === "WD") return;

  const config = await tx.categoryConfig.findUnique({
    where: { categoryCode: match.categoryCode },
  });
  if (!config?.secondChanceEnabled) return;

  const maxRoundA = await tx.knockoutMatch.aggregate({
    where: { categoryCode: match.categoryCode, series: "A" },
    _max: { round: true },
  });
  const qfRoundA = maxRoundA._max.round ? maxRoundA._max.round - 2 : null;
  if (!qfRoundA || match.round !== qfRoundA) return;

  if (!match.homeTeamId || !match.awayTeamId) return;
  const loserTeamId =
    winnerTeamId === match.homeTeamId ? match.awayTeamId : match.homeTeamId;

  const seriesAQFs = await tx.knockoutMatch.findMany({
    where: {
      categoryCode: match.categoryCode,
      series: "A",
      round: qfRoundA,
    },
    select: { id: true },
    orderBy: { matchNo: "asc" },
  });
  const qfIndex = seriesAQFs.findIndex((entry) => entry.id === match.id);
  if (qfIndex < 0) return;

  const maxRoundB = await tx.knockoutMatch.aggregate({
    where: { categoryCode: match.categoryCode, series: "B" },
    _max: { round: true },
  });
  const qfRoundB = maxRoundB._max.round ? maxRoundB._max.round - 2 : null;
  if (!qfRoundB) return;

  const seriesBQFs = await tx.knockoutMatch.findMany({
    where: {
      categoryCode: match.categoryCode,
      series: "B",
      round: qfRoundB,
    },
    orderBy: { matchNo: "asc" },
  });
  const target = seriesBQFs[qfIndex];
  if (!target) return;

  const existingElsewhere = await tx.knockoutMatch.findFirst({
    where: {
      categoryCode: match.categoryCode,
      series: "B",
      round: qfRoundB,
      homeTeamId: loserTeamId,
      NOT: { id: target.id },
    },
    select: { id: true, matchNo: true },
  });
  if (existingElsewhere) {
    throw new Error(
      `Second chance conflict: loser already assigned to B QF${existingElsewhere.matchNo}.`
    );
  }

  if (target.homeTeamId && target.homeTeamId !== loserTeamId) {
    throw new Error(
      `Second chance slot already occupied for B QF${target.matchNo}.`
    );
  }

  if (target.homeTeamId === loserTeamId) return;

  const previousTeamId = target.homeTeamId;
  const previousWinner = target.winnerTeamId;
  const updates: {
    homeTeamId?: string | null;
    winnerTeamId?: string | null;
    status?: "SCHEDULED";
  } = { homeTeamId: loserTeamId };

  if (previousTeamId && previousTeamId !== loserTeamId) {
    updates.winnerTeamId = null;
    updates.status = "SCHEDULED";
    await tx.knockoutGameScore.deleteMany({
      where: { knockoutMatchId: target.id },
    });
  }

  await tx.knockoutMatch.update({
    where: { id: target.id },
    data: updates,
  });

  if (previousTeamId && previousTeamId !== loserTeamId && previousWinner) {
    await clearDownstreamSlot(tx, target.id, previousWinner);
  }
}

async function clearSecondChanceDrop(
  tx: typeof prisma,
  match: {
    id: string;
    categoryCode: "MD" | "WD" | "XD";
    series: "A" | "B";
    round: number;
    matchNo: number;
    winnerTeamId: string | null;
    homeTeamId: string | null;
    awayTeamId: string | null;
  }
) {
  if (match.series !== "A" || match.categoryCode === "WD") return;

  const config = await tx.categoryConfig.findUnique({
    where: { categoryCode: match.categoryCode },
  });
  if (!config?.secondChanceEnabled) return;

  const maxRoundA = await tx.knockoutMatch.aggregate({
    where: { categoryCode: match.categoryCode, series: "A" },
    _max: { round: true },
  });
  const qfRoundA = maxRoundA._max.round ? maxRoundA._max.round - 2 : null;
  if (!qfRoundA || match.round !== qfRoundA) return;

  if (!match.winnerTeamId || !match.homeTeamId || !match.awayTeamId) return;
  const loserTeamId =
    match.winnerTeamId === match.homeTeamId ? match.awayTeamId : match.homeTeamId;

  const seriesAQFs = await tx.knockoutMatch.findMany({
    where: {
      categoryCode: match.categoryCode,
      series: "A",
      round: qfRoundA,
    },
    select: { id: true },
    orderBy: { matchNo: "asc" },
  });
  const qfIndex = seriesAQFs.findIndex((entry) => entry.id === match.id);
  if (qfIndex < 0) return;

  const maxRoundB = await tx.knockoutMatch.aggregate({
    where: { categoryCode: match.categoryCode, series: "B" },
    _max: { round: true },
  });
  const qfRoundB = maxRoundB._max.round ? maxRoundB._max.round - 2 : null;
  if (!qfRoundB) return;

  const seriesBQFs = await tx.knockoutMatch.findMany({
    where: {
      categoryCode: match.categoryCode,
      series: "B",
      round: qfRoundB,
    },
    orderBy: { matchNo: "asc" },
  });
  const target = seriesBQFs[qfIndex];
  if (!target) return;

  if (target.homeTeamId !== loserTeamId) return;

  const previousWinner = target.winnerTeamId;
  const shouldReset =
    previousWinner === loserTeamId || !target.awayTeamId;

  if (shouldReset) {
    await tx.knockoutGameScore.deleteMany({
      where: { knockoutMatchId: target.id },
    });
  }

  await tx.knockoutMatch.update({
    where: { id: target.id },
    data: {
      homeTeamId: null,
      ...(shouldReset ? { winnerTeamId: null, status: "SCHEDULED" } : {}),
    },
  });

  if (shouldReset && previousWinner) {
    await clearDownstreamSlot(tx, target.id, previousWinner);
  }
}

export async function generateGroupStageMatches(formData: FormData) {
  const parsed = categorySchema.safeParse(formData.get("category"));
  if (!parsed.success) {
    redirect(`/matches?error=${encodeURIComponent("Invalid category.")}`);
  }

  const groupId = formData.get("groupId")?.toString() || "";
  const categoryCode = parsed.data;

  await assertGroupAssignmentLocked(categoryCode);

  const category = await prisma.category.findUnique({
    where: { code: categoryCode },
  });

  if (!category) {
    redirect(`/matches?category=${categoryCode}&error=${encodeURIComponent("Category not found.")}`);
  }

  const groups = await prisma.group.findMany({
    where: {
      categoryId: category.id,
      ...(groupId ? { id: groupId } : {}),
    },
    include: { teams: true },
    orderBy: { name: "asc" },
  });

  if (groups.length === 0) {
    redirect(`/matches?category=${categoryCode}&error=${encodeURIComponent("No groups found.")}`);
  }

  const groupIds = groups.map((group) => group.id);
  const existingMatches = await prisma.match.findMany({
    where: {
      stage: "GROUP",
      groupId: { in: groupIds },
    },
    select: {
      groupId: true,
      homeTeamId: true,
      awayTeamId: true,
    },
  });

  const existingKeys = new Set(
    existingMatches
      .filter((match) => match.groupId && match.homeTeamId && match.awayTeamId)
      .map((match) => {
        const sorted = [match.homeTeamId!, match.awayTeamId!].sort();
        return `${match.groupId}:${sorted[0]}:${sorted[1]}`;
      })
  );

  const toCreate: {
    stage: "GROUP";
    groupId: string;
    homeTeamId: string;
    awayTeamId: string;
    status: "SCHEDULED";
  }[] = [];

  for (const group of groups) {
    const teamIds = group.teams.map((entry) => entry.teamId).sort();
    if (teamIds.length < 2) continue;
    for (let i = 0; i < teamIds.length; i += 1) {
      for (let j = i + 1; j < teamIds.length; j += 1) {
        const homeTeamId = teamIds[i];
        const awayTeamId = teamIds[j];
        const key = `${group.id}:${homeTeamId}:${awayTeamId}`;
        if (existingKeys.has(key)) continue;
        existingKeys.add(key);
        toCreate.push({
          stage: "GROUP",
          groupId: group.id,
          homeTeamId,
          awayTeamId,
          status: "SCHEDULED",
        });
      }
    }
  }

  if (toCreate.length > 0) {
    await prisma.match.createMany({
      data: toCreate,
      skipDuplicates: true,
    });
  }

  revalidatePath("/matches");
  redirect(`/matches?category=${categoryCode}${groupId ? `&group=${groupId}` : ""}`);
}

export async function clearGroupStageMatches(formData: FormData) {
  const parsed = categorySchema.safeParse(formData.get("category"));
  if (!parsed.success) {
    redirect(`/matches?error=${encodeURIComponent("Invalid category.")}`);
  }

  const categoryCode = parsed.data;

  await assertGroupStageUnlocked(categoryCode);

  await prisma.match.deleteMany({
    where: {
      stage: "GROUP",
      group: { category: { code: categoryCode } },
    },
  });

  revalidatePath("/matches");
  revalidatePath("/standings");
  redirect(`/matches?category=${categoryCode}`);
}

export async function randomizeAllGroupMatchResults(formData: FormData) {
  // DEV ONLY -- do not enable in production
  if (process.env.NODE_ENV === "production") {
    redirect(`/matches?error=${encodeURIComponent("Not available in production.")}`);
  }

  const parsed = categorySchema.safeParse(formData.get("category"));
  if (!parsed.success) {
    redirect(`/matches?error=${encodeURIComponent("Invalid category.")}`);
  }
  const categoryCode = parsed.data;

  await assertGroupStageUnlocked(categoryCode);

  const scoringMode = await getScoringMode();

  const matches = await prisma.match.findMany({
    where: {
      stage: "GROUP",
      status: "SCHEDULED",
      group: { category: { code: categoryCode } },
    },
    include: {
      games: true,
    },
  });

  if (matches.length === 0) {
    revalidatePath("/matches");
    redirect(`/matches?category=${categoryCode}`);
  }

  await prisma.$transaction(
    matches.flatMap((match) => {
      if (match.games.length > 0) return [];
      const winner =
        Math.random() < 0.5 ? ("home" as const) : ("away" as const);
      const winnerTeamId =
        winner === "home" ? match.homeTeamId : match.awayTeamId;

      if (!match.homeTeamId || !match.awayTeamId || !winnerTeamId) {
        return [];
      }

      const games =
        scoringMode === "SINGLE_GAME_21"
          ? [buildSingleGameScore(winner)]
          : buildBestOfThreeScores(winner);

      return [
        prisma.gameScore.deleteMany({ where: { matchId: match.id } }),
        prisma.gameScore.createMany({
          data: games.map((game, index) => ({
            matchId: match.id,
            gameNumber: index + 1,
            homePoints: game.homePoints,
            awayPoints: game.awayPoints,
          })),
        }),
        prisma.match.update({
          where: { id: match.id },
          data: {
            status: "COMPLETED",
            winnerTeamId,
          },
        }),
      ];
    })
  );

  revalidatePath("/matches");
  revalidatePath("/standings");
  redirect(`/matches?category=${categoryCode}`);
}

export async function upsertMatchScore(formData: FormData) {
  const redirectOptions = readMatchFilterRedirectOptions(formData);
  const parsedCategory = categorySchema.safeParse(formData.get("category"));

  const parsed = scoreSchema.safeParse({
    matchId: formData.get("matchId"),
    winnerTeamId: formData.get("winnerTeamId")?.toString() || undefined,
    game1Home: parseNumber(formData.get("game1Home")),
    game1Away: parseNumber(formData.get("game1Away")),
    game2Home: parseNumber(formData.get("game2Home")),
    game2Away: parseNumber(formData.get("game2Away")),
    game3Home: parseNumber(formData.get("game3Home")),
    game3Away: parseNumber(formData.get("game3Away")),
  });

  if (!parsed.success) {
    if (parsedCategory.success) {
      redirect(
        buildMatchesRedirect(parsedCategory.data, {
          ...redirectOptions,
          error: parsed.error.issues[0]?.message ?? "Invalid score data.",
        })
      );
    }
    redirect(
      `/matches?error=${encodeURIComponent(
        parsed.error.issues[0]?.message ?? "Invalid score data."
      )}`
    );
  }

  const match = await prisma.match.findUnique({
    where: { id: parsed.data.matchId },
    include: {
      group: { include: { category: true } },
    },
  });

  if (!match || match.stage !== "GROUP" || !match.group) {
    redirect(`/matches?error=${encodeURIComponent("Match not found.")}`);
  }

  const successRedirect = buildMatchesRedirect(
    match.group.category.code,
    redirectOptions
  );

  await assertGroupStageUnlocked(match.group.category.code);

  if (!match.homeTeamId || !match.awayTeamId) {
    redirect(
      buildMatchesRedirect(match.group.category.code, {
        ...redirectOptions,
        error: "Match teams are not set.",
      })
    );
  }

  const scoringMode = await getScoringMode();

  const game1Home = parsed.data.game1Home;
  const game1Away = parsed.data.game1Away;
  if (game1Home === undefined || game1Away === undefined) {
    redirect(
      buildMatchesRedirect(match.group.category.code, {
        ...redirectOptions,
        error: "Game 1 scores are required.",
      })
    );
  }
  if (game1Home === game1Away) {
    redirect(
      buildMatchesRedirect(match.group.category.code, {
        ...redirectOptions,
        error: "Game 1 cannot be tied.",
      })
    );
  }

  const games: { gameNumber: number; homePoints: number; awayPoints: number }[] =
    [
      {
        gameNumber: 1,
        homePoints: game1Home,
        awayPoints: game1Away,
      },
    ];

  let winnerTeamId: string | null = null;

  if (scoringMode === "SINGLE_GAME_21") {
    winnerTeamId = game1Home > game1Away ? match.homeTeamId : match.awayTeamId;
  } else {
    const game2Home = parsed.data.game2Home;
    const game2Away = parsed.data.game2Away;
    if (game2Home === undefined || game2Away === undefined) {
      redirect(
        buildMatchesRedirect(match.group.category.code, {
          ...redirectOptions,
          error: "Game 2 scores are required.",
        })
      );
    }
    if (game2Home === game2Away) {
      redirect(
        buildMatchesRedirect(match.group.category.code, {
          ...redirectOptions,
          error: "Game 2 cannot be tied.",
        })
      );
    }

    games.push({
      gameNumber: 2,
      homePoints: game2Home,
      awayPoints: game2Away,
    });

    let homeWins = 0;
    let awayWins = 0;
    if (game1Home > game1Away) homeWins += 1;
    else awayWins += 1;
    if (game2Home > game2Away) homeWins += 1;
    else awayWins += 1;

    if (homeWins === 2) {
      winnerTeamId = match.homeTeamId;
    } else if (awayWins === 2) {
      winnerTeamId = match.awayTeamId;
    } else {
      const game3Home = parsed.data.game3Home;
      const game3Away = parsed.data.game3Away;
      if (game3Home === undefined || game3Away === undefined) {
        redirect(
          buildMatchesRedirect(match.group.category.code, {
            ...redirectOptions,
            error: "Game 3 scores are required.",
          })
        );
      }
      if (game3Home === game3Away) {
        redirect(
          buildMatchesRedirect(match.group.category.code, {
            ...redirectOptions,
            error: "Game 3 cannot be tied.",
          })
        );
      }
      games.push({
        gameNumber: 3,
        homePoints: game3Home,
        awayPoints: game3Away,
      });
      winnerTeamId = game3Home > game3Away ? match.homeTeamId : match.awayTeamId;
    }
  }

  await prisma.$transaction([
    prisma.gameScore.deleteMany({ where: { matchId: match.id } }),
    prisma.gameScore.createMany({
      data: games.map((game) => ({ matchId: match.id, ...game })),
    }),
    prisma.match.update({
      where: { id: match.id },
      data: {
        status: "COMPLETED",
        winnerTeamId,
      },
    }),
  ]);

  revalidatePath("/matches");
  redirect(successRedirect);
}

export async function undoMatchResult(formData: FormData) {
  const matchId = String(formData.get("matchId") ?? "");
  if (!matchId) {
    const redirectOptions = readMatchFilterRedirectOptions(formData);
    const parsedCategory = categorySchema.safeParse(formData.get("category"));
    if (parsedCategory.success) {
      redirect(
        buildMatchesRedirect(parsedCategory.data, {
          ...redirectOptions,
          error: "Match is required.",
        })
      );
    }
    redirect(`/matches?error=${encodeURIComponent("Match is required.")}`);
  }

  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: { group: { include: { category: true } } },
  });

  if (!match || match.stage !== "GROUP" || !match.group) {
    redirect(`/matches?error=${encodeURIComponent("Match not found.")}`);
  }

  const redirectOptions = readMatchFilterRedirectOptions(formData);

  await assertGroupStageUnlocked(match.group.category.code);

  await prisma.$transaction([
    prisma.gameScore.deleteMany({ where: { matchId: match.id } }),
    prisma.match.update({
      where: { id: match.id },
      data: {
        status: "SCHEDULED",
        winnerTeamId: null,
      },
    }),
  ]);

  revalidatePath("/matches");
  redirect(buildMatchesRedirect(match.group.category.code, redirectOptions));
}

export async function lockGroupStage(formData: FormData) {
  const parsed = categorySchema.safeParse(formData.get("category"));
  if (!parsed.success) {
    redirect(`/matches?error=${encodeURIComponent("Invalid category.")}`);
  }

  await prisma.groupStageLock.upsert({
    where: { categoryCode: parsed.data },
    update: { locked: true, lockedAt: new Date() },
    create: { categoryCode: parsed.data, locked: true, lockedAt: new Date() },
  });

  revalidatePath("/matches");
  redirect(`/matches?category=${parsed.data}`);
}

export async function unlockGroupStage(formData: FormData) {
  const parsed = categorySchema.safeParse(formData.get("category"));
  if (!parsed.success) {
    redirect(`/matches?error=${encodeURIComponent("Invalid category.")}`);
  }

  await prisma.groupStageLock.upsert({
    where: { categoryCode: parsed.data },
    update: { locked: false, lockedAt: null },
    create: { categoryCode: parsed.data, locked: false, lockedAt: null },
  });

  revalidatePath("/matches");
  redirect(`/matches?category=${parsed.data}`);
}

export async function generateMatchesKnockout(formData: FormData) {
  const parsed = categorySchema.safeParse(formData.get("category"));
  if (!parsed.success) {
    return { error: "Invalid category." };
  }
  const categoryCode = parsed.data;
  const series = parseSeriesFilter(formData.get("series"));

  const count = await prisma.knockoutMatch.count({
    where: {
      categoryCode,
      ...(series ? { series } : {}),
    },
  });

  if (count === 0) {
    return { error: "Generate bracket in /knockout first." };
  }

  await prisma.knockoutMatch.updateMany({
    where: {
      categoryCode,
      ...(series ? { series } : {}),
    },
    data: { isPublished: true },
  });

  await syncKnockoutPropagation(categoryCode);

  revalidatePath("/matches");
  return { ok: true };
}

export async function upsertKnockoutMatchScore(formData: FormData) {
  const parsed = scoreSchema.safeParse({
    matchId: formData.get("matchId"),
    winnerTeamId: formData.get("winnerTeamId")?.toString() || undefined,
    game1Home: parseNumber(formData.get("game1Home")),
    game1Away: parseNumber(formData.get("game1Away")),
    game2Home: parseNumber(formData.get("game2Home")),
    game2Away: parseNumber(formData.get("game2Away")),
    game3Home: parseNumber(formData.get("game3Home")),
    game3Away: parseNumber(formData.get("game3Away")),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid score data." };
  }

  const match = await prisma.knockoutMatch.findUnique({
    where: { id: parsed.data.matchId },
  });

  if (!match) {
    return { error: "Match not found." };
  }

  if (!match.homeTeamId || !match.awayTeamId) {
    return { error: "Match teams are not set." };
  }

  const scoringMode = await getScoringMode();

  const game1Home = parsed.data.game1Home;
  const game1Away = parsed.data.game1Away;
  if (game1Home === undefined || game1Away === undefined) {
    return { error: "Game 1 scores are required." };
  }
  if (game1Home === game1Away) {
    return { error: "Game 1 cannot be tied." };
  }

  const games: { gameNumber: number; homePoints: number; awayPoints: number }[] = [
    {
      gameNumber: 1,
      homePoints: game1Home,
      awayPoints: game1Away,
    },
  ];

  let winnerTeamId: string | null = null;

  if (scoringMode === "SINGLE_GAME_21") {
    winnerTeamId = game1Home > game1Away ? match.homeTeamId : match.awayTeamId;
  } else {
    const game2Home = parsed.data.game2Home;
    const game2Away = parsed.data.game2Away;
    if (game2Home === undefined || game2Away === undefined) {
      return { error: "Game 2 scores are required." };
    }
    if (game2Home === game2Away) {
      return { error: "Game 2 cannot be tied." };
    }

    games.push({
      gameNumber: 2,
      homePoints: game2Home,
      awayPoints: game2Away,
    });

    let homeWins = 0;
    let awayWins = 0;
    if (game1Home > game1Away) homeWins += 1;
    else awayWins += 1;
    if (game2Home > game2Away) homeWins += 1;
    else awayWins += 1;

    if (homeWins === 2) {
      winnerTeamId = match.homeTeamId;
    } else if (awayWins === 2) {
      winnerTeamId = match.awayTeamId;
    } else {
      const game3Home = parsed.data.game3Home;
      const game3Away = parsed.data.game3Away;
      if (game3Home === undefined || game3Away === undefined) {
        return { error: "Game 3 scores are required." };
      }
      if (game3Home === game3Away) {
        return { error: "Game 3 cannot be tied." };
      }
      games.push({
        gameNumber: 3,
        homePoints: game3Home,
        awayPoints: game3Away,
      });
      winnerTeamId = game3Home > game3Away ? match.homeTeamId : match.awayTeamId;
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.knockoutGameScore.deleteMany({ where: { knockoutMatchId: match.id } });
    await tx.knockoutGameScore.createMany({
      data: games.map((game) => ({ knockoutMatchId: match.id, ...game })),
    });
    await tx.knockoutMatch.update({
      where: { id: match.id },
      data: {
        status: "COMPLETED",
        winnerTeamId,
      },
    });
    if (winnerTeamId) {
      await applyWinnerToNextMatch(tx, match.id, winnerTeamId);
      await applySecondChanceDrop(tx, match, winnerTeamId);
    }
  });

  revalidatePath("/matches");
  revalidatePath("/knockout");
  return { ok: true };
}

export async function undoKnockoutMatchResult(formData: FormData) {
  const matchId = String(formData.get("matchId") ?? "");
  if (!matchId) {
    return { error: "Match is required." };
  }

  const match = await prisma.knockoutMatch.findUnique({
    where: { id: matchId },
  });

  if (!match) {
    return { error: "Match not found." };
  }

  await prisma.$transaction(async (tx) => {
    if (match.winnerTeamId) {
      await clearDownstreamSlot(tx, match.id, match.winnerTeamId);
    }
    await clearSecondChanceDrop(tx, match);
    await tx.knockoutGameScore.deleteMany({ where: { knockoutMatchId: match.id } });
    await tx.knockoutMatch.update({
      where: { id: match.id },
      data: {
        status: "SCHEDULED",
        winnerTeamId: null,
      },
    });
  });

  revalidatePath("/matches");
  revalidatePath("/knockout");
  return { ok: true };
}

export async function clearMatchesKnockout(formData: FormData) {
  const parsed = categorySchema.safeParse(formData.get("category"));
  if (!parsed.success) {
    return { error: "Invalid category." };
  }
  const categoryCode = parsed.data;
  const series = parseSeriesFilter(formData.get("series"));

  await prisma.knockoutMatch.deleteMany({
    where: {
      categoryCode,
      ...(series ? { series } : {}),
      isPublished: true,
    },
  });

  revalidatePath("/matches");
  return { ok: true };
}

export async function randomizeAllKnockoutResultsDev(formData: FormData) {
  // DEV ONLY -- do not enable in production
  if (process.env.NODE_ENV === "production") {
    return { error: "Not available in production." };
  }

  const parsed = categorySchema.safeParse(formData.get("category"));
  if (!parsed.success) {
    return { error: "Invalid category." };
  }
  const categoryCode = parsed.data;
  const series = parseSeriesFilter(formData.get("series"));

  const matches = await prisma.knockoutMatch.findMany({
    where: {
      categoryCode,
      ...(series ? { series } : {}),
      isPublished: true,
    },
    include: {
      games: true,
    },
  });

  if (matches.length === 0) {
    revalidatePath("/matches");
    return { ok: true };
  }

  const scoringMode = await getScoringMode();

  await prisma.$transaction(
    matches.flatMap((match) => {
      if (match.games.length > 0) return [];
      if (!match.homeTeamId || !match.awayTeamId) {
        return [
          prisma.knockoutGameScore.deleteMany({
            where: { knockoutMatchId: match.id },
          }),
          prisma.knockoutMatch.update({
            where: { id: match.id },
            data: { status: "SCHEDULED", winnerTeamId: null },
          }),
        ];
      }

      const winner =
        Math.random() < 0.5 ? ("home" as const) : ("away" as const);
      const winnerTeamId =
        winner === "home" ? match.homeTeamId : match.awayTeamId;

      const games =
        scoringMode === "SINGLE_GAME_21"
          ? [buildSingleGameScore(winner)]
          : buildBestOfThreeScores(winner);

      return [
        prisma.knockoutGameScore.deleteMany({
          where: { knockoutMatchId: match.id },
        }),
        prisma.knockoutGameScore.createMany({
          data: games.map((game, index) => ({
            knockoutMatchId: match.id,
            gameNumber: index + 1,
            homePoints: game.homePoints,
            awayPoints: game.awayPoints,
          })),
        }),
        prisma.knockoutMatch.update({
          where: { id: match.id },
          data: { status: "COMPLETED", winnerTeamId },
        }),
      ];
    })
  );

  revalidatePath("/matches");
  return { ok: true };
}

export async function fetchKnockoutMatches(params: { categoryCode: "MD" | "WD" | "XD" }) {
  const matches = await prisma.knockoutMatch.findMany({
    where: { categoryCode: params.categoryCode, isPublished: true },
    include: {
      homeTeam: { include: { members: { include: { player: true } } } },
      awayTeam: { include: { members: { include: { player: true } } } },
      games: true,
    },
    orderBy: [{ series: "asc" }, { round: "asc" }, { matchNo: "asc" }],
  });

  return matches.map((match) => ({
    id: match.id,
    series: match.series,
    round: match.round,
    matchNo: match.matchNo,
    status: match.status,
    winnerTeamId: match.winnerTeamId,
    games: match.games.map((game) => ({
      gameNumber: game.gameNumber,
      homePoints: game.homePoints,
      awayPoints: game.awayPoints,
    })),
    homeTeam: match.homeTeam
      ? {
          id: match.homeTeam.id,
          name: match.homeTeam.name,
          members: match.homeTeam.members.map((member) => ({
            player: { name: member.player.name },
          })),
        }
      : null,
    awayTeam: match.awayTeam
      ? {
          id: match.awayTeam.id,
          name: match.awayTeam.name,
          members: match.awayTeam.members.map((member) => ({
            player: { name: member.player.name },
          })),
        }
      : null,
  }));
}
