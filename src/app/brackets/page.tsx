import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { BracketDiagram } from "@/app/knockout/bracket-diagram";
import { getRoleFromRequest } from "@/lib/auth";
import { getFavouritePlayerCategoryMap, getFavouritePlayerContext } from "@/lib/favourite-player";

export const dynamic = "force-dynamic";
export const metadata = { title: "Brackets" };

type BracketsPageProps = {
  searchParams?: Promise<{ category?: string; series?: "A" | "B"; fromNav?: string }>;
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
  const role = await getRoleFromRequest();
  const favourite = await getFavouritePlayerContext();
  const favouriteMap = await getFavouritePlayerCategoryMap();
  const isViewer = role === "viewer";
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const fromNav = resolvedSearchParams?.fromNav === "1";
  const selectedCategory =
    isViewer &&
    fromNav &&
    favourite?.categoryCode &&
    categories.includes(favourite.categoryCode)
      ? favourite.categoryCode
      : categories.includes(resolvedSearchParams?.category as (typeof categories)[number])
        ? (resolvedSearchParams?.category as (typeof categories)[number])
        : "MD";
  const preferredSeries =
    isViewer && fromNav
      ? favouriteMap.get(selectedCategory)?.preferredSeries ?? null
      : null;
  const requestedSeries =
    preferredSeries && seriesOptions.includes(preferredSeries)
      ? preferredSeries
      : seriesOptions.includes(resolvedSearchParams?.series as (typeof seriesOptions)[number])
        ? (resolvedSearchParams?.series as (typeof seriesOptions)[number])
        : "A";
  const isWD = selectedCategory === "WD";
  const selectedSeries = isWD && requestedSeries === "B" ? "A" : requestedSeries;

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

  const showPlayIns = !isWD && matches.some((match) => match.round === 1);

  const seeds = await prisma.knockoutSeed.findMany({
    where: { categoryCode: selectedCategory, series: selectedSeries },
  });
  const seedMap = new Map(seeds.map((seed) => [seed.teamId, seed.seedNo]));

  return (
    <section className="rounded-2xl border border-border bg-card p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Brackets</h1>
          {!isViewer ? (
            <p className="mt-1 text-sm text-muted-foreground">
              Enter results in Matches -&gt; bracket updates automatically.
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {categories.map((categoryCode) => (
            <Button
              key={categoryCode}
              asChild
              variant={categoryCode === selectedCategory ? "default" : "outline"}
              size="sm"
            >
              <Link
                href={`/brackets?category=${categoryCode}&series=${
                  isViewer
                    ? favouriteMap.get(categoryCode)?.preferredSeries ?? selectedSeries
                    : selectedSeries
                }`}
              >
                {categoryCode}
              </Link>
            </Button>
          ))}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {(isWD ? (["A"] as const) : seriesOptions).map((series) => (
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
          Knockout Stage has not begun.
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
            favouritePlayerName={favourite?.playerName ?? null}
          />
        </div>
      )}
    </section>
  );
}
