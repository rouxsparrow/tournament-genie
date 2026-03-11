"use server";

import { prisma } from "@/lib/prisma";

export type StandingsCategoryCode = "MD" | "WD" | "XD";

type StandingRow = {
  teamId: string;
  teamName: string;
  wins: number;
  losses: number;
  played: number;
  pointsFor: number;
  pointsAgainst: number;
  pointDiff: number;
};

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

type GroupResolvedStandings = {
  group: GroupForStandings;
  matches: GroupForStandings["matches"];
  standings: StandingRow[];
};

type RandomDrawResolver = {
  getOrder: (teamIds: string[]) => Promise<string[]>;
};

function buildTieKey(groupId: string, teamIds: string[]) {
  const sortedIds = [...teamIds].sort();
  return `${groupId}:${sortedIds.join(",")}`;
}

function shuffleIds(teamIds: string[]) {
  const shuffled = [...teamIds];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

async function createGroupRandomDrawResolver(
  groupId: string,
  categoryCode: StandingsCategoryCode
): Promise<RandomDrawResolver> {
  const existing = await prisma.groupRandomDraw.findMany({
    where: { groupId, categoryCode },
    select: { tieKey: true, orderedTeamIds: true },
  });

  const orderByTieKey = new Map<string, string[]>();
  for (const row of existing) {
    if (Array.isArray(row.orderedTeamIds)) {
      orderByTieKey.set(row.tieKey, row.orderedTeamIds as string[]);
    }
  }

  return {
    async getOrder(teamIds: string[]) {
      const tieKey = buildTieKey(groupId, teamIds);
      const cached = orderByTieKey.get(tieKey);
      if (cached && cached.length > 0) return cached;

      const sortedIds = [...teamIds].sort();
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

        const ordered = Array.isArray(row.orderedTeamIds)
          ? (row.orderedTeamIds as string[])
          : shuffled;
        orderByTieKey.set(tieKey, ordered);
        return ordered;
      } catch {
        const fallback = await prisma.groupRandomDraw.findUnique({
          where: { tieKey },
          select: { orderedTeamIds: true },
        });
        if (fallback && Array.isArray(fallback.orderedTeamIds)) {
          const ordered = fallback.orderedTeamIds as string[];
          orderByTieKey.set(tieKey, ordered);
          return ordered;
        }
        throw new Error("Unable to resolve random draw order.");
      }
    },
  };
}

async function resolveStandingsForGroup(
  group: GroupForStandings,
  randomDrawResolver: RandomDrawResolver
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

  for (const entry of stats.values()) {
    entry.pointDiff = entry.pointsFor - entry.pointsAgainst;
  }

  const baseSorted = Array.from(stats.values()).sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (b.pointDiff !== a.pointDiff) return b.pointDiff - a.pointDiff;
    if (b.pointsFor !== a.pointsFor) return b.pointsFor - a.pointsFor;
    return a.teamName.localeCompare(b.teamName);
  });

  const resolved: StandingRow[] = [];
  let index = 0;

  while (index < baseSorted.length) {
    let nextIndex = index + 1;
    while (
      nextIndex < baseSorted.length &&
      baseSorted[nextIndex].wins === baseSorted[index].wins &&
      baseSorted[nextIndex].pointDiff === baseSorted[index].pointDiff &&
      baseSorted[nextIndex].pointsFor === baseSorted[index].pointsFor
    ) {
      nextIndex += 1;
    }

    const tieGroup = baseSorted.slice(index, nextIndex);

    if (tieGroup.length === 2) {
      const [first, second] = tieGroup;
      const headToHead = completedMatches.find(
        (match) =>
          (match.homeTeamId === first.teamId && match.awayTeamId === second.teamId) ||
          (match.homeTeamId === second.teamId && match.awayTeamId === first.teamId)
      );

      if (headToHead?.winnerTeamId === first.teamId) {
        resolved.push(first, second);
      } else if (headToHead?.winnerTeamId === second.teamId) {
        resolved.push(second, first);
      } else {
        const order = await randomDrawResolver.getOrder([first.teamId, second.teamId]);
        const ordered = order
          .map((id) => tieGroup.find((team) => team.teamId === id))
          .filter((team): team is StandingRow => Boolean(team));
        resolved.push(...ordered);
      }
    } else if (tieGroup.length > 2) {
      const order = await randomDrawResolver.getOrder(tieGroup.map((team) => team.teamId));
      const ordered = order
        .map((id) => tieGroup.find((team) => team.teamId === id))
        .filter((team): team is StandingRow => Boolean(team));
      resolved.push(...ordered);
    } else {
      resolved.push(...tieGroup);
    }

    index = nextIndex;
  }

  return {
    group,
    matches: group.matches,
    standings: resolved,
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
  const randomDrawResolver = await createGroupRandomDrawResolver(
    resolvedGroup.id,
    resolvedGroup.category.code
  );

  return resolveStandingsForGroup(resolvedGroup, randomDrawResolver);
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
      const randomDrawResolver = await createGroupRandomDrawResolver(
        resolvedGroup.id,
        resolvedGroup.category.code
      );
      return resolveStandingsForGroup(resolvedGroup, randomDrawResolver);
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
