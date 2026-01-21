import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { BracketDiagram } from "@/app/knockout/bracket-diagram";

type BracketsPageProps = {
  searchParams?: Promise<{ category?: string; series?: "A" | "B" }>;
};

const categories = ["MD", "WD", "XD"] as const;
const seriesOptions = ["A", "B"] as const;

function teamLabel(team: {
  name: string;
  members: { player: { name: string } }[];
}) {
  if (team.name) return team.name;
  const names = team.members.map((member) => member.player.name);
  return names.length === 2 ? `${names[0]} / ${names[1]}` : "Unnamed team";
}

export default async function BracketsPage({ searchParams }: BracketsPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const selectedCategory = categories.includes(
    resolvedSearchParams?.category as (typeof categories)[number]
  )
    ? (resolvedSearchParams?.category as (typeof categories)[number])
    : "MD";
  const selectedSeries = seriesOptions.includes(
    resolvedSearchParams?.series as (typeof seriesOptions)[number]
  )
    ? (resolvedSearchParams?.series as (typeof seriesOptions)[number])
    : "A";

  const matches = await prisma.knockoutMatch.findMany({
    where: { categoryCode: selectedCategory, series: selectedSeries },
    include: {
      homeTeam: { include: { members: { include: { player: true } } } },
      awayTeam: { include: { members: { include: { player: true } } } },
      previousMatches: true,
      games: true,
    },
    orderBy: [{ round: "asc" }, { matchNo: "asc" }],
  });

  const showPlayIns = matches.some((match) => match.round === 1);

  const seeds = await prisma.knockoutSeed.findMany({
    where: { categoryCode: selectedCategory, series: selectedSeries },
  });
  const seedMap = new Map(seeds.map((seed) => [seed.teamId, seed.seedNo]));

  return (
    <section className="rounded-2xl border border-border bg-card p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Brackets</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Enter results in Matches -&gt; bracket updates automatically.
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
              <Link href={`/brackets?category=${categoryCode}&series=${selectedSeries}`}>
                {categoryCode}
              </Link>
            </Button>
          ))}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {seriesOptions.map((series) => (
          <Button
            key={series}
            asChild
            size="sm"
            variant={series === selectedSeries ? "default" : "outline"}
          >
            <Link href={`/brackets?category=${selectedCategory}&series=${series}`}>
              Series {series}
            </Link>
          </Button>
        ))}
      </div>

      {matches.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">
          Generate the Series {selectedSeries} bracket to view matches.
        </p>
      ) : (
        <div className="mt-6">
          <BracketDiagram
            matches={matches.map((match) => ({
              id: match.id,
              round: match.round,
              matchNo: match.matchNo,
              status: match.status,
              winnerTeamId: match.winnerTeamId,
              games: match.games.map((game) => ({
                gameNumber: game.gameNumber,
                homePoints: game.homePoints,
                awayPoints: game.awayPoints,
              })),
              previousMatches: match.previousMatches.map((prev) => ({
                round: prev.round,
                matchNo: prev.matchNo,
                nextSlot: prev.nextSlot,
              })),
              homeTeam: {
                id: match.homeTeamId,
                name: match.homeTeam ? teamLabel(match.homeTeam) : "TBD",
                seed: match.homeTeamId ? seedMap.get(match.homeTeamId) ?? null : null,
              },
              awayTeam: {
                id: match.awayTeamId,
                name: match.awayTeam ? teamLabel(match.awayTeam) : "TBD",
                seed: match.awayTeamId ? seedMap.get(match.awayTeamId) ?? null : null,
              },
            }))}
            showPlayIns={showPlayIns}
          />
        </div>
      )}
    </section>
  );
}
