import { prisma } from "@/lib/prisma";

type GetScheduledMatchesOptions = {
  onlyWithActiveCourtAssignment?: boolean;
};

export async function getScheduledMatches(options?: GetScheduledMatchesOptions) {
  const onlyWithActiveCourtAssignment = options?.onlyWithActiveCourtAssignment ?? false;
  const groupMatches = await prisma.match.findMany({
    where: {
      status: "SCHEDULED",
      stage: "GROUP",
      homeTeamId: { not: null },
      awayTeamId: { not: null },
      ...(onlyWithActiveCourtAssignment
        ? {
            courtAssignments: {
              some: {
                status: "ACTIVE",
                stage: "GROUP",
              },
            },
          }
        : {}),
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
      ...(onlyWithActiveCourtAssignment
        ? {
            courtAssignments: {
              some: {
                status: "ACTIVE",
                stage: "KNOCKOUT",
              },
            },
          }
        : {}),
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

  return { groupMatches, knockoutMatches };
}
