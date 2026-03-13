"use server";

import { prisma } from "@/lib/prisma";
import {
  finalizeStandingMetrics,
  resolveStandingRows,
  type StandingRow,
} from "@/app/standings/logic";
import {
  buildGroupRandomDrawTieKey,
  buildGroupStandingOverrideTieKey,
  isValidTieOrder,
  normalizeOrderedTeamIds,
  type RankingTieOrderSource,
} from "@/lib/ranking-tie-override";

export type StandingsCategoryCode = "MD" | "WD" | "XD";

type GroupForStandings = {
  id: string;
  name: string;
  category: { code: StandingsCategoryCode };
  teams: {
    team: {
      id: string;
      name: string;
      members: { player: { name: string } }[];
    };
  }[];
  matches: {
    id: string;
    status: "SCHEDULED" | "COMPLETED";
    winnerTeamId: string | null;
    homeTeamId: string | null;
    awayTeamId: string | null;
    games: {
      gameNumber: number;
      homePoints: number;
      awayPoints: number;
    }[];
  }[];
};

export type GroupStandingFallbackTie = {
  tieKey: string;
  source: RankingTieOrderSource;
  orderedTeamIds: string[];
  rows: StandingRow[];
};

export type GroupResolvedStandings = {
  group: GroupForStandings;
  matches: GroupForStandings["matches"];
  standings: StandingRow[];
  fallbackTies: GroupStandingFallbackTie[];
};

type TieOrderResolver = {
  getOrder: (params: {
    exactTieKey: string;
    teamIds: string[];
  }) => Promise<{
    orderedTeamIds: string[];
    source: RankingTieOrderSource;
  }>;
};

