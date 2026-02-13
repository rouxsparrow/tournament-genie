"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { syncKnockoutPropagation } from "@/app/knockout/sync";
import { getScheduleState } from "@/app/schedule/actions";
import { requireAdmin } from "@/lib/auth";
import {
  clearGroupStageMatchesForCategory,
  generateGroupStageMatchesForCategory,
  publishKnockoutMatchesForCategory,
} from "@/lib/match-management";
import {
  getBroadcastViewChangeType,
  getBroadcastViewSignature,
} from "@/lib/schedule/broadcast-view-signature";
import { publishBroadcastRefreshEvent } from "@/lib/supabase/broadcast-refresh-publisher";
import { publishScheduleCompletionEvent } from "@/lib/supabase/schedule-realtime-publisher";

const categorySchema = z.enum(["MD", "WD", "XD"]);
const pageCategorySchema = z.enum(["ALL", "MD", "WD", "XD"]);

const seriesFilterSchema = z.enum(["A", "B", "ALL"]);

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

const finalBestOf3Schema = z.object({
  matchId: z.string().min(1, "Match is required."),
  isBestOf3: z.boolean(),
});

function getConfiguredRefereePasscode() {
  const configuredPasscode = process.env.Referee_code ?? process.env.REFEREE_CODE ?? "";
  if (!/^\d{4}$/.test(configuredPasscode)) return null;
  return configuredPasscode;
}

function hasValidRefereePasscode(formData: FormData) {
  const configured = getConfiguredRefereePasscode();
  if (!configured) return false;
  const supplied = String(formData.get("refereePasscode") ?? "");
  return supplied === configured;
}

