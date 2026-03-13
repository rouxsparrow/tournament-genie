import { loadGlobalGroupRanking } from "@/app/knockout/logic";
import { prisma } from "@/lib/prisma";
import { GroupStageResultRotator } from "@/app/group-stage-result/rotator";

export const dynamic = "force-dynamic";
export const metadata = { title: "Group Stage Result" };

const categories = ["MD", "WD", "XD"] as const;

type CategoryCode = (typeof categories)[number];

const categoryLabelByCode: Record<CategoryCode, string> = {
  MD: "Men's Doubles",
  WD: "Women's Doubles",
  XD: "Mixed Doubles",
};

function teamLabel(team: {
  name: string;
  members: { player: { name: string } }[];
}) {
  if (team.name) return team.name;
  const names = team.members.map((member) => member.player.name);
  return names.length === 2 ? `${names[0]} / ${names[1]}` : "Unnamed team";
}

export default async function GroupStageResultPage() {
  const results = await Promise.all(
    categories.map(async (categoryCode) => {
      const [lock, qualifiers, globalRanking] = await Promise.all([
        prisma.groupStageLock.findUnique({
          where: { categoryCode },
        }),
        prisma.seriesQualifier.findMany({
          where: { categoryCode },
          include: {
            team: {
              include: {
                members: {
                  include: {
                    player: true,
                  },
                },
              },
            },
          },
        }),
        loadGlobalGroupRanking(categoryCode),
      ]);

      return {
        categoryCode,
        categoryLabel: categoryLabelByCode[categoryCode],
        isLocked: lock?.locked ?? false,
        rows: globalRanking.map((entry) => {
          const qualifier = qualifiers.find((qualifierEntry) => qualifierEntry.teamId === entry.teamId);
          const team = qualifier?.team ?? null;

          return {
            teamId: entry.teamId,
            globalRank: entry.globalRank,
            teamLabel: team ? teamLabel(team) : entry.teamName,
            groupLabel: `${entry.groupName} (#${entry.groupRank})`,
            qualifierSeries: qualifier?.series ?? null,
            avgPD: entry.avgPD,
            avgPF: entry.avgPF,
          };
        }),
      };
    })
  );

  return (
    <div className="lg:relative lg:left-1/2 lg:right-1/2 lg:-mx-[50vw] lg:w-screen lg:px-6 xl:px-10">
      <section className="rounded-2xl border border-border bg-card px-4 py-5 md:px-6 lg:mx-auto lg:max-w-[1560px] lg:px-8">
        <GroupStageResultRotator results={results} />
      </section>
    </div>
  );
}
