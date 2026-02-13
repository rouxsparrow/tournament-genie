"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  upsertKnockoutMatchScore,
  upsertMatchScoreNoRedirect,
} from "@/app/matches/actions";

const COURT_LABELS: Record<string, "P5" | "P6" | "P7" | "P8" | "P9"> = {
  C1: "P5",
  C2: "P6",
  C3: "P7",
  C4: "P8",
  C5: "P9",
};

const scoreValueSchema = z.number().int().min(0).max(30);

const submitRefereeScoreSchema = z.object({
  stage: z.enum(["GROUP", "KNOCKOUT"]),
  matchId: z.string().min(1, "Match is required."),
  passcode: z
    .string()
    .regex(/^\d{4}$/, "Passcode must be a 4 digit number."),
  lockState: z.literal(true),
  notes: z.string().max(500).optional(),
  bestOf3Enabled: z.boolean().optional(),
  scores: z.object({
    game1: z.object({ home: scoreValueSchema, away: scoreValueSchema }),
    game2: z.object({ home: scoreValueSchema, away: scoreValueSchema }).optional(),
    game3: z.object({ home: scoreValueSchema, away: scoreValueSchema }).optional(),
  }),
});

type SubmitRefereeScoreInput = z.infer<typeof submitRefereeScoreSchema>;

function getConfiguredRefereePasscode() {
  const configuredPasscode = process.env.Referee_code ?? process.env.REFEREE_CODE ?? "";
  if (!/^\d{4}$/.test(configuredPasscode)) return null;
  return configuredPasscode;
}

export async function verifyRefereePasscode(passcode: string) {
  const configuredPasscode = getConfiguredRefereePasscode();
  if (!configuredPasscode) {
    return { error: "Referee passcode is not configured correctly." };
  }
  if (!/^\d{4}$/.test(passcode)) {
    return { error: "Passcode must be a 4 digit number." };
  }
  if (passcode !== configuredPasscode) {
    return { error: "Invalid referee passcode." };
  }
  return { ok: true as const };
}

export async function submitRefereeScore(input: SubmitRefereeScoreInput) {
  const parsed = submitRefereeScoreSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid submission." };
  }

  const payload = parsed.data;
  if (payload.scores.game1.home === 0 && payload.scores.game1.away === 0) {
    return { error: "Score cannot be 0-0" };
  }

  const configuredPasscode = getConfiguredRefereePasscode();
  if (!configuredPasscode) {
    return { error: "Referee passcode is not configured correctly." };
  }
  if (payload.passcode !== configuredPasscode) {
    return { error: "Invalid referee passcode." };
  }

  const scoreFormData = new FormData();
  scoreFormData.set("matchId", payload.matchId);
  scoreFormData.set("refereePasscode", payload.passcode);
  scoreFormData.set("game1Home", String(payload.scores.game1.home));
  scoreFormData.set("game1Away", String(payload.scores.game1.away));

  if (payload.scores.game2) {
    scoreFormData.set("game2Home", String(payload.scores.game2.home));
    scoreFormData.set("game2Away", String(payload.scores.game2.away));
  }
  if (payload.scores.game3) {
    scoreFormData.set("game3Home", String(payload.scores.game3.home));
    scoreFormData.set("game3Away", String(payload.scores.game3.away));
  }

  if (payload.stage === "GROUP") {
    const match = await prisma.match.findUnique({
      where: { id: payload.matchId },
      include: {
        group: { include: { category: true } },
        homeTeam: { select: { name: true } },
        awayTeam: { select: { name: true } },
      },
    });

    if (!match || !match.group) {
      return { error: "Match not found." };
    }

    scoreFormData.set("category", match.group.category.code);
    const result = await upsertMatchScoreNoRedirect(scoreFormData);
    if ("error" in result && result.error) {
      return { error: result.error };
    }

    await prisma.refereeSubmission.create({
      data: {
        matchType: "GROUP",
        categoryCode: match.group.category.code,
        lockState: payload.lockState,
        submittedBy: "referee",
        scores: {
          game1: payload.scores.game1,
          game2: payload.scores.game2 ?? null,
          game3: payload.scores.game3 ?? null,
        },
        notes: payload.notes,
        groupMatchId: payload.matchId,
      },
    });

    const assignment = await prisma.courtAssignment.findFirst({
      where: {
        stage: "GROUP",
        matchType: "GROUP",
        groupMatchId: payload.matchId,
      },
      orderBy: { assignedAt: "desc" },
      select: { courtId: true },
    });

    await prisma.scheduleActionLog.create({
      data: {
        action: "REFEREE_SCORE_SUBMITTED",
        payload: {
          stage: "GROUP",
          matchType: "GROUP",
          matchId: payload.matchId,
          courtLabel: assignment ? COURT_LABELS[assignment.courtId] ?? null : null,
          categoryCode: match.group.category.code,
          series: null,
          round: null,
          matchNo: null,
          groupName: match.group.name,
          homeTeamName: match.homeTeam?.name ?? "TBD",
          awayTeamName: match.awayTeam?.name ?? "TBD",
          submittedAt: new Date().toISOString(),
          isRead: false,
        },
      },
    });
  } else {
    const match = await prisma.knockoutMatch.findUnique({
      where: { id: payload.matchId },
      select: {
        id: true,
        categoryCode: true,
        series: true,
        round: true,
        matchNo: true,
        isBestOf3: true,
        homeTeam: { select: { name: true } },
        awayTeam: { select: { name: true } },
      },
    });

    if (!match) {
      return { error: "Match not found." };
    }

    const result = await upsertKnockoutMatchScore(scoreFormData);
    if (result?.error) {
      return { error: result.error };
    }

    await prisma.refereeSubmission.create({
      data: {
        matchType: "KNOCKOUT",
        categoryCode: match.categoryCode,
        lockState: payload.lockState,
        submittedBy: "referee",
        scores: {
          game1: payload.scores.game1,
          game2: payload.scores.game2 ?? null,
          game3: payload.scores.game3 ?? null,
        },
        notes: payload.notes,
        knockoutMatchId: payload.matchId,
        series: match.series,
        round: match.round,
        matchNo: match.matchNo,
        isBestOf3: match.isBestOf3,
      },
    });

    const assignment = await prisma.courtAssignment.findFirst({
      where: {
        stage: "KNOCKOUT",
        matchType: "KNOCKOUT",
        knockoutMatchId: payload.matchId,
      },
      orderBy: { assignedAt: "desc" },
      select: { courtId: true },
    });

    await prisma.scheduleActionLog.create({
      data: {
        action: "REFEREE_SCORE_SUBMITTED",
        payload: {
          stage: "KNOCKOUT",
          matchType: "KNOCKOUT",
          matchId: payload.matchId,
          courtLabel: assignment ? COURT_LABELS[assignment.courtId] ?? null : null,
          categoryCode: match.categoryCode,
          series: match.series,
          round: match.round,
          matchNo: match.matchNo,
          groupName: null,
          homeTeamName: match.homeTeam?.name ?? "TBD",
          awayTeamName: match.awayTeam?.name ?? "TBD",
          submittedAt: new Date().toISOString(),
          isRead: false,
        },
      },
    });
  }

  revalidatePath("/referee");
  revalidatePath("/matches");
  revalidatePath("/schedule");
  revalidatePath("/standings");
  revalidatePath("/knockout");

  return { ok: true as const };
}
