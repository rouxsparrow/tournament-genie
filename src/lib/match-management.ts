import { prisma } from "@/lib/prisma";

export type CategoryCode = "MD" | "WD" | "XD";

export async function generateGroupStageMatchesForCategory(categoryCode: CategoryCode) {
  const category = await prisma.category.findUnique({
    where: { code: categoryCode },
  });

  if (!category) {
    throw new Error("Category not found.");
  }

  const groups = await prisma.group.findMany({
    where: { categoryId: category.id },
    include: { teams: true },
    orderBy: { name: "asc" },
  });

  if (groups.length === 0) {
    throw new Error("No groups found.");
  }

  const groupIds = groups.map((group) => group.id);
  const existingMatches = await prisma.match.findMany({
    where: {
      stage: "GROUP",
      groupId: { in: groupIds },
    },
    select: {
      groupId: true,
      homeTeamId: true,
      awayTeamId: true,
    },
  });

  const existingKeys = new Set(
    existingMatches
      .filter((match) => match.groupId && match.homeTeamId && match.awayTeamId)
      .map((match) => {
        const sorted = [match.homeTeamId!, match.awayTeamId!].sort();
        return `${match.groupId}:${sorted[0]}:${sorted[1]}`;
      })
  );

  const toCreate: {
    stage: "GROUP";
    groupId: string;
    homeTeamId: string;
    awayTeamId: string;
    status: "SCHEDULED";
  }[] = [];

  for (const group of groups) {
    const teamIds = group.teams.map((entry) => entry.teamId).sort();
    if (teamIds.length < 2) continue;
    for (let i = 0; i < teamIds.length; i += 1) {
      for (let j = i + 1; j < teamIds.length; j += 1) {
        const homeTeamId = teamIds[i];
        const awayTeamId = teamIds[j];
        const key = `${group.id}:${homeTeamId}:${awayTeamId}`;
        if (existingKeys.has(key)) continue;
        existingKeys.add(key);
        toCreate.push({
          stage: "GROUP",
          groupId: group.id,
          homeTeamId,
          awayTeamId,
          status: "SCHEDULED",
        });
      }
    }
  }

  if (toCreate.length > 0) {
    await prisma.match.createMany({
      data: toCreate,
      skipDuplicates: true,
    });
  }

  return { createdCount: toCreate.length };
}

export async function clearGroupStageMatchesForCategory(categoryCode: CategoryCode) {
  const result = await prisma.match.deleteMany({
    where: {
      stage: "GROUP",
      group: { category: { code: categoryCode } },
    },
  });

  return { deletedCount: result.count };
}

export async function publishKnockoutMatchesForCategory(categoryCode: CategoryCode) {
  const result = await prisma.knockoutMatch.updateMany({
    where: { categoryCode },
    data: { isPublished: true },
  });

  return { publishedCount: result.count };
}

export async function clearKnockoutBracketArtifacts(
  categoryCode: CategoryCode,
  seriesOverride?: ("A" | "B")[]
) {
  const seriesList: ("A" | "B")[] =
    seriesOverride && seriesOverride.length > 0
      ? seriesOverride
      : categoryCode === "WD"
        ? ["A"]
        : ["A", "B"];

  await prisma.$transaction([
    prisma.refereeSubmission.deleteMany({
      where: { matchType: "KNOCKOUT", categoryCode, series: { in: seriesList } },
    }),
    prisma.knockoutMatch.deleteMany({
      where: { categoryCode, series: { in: seriesList } },
    }),
    prisma.knockoutSeed.deleteMany({
      where: { categoryCode, series: { in: seriesList } },
    }),
    prisma.knockoutRandomDraw.deleteMany({
      where: {
        categoryCode,
        series: { in: seriesList },
        NOT: { drawKey: { startsWith: "global:" } },
      },
    }),
  ]);
}
