"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { buildSecondChanceHomeAssignments } from "@/app/knockout/bracket-layout";
import { loadGlobalGroupRanking } from "@/app/knockout/logic";
import { BracketError, generateKnockoutBracketInternal } from "@/app/knockout/bracket-service";
import { requireAdmin } from "@/lib/auth";
import { invalidatePublicReadModels } from "@/lib/public-read-models/cache-tags";

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
  const categoryConfig = isWD
    ? null
    : await prisma.categoryConfig.findUnique({
        where: { categoryCode },
      });
  const playInsEnabled = isWD ? false : categoryConfig?.playInsEnabled ?? false;
  const minRankedTeams = isWD ? 4 : 8;
  if (globalRanking.length < minRankedTeams) {
    redirect(
      `/knockout?category=${categoryCode}&error=${encodeURIComponent(
        isWD
          ? "Series A requires at least 4 teams for Women's Doubles."
          : "Series A requires at least 8 teams for Men's Doubles and Mixed Doubles."
      )}`
    );
  }

  const eligibleRanking = isWD
    ? globalRanking.slice(0, globalRanking.length > 8 ? 8 : 4)
    : globalRanking.slice(0, playInsEnabled ? 16 : 12);

  const qualifiers: {
    categoryCode: "MD" | "WD" | "XD";
    series: "A" | "B";
    groupId: string;
    teamId: string;
    groupRank: number;
  }[] = eligibleRanking.map((entry) => ({
    categoryCode,
    series: isWD ? "A" : entry.globalRank <= 8 ? "A" : "B",
    groupId: entry.groupId,
    teamId: entry.teamId,
    groupRank: entry.groupRank,
  }));

  await prisma.$transaction([
    prisma.seriesQualifier.deleteMany({ where: { categoryCode } }),
    prisma.seriesQualifier.createMany({
      data: qualifiers,
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

  await invalidatePublicReadModels({
    type: "knockout-results",
    categoryCodes: [categoryCode],
    series: [series],
  });
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
  if (!(config?.secondChanceEnabled ?? true)) {
    redirect(`/knockout?category=${categoryCode}&error=${encodeURIComponent("Second chance is not enabled.")}`);
  }
  const playInsEnabled = config?.playInsEnabled ?? false;

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

  const assignmentByMatchNo = playInsEnabled
    ? new Map(seriesASeeds.map((seed, index) => [index + 1, seed.teamId]))
    : new Map(
        buildSecondChanceHomeAssignments(
          seriesASeeds.map((seed) => seed.teamId)
        ).map((assignment) => [assignment.matchNo, assignment.homeTeamId])
      );

  await prisma.$transaction(
    qfMatches.map((match) =>
      prisma.knockoutMatch.update({
        where: { id: match.id },
        data: {
          homeTeamId: assignmentByMatchNo.get(match.matchNo) ?? null,
        },
      })
    )
  );

  await invalidatePublicReadModels({
    type: "knockout-results",
    categoryCodes: [categoryCode],
    series: ["B"],
  });
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

export async function togglePlayInsEnabled(formData: FormData) {
  await requireAdmin({ onFail: "redirect" });
  const parsed = categorySchema.safeParse(formData.get("category"));
  if (!parsed.success) {
    redirect(`/knockout?error=${encodeURIComponent("Invalid category.")}`);
  }

  const categoryCode = parsed.data;
  if (categoryCode === "WD") {
    redirect(
      `/knockout?category=${categoryCode}&error=${encodeURIComponent(
        "Play-ins are not available for Women's Doubles."
      )}`
    );
  }

  const enabled = formData.get("playInsEnabled") === "on";
  await prisma.categoryConfig.upsert({
    where: { categoryCode },
    create: { categoryCode, playInsEnabled: enabled },
    update: { playInsEnabled: enabled },
  });

  revalidatePath("/knockout");
  redirect(`/knockout?category=${categoryCode}`);
}
