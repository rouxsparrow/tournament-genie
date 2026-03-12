"use server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  upsertKnockoutMatchScore,
  upsertMatchScoreNoRedirect,
} from "@/app/matches/actions";
import { requireReferee } from "@/lib/referee-auth";

const REFEREE_SCORE_SUBMITTED_GROUP_ACTION = "REFEREE_SCORE_SUBMITTED_GROUP";
const REFEREE_SCORE_SUBMITTED_KNOCKOUT_ACTION = "REFEREE_SCORE_SUBMITTED_KNOCKOUT";

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
  lockState: z.literal(true),
  notes: z.string().max(500).optional(),
  bestOf3Enabled: z.boolean().optional(),
  scores: z.object({
    game1: z.object({ home: scoreValueSchema, away: scoreValueSchema }),
    game2: z.object({ home: scoreValueSchema, away: scoreValueSchema }).optional(),
    game3: z.object({ home: scoreValueSchema, away: scoreValueSchema }).optional(),
  }),
});

const REFEREE_SUBMISSION_LIMIT = 20;
const REFEREE_SUBMISSION_WINDOW_MS = 60_000;

type SubmitRefereeScoreInput = z.infer<typeof submitRefereeScoreSchema>;

async function isRateLimited(refereeAccountId: string) {
  const windowStart = new Date(Date.now() - REFEREE_SUBMISSION_WINDOW_MS);
  const recentCount = await prisma.refereeSubmission.count({
    where: {
      refereeAccountId,
      submittedAt: {
        gte: windowStart,
      },
    },
  });

  return recentCount >= REFEREE_SUBMISSION_LIMIT;
}

function buildRefereeScoreFormData(payload: SubmitRefereeScoreInput) {
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

  return scoreFormData;
}

export async function submitRefereeScore(input: SubmitRefereeScoreInput) {
  const parsed = submitRefereeScoreSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid submission." };
  }

  const referee = await requireReferee({ onFail: "return" });
  if ("error" in referee) {
    return referee;
  }

  if (await isRateLimited(referee.id)) {
    return { error: "Too many submissions. Please wait and try again." };
  }

  const payload = parsed.data;
  if (payload.scores.game1.home === 0 && payload.scores.game1.away === 0) {
    return { error: "Score cannot be 0-0" };
  }

  const scoreFormData = buildRefereeScoreFormData(payload);

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

    if (match.status !== "SCHEDULED") {
      return { error: "Only scheduled matches can be submitted by referee." };
    }

    const assignment = await prisma.courtAssignment.findFirst({
      where: {
        stage: "GROUP",
        status: "ACTIVE",
        matchType: "GROUP",
        groupMatchId: payload.matchId,
      },
      orderBy: { assignedAt: "desc" },
      select: { courtId: true },
    });

    if (!assignment) {
      return { error: "Match is not assigned to an active court." };
    }

    scoreFormData.set("category", match.group.category.code);
    const result = await upsertMatchScoreNoRedirect(scoreFormData, {
      actor: "referee",
    });
    if ("error" in result && result.error) {
      return { error: result.error };
    }

    await prisma.refereeSubmission.create({
      data: {
        matchType: "GROUP",
        categoryCode: match.group.category.code,
        lockState: payload.lockState,
        submittedBy: "referee",
        refereeAccountId: referee.id,
        scores: {
          game1: payload.scores.game1,
          game2: payload.scores.game2 ?? null,
          game3: payload.scores.game3 ?? null,
        },
        notes: payload.notes,
        groupMatchId: payload.matchId,
      },
    });

    await prisma.scheduleActionLog.create({
      data: {
        action: REFEREE_SCORE_SUBMITTED_GROUP_ACTION,
        payload: {
          stage: "GROUP",
          matchType: "GROUP",
          matchId: payload.matchId,
          courtLabel: COURT_LABELS[assignment.courtId] ?? null,
          categoryCode: match.group.category.code,
          series: null,
          round: null,
          matchNo: null,
          groupName: match.group.name,
          homeTeamName: match.homeTeam?.name ?? "TBD",
          awayTeamName: match.awayTeam?.name ?? "TBD",
          submittedAt: new Date().toISOString(),
          submittedByRefereeId: referee.id,
          submittedByRefereeName: referee.displayName,
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
        status: true,
        homeTeam: { select: { name: true } },
        awayTeam: { select: { name: true } },
      },
    });

    if (!match) {
      return { error: "Match not found." };
    }

    if (match.status !== "SCHEDULED") {
      return { error: "Only scheduled matches can be submitted by referee." };
    }

    const assignment = await prisma.courtAssignment.findFirst({
      where: {
        stage: "KNOCKOUT",
        status: "ACTIVE",
        matchType: "KNOCKOUT",
        knockoutMatchId: payload.matchId,
      },
      orderBy: { assignedAt: "desc" },
      select: { courtId: true },
    });

    if (!assignment) {
      return { error: "Match is not assigned to an active court." };
    }

    const result = await upsertKnockoutMatchScore(scoreFormData, {
      actor: "referee",
    });
    if (result?.error) {
      return { error: result.error };
    }

    await prisma.refereeSubmission.create({
      data: {
        matchType: "KNOCKOUT",
        categoryCode: match.categoryCode,
        lockState: payload.lockState,
        submittedBy: "referee",
        refereeAccountId: referee.id,
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

    await prisma.scheduleActionLog.create({
      data: {
        action: REFEREE_SCORE_SUBMITTED_KNOCKOUT_ACTION,
        payload: {
          stage: "KNOCKOUT",
          matchType: "KNOCKOUT",
          matchId: payload.matchId,
          courtLabel: COURT_LABELS[assignment.courtId] ?? null,
          categoryCode: match.categoryCode,
          series: match.series,
          round: match.round,
          matchNo: match.matchNo,
          groupName: null,
          homeTeamName: match.homeTeam?.name ?? "TBD",
          awayTeamName: match.awayTeam?.name ?? "TBD",
          submittedAt: new Date().toISOString(),
          submittedByRefereeId: referee.id,
          submittedByRefereeName: referee.displayName,
          isRead: false,
        },
      },
    });
  }

  return { ok: true as const, stage: payload.stage, matchId: payload.matchId };
}
