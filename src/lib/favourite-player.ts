import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";

const COOKIE_NAME = "tg_fav_player_id";

type CategoryCode = "MD" | "WD" | "XD";
type SeriesCode = "A" | "B";

export type FavouritePlayerContext = {
  playerId: string;
  playerName: string;
  categoryCode?: CategoryCode;
  groupId?: string;
  groupName?: string;
  series?: SeriesCode;
};

function normalize(value: string) {
  return value.toLowerCase();
}

function compareNullable(a?: string, b?: string) {
  if (a === b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a.localeCompare(b);
}

export async function getFavouritePlayerId(): Promise<string | null> {
  const store = await cookies();
  const value = store.get(COOKIE_NAME)?.value ?? "";
  return value || null;
}

export async function getFavouritePlayerContext(): Promise<FavouritePlayerContext | null> {
  const playerId = await getFavouritePlayerId();
  if (!playerId) return null;

  const player = await prisma.player.findUnique({
    where: { id: playerId },
    include: {
      teams: {
        include: {
          team: {
            include: {
              category: true,
              groupLinks: { include: { group: true } },
              seriesQualifiers: true,
            },
          },
        },
      },
    },
  });

  if (!player) return null;

  const entries = player.teams.map((member) => {
    const team = member.team;
    const categoryCode = team.category.code as CategoryCode;
    const groupLink = [...team.groupLinks].sort((a, b) =>
      normalize(a.group.name).localeCompare(normalize(b.group.name))
    )[0];
    const qualifier = [...team.seriesQualifiers].sort((a, b) =>
      normalize(a.series).localeCompare(normalize(b.series))
    )[0];

    return {
      teamName: team.name,
      categoryCode,
      groupId: groupLink?.groupId,
      groupName: groupLink?.group.name,
      series: qualifier?.series as SeriesCode | undefined,
    };
  });

  const [primary] = [...entries].sort((a, b) => {
    const cat = compareNullable(a.categoryCode, b.categoryCode);
    if (cat !== 0) return cat;
    const team = compareNullable(a.teamName, b.teamName);
    if (team !== 0) return team;
    const group = compareNullable(a.groupName, b.groupName);
    if (group !== 0) return group;
    return compareNullable(a.series, b.series);
  });

  return {
    playerId: player.id,
    playerName: player.name,
    categoryCode: primary?.categoryCode,
    groupId: primary?.groupId,
    groupName: primary?.groupName,
    series: primary?.series,
  };
}

export type FavouriteCategoryPreference = {
  categoryCode: CategoryCode;
  groupId: string | null;
  groupName: string | null;
  seriesOptions: SeriesCode[];
  preferredSeries: SeriesCode | null;
};

export async function getFavouritePlayerCategoryMap(): Promise<
  Map<CategoryCode, FavouriteCategoryPreference>
> {
  const playerId = await getFavouritePlayerId();
  if (!playerId) return new Map();

  const player = await prisma.player.findUnique({
    where: { id: playerId },
    include: {
      teams: {
        include: {
          team: {
            include: {
              category: true,
              groupLinks: { include: { group: true } },
              seriesQualifiers: true,
            },
          },
        },
      },
    },
  });

  if (!player) return new Map();

  const map = new Map<CategoryCode, FavouriteCategoryPreference>();
  const teamIds: string[] = [];
  const teamCategoryById = new Map<string, CategoryCode>();

  for (const member of player.teams) {
    const team = member.team;
    const categoryCode = team.category.code as CategoryCode;
    teamIds.push(team.id);
    teamCategoryById.set(team.id, categoryCode);
    const entry = map.get(categoryCode) ?? {
      categoryCode,
      groupId: null,
      groupName: null,
      seriesOptions: [] as SeriesCode[],
      preferredSeries: null,
    };

    const groupLink = [...team.groupLinks].sort((a, b) =>
      normalize(a.group.name).localeCompare(normalize(b.group.name))
    )[0];
    if (!entry.groupId && groupLink) {
      entry.groupId = groupLink.groupId;
      entry.groupName = groupLink.group.name;
    }

    for (const qualifier of team.seriesQualifiers) {
      const series = qualifier.series as SeriesCode;
      if (!entry.seriesOptions.includes(series)) {
        entry.seriesOptions.push(series);
      }
    }

    entry.seriesOptions.sort();
    entry.preferredSeries = entry.seriesOptions.includes("B")
      ? "B"
      : entry.seriesOptions[0] ?? null;

    map.set(categoryCode, entry);
  }

  if (teamIds.length > 0) {
    const matches = await prisma.knockoutMatch.findMany({
      where: {
        OR: [{ homeTeamId: { in: teamIds } }, { awayTeamId: { in: teamIds } }],
      },
      select: {
        categoryCode: true,
        series: true,
        homeTeamId: true,
        awayTeamId: true,
      },
    });

    for (const match of matches) {
      const matchCategory = match.categoryCode as CategoryCode;
      const entry = map.get(matchCategory);
      if (!entry) continue;
      const series = match.series as SeriesCode;
      if (!entry.seriesOptions.includes(series)) {
        entry.seriesOptions.push(series);
      }
      entry.seriesOptions.sort();
      entry.preferredSeries = entry.seriesOptions.includes("B")
        ? "B"
        : entry.seriesOptions[0] ?? null;
      map.set(matchCategory, entry);
    }
  }

  return map;
}

export async function setFavouritePlayerIdCookie(playerId: string | null) {
  const store = await cookies();
  if (!playerId) {
    store.set(COOKIE_NAME, "", {
      path: "/",
      maxAge: 0,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
    });
    return;
  }

  store.set(COOKIE_NAME, playerId, {
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
  });
}
