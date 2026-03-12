import { Badge } from "@/components/ui/badge";
import { loadGlobalGroupRanking } from "@/app/knockout/logic";
import { prisma } from "@/lib/prisma";

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
        isLocked: lock?.locked ?? false,
        globalRanking,
        qualifiedSeriesByTeamId: new Map(
          qualifiers.map((entry) => [entry.teamId, entry.series] as const)
        ),
        teamById: new Map(qualifiers.map((entry) => [entry.teamId, entry.team] as const)),
      };
    })
  );

  return (
    <section className="rounded-2xl border border-border bg-card p-8">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Group Stage Result</h1>
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-3">
        {results.map((categoryResult) => (
          <div key={categoryResult.categoryCode} className="rounded-xl border border-border p-5">
            <h2 className="text-lg font-semibold text-foreground">
              {categoryResult.categoryCode} · {categoryLabelByCode[categoryResult.categoryCode]}
            </h2>

            {!categoryResult.isLocked ? (
              <p className="mt-3 rounded-lg border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
                Group stage is not locked for this category yet.
              </p>
            ) : categoryResult.globalRanking.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">
                No completed group standings available.
              </p>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="py-2 text-left">Rank</th>
                      <th className="py-2 text-left">Team</th>
                      <th className="py-2 text-left">Group</th>
                      <th className="py-2 text-left">Status</th>
                      <th className="py-2 text-right">Avg PA</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {categoryResult.globalRanking.map((entry) => {
                      const team = categoryResult.teamById.get(entry.teamId);
                      const qualifierSeries =
                        categoryResult.qualifiedSeriesByTeamId.get(entry.teamId);
                      return (
                        <tr key={entry.teamId}>
                          <td className="py-2 text-left">{entry.globalRank}</td>
                          <td className="py-2 text-left">
                            {team ? teamLabel(team) : entry.teamName}
                          </td>
                          <td className="py-2 text-left">
                            {entry.groupName} (#{entry.groupRank})
                          </td>
                          <td className="py-2 text-left">
                            {qualifierSeries === "A" ? (
                              <Badge variant="default">Series A</Badge>
                            ) : qualifierSeries === "B" ? (
                              <Badge variant="secondary">Series B</Badge>
                            ) : (
                              <Badge
                                variant="outline"
                                className="border-red-300 text-red-700 dark:border-red-500/50 dark:text-red-300"
                              >
                                Eliminated
                              </Badge>
                            )}
                          </td>
                          <td className="py-2 text-right">{entry.avgPA.toFixed(2)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
