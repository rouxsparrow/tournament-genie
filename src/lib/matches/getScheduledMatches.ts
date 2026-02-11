import { prisma } from "@/lib/prisma";

export async function getScheduledMatches() {
  const groupMatches = await prisma.match.findMany({
    where: {
      status: "SCHEDULED",
      stage: "GROUP",
      homeTeamId: { not: null },
      awayTeamId: { not: null },
    },
    include: {
      group: { include: { category: true } },
      homeTeam: { include: { members: { include: { player: true } } } },
      awayTeam: { include: { members: { include: { player: true } } } },
      courtAssignments: {
        where: { status: "ACTIVE" },
        orderBy: { assignedAt: "desc" },
        take: 1,
        select: { courtId: true },
      },
    },
    orderBy: [{ group: { name: "asc" } }, { createdAt: "asc" }],
  });

  const knockoutMatches = await prisma.knockoutMatch.findMany({
    where: {
      status: "SCHEDULED",
      isPublished: true,
      homeTeamId: { not: null },
      awayTeamId: { not: null },
    },
    include: {
      homeTeam: { include: { members: { include: { player: true } } } },
      awayTeam: { include: { members: { include: { player: true } } } },
      courtAssignments: {
        where: { status: "ACTIVE" },
        orderBy: { assignedAt: "desc" },
        take: 1,
        select: { courtId: true },
      },
    },
    orderBy: [
      { categoryCode: "asc" },
      { series: "asc" },
      { round: "asc" },
      { matchNo: "asc" },
    ],
  });

  const groups = await prisma.group.findMany({
    include: { category: true },
    orderBy: [{ category: { code: "asc" } }, { name: "asc" }],
  });

  return { groupMatches, knockoutMatches, groups };
}