function parseNumber(value: FormDataEntryValue | null) {
  if (value === null || value === "") return undefined;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

type CompletionRealtimeParams = {
  stage: "GROUP" | "KNOCKOUT";
  source: "matches-score-save" | "referee-score-submit";
  matchType: "GROUP" | "KNOCKOUT";
  matchId: string;
  completedAt: string;
};

async function reconcileScheduleAndBroadcastCompletion(
  params: CompletionRealtimeParams
) {
  const before = await getBroadcastViewSignature(params.stage);

  try {
    await getScheduleState({ stage: params.stage }, { mode: "presenting" });
  } catch (error) {
    console.error("[schedule][completion] reconcile failed", {
      stage: params.stage,
      matchType: params.matchType,
      matchId: params.matchId,
      source: params.source,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  await publishScheduleCompletionEvent({
    stage: params.stage,
    source: params.source,
    matchType: params.matchType,
    matchId: params.matchId,
    completedAt: params.completedAt,
  });

  const after = await getBroadcastViewSignature(params.stage);
  const changeType = getBroadcastViewChangeType(before, after);
  if (!changeType) {
    return;
  }

  const broadcastResult = await publishBroadcastRefreshEvent({
    stage: params.stage,
    source: params.source,
    reason: "view-change",
    changeType,
  });
  if (!broadcastResult.ok) {
    console.error("[broadcast][completion] publish failed", {
      stage: params.stage,
      matchType: params.matchType,
      matchId: params.matchId,
      source: params.source,
      error: broadcastResult.error,
      response: broadcastResult.response ?? null,
    });
  }
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
  categoryCode: "ALL" | "MD" | "WD" | "XD",
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
  tx: Prisma.TransactionClient,
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
  tx: Prisma.TransactionClient,
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

async function applyLoserToBronzeMatch(
  tx: Prisma.TransactionClient,
  match: {
    id: string;
    categoryCode: "MD" | "WD" | "XD";
    series: "A" | "B";
    round: number;
    matchNo: number;
    homeTeamId: string | null;
    awayTeamId: string | null;
  },
  winnerTeamId: string
) {
  if (match.round !== 3) return;
  if (!match.homeTeamId || !match.awayTeamId) return;
  if (match.matchNo !== 1 && match.matchNo !== 2) return;

  const loserTeamId =
    winnerTeamId === match.homeTeamId ? match.awayTeamId : match.homeTeamId;
  const bronzeMatch = await tx.knockoutMatch.findFirst({
    where: {
      categoryCode: match.categoryCode,
      series: match.series,
      round: 4,
      matchNo: 2,
    },
  });
  if (!bronzeMatch) return;

  const slotField = match.matchNo === 1 ? "homeTeamId" : "awayTeamId";
  const currentSlot = bronzeMatch[slotField];
  if (currentSlot === loserTeamId) return;

  await tx.knockoutGameScore.deleteMany({
    where: { knockoutMatchId: bronzeMatch.id },
  });
  await tx.knockoutMatch.update({
    where: { id: bronzeMatch.id },
    data: {
      [slotField]: loserTeamId,
      winnerTeamId: null,
      status: "SCHEDULED",
      completedAt: null,
    },
  });
}

async function clearLoserFromBronzeMatch(
  tx: Prisma.TransactionClient,
  match: {
    id: string;
    categoryCode: "MD" | "WD" | "XD";
    series: "A" | "B";
    round: number;
    matchNo: number;
  }
) {
  if (match.round !== 3) return;
  if (match.matchNo !== 1 && match.matchNo !== 2) return;

  const bronzeMatch = await tx.knockoutMatch.findFirst({
    where: {
      categoryCode: match.categoryCode,
      series: match.series,
      round: 4,
      matchNo: 2,
    },
  });
  if (!bronzeMatch) return;

  const slotField = match.matchNo === 1 ? "homeTeamId" : "awayTeamId";
  if (!bronzeMatch[slotField]) return;

  await tx.knockoutGameScore.deleteMany({
    where: { knockoutMatchId: bronzeMatch.id },
  });
  await tx.knockoutMatch.update({
    where: { id: bronzeMatch.id },
    data: {
      [slotField]: null,
      winnerTeamId: null,
      status: "SCHEDULED",
      completedAt: null,
    },
  });
}

async function applySecondChanceDrop(
  tx: Prisma.TransactionClient,
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

  const qfRoundA = 2;
  if (match.round !== qfRoundA) return;

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

  const qfRoundB = 2;

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
  tx: Prisma.TransactionClient,
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

  const qfRoundA = 2;
  if (match.round !== qfRoundA) return;

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

  const qfRoundB = 2;

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
  await requireAdmin({ onFail: "redirect" });
  const parsed = categorySchema.safeParse(formData.get("category"));
  if (!parsed.success) {
    redirect(`/matches?error=${encodeURIComponent("Invalid category.")}`);
  }

  const categoryCode = parsed.data;

  await assertGroupAssignmentLocked(categoryCode);
  await generateGroupStageMatchesForCategory(categoryCode);

  revalidatePath("/matches");
  redirect(`/matches?category=${categoryCode}`);
}

export async function clearGroupStageMatches(formData: FormData) {
  await requireAdmin({ onFail: "redirect" });
  const parsed = categorySchema.safeParse(formData.get("category"));
  if (!parsed.success) {
    redirect(`/matches?error=${encodeURIComponent("Invalid category.")}`);
  }

  const categoryCode = parsed.data;

  await assertGroupStageUnlocked(categoryCode);

  await clearGroupStageMatchesForCategory(categoryCode);

  revalidatePath("/matches");
  revalidatePath("/standings");
  redirect(`/matches?category=${categoryCode}`);
}

type TeamSearchTarget = {
  name: string;
  members: { player: { name: string } }[];
};

function teamSearchText(team: TeamSearchTarget | null) {
  if (!team) return "";
  const names = team.members.map((member) => member.player.name).join(" ");
  return `${team.name} ${names}`.trim().toLowerCase();
}

export async function randomizeFilteredGroupMatchResults(formData: FormData) {
  await requireAdmin({ onFail: "redirect" });
  // DEV ONLY -- do not enable in production
  if (process.env.NODE_ENV === "production") {
    redirect(`/matches?error=${encodeURIComponent("Not available in production.")}`);
  }

  const redirectOptions = readMatchFilterRedirectOptions(formData);
  const parsed = categorySchema.safeParse(formData.get("category"));
  if (!parsed.success) {
    redirect(`/matches?error=${encodeURIComponent("Invalid category.")}`);
  }
  const categoryCode = parsed.data;

  await assertGroupStageUnlocked(categoryCode);

  const scoringMode = await getScoringMode();
  const search = redirectOptions.search?.trim().toLowerCase();

  const matches = await prisma.match.findMany({
    where: {
      stage: "GROUP",
      status: "SCHEDULED",
      group: {
        category: { code: categoryCode },
        ...(redirectOptions.groupId ? { id: redirectOptions.groupId } : {}),
      },
    },
    include: {
      games: true,
      homeTeam: { include: { members: { include: { player: true } } } },
      awayTeam: { include: { members: { include: { player: true } } } },
    },
  });

  const filteredMatches = search
    ? matches.filter((match) => {
        const home = teamSearchText(match.homeTeam);
        const away = teamSearchText(match.awayTeam);
        return home.includes(search) || away.includes(search);
      })
    : matches;

  if (filteredMatches.length === 0) {
    revalidatePath("/matches");
    redirect(buildMatchesRedirect(categoryCode, redirectOptions));
  }

  await prisma.$transaction(
    filteredMatches.flatMap((match) => {
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
            completedAt: new Date(),
          },
        }),
      ];
    })
  );

  revalidatePath("/matches");
  revalidatePath("/standings");
  redirect(buildMatchesRedirect(categoryCode, redirectOptions));
}

type ScoreUpsertResult =
  | { ok: true; categoryCode: "MD" | "WD" | "XD"; matchId: string }
  | { error: string; categoryCode?: "MD" | "WD" | "XD" };

async function upsertMatchScoreInternal(formData: FormData): Promise<ScoreUpsertResult | void> {
  const noRedirect = String(formData.get("noRedirect") ?? "") === "true";
  const refereeAuthorized = hasValidRefereePasscode(formData);
  if (!refereeAuthorized) {
    const auth = await requireAdmin({ onFail: noRedirect ? "return" : "redirect" });
    if (auth?.error) {
      return { error: auth.error };
    }
  }
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
    const error = parsed.error.issues[0]?.message ?? "Invalid score data.";
    if (noRedirect) {
      return {
        error,
        ...(parsedCategory.success ? { categoryCode: parsedCategory.data } : {}),
      };
    }
    if (parsedCategory.success) {
      redirect(
        buildMatchesRedirect(parsedCategory.data, {
          ...redirectOptions,
          error,
        })
      );
    }
    redirect(`/matches?error=${encodeURIComponent(error)}`);
  }

  const match = await prisma.match.findUnique({
    where: { id: parsed.data.matchId },
    include: {
      group: { include: { category: true } },
    },
  });

  if (!match || match.stage !== "GROUP" || !match.group) {
    if (noRedirect) {
      return { error: "Match not found." };
    }
    redirect(`/matches?error=${encodeURIComponent("Match not found.")}`);
  }

  const successRedirect = buildMatchesRedirect(
    match.group.category.code,
    redirectOptions
  );

  if (noRedirect) {
    const lock = await prisma.groupStageLock.findUnique({
      where: { categoryCode: match.group.category.code },
    });
    if (lock?.locked) {
      return {
        error: "Group stage is locked for this category.",
        categoryCode: match.group.category.code,
      };
    }
  } else {
    await assertGroupStageUnlocked(match.group.category.code);
  }

  if (!match.homeTeamId || !match.awayTeamId) {
    if (noRedirect) {
      return {
        error: "Match teams are not set.",
        categoryCode: match.group.category.code,
      };
    }
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
    if (noRedirect) {
      return {
        error: "Game 1 scores are required.",
        categoryCode: match.group.category.code,
      };
    }
    redirect(
      buildMatchesRedirect(match.group.category.code, {
        ...redirectOptions,
        error: "Game 1 scores are required.",
      })
    );
  }
  if (game1Home === 0 && game1Away === 0) {
    await prisma.$transaction([
      prisma.gameScore.deleteMany({ where: { matchId: match.id } }),
      prisma.match.update({
        where: { id: match.id },
        data: { status: "SCHEDULED", winnerTeamId: null, completedAt: null },
      }),
    ]);
    revalidatePath("/matches");
    revalidatePath("/standings");
    if (noRedirect) {
      return {
        ok: true,
        categoryCode: match.group.category.code,
        matchId: match.id,
      };
    }
    redirect(successRedirect);
  }
  if (game1Home === game1Away) {
    if (noRedirect) {
      return {
        error: "Game 1 cannot be tied.",
        categoryCode: match.group.category.code,
      };
    }
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
      if (noRedirect) {
        return {
          error: "Game 2 scores are required.",
          categoryCode: match.group.category.code,
        };
      }
      redirect(
        buildMatchesRedirect(match.group.category.code, {
          ...redirectOptions,
          error: "Game 2 scores are required.",
        })
      );
    }
    if (game2Home === game2Away) {
      if (noRedirect) {
        return {
          error: "Game 2 cannot be tied.",
          categoryCode: match.group.category.code,
        };
      }
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
        if (noRedirect) {
          return {
            error: "Game 3 scores are required.",
            categoryCode: match.group.category.code,
          };
        }
        redirect(
          buildMatchesRedirect(match.group.category.code, {
            ...redirectOptions,
            error: "Game 3 scores are required.",
          })
        );
      }
      if (game3Home === game3Away) {
        if (noRedirect) {
          return {
            error: "Game 3 cannot be tied.",
            categoryCode: match.group.category.code,
          };
        }
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

  const completedAt = new Date();
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
        completedAt,
      },
    }),
  ]);

  await reconcileScheduleAndBroadcastCompletion({
    stage: "GROUP",
    source: refereeAuthorized ? "referee-score-submit" : "matches-score-save",
    matchType: "GROUP",
    matchId: match.id,
    completedAt: completedAt.toISOString(),
  });

  revalidatePath("/schedule");
  revalidatePath("/matches");
  revalidatePath("/standings");
  if (noRedirect) {
    return {
      ok: true,
      categoryCode: match.group.category.code,
      matchId: match.id,
    };
  }
  redirect(successRedirect);
}

