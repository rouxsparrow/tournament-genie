"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { loadGlobalGroupRanking, nextPowerOfTwo } from "@/app/knockout/logic";
import { syncKnockoutPropagation } from "@/app/knockout/sync";
import { BracketError, generateKnockoutBracketInternal } from "@/app/knockout/bracket-service";
import { requireAdmin } from "@/lib/auth";

const categorySchema = z.enum(["MD", "WD", "XD"]);

const seriesSchema = z.enum(["A", "B"]);

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
  await requireAdmin({ onFail: "redirect" });
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

export async function generateKnockoutBracket(formData: FormData) {
  await requireAdmin({ onFail: "redirect" });
  const categoryParsed = categorySchema.safeParse(formData.get("category"));
  const seriesParsed = seriesSchema.safeParse(formData.get("series"));

  if (!categoryParsed.success || !seriesParsed.success) {
    redirect(`/knockout?error=${encodeURIComponent("Invalid bracket request.")}`);
  }

  const categoryCode = categoryParsed.data;
  const series = seriesParsed.data;

  try {
    await generateKnockoutBracketInternal({ categoryCode, series });
  } catch (error) {
    if (error instanceof BracketError) {
      redirect(
        `/knockout?category=${categoryCode}&error=${encodeURIComponent(error.message)}`
      );
    }
    throw error;
  }

  revalidatePath("/knockout");
  redirect(`/knockout?category=${categoryCode}`);
}

export async function applySecondChanceDrop(formData: FormData) {
  await requireAdmin({ onFail: "redirect" });
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
  await requireAdmin({ onFail: "redirect" });
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
