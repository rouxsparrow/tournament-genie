"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { computeStandingsForCategory } from "@/app/standings/actions";
import { loadGlobalGroupRankingDetailed } from "@/app/knockout/logic";
import { invalidatePublicReadModels } from "@/lib/public-read-models/cache-tags";
import { isValidTieOrder } from "@/lib/ranking-tie-override";
import { prisma } from "@/lib/prisma";
import type {
  SaveTieBreakOverrideInput,
  TieBreakActionPayload,
  TieBreakActionResult,
  TieBreakState,
  TieBreakTeam,
} from "@/app/tie-breaks/types";

const categorySchema = z.enum(["MD", "WD", "XD"]);
const scopeSchema = z.enum(["GROUP_STANDINGS", "GLOBAL_GROUP_RANKING"]);

const saveTieBreakOverrideSchema = z.object({
  categoryCode: categorySchema,
  scope: scopeSchema,
  tieKey: z.string().min(1),
  orderedTeamIds: z.array(z.string().min(1)).min(2),
});

const tieBreakActionSchema = z.object({
  categoryCode: categorySchema,
  scope: scopeSchema,
  tieKey: z.string().min(1),
});

function orderTeamsByIds(teams: TieBreakTeam[], orderedTeamIds: string[]) {
  const teamById = new Map(teams.map((team) => [team.teamId, team]));
  const ordered = orderedTeamIds
    .map((teamId) => teamById.get(teamId))
    .filter((team): team is TieBreakTeam => Boolean(team));
  const usedIds = new Set(ordered.map((team) => team.teamId));
  const remaining = teams.filter((team) => !usedIds.has(team.teamId));
  return [...ordered, ...remaining];
}

function findTieCard(
  state: TieBreakState,
  payload: TieBreakActionPayload
) {
  const ties =
    payload.scope === "GROUP_STANDINGS"
      ? state.groupStandingTies
      : state.globalRankingTies;
  return ties.find((tie) => tie.tieKey === payload.tieKey) ?? null;
}

function expectedTeamIds(card: { teams: TieBreakTeam[] }) {
  return card.teams.map((team) => team.teamId);
}

async function getTieEditingBlockState(categoryCode: "MD" | "WD" | "XD") {
  const [qualifierCount, knockoutMatchCount] = await Promise.all([
    prisma.seriesQualifier.count({ where: { categoryCode } }),
    prisma.knockoutMatch.count({ where: { categoryCode } }),
  ]);

  if (qualifierCount > 0 || knockoutMatchCount > 0) {
    return {
      isBlocked: true,
      blockedReason:
        "Tie override editing is locked because Series Split or knockout data already exists for this category. Clear or recompute downstream knockout data first.",
    };
  }

  return {
    isBlocked: false,
    blockedReason: null,
  };
}

export async function loadTieBreakState(categoryCode: "MD" | "WD" | "XD"): Promise<TieBreakState> {
  const [standingsByGroup, globalRankingDetailed, blockState] = await Promise.all([
    computeStandingsForCategory(categoryCode),
    loadGlobalGroupRankingDetailed(categoryCode),
    getTieEditingBlockState(categoryCode),
  ]);

  return {
    categoryCode,
    isBlocked: blockState.isBlocked,
    blockedReason: blockState.blockedReason,
    groupStandingTies: standingsByGroup.flatMap((groupResult) =>
      groupResult.fallbackTies.map((tie) => ({
        scope: "GROUP_STANDINGS" as const,
        categoryCode,
        tieKey: tie.tieKey,
        groupId: groupResult.group.id,
        groupName: groupResult.group.name,
        wins: tie.rows[0]?.wins ?? 0,
        avgPD: tie.rows[0]?.avgPointDiff ?? 0,
        avgPF: tie.rows[0]?.avgPointsFor ?? 0,
        source: tie.source,
        orderedTeamIds: tie.orderedTeamIds,
        teams: orderTeamsByIds(
          tie.rows.map((row) => ({
            teamId: row.teamId,
            teamName: row.teamName,
          })),
          tie.orderedTeamIds
        ),
      }))
    ),
    globalRankingTies: globalRankingDetailed.fallbackTies.map((tie) => ({
      scope: "GLOBAL_GROUP_RANKING" as const,
      categoryCode,
      tieKey: tie.tieKey,
      groupRank: tie.entries[0]?.groupRank ?? 0,
      avgPD: tie.entries[0]?.avgPD ?? 0,
      source: tie.source,
      orderedTeamIds: tie.orderedTeamIds,
      teams: orderTeamsByIds(
        tie.entries.map((entry) => ({
          teamId: entry.teamId,
          teamName: entry.teamName,
          groupName: entry.groupName,
        })),
        tie.orderedTeamIds
      ),
    })),
  };
}

async function revalidateTieBreakPaths(categoryCode: "MD" | "WD" | "XD") {
  await invalidatePublicReadModels({
    type: "group-results",
    categoryCodes: [categoryCode],
  });
  revalidatePath("/admin");
  revalidatePath("/tie-breaks");
  revalidatePath("/standings");
  revalidatePath("/knockout");
  revalidatePath("/group-stage-result");
}

export async function saveTieBreakOverride(
  input: SaveTieBreakOverrideInput
): Promise<TieBreakActionResult> {
  const guard = await requireAdmin({ onFail: "return" });
  if (guard) return { error: guard.error };

  const parsed = saveTieBreakOverrideSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "Invalid tie override payload." };
  }

  const { categoryCode, scope, tieKey, orderedTeamIds } = parsed.data;
  const currentState = await loadTieBreakState(categoryCode);
  if (currentState.isBlocked) {
    return {
      error: currentState.blockedReason ?? "Tie override editing is locked.",
      state: currentState,
    };
  }

  const tie = findTieCard(currentState, { categoryCode, scope, tieKey });
  if (!tie) {
    return {
      error: "This tie changed and can no longer be edited. Refresh and try again.",
      state: currentState,
    };
  }

  const currentTeamIds = expectedTeamIds(tie);
  if (!isValidTieOrder(currentTeamIds, orderedTeamIds)) {
    return {
      error: "Submitted team order does not match the current tie.",
      state: currentState,
    };
  }

  await prisma.rankingTieOverride.upsert({
    where: { tieKey },
    update: {
      scope,
      categoryCode,
      groupId: tie.scope === "GROUP_STANDINGS" ? tie.groupId : null,
      orderedTeamIds,
    },
    create: {
      scope,
      categoryCode,
      groupId: tie.scope === "GROUP_STANDINGS" ? tie.groupId : null,
      tieKey,
      orderedTeamIds,
    },
  });

  await revalidateTieBreakPaths(categoryCode);
  return {
    ok: true,
    message: "Manual tie order saved.",
    state: await loadTieBreakState(categoryCode),
  };
}

export async function clearTieBreakOverride(
  input: TieBreakActionPayload
): Promise<TieBreakActionResult> {
  const guard = await requireAdmin({ onFail: "return" });
  if (guard) return { error: guard.error };

  const parsed = tieBreakActionSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "Invalid tie override payload." };
  }

  const { categoryCode, tieKey } = parsed.data;
  const currentState = await loadTieBreakState(categoryCode);
  if (currentState.isBlocked) {
    return {
      error: currentState.blockedReason ?? "Tie override editing is locked.",
      state: currentState,
    };
  }

  await prisma.rankingTieOverride.deleteMany({
    where: { tieKey },
  });

  await revalidateTieBreakPaths(categoryCode);
  return {
    ok: true,
    message: "Manual tie order cleared.",
    state: await loadTieBreakState(categoryCode),
  };
}