export async function upsertMatchScore(formData: FormData): Promise<void> {
  await upsertMatchScoreInternal(formData);
}

export async function upsertMatchScoreNoRedirect(
  formData: FormData
): Promise<ScoreUpsertResult> {
  const working = new FormData();
  formData.forEach((value, key) => {
    working.append(key, value);
  });
  working.set("noRedirect", "true");
  const result = await upsertMatchScoreInternal(working);
  if (result && ("ok" in result || "error" in result)) {
    return result;
  }
  return { error: "Invalid score submission." };
}

export async function undoMatchResult(formData: FormData) {
  await requireAdmin({ onFail: "redirect" });
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
  const before = await getBroadcastViewSignature("GROUP");

  await prisma.$transaction([
    prisma.gameScore.deleteMany({ where: { matchId: match.id } }),
    prisma.match.update({
      where: { id: match.id },
      data: {
        status: "SCHEDULED",
        winnerTeamId: null,
        completedAt: null,
      },
    }),
  ]);

  const after = await getBroadcastViewSignature("GROUP");
  const changeType = getBroadcastViewChangeType(before, after);
  if (changeType) {
    const broadcastResult = await publishBroadcastRefreshEvent({
      stage: "GROUP",
      source: "matches-score-save",
      reason: "view-change",
      changeType,
    });
    if (!broadcastResult.ok) {
      console.error("[broadcast][undo] publish failed", {
        stage: "GROUP",
        matchType: "GROUP",
        matchId: match.id,
        source: "matches-score-save",
        error: broadcastResult.error,
        response: broadcastResult.response ?? null,
      });
    }
  }

  revalidatePath("/matches");
  redirect(buildMatchesRedirect(match.group.category.code, redirectOptions));
}

