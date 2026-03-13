import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";
import {
  computeStandingsForCategory,
  getCompletedGroupMatches,
  type StandingsCategoryCode,
} from "@/app/standings/actions";
import { getPresentingState } from "@/app/schedule/actions";
import { normalizeStandingsSummary } from "@/lib/public-read-models/standings-normalization";
import {
  bracketsAllTag,
  bracketsCategoryTag,
  bracketsSeriesTag,
  presentingAllTag,
  presentingStageTag,
  standingsAllTag,
  standingsCategoryTag,
  standingsGroupMatchesTag,
} from "@/lib/public-read-models/cache-tags";
import type {
  CategoryCode,
  PublicBracketsState,
  PublicScheduleStage,
  PublicStandingsGroupMatches,
  PublicStandingsSummary,
  SeriesCode,
} from "@/lib/public-read-models/types";

function normalizeCategoryCode(categoryCode: string | null | undefined): CategoryCode {
  if (categoryCode === "WD" || categoryCode === "XD") return categoryCode;
  return "MD";
}

function normalizeSeriesCode(series: string | null | undefined): SeriesCode {
  if (series === "B") return "B";
  return "A";
}

function teamLabel(
  team:
    | {
        name: string;
        members: { player: { name: string } }[];
      }
    | null
) {
  if (!team) return "TBD";
  if (team.name) return team.name;
  const names = team.members.map((member) => member.player.name);
  return names.length === 2 ? `${names[0]} / ${names[1]}` : "Unnamed team";
}

export async function getCachedStandingsSummary(categoryCode: CategoryCode): Promise<PublicStandingsSummary> {
  const normalized = normalizeCategoryCode(categoryCode);
  const cached = unstable_cache(
    async () => {
      const groupData = await computeStandingsForCategory(normalized);
      return normalizeStandingsSummary({
        categoryCode: normalized,
        groups: groupData.map((entry) => ({
          group: {
            id: entry.group.id,
            name: entry.group.name,
            teamCount: entry.group.teams.length,
          },
          standings: entry.standings,
          completedCount: entry.matches.filter((match) => match.status === "COMPLETED").length,
        })),
      } satisfies PublicStandingsSummary);
    },
    ["public", "standings", "summary", "v2", normalized],
    {
      tags: [standingsAllTag(), standingsCategoryTag(normalized)],
    }
  );

  return normalizeStandingsSummary(await cached());
}

export async function getCachedStandingsGroupMatches(
  groupId: string
): Promise<PublicStandingsGroupMatches> {
  const trimmed = groupId.trim();
  const cached = unstable_cache(
    async () => {
      const matches = await getCompletedGroupMatches(trimmed);
      return {
        groupId: trimmed,
        matches: matches.map((match) => ({
          id: match.id,
          status: "COMPLETED",
          winnerTeamId: match.winnerTeamId,
          homeTeamId: match.homeTeamId,
          awayTeamId: match.awayTeamId,
          homeTeamName: teamLabel(match.homeTeam),
          awayTeamName: teamLabel(match.awayTeam),
          games: match.games.map((game) => ({
            gameNumber: game.gameNumber,
            homePoints: game.homePoints,
            awayPoints: game.awayPoints,
          })),
        })),
      } satisfies PublicStandingsGroupMatches;
    },
    ["public", "standings", "group-matches", trimmed],
    {
      tags: [standingsAllTag(), standingsGroupMatchesTag(trimmed)],
    }
  );

  return cached();
}

export async function getCachedPresentingState(stage: PublicScheduleStage) {
  const normalizedStage = stage === "KNOCKOUT" ? "KNOCKOUT" : "GROUP";
  const cached = unstable_cache(
    async () => getPresentingState({ category: "ALL", stage: normalizedStage }),
    ["public", "presenting", normalizedStage],
    {
      tags: [presentingAllTag(), presentingStageTag(normalizedStage)],
    }
  );

  return cached();
}

export async function getCachedBracketsState(
  categoryCode: CategoryCode,
  series: SeriesCode
): Promise<PublicBracketsState> {
  const normalizedCategory = normalizeCategoryCode(categoryCode);
  const normalizedSeries = normalizeSeriesCode(series);

  const cached = unstable_cache(
    async () => loadBracketsState(normalizedCategory, normalizedSeries),
    ["public", "brackets", normalizedCategory, normalizedSeries],
    {
      tags: [
        bracketsAllTag(),
        bracketsCategoryTag(normalizedCategory),
        bracketsSeriesTag(normalizedCategory, normalizedSeries),
      ],
    }
  );

  return cached();
}