function shuffleIds(teamIds: string[]) {
  const shuffled = [...teamIds];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

async function createGroupTieOrderResolver(
  groupId: string,
  categoryCode: StandingsCategoryCode
): Promise<TieOrderResolver> {
  const [existingRandom, existingManual] = await Promise.all([
    prisma.groupRandomDraw.findMany({
      where: { groupId, categoryCode },
      select: { tieKey: true, orderedTeamIds: true },
    }),
    prisma.rankingTieOverride.findMany({
      where: { scope: "GROUP_STANDINGS", categoryCode, groupId },
      select: { tieKey: true, orderedTeamIds: true },
    }),
  ]);

  const randomOrderByTieKey = new Map<string, string[]>();
  for (const row of existingRandom) {
    const orderedTeamIds = normalizeOrderedTeamIds(row.orderedTeamIds);
    if (orderedTeamIds.length > 0) {
      randomOrderByTieKey.set(row.tieKey, orderedTeamIds);
    }
  }

  const manualOrderByTieKey = new Map<string, string[]>();
  for (const row of existingManual) {
    const orderedTeamIds = normalizeOrderedTeamIds(row.orderedTeamIds);
    if (orderedTeamIds.length > 0) {
      manualOrderByTieKey.set(row.tieKey, orderedTeamIds);
    }
  }

  return {
    async getOrder(params) {
      const manualOrder = manualOrderByTieKey.get(params.exactTieKey);
      if (manualOrder && isValidTieOrder(params.teamIds, manualOrder)) {
        return {
          orderedTeamIds: manualOrder,
          source: "manual" as const,
        };
      }

      const tieKey = buildGroupRandomDrawTieKey(groupId, params.teamIds);
      const cached = randomOrderByTieKey.get(tieKey);
      if (cached && isValidTieOrder(params.teamIds, cached)) {
        return {
          orderedTeamIds: cached,
          source: "random" as const,
        };
      }

      const sortedIds = [...params.teamIds].sort();
      const shuffled = shuffleIds(sortedIds);

      try {
        const row = await prisma.groupRandomDraw.upsert({
          where: { tieKey },
          update: {},
          create: {
            groupId,
            categoryCode,
            tieKey,
            orderedTeamIds: shuffled,
          },
          select: { orderedTeamIds: true },
        });

        const ordered = normalizeOrderedTeamIds(row.orderedTeamIds);
        const resolvedOrder = isValidTieOrder(params.teamIds, ordered) ? ordered : shuffled;
        randomOrderByTieKey.set(tieKey, resolvedOrder);
        return {
          orderedTeamIds: resolvedOrder,
          source: "random" as const,
        };
      } catch {
        const fallback = await prisma.groupRandomDraw.findUnique({
          where: { tieKey },
          select: { orderedTeamIds: true },
        });
        if (fallback) {
          const ordered = normalizeOrderedTeamIds(fallback.orderedTeamIds);
          if (isValidTieOrder(params.teamIds, ordered)) {
            randomOrderByTieKey.set(tieKey, ordered);
            return {
              orderedTeamIds: ordered,
              source: "random" as const,
            };
          }
        }
        throw new Error("Unable to resolve random draw order.");
      }
    },
  };
}

async function resolveStandingsForGroup(
  group: GroupForStandings,
  tieOrderResolver: TieOrderResolver
): Promise<GroupResolvedStandings> {
  const stats = new Map<string, StandingRow>();
  const teams = group.teams.map((entry) => entry.team);

  for (const team of teams) {
    stats.set(team.id, {
      teamId: team.id,
      teamName:
        team.name ||
        (team.members.length === 2
          ? `${team.members[0]?.player.name ?? ""} / ${team.members[1]?.player.name ?? ""}`
          : "Unnamed team"),
      wins: 0,
      losses: 0,
      played: 0,
      pointsFor: 0,
      pointsAgainst: 0,
      pointDiff: 0,
      avgPointDiff: 0,
      avgPointsFor: 0,
    });
  }

  const completedMatches = group.matches.filter((match) => match.status === "COMPLETED");

  for (const match of completedMatches) {
    if (!match.homeTeamId || !match.awayTeamId || !match.winnerTeamId) continue;
    const home = stats.get(match.homeTeamId);
    const away = stats.get(match.awayTeamId);
    if (!home || !away) continue;

    home.played += 1;
    away.played += 1;

    if (match.winnerTeamId === match.homeTeamId) {
      home.wins += 1;
      away.losses += 1;
    } else if (match.winnerTeamId === match.awayTeamId) {
      away.wins += 1;
      home.losses += 1;
    }

    for (const game of match.games) {
      home.pointsFor += game.homePoints;
      home.pointsAgainst += game.awayPoints;
      away.pointsFor += game.awayPoints;
      away.pointsAgainst += game.homePoints;
    }
  }

  const fallbackTies: GroupStandingFallbackTie[] = [];
  const resolved = await resolveStandingRows({
    rows: Array.from(stats.values(), finalizeStandingMetrics),
    completedMatches,
    buildTieKey: (tieGroup) =>
      buildGroupStandingOverrideTieKey({
        groupId: group.id,
        teamIds: tieGroup.map((row) => row.teamId),
        wins: tieGroup[0]?.wins ?? 0,
        avgPointDiff: tieGroup[0]?.avgPointDiff ?? 0,
        avgPointsFor: tieGroup[0]?.avgPointsFor ?? 0,
      }),
    getFallbackOrder: (tie) =>
      tieOrderResolver.getOrder({
        exactTieKey: tie.tieKey,
        teamIds: tie.teamIds,
      }),
    onFallbackResolved: (tie) => {
      fallbackTies.push({
        tieKey: tie.tieKey,
        source: tie.source,
        orderedTeamIds: tie.orderedTeamIds,
        rows: tie.rows,
      });
    },
  });

  return {
    group,
    matches: group.matches,
    standings: resolved,
    fallbackTies,
  };
}

function groupStandingsSelect() {
  return {
    id: true,
    name: true,
    category: {
      select: {
        code: true,
      },
    },
    teams: {
      select: {
        team: {
          select: {
            id: true,
            name: true,
            members: {
              select: {
                player: {
                  select: {
                    name: true,
                  },
                },
              },
            },
          },
        },
      },
    },
    matches: {
      where: {
        stage: "GROUP" as const,
      },
      select: {
        id: true,
        status: true,
        winnerTeamId: true,
        homeTeamId: true,
        awayTeamId: true,
        games: {
          select: {
            gameNumber: true,
            homePoints: true,
            awayPoints: true,
          },
          orderBy: {
            gameNumber: "asc" as const,
          },
        },
      },
      orderBy: {
        createdAt: "asc" as const,
      },
    },
  };
}

export async function computeStandings(groupId: string) {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: groupStandingsSelect(),
  });

  if (!group) return null;

  const resolvedGroup = group as GroupForStandings;
  const tieOrderResolver = await createGroupTieOrderResolver(
    resolvedGroup.id,
    resolvedGroup.category.code
  );

  return resolveStandingsForGroup(resolvedGroup, tieOrderResolver);
}

export async function computeStandingsForCategory(categoryCode: StandingsCategoryCode) {
  const groups = await prisma.group.findMany({
    where: { category: { code: categoryCode } },
    select: groupStandingsSelect(),
    orderBy: { name: "asc" },
  });

  return Promise.all(
    groups.map(async (group) => {
      const resolvedGroup = group as GroupForStandings;
      const tieOrderResolver = await createGroupTieOrderResolver(
        resolvedGroup.id,
        resolvedGroup.category.code
      );
      return resolveStandingsForGroup(resolvedGroup, tieOrderResolver);
    })
  );
}

export async function getCompletedGroupMatches(groupId: string) {
  return prisma.match.findMany({
    where: {
      groupId,
      stage: "GROUP",
      status: "COMPLETED",
    },
    select: {
      id: true,
      status: true,
      winnerTeamId: true,
      homeTeamId: true,
      awayTeamId: true,
      homeTeam: {
        select: {
          id: true,
          name: true,
          members: {
            select: {
              player: {
                select: {
                  name: true,
                },
              },
            },
          },
        },
      },
      awayTeam: {
        select: {
          id: true,
          name: true,
          members: {
            select: {
              player: {
                select: {
                  name: true,
                },
              },
            },
          },
        },
      },
      games: {
        select: {
          gameNumber: true,
          homePoints: true,
          awayPoints: true,
        },
        orderBy: {
          gameNumber: "asc",
        },
      },
    },
    orderBy: {
      createdAt: "asc",
    },
  });
}