export async function lockGroupStage(formData: FormData) {
  await requireAdmin({ onFail: "redirect" });
  const redirectOptions = readMatchFilterRedirectOptions(formData);
  const parsed = categorySchema.safeParse(formData.get("category"));
  const pageCategoryParsed = pageCategorySchema.safeParse(formData.get("pageCategory"));
  if (!parsed.success) {
    redirect(`/matches?error=${encodeURIComponent("Invalid category.")}`);
  }

  await prisma.groupStageLock.upsert({
    where: { categoryCode: parsed.data },
    update: { locked: true, lockedAt: new Date() },
    create: { categoryCode: parsed.data, locked: true, lockedAt: new Date() },
  });

  revalidatePath("/matches");
  redirect(
    buildMatchesRedirect(
      pageCategoryParsed.success ? pageCategoryParsed.data : parsed.data,
      redirectOptions
    )
  );
}

export async function unlockGroupStage(formData: FormData) {
  await requireAdmin({ onFail: "redirect" });
  const redirectOptions = readMatchFilterRedirectOptions(formData);
  const parsed = categorySchema.safeParse(formData.get("category"));
  const pageCategoryParsed = pageCategorySchema.safeParse(formData.get("pageCategory"));
  if (!parsed.success) {
    redirect(`/matches?error=${encodeURIComponent("Invalid category.")}`);
  }

  await prisma.groupStageLock.upsert({
    where: { categoryCode: parsed.data },
    update: { locked: false, lockedAt: null },
    create: { categoryCode: parsed.data, locked: false, lockedAt: null },
  });

  revalidatePath("/matches");
  redirect(
    buildMatchesRedirect(
      pageCategoryParsed.success ? pageCategoryParsed.data : parsed.data,
      redirectOptions
    )
  );
}

