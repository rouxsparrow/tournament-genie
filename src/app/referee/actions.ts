"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  upsertKnockoutMatchScore,
  upsertMatchScoreNoRedirect,
} from "@/app/matches/actions";

const scoreValueSchema = z.number().int().min(0).max(30);

const submitRefereeScoreSchema = z.object({
  stage: z.enum(["GROUP", "KNOCKOUT"]),
  matchId: z.string().min(1, "Match is required."),
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

export async function submitRefereeScore(input: SubmitRefereeScoreInput) {
  const auth = await requireAdmin({ onFail: "return" });
  if (auth?.error) {
    return { error: auth.error };
  }

  const parsed = submitRefereeScoreSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid submission." };
  }

  const payload = parsed.data;

  const scoreFormData = new FormData();
  scoreFormData.set("matchId", payload.matchId);
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
      include: { group: { include: { category: true } } },
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
        submittedBy: "admin",
        scores: {
          game1: payload.scores.game1,
          game2: payload.scores.game2 ?? null,
          game3: payload.scores.game3 ?? null,
        },
        notes: payload.notes,
        groupMatchId: payload.matchId,
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
        submittedBy: "admin",
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
  }

  revalidatePath("/referee");
  revalidatePath("/matches");
  revalidatePath("/schedule");
  revalidatePath("/standings");
  revalidatePath("/knockout");

  return { ok: true as const };
}
