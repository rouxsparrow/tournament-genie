import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import {
  computeSeriesQualifiers,
} from "@/app/knockout/actions";
import { SecondChanceToggle } from "@/app/knockout/second-chance-toggle";
import { loadGlobalGroupRanking } from "@/app/knockout/logic";
import { syncKnockoutPropagation } from "@/app/knockout/sync";
import { ClearBracketButton } from "@/app/knockout/clear-bracket-button";
import { GenerateBracketButton } from "@/app/knockout/generate-bracket-button";

type KnockoutPageProps = {
  searchParams?: Promise<{ category?: string; error?: string; adjusted?: string }>;
};

const categories = ["MD", "WD", "XD"] as const;

function teamLabel(team: {
  name: string;
  members: { player: { name: string } }[];
}) {
  if (team.name) return team.name;
  const names = team.members.map((member) => member.player.name);
  return names.length === 2 ? `${names[0]} / ${names[1]}` : "Unnamed team";
}


export default async function KnockoutPage({ searchParams }: KnockoutPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const selectedCategory = categories.includes(
    resolvedSearchParams?.category as (typeof categories)[number]
  )
    ? (resolvedSearchParams?.category as (typeof categories)[number])
    : "MD";
  const errorMessage = resolvedSearchParams?.error
    ? decodeURIComponent(resolvedSearchParams.error)
    : null;
  const adjusted = resolvedSearchParams?.adjusted === "1";
  const isWD = selectedCategory === "WD";

  await syncKnockoutPropagation(selectedCategory);

  const category = await prisma.category.findUnique({
    where: { code: selectedCategory },
  });

  const lock = await prisma.groupStageLock.findUnique({
    where: { categoryCode: selectedCategory },
  });
  const isLocked = lock?.locked ?? false;

  const categoryConfig = await prisma.categoryConfig.findUnique({
    where: { categoryCode: selectedCategory },
  });

  const seriesAExists = await prisma.knockoutMatch.findFirst({
    where: { categoryCode: selectedCategory, series: "A" },
    select: { id: true },
  });
  const seriesBExists = isWD
    ? null
    : await prisma.knockoutMatch.findFirst({
        where: { categoryCode: selectedCategory, series: "B" },
        select: { id: true },
      });

  const qualifiers = await prisma.seriesQualifier.findMany({
    where: { categoryCode: selectedCategory },
    include: {
      team: { include: { members: { include: { player: true } } } },
      group: true,
    },
    orderBy: [{ groupId: "asc" }, { groupRank: "asc" }],
  });

  const groups = category
    ? await prisma.group.findMany({
        where: { categoryId: category.id },
        orderBy: { name: "asc" },
      })
    : [];

  const qualifiersByGroup = new Map(
    groups.map((group) => [
      group.id,
      qualifiers.filter((entry) => entry.groupId === group.id),
    ])
  );
  const seriesACount = qualifiers.filter((entry) => entry.series === "A").length;
  const seriesBCount = qualifiers.filter((entry) => entry.series === "B").length;
  const teamById = new Map(qualifiers.map((entry) => [entry.teamId, entry.team]));

  const globalRanking = isLocked
    ? await loadGlobalGroupRanking(selectedCategory)
    : [];
  const seriesASeedPreview = globalRanking.slice(
    0,
    isWD ? (globalRanking.length >= 8 ? 8 : 4) : 8
  );

  return (
    <section className="rounded-2xl border border-border bg-card p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Knockout</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Split series and generate brackets after group stage lock.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {categories.map((categoryCode) => (
            <Button
              key={categoryCode}
              asChild
              variant={categoryCode === selectedCategory ? "default" : "outline"}
              size="sm"
            >
              <Link href={`/knockout?category=${categoryCode}`}>
                {categoryCode}
              </Link>
            </Button>
          ))}
        </div>
      </div>

      {errorMessage ? (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {errorMessage}
        </div>
      ) : null}

      {!isLocked ? (
        <div className="mt-6 rounded-xl border border-border bg-muted px-4 py-3 text-sm text-muted-foreground">
          Lock the group stage scoring for this category before splitting series
          or generating brackets.
        </div>
      ) : null}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <form action={computeSeriesQualifiers}>
          <input type="hidden" name="category" value={selectedCategory} />
          <Button type="submit" disabled={!isLocked}>
            Compute Series Split
          </Button>
        </form>
        <GenerateBracketButton
          category={selectedCategory}
          series="A"
          disabled={!isLocked}
          exists={Boolean(seriesAExists)}
        />
        {!isWD ? (
          <GenerateBracketButton
            category={selectedCategory}
            series="B"
            disabled={!isLocked}
            exists={Boolean(seriesBExists)}
          />
        ) : null}
        {!isWD && categoryConfig?.secondChanceEnabled ? (
          <span className="text-xs text-muted-foreground">
            Second chance enabled for this category.
          </span>
        ) : null}
        {!isWD ? (
          <SecondChanceToggle
            category={selectedCategory}
            enabled={categoryConfig?.secondChanceEnabled ?? false}
            disabled={!isLocked}
          />
        ) : null}
        {qualifiers.length > 0 ? (
          <span className="text-xs text-muted-foreground">
            Series A: {seriesACount} teams
            {!isWD ? ` · Series B: ${seriesBCount} teams` : ""}
          </span>
        ) : null}
        {adjusted ? (
          <span className="text-xs text-muted-foreground">
            Adjusted: moved lowest-ranked team(s) from Series A to Series B to make Series A even.
          </span>
        ) : null}
        <ClearBracketButton category={selectedCategory} />
      </div>


      <div className="mt-8 space-y-6">
        <div className="rounded-xl border border-border p-5">
          <h2 className="text-lg font-semibold text-foreground">
            Series Split
          </h2>
          {groups.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              No groups found for this category.
            </p>
          ) : (
            <div className="mt-4 space-y-4">
              {groups.map((group) => {
                const entries = qualifiersByGroup.get(group.id) ?? [];
                const seriesA = entries.filter((entry) => entry.series === "A");
                const seriesB = entries.filter((entry) => entry.series === "B");
                return (
                  <div key={group.id} className="rounded-lg border border-border p-4">
                    <p className="text-sm font-semibold text-foreground">
                      Group {group.name}
                    </p>
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground">
                          Series A
                        </p>
                        {seriesA.length === 0 ? (
                          <p className="mt-1 text-sm text-muted-foreground">
                            No qualifiers yet.
                          </p>
                        ) : (
                          <ul className="mt-1 space-y-1 text-sm text-foreground">
                            {seriesA.map((entry) => (
                              <li key={entry.id}>
                                #{entry.groupRank} {teamLabel(entry.team)}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      <div>
                        {!isWD ? (
                          <>
                            <p className="text-xs font-semibold text-muted-foreground">
                              Series B
                            </p>
                            {seriesB.length === 0 ? (
                              <p className="mt-1 text-sm text-muted-foreground">
                                No qualifiers yet.
                              </p>
                            ) : (
                              <ul className="mt-1 space-y-1 text-sm text-foreground">
                                {seriesB.map((entry) => (
                                  <li key={entry.id}>
                                    #{entry.groupRank} {teamLabel(entry.team)}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-border p-5">
          <h2 className="text-lg font-semibold text-foreground">
            Series A Seeds (Qualified Only)
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Bracket uses Series A qualified seeds only (not global group stage ranking).
          </p>
          {seriesASeedPreview.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">
              No Series A qualifiers available.
            </p>
          ) : (
            <ul className="mt-3 space-y-1 text-sm text-foreground">
              {seriesASeedPreview.map((seed) => {
                const team = teamById.get(seed.teamId);
                return (
                  <li key={seed.teamId}>
                    #{seed.globalRank} {team ? teamLabel(team) : seed.teamName}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="rounded-xl border border-border p-5">
          <h2 className="text-lg font-semibold text-foreground">
            Group Stage Ranking
          </h2>
          {globalRanking.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
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
                    <th className="py-2 text-right">Avg PA</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {globalRanking.map((entry) => {
                    const team = teamById.get(entry.teamId);
                    return (
                      <tr key={entry.teamId}>
                        <td className="py-2 text-left">{entry.globalRank}</td>
                        <td className="py-2 text-left">
                          {team ? teamLabel(team) : entry.teamName}
                        </td>
                        <td className="py-2 text-left">
                          {entry.groupName} (#{entry.groupRank})
                        </td>
                        <td className="py-2 text-right">
                          {entry.avgPA.toFixed(2)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
