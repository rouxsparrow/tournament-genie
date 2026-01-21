import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { computeStandings } from "@/app/standings/actions";
import { StandingsClient } from "@/app/standings/standings-client";

export const dynamic = "force-dynamic";

type StandingsPageProps = {
  searchParams?: Promise<{ category?: string; error?: string }>;
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

export default async function StandingsPage({ searchParams }: StandingsPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const selectedCategory = categories.includes(
    resolvedSearchParams?.category as (typeof categories)[number]
  )
    ? (resolvedSearchParams?.category as (typeof categories)[number])
    : "MD";
  const errorMessage = resolvedSearchParams?.error
    ? decodeURIComponent(resolvedSearchParams.error)
    : null;

  const category = await prisma.category.findUnique({
    where: { code: selectedCategory },
  });

  const groups = category
    ? await prisma.group.findMany({
        where: { categoryId: category.id },
        orderBy: { name: "asc" },
      })
    : [];

  const groupData = (
    await Promise.all(groups.map((group) => computeStandings(group.id)))
  ).filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

  return (
    <section className="rounded-2xl border border-border bg-card p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Standings</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            View group-stage rankings and completed results.
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
              <Link href={`/standings?category=${categoryCode}`}>
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

      <StandingsClient
        categoryCode={selectedCategory}
        groups={groups.map((group) => ({ id: group.id, name: group.name }))}
        groupData={groupData.map((entry) => ({
          group: {
            id: entry.group.id,
            name: entry.group.name,
            teams: entry.group.teams.map((teamEntry) => ({
              team: {
                id: teamEntry.team.id,
                name: teamEntry.team.name,
                members: teamEntry.team.members.map((member) => ({
                  player: { name: member.player.name },
                })),
              },
            })),
          },
          standings: entry.standings,
          matches: entry.matches.map((match) => ({
            id: match.id,
            status: match.status,
            winnerTeamId: match.winnerTeamId,
            homeTeamId: match.homeTeamId,
            awayTeamId: match.awayTeamId,
            games: match.games.map((game) => ({
              gameNumber: game.gameNumber,
              homePoints: game.homePoints,
              awayPoints: game.awayPoints,
            })),
          })),
        }))}
      />
    </section>
  );
}
