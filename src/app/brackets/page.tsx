import Link from "next/link";
import { Button } from "@/components/ui/button";
import { BracketDiagram } from "@/app/knockout/bracket-diagram";
import { getRoleFromRequest } from "@/lib/auth";
import { getFavouritePlayerCategoryMap, getFavouritePlayerContext } from "@/lib/favourite-player";
import { getFreshBracketsState } from "@/lib/public-read-models/loaders";
import type { CategoryCode, SeriesCode } from "@/lib/public-read-models/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "Brackets" };

type BracketsPageProps = {
  searchParams?: Promise<{ category?: string; series?: "A" | "B"; fromNav?: string }>;
};

const categories: CategoryCode[] = ["MD", "WD", "XD"];
const seriesOptions: SeriesCode[] = ["A", "B"];

function parseCategory(input: string | undefined): CategoryCode {
  if (input === "WD" || input === "XD") return input;
  return "MD";
}

function parseSeries(input: string | undefined): SeriesCode {
  if (input === "B") return "B";
  return "A";
}

export default async function BracketsPage({ searchParams }: BracketsPageProps) {
  const role = await getRoleFromRequest();
  const favourite = await getFavouritePlayerContext();
  const favouriteMap = await getFavouritePlayerCategoryMap();
  const isViewer = role === "viewer";
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const fromNav = resolvedSearchParams?.fromNav === "1";

  const selectedCategory =
    isViewer && fromNav && favourite?.categoryCode
      ? parseCategory(favourite.categoryCode)
      : parseCategory(resolvedSearchParams?.category);

  const preferredSeries =
    isViewer && fromNav ? favouriteMap.get(selectedCategory)?.preferredSeries ?? null : null;

  const requestedSeries = preferredSeries
    ? parseSeries(preferredSeries)
    : parseSeries(resolvedSearchParams?.series);

  const bracketsState = await getFreshBracketsState(selectedCategory, requestedSeries);
  const selectedSeries = bracketsState.series;

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
        {(bracketsState.isWD ? (["A"] as const) : seriesOptions).map((series) => (
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

      {bracketsState.matches.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">Knockout Stage has not begun.</p>
      ) : (
        <div className="mt-6">
          <BracketDiagram
            matches={bracketsState.matches}
            showPlayIns={bracketsState.showPlayIns}
            favouritePlayerName={favourite?.playerName ?? null}
          />
        </div>
      )}
    </section>
  );
}
