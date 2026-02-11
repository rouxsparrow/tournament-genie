"use server";

import { prisma } from "@/lib/prisma";

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
  category: { code: "MD" | "WD" | "XD" };
  teams: {
    team: {
      id: string;
      name: string;
      members: { player: { name: string } }[];
    };
  }[];
  matches: {
    id: string;
    status: "SCHEDULED" | "COMPLETED" | "WALKOVER";
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

async function getRandomDrawOrder(params: {
  groupId: string;
  categoryCode: "MD" | "WD" | "XD";
  teamIds: string[];
}) {
  const sortedIds = [...params.teamIds].sort();
  const tieKey = `${params.groupId}:${sortedIds.join(",")}`;

  const existing = await prisma.groupRandomDraw.findUnique({
    where: { tieKey },
  });

  if (existing && Array.isArray(existing.orderedTeamIds)) {
    return existing.orderedTeamIds as string[];
  }

  const shuffled = [...sortedIds];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  try {
    const created = await prisma.groupRandomDraw.create({
      data: {
        groupId: params.groupId,
        categoryCode: params.categoryCode,
        tieKey,
        orderedTeamIds: shuffled,
      },
    });
    return created.orderedTeamIds as string[];
  } catch (error) {
    const fallback = await prisma.groupRandomDraw.findUnique({ where: { tieKey } });
    if (fallback && Array.isArray(fallback.orderedTeamIds)) {
      return fallback.orderedTeamIds as string[];
    }
    throw error;
  }
}

export async function computeStandings(groupId: string) {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    include: {
      category: true,
      teams: {
        include: {
          team: {
            include: { members: { include: { player: true } } },
          },
        },
      },
      matches: {
        where: { stage: "GROUP" },
        include: {
          games: true,
          homeTeam: true,
          awayTeam: true,
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!group) return null;
  return resolveStandingsForGroup(group as GroupForStandings);
}

async function resolveStandingsForGroup(group: GroupForStandings) {

  const stats = new Map<string, StandingRow>();
  const teams = group.teams.map((entry) => entry.team);

  for (const team of teams) {
    stats.set(team.id, {
      teamId: team.id,
      teamName: team.name,
      wins: 0,
      losses: 0,
      played: 0,
      pointsFor: 0,
      pointsAgainst: 0,
      pointDiff: 0,
    });
  }

  const completedMatches = group.matches.filter(
    (match) => match.status === "COMPLETED" || match.status === "WALKOVER"
  );

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
          (match.homeTeamId === first.teamId &&
            match.awayTeamId === second.teamId) ||
          (match.homeTeamId === second.teamId &&
            match.awayTeamId === first.teamId)
      );

      if (headToHead?.winnerTeamId === first.teamId) {
        resolved.push(first, second);
      } else if (headToHead?.winnerTeamId === second.teamId) {
        resolved.push(second, first);
      } else {
        const order = await getRandomDrawOrder({
          groupId: group.id,
          categoryCode: group.category.code,
          teamIds: [first.teamId, second.teamId],
        });
        const ordered = order
          .map((id) => tieGroup.find((team) => team.teamId === id))
          .filter((team): team is StandingRow => Boolean(team));
        resolved.push(...ordered);
      }
    } else if (tieGroup.length > 2) {
      const order = await getRandomDrawOrder({
        groupId: group.id,
        categoryCode: group.category.code,
        teamIds: tieGroup.map((team) => team.teamId),
      });
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

export async function computeStandingsForCategory(categoryCode: "MD" | "WD" | "XD") {
  const groups = await prisma.group.findMany({
    where: { category: { code: categoryCode } },
    include: {
      category: true,
      teams: {
        include: {
          team: {
            include: { members: { include: { player: true } } },
          },
        },
      },
      matches: {
        where: { stage: "GROUP" },
        include: {
          games: true,
          homeTeam: true,
          awayTeam: true,
        },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: { name: "asc" },
  });

  return Promise.all(
    groups.map((group) => resolveStandingsForGroup(group as GroupForStandings))
  );
}
