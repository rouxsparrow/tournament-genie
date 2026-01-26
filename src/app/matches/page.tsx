import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import {
  clearGroupStageMatches,
  generateGroupStageMatches,
  lockGroupStage,
  unlockGroupStage,
} from "@/app/matches/actions";
import { MatchesListClient } from "@/app/matches/matches-list-client";
import { KnockoutMatchesSection } from "@/app/matches/knockout-matches-section";
import { syncKnockoutPropagation } from "@/app/knockout/sync";
import { GlobalFormPendingBridge } from "@/components/global-form-pending-bridge";

type MatchesPageProps = {
  searchParams?: Promise<{
    category?: string;
    group?: string;
    search?: string;
    view?: "group" | "knockout";
    error?: string;
  }>;
};

const categories = ["MD", "WD", "XD"] as const;

export const dynamic = "force-dynamic";

export default async function MatchesPage({ searchParams }: MatchesPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const selectedCategory = categories.includes(
    resolvedSearchParams?.category as (typeof categories)[number]
  )
    ? (resolvedSearchParams?.category as (typeof categories)[number])
    : "MD";
  const errorMessage = resolvedSearchParams?.error
    ? decodeURIComponent(resolvedSearchParams.error)
    : null;
  const view = resolvedSearchParams?.view === "knockout" ? "knockout" : "group";
  const initialGroupId = resolvedSearchParams?.group ?? "";
  const initialSearch = resolvedSearchParams?.search ?? "";

  if (view === "knockout") {
    await syncKnockoutPropagation(selectedCategory);
  }

  const category = await prisma.category.findUnique({
    where: { code: selectedCategory },
  });

  const assignmentLock = await prisma.groupAssignmentLock.findUnique({
    where: { categoryCode: selectedCategory },
  });
  const isAssignmentLocked = assignmentLock?.locked ?? false;

  const stageLock = await prisma.groupStageLock.findUnique({
    where: { categoryCode: selectedCategory },
  });
  const isStageLocked = stageLock?.locked ?? false;

  const groups = category
    ? await prisma.group.findMany({
        where: { categoryId: category.id },
        orderBy: { name: "asc" },
      })
    : [];

  const settings = await prisma.tournamentSettings.findFirst({
    orderBy: { createdAt: "desc" },
  });
  const scoringMode = settings?.scoringMode ?? "SINGLE_GAME_21";

  const matches = category
    ? await prisma.match.findMany({
        where: {
          stage: "GROUP",
          group: {
            categoryId: category.id,
          },
        },
        include: {
          group: true,
          homeTeam: { include: { members: { include: { player: true } } } },
          awayTeam: { include: { members: { include: { player: true } } } },
          games: true,
        },
        orderBy: [{ group: { name: "asc" } }, { createdAt: "asc" }],
      })
    : [];

  const knockoutMatches = await prisma.knockoutMatch.findMany({
    where: { categoryCode: selectedCategory, isPublished: true },
    include: {
      homeTeam: { include: { members: { include: { player: true } } } },
      awayTeam: { include: { members: { include: { player: true } } } },
      games: true,
    },
    orderBy: [{ series: "asc" }, { round: "asc" }, { matchNo: "asc" }],
  });

  return (
    <section className="rounded-2xl border border-border bg-card p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Matches</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage group stage and knockout matches.
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
              <Link href={`/matches?category=${categoryCode}&view=${view}`}>
                {categoryCode}
              </Link>
            </Button>
          ))}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button asChild variant={view === "group" ? "default" : "outline"} size="sm">
          <Link href={`/matches?category=${selectedCategory}&view=group`}>
            Group Stage
          </Link>
        </Button>
        <Button
          asChild
          variant={view === "knockout" ? "default" : "outline"}
          size="sm"
        >
          <Link href={`/matches?category=${selectedCategory}&view=knockout`}>
            Knockout
          </Link>
        </Button>
      </div>

      {errorMessage ? (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {errorMessage}
        </div>
      ) : null}

      {view === "group" ? (
        <div className="mt-6 grid gap-4 lg:grid-cols-[2fr,1fr]">
          <div className="rounded-xl border border-border bg-muted px-4 py-3">
            <p className="text-sm font-medium text-foreground">
              Group assignment: {isAssignmentLocked ? "locked" : "unlocked"}
            </p>
            <p className="text-xs text-muted-foreground">
              Matches can only be generated after assignment is locked.
            </p>
          </div>
          <div className="rounded-xl border border-border bg-muted px-4 py-3">
            <p className="text-sm font-medium text-foreground">
              Group stage scoring: {isStageLocked ? "locked" : "unlocked"}
            </p>
            <p className="text-xs text-muted-foreground">
              Lock to prevent further score edits.
            </p>
          </div>
        </div>
      ) : null}

      <div className="mt-6 space-y-6">
        {view === "group" ? (
          <section className="rounded-xl border border-border bg-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-foreground">
                Group Stage Matches
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Buttons below apply to Group Stage matches only.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <form
                action={generateGroupStageMatches}
                className="flex items-center gap-2"
              >
                <GlobalFormPendingBridge />
                <input type="hidden" name="category" value={selectedCategory} />
                <Button type="submit" disabled={!isAssignmentLocked}>
                  Generate matches
                </Button>
              </form>
              <form action={clearGroupStageMatches}>
                <GlobalFormPendingBridge />
                <input type="hidden" name="category" value={selectedCategory} />
                <Button type="submit" variant="outline">
                  Clear matches
                </Button>
              </form>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-muted-foreground">
              Scoring mode:{" "}
              {scoringMode === "SINGLE_GAME_21"
                ? "Single game to 21"
                : "Best of 3 to 21"}
            </div>
            <div className="flex flex-wrap gap-2">
              <form action={lockGroupStage}>
                <GlobalFormPendingBridge />
                <input type="hidden" name="category" value={selectedCategory} />
                <Button size="sm" type="submit" disabled={isStageLocked}>
                  Lock group stage
                </Button>
              </form>
              <form action={unlockGroupStage}>
                <GlobalFormPendingBridge />
                <input type="hidden" name="category" value={selectedCategory} />
                <Button
                  size="sm"
                  type="submit"
                  variant="outline"
                  disabled={!isStageLocked}
                >
                  Unlock
                </Button>
              </form>
            </div>
          </div>

          <div className="mt-6">
            <MatchesListClient
              categoryCode={selectedCategory}
              groups={groups.map((group) => ({ id: group.id, name: group.name }))}
              matches={matches.map((match) => ({
                id: match.id,
                status: match.status,
                winnerTeamId: match.winnerTeamId,
                group: { id: match.group?.id ?? "", name: match.group?.name ?? "" },
                homeTeam: match.homeTeam
                  ? {
                      id: match.homeTeam.id,
                      name: match.homeTeam.name,
                      members: match.homeTeam.members.map((member) => ({
                        player: { name: member.player.name },
                      })),
                    }
                  : null,
                awayTeam: match.awayTeam
                  ? {
                      id: match.awayTeam.id,
                      name: match.awayTeam.name,
                      members: match.awayTeam.members.map((member) => ({
                        player: { name: member.player.name },
                      })),
                    }
                  : null,
                games: match.games.map((game) => ({
                  gameNumber: game.gameNumber,
                  homePoints: game.homePoints,
                  awayPoints: game.awayPoints,
                })),
              }))}
              initialFilters={{ groupId: initialGroupId, search: initialSearch }}
              scoringMode={scoringMode}
              isStageLocked={isStageLocked}
              isDev={process.env.NODE_ENV !== "production"}
            />
          </div>
        </section>
        ) : (
        <KnockoutMatchesSection
          categoryCode={selectedCategory}
          isDev={process.env.NODE_ENV !== "production"}
          scoringMode={scoringMode}
          matches={knockoutMatches.map((match) => ({
            id: match.id,
            series: match.series,
            round: match.round,
            matchNo: match.matchNo,
            status: match.status,
            winnerTeamId: match.winnerTeamId,
            isBestOf3: match.isBestOf3,
            games: match.games.map((game) => ({
              gameNumber: game.gameNumber,
              homePoints: game.homePoints,
              awayPoints: game.awayPoints,
            })),
            homeTeam: match.homeTeam
              ? {
                  id: match.homeTeam.id,
                  name: match.homeTeam.name,
                    members: match.homeTeam.members.map((member) => ({
                      player: { name: member.player.name },
                    })),
                  }
                : null,
              awayTeam: match.awayTeam
                ? {
                    id: match.awayTeam.id,
                    name: match.awayTeam.name,
                    members: match.awayTeam.members.map((member) => ({
                      player: { name: member.player.name },
                    })),
                  }
                : null,
            }))}
          />
        )}
      </div>
    </section>
  );
}