export async function generateMatchesKnockout(formData: FormData) {
  await requireAdmin({ onFail: "redirect" });
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

  if (series) {
    await prisma.knockoutMatch.updateMany({
      where: {
        categoryCode,
        series,
      },
      data: { isPublished: true },
    });
  } else {
    await publishKnockoutMatchesForCategory(categoryCode);
  }

  await syncKnockoutPropagation(categoryCode);

  revalidatePath("/matches");
  return { ok: true };
}

export async function upsertKnockoutMatchScore(formData: FormData) {
  const refereeAuthorized = hasValidRefereePasscode(formData);
  if (!refereeAuthorized) {
    await requireAdmin({ onFail: "redirect" });
  }
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
  const matchScoringMode =
    match.round === 4 && match.matchNo === 1 && match.isBestOf3
      ? "BEST_OF_3_21"
      : scoringMode;

  const game1Home = parsed.data.game1Home;
  const game1Away = parsed.data.game1Away;
  if (game1Home === undefined || game1Away === undefined) {
    return { error: "Game 1 scores are required." };
  }
  if (game1Home === 0 && game1Away === 0) {
    await prisma.$transaction(async (tx) => {
      if (match.winnerTeamId) {
        await clearDownstreamSlot(tx, match.id, match.winnerTeamId);
      }
      await clearSecondChanceDrop(tx, match);
      await clearLoserFromBronzeMatch(tx, match);
      await tx.knockoutGameScore.deleteMany({
        where: { knockoutMatchId: match.id },
      });
      await tx.knockoutMatch.update({
        where: { id: match.id },
        data: {
          status: "SCHEDULED",
          winnerTeamId: null,
          completedAt: null,
        },
      });
    });
    revalidatePath("/matches");
    revalidatePath("/knockout");
    return { ok: true };
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

  if (matchScoringMode === "SINGLE_GAME_21") {
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

  const completedAt = new Date();
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
        completedAt,
      },
    });
    if (winnerTeamId) {
      await applyWinnerToNextMatch(tx, match.id, winnerTeamId);
      await applySecondChanceDrop(tx, match, winnerTeamId);
      await applyLoserToBronzeMatch(tx, match, winnerTeamId);
    }
  });

  await reconcileScheduleAndBroadcastCompletion({
    stage: "KNOCKOUT",
    source: refereeAuthorized ? "referee-score-submit" : "matches-score-save",
    matchType: "KNOCKOUT",
    matchId: match.id,
    completedAt: completedAt.toISOString(),
  });

  revalidatePath("/schedule");
  revalidatePath("/matches");
  revalidatePath("/knockout");
  return { ok: true };
}

export async function undoKnockoutMatchResult(formData: FormData) {
  await requireAdmin({ onFail: "redirect" });
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
  const before = await getBroadcastViewSignature("KNOCKOUT");

  await prisma.$transaction(async (tx) => {
    if (match.winnerTeamId) {
      await clearDownstreamSlot(tx, match.id, match.winnerTeamId);
    }
    await clearSecondChanceDrop(tx, match);
    await clearLoserFromBronzeMatch(tx, match);
    await tx.knockoutGameScore.deleteMany({ where: { knockoutMatchId: match.id } });
    await tx.knockoutMatch.update({
      where: { id: match.id },
      data: {
        status: "SCHEDULED",
        winnerTeamId: null,
        completedAt: null,
      },
    });
  });

  const after = await getBroadcastViewSignature("KNOCKOUT");
  const changeType = getBroadcastViewChangeType(before, after);
  if (changeType) {
    const broadcastResult = await publishBroadcastRefreshEvent({
      stage: "KNOCKOUT",
      source: "matches-score-save",
      reason: "view-change",
      changeType,
    });
    if (!broadcastResult.ok) {
      console.error("[broadcast][undo] publish failed", {
        stage: "KNOCKOUT",
        matchType: "KNOCKOUT",
        matchId: match.id,
        source: "matches-score-save",
        error: broadcastResult.error,
        response: broadcastResult.response ?? null,
      });
    }
  }

  revalidatePath("/matches");
  revalidatePath("/knockout");
  return { ok: true };
}