export async function getFreshBracketsState(
  categoryCode: CategoryCode,
  series: SeriesCode
): Promise<PublicBracketsState> {
  const normalizedCategory = normalizeCategoryCode(categoryCode);
  const normalizedSeries = normalizeSeriesCode(series);

  return loadBracketsState(normalizedCategory, normalizedSeries);
}

async function loadBracketsState(
  normalizedCategory: CategoryCode,
  normalizedSeries: SeriesCode
): Promise<PublicBracketsState> {
  const isWD = normalizedCategory === "WD";
  const resolvedSeries = isWD && normalizedSeries === "B" ? "A" : normalizedSeries;
  const matches = await prisma.knockoutMatch.findMany({
    where: { categoryCode: normalizedCategory, series: resolvedSeries },
    include: {
      homeTeam: { include: { members: { include: { player: true } } } },
      awayTeam: { include: { members: { include: { player: true } } } },
      previousMatches: true,
      games: true,
    },
    orderBy: [{ round: "asc" }, { matchNo: "asc" }],
  });

  const showPlayIns = !isWD && matches.some((match) => match.round === 1);

  const seeds = await prisma.knockoutSeed.findMany({
    where: { categoryCode: normalizedCategory, series: resolvedSeries },
  });
  const seedMap = new Map(seeds.map((seed) => [seed.teamId, seed.seedNo]));

  return {
    categoryCode: normalizedCategory,
    series: resolvedSeries,
    isWD,
    showPlayIns,
    matches: matches.map((match) => ({
      id: match.id,
      round: match.round,
      matchNo: match.matchNo,
      status: match.status,
      winnerTeamId: match.winnerTeamId,
      games: match.games.map((game) => ({
        gameNumber: game.gameNumber,
        homePoints: game.homePoints,
        awayPoints: game.awayPoints,
      })),
      previousMatches: match.previousMatches.map((prev) => ({
        round: prev.round,
        matchNo: prev.matchNo,
        nextSlot: prev.nextSlot,
      })),
      homeTeam: {
        id: match.homeTeamId,
        name: match.homeTeam ? teamLabel(match.homeTeam) : "TBD",
        seed: match.homeTeamId ? seedMap.get(match.homeTeamId) ?? null : null,
      },
      awayTeam: {
        id: match.awayTeamId,
        name: match.awayTeam ? teamLabel(match.awayTeam) : "TBD",
        seed: match.awayTeamId ? seedMap.get(match.awayTeamId) ?? null : null,
      },
    })),
  } satisfies PublicBracketsState;
}

export async function resolvePresentingStageForViewerFromNav(favouritePlayerId: string | null) {
  const [hasAssignedGroup, hasAnyGroupScheduled, hasFavouriteGroupScheduled] = await Promise.all([
    prisma.courtAssignment.count({
      where: {
        stage: "GROUP",
        status: "ACTIVE",
        groupMatchId: { not: null },
      },
    }),
    prisma.match.count({
      where: {
        stage: "GROUP",
        status: "SCHEDULED",
        groupId: { not: null },
        homeTeamId: { not: null },
        awayTeamId: { not: null },
      },
    }),
    favouritePlayerId
      ? prisma.match.count({
          where: {
            stage: "GROUP",
            status: "SCHEDULED",
            OR: [
              { homeTeam: { members: { some: { playerId: favouritePlayerId } } } },
              { awayTeam: { members: { some: { playerId: favouritePlayerId } } } },
            ],
          },
        })
      : Promise.resolve(0),
  ]);

  if (hasAssignedGroup > 0 || hasAnyGroupScheduled > 0 || hasFavouriteGroupScheduled > 0) {
    return "GROUP" as const;
  }

  return "KNOCKOUT" as const;
}

export function parseStandingsCategory(input: unknown): StandingsCategoryCode {
  return normalizeCategoryCode(typeof input === "string" ? input : null);
}

export function parseBracketsCategory(input: unknown): CategoryCode {
  return normalizeCategoryCode(typeof input === "string" ? input : null);
}

export function parseBracketsSeries(input: unknown): SeriesCode {
  return normalizeSeriesCode(typeof input === "string" ? input : null);
}

export function parsePresentingStage(input: unknown): PublicScheduleStage {
  const value = typeof input === "string" ? input.toLowerCase() : "";
  return value === "ko" || value === "knockout" ? "KNOCKOUT" : "GROUP";
}
