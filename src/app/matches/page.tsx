import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { MatchesListClient } from "@/app/matches/matches-list-client";
import { KnockoutMatchesSection } from "@/app/matches/knockout-matches-section";
import { syncKnockoutPropagation } from "@/app/knockout/sync";

type MatchesPageProps = {
  searchParams?: Promise<{
    category?: string;
    group?: string;
    search?: string;
    view?: "group" | "knockout";
    error?: string;
  }>;
};

const categoryFilters = ["ALL", "MD", "WD", "XD"] as const;

export const dynamic = "force-dynamic";
export const metadata = { title: "Matches" };

export default async function MatchesPage({ searchParams }: MatchesPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const selectedCategory = categoryFilters.includes(
    resolvedSearchParams?.category as (typeof categoryFilters)[number]
  )
    ? (resolvedSearchParams?.category as (typeof categoryFilters)[number])
    : "ALL";
  const errorMessage = resolvedSearchParams?.error
    ? decodeURIComponent(resolvedSearchParams.error)
    : null;
  const view = resolvedSearchParams?.view === "knockout" ? "knockout" : "group";
  const initialGroupId = resolvedSearchParams?.group ?? "";
  const initialSearch = resolvedSearchParams?.search ?? "";

  if (view === "knockout" && selectedCategory !== "ALL") {
    await syncKnockoutPropagation(selectedCategory);
  }

  const category =
    selectedCategory === "ALL"
      ? null
      : await prisma.category.findUnique({
          where: { code: selectedCategory },
        });

  const assignmentLock =
    selectedCategory === "ALL"
      ? null
      : await prisma.groupAssignmentLock.findUnique({
          where: { categoryCode: selectedCategory },
        });
  const isAssignmentLocked = assignmentLock?.locked ?? false;

  const stageLocks = await prisma.groupStageLock.findMany({
    select: { categoryCode: true, locked: true },
  });
  const stageLockByCategory = {
    MD: stageLocks.find((lock) => lock.categoryCode === "MD")?.locked ?? false,
    WD: stageLocks.find((lock) => lock.categoryCode === "WD")?.locked ?? false,
    XD: stageLocks.find((lock) => lock.categoryCode === "XD")?.locked ?? false,
  } as const;

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
          group: { include: { category: true } },
          homeTeam: { include: { members: { include: { player: true } } } },
          awayTeam: { include: { members: { include: { player: true } } } },
          games: true,
        },
        orderBy: [{ group: { name: "asc" } }, { createdAt: "asc" }],
      })
    : selectedCategory === "ALL"
      ? await prisma.match.findMany({
          where: { stage: "GROUP" },
          include: {
            group: { include: { category: true } },
            homeTeam: { include: { members: { include: { player: true } } } },
            awayTeam: { include: { members: { include: { player: true } } } },
            games: true,
          },
          orderBy: [{ group: { name: "asc" } }, { createdAt: "asc" }],
        })
      : [];

  const knockoutMatches = await prisma.knockoutMatch.findMany({
    where: {
      isPublished: true,
      ...(selectedCategory === "ALL" ? {} : { categoryCode: selectedCategory }),
    },
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
        <div />
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

      <div className="mt-6 space-y-6">
        {view === "group" ? (
          <section className="rounded-xl border border-border bg-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-foreground">
                Group Stage Matches
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Group stage scoring and result management.
              </p>
            </div>
          </div>

          <div className="mt-6">
            <MatchesListClient
              categoryCode={selectedCategory}
              groups={groups.map((group) => ({ id: group.id, name: group.name }))}
              matches={matches.map((match) => ({
                id: match.id,
                categoryCode:
                  selectedCategory === "ALL"
                    ? match.group?.category.code ?? "MD"
                    : selectedCategory,
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
              stageLockByCategory={stageLockByCategory}
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
            categoryCode: match.categoryCode,
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