export async function clearMatchesKnockout(formData: FormData) {
  await requireAdmin({ onFail: "redirect" });
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
  await requireAdmin({ onFail: "redirect" });
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
  const roundFilter = String(formData.get("round") ?? "");
  const search = String(formData.get("search") ?? "").trim().toLowerCase();

  const matches = await prisma.knockoutMatch.findMany({
    where: {
      categoryCode,
      ...(series ? { series } : {}),
      isPublished: true,
    },
    include: {
      games: true,
      homeTeam: { include: { members: { include: { player: true } } } },
      awayTeam: { include: { members: { include: { player: true } } } },
    },
  });

  const filteredMatches = matches.filter((match) => {
    if (roundFilter && roundFilter !== "ALL" && String(match.round) !== roundFilter) {
      return false;
    }
    if (!search) return true;
    const home = teamSearchText(match.homeTeam);
    const away = teamSearchText(match.awayTeam);
    return home.includes(search) || away.includes(search);
  });

  if (filteredMatches.length === 0) {
    revalidatePath("/matches");
    return { ok: true };
  }

  const scoringMode = await getScoringMode();

  await prisma.$transaction(
    filteredMatches.flatMap((match) => {
      if (match.games.length > 0) return [];
      if (!match.homeTeamId || !match.awayTeamId) {
        return [
          prisma.knockoutGameScore.deleteMany({
            where: { knockoutMatchId: match.id },
          }),
          prisma.knockoutMatch.update({
            where: { id: match.id },
            data: { status: "SCHEDULED", winnerTeamId: null, completedAt: null },
          }),
        ];
      }

      const winner =
        Math.random() < 0.5 ? ("home" as const) : ("away" as const);
      const winnerTeamId =
        winner === "home" ? match.homeTeamId : match.awayTeamId;

      const matchScoringMode =
        match.round === 4 && match.matchNo === 1 && match.isBestOf3
          ? "BEST_OF_3_21"
          : scoringMode;
      const games =
        matchScoringMode === "SINGLE_GAME_21"
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
          data: { status: "COMPLETED", winnerTeamId, completedAt: new Date() },
        }),
      ];
    })
  );

  revalidatePath("/matches");
  return { ok: true };
}

export async function fetchKnockoutMatches(params: {
  categoryCode: "ALL" | "MD" | "WD" | "XD";
}) {
  const matches = await prisma.knockoutMatch.findMany({
    where: {
      isPublished: true,
      ...(params.categoryCode === "ALL" ? {} : { categoryCode: params.categoryCode }),
    },
    include: {
      homeTeam: { include: { members: { include: { player: true } } } },
      awayTeam: { include: { members: { include: { player: true } } } },
      games: true,
    },
    orderBy: [{ series: "asc" }, { round: "asc" }, { matchNo: "asc" }],
  });

  return matches.map((match) => ({
    id: match.id,
    categoryCode: match.categoryCode,
    series: match.series,
    round: match.round,
    matchNo: match.matchNo,
    status: match.status,
    winnerTeamId: match.winnerTeamId,
    isBestOf3: match.isBestOf3,
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

export async function setFinalBestOf3(formData: FormData) {
  await requireAdmin({ onFail: "redirect" });
  const parsed = finalBestOf3Schema.safeParse({
    matchId: formData.get("matchId"),
    isBestOf3: String(formData.get("isBestOf3")) === "true",
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }

  const match = await prisma.knockoutMatch.findUnique({
    where: { id: parsed.data.matchId },
  });

  if (!match) {
    return { error: "Match not found." };
  }

  if (match.round !== 4) {
    return { error: "Final best-of-3 is only available for Finals." };
  }

  if (match.matchNo !== 1) {
    return { error: "Final best-of-3 is only available for Finals." };
  }

  await prisma.knockoutMatch.update({
    where: { id: match.id },
    data: { isBestOf3: parsed.data.isBestOf3 },
  });

  revalidatePath("/matches");
  revalidatePath("/knockout");
  return { ok: true };
}
