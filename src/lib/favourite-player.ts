import { cache } from "react";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { getRoleFromRequest } from "@/lib/auth";

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

export type FavouriteCategoryPreference = {
  categoryCode: CategoryCode;
  groupId: string | null;
  groupName: string | null;
  seriesOptions: SeriesCode[];
  preferredSeries: SeriesCode | null;
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

const getFavouriteRole = cache(async () => getRoleFromRequest());

export const getFavouritePlayerId = cache(async (): Promise<string | null> => {
  const role = await getFavouriteRole();
  if (role !== "viewer") return null;
  const store = await cookies();
  const value = store.get(COOKIE_NAME)?.value ?? "";
  return value || null;
});

const loadFavouritePlayerBundle = cache(async (): Promise<{
  context: FavouritePlayerContext | null;
  categoryMap: Map<CategoryCode, FavouriteCategoryPreference>;
}> => {
  const playerId = await getFavouritePlayerId();
  if (!playerId) {
    return { context: null, categoryMap: new Map() };
  }

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

  if (!player) {
    return { context: null, categoryMap: new Map() };
  }

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
      teamId: team.id,
      teamName: team.name,
      categoryCode,
      groupId: groupLink?.groupId,
      groupName: groupLink?.group.name,
      series: qualifier?.series as SeriesCode | undefined,
      seriesOptions: team.seriesQualifiers.map((q) => q.series as SeriesCode),
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

  const categoryMap = new Map<CategoryCode, FavouriteCategoryPreference>();
  for (const entry of entries) {
    const mapEntry = categoryMap.get(entry.categoryCode) ?? {
      categoryCode: entry.categoryCode,
      groupId: null,
      groupName: null,
      seriesOptions: [] as SeriesCode[],
      preferredSeries: null,
    };

    if (!mapEntry.groupId && entry.groupId) {
      mapEntry.groupId = entry.groupId;
      mapEntry.groupName = entry.groupName ?? null;
    }

    for (const series of entry.seriesOptions) {
      if (!mapEntry.seriesOptions.includes(series)) {
        mapEntry.seriesOptions.push(series);
      }
    }

    if (entry.series && !mapEntry.seriesOptions.includes(entry.series)) {
      mapEntry.seriesOptions.push(entry.series);
    }

    mapEntry.seriesOptions.sort();
    mapEntry.preferredSeries = mapEntry.seriesOptions.includes("B")
      ? "B"
      : mapEntry.seriesOptions[0] ?? null;

    categoryMap.set(entry.categoryCode, mapEntry);
  }

  const teamIds = entries.map((entry) => entry.teamId);
  if (teamIds.length > 0) {
    const matches = await prisma.knockoutMatch.findMany({
      where: {
        OR: [{ homeTeamId: { in: teamIds } }, { awayTeamId: { in: teamIds } }],
      },
      select: {
        categoryCode: true,
        series: true,
      },
    });

    for (const match of matches) {
      const categoryCode = match.categoryCode as CategoryCode;
      const series = match.series as SeriesCode;
      const entry = categoryMap.get(categoryCode);
      if (!entry) continue;
      if (!entry.seriesOptions.includes(series)) {
        entry.seriesOptions.push(series);
        entry.seriesOptions.sort();
      }
      entry.preferredSeries = entry.seriesOptions.includes("B")
        ? "B"
        : entry.seriesOptions[0] ?? null;
      categoryMap.set(categoryCode, entry);
    }
  }

  return {
    context: {
      playerId: player.id,
      playerName: player.name,
      categoryCode: primary?.categoryCode,
      groupId: primary?.groupId,
      groupName: primary?.groupName,
      series: primary?.series,
    },
    categoryMap,
  };
});

export async function getFavouritePlayerContext(): Promise<FavouritePlayerContext | null> {
  const bundle = await loadFavouritePlayerBundle();
  return bundle.context;
}

export async function getFavouritePlayerCategoryMap(): Promise<
  Map<CategoryCode, FavouriteCategoryPreference>
> {
  const bundle = await loadFavouritePlayerBundle();
  return bundle.categoryMap;
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
