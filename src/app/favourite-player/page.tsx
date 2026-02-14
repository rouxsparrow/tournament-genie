import Link from "next/link";
import { FavouritePlayerClient } from "@/app/favourite-player-client";
import { getRoleFromRequest } from "@/lib/auth";
import { getFavouritePlayerId } from "@/lib/favourite-player";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const metadata = { title: "Favourite Player" };

export default async function FavouritePlayerPage() {
  const role = await getRoleFromRequest();
  if (role === "admin") {
    return null;
  }

  const favouriteId = await getFavouritePlayerId();
  const players = await prisma.player.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const favouritePlayer = players.find((player) => player.id === favouriteId) ?? null;
  const hasValidFavourite = Boolean(favouritePlayer);
  const hasPlayers = players.length > 0;

  return (
    <section className="rounded-2xl border border-border bg-card p-8">
      <div>
        <h1 className="text-center text-2xl font-semibold text-foreground">
          Pick Your <span className="text-[yellowgreen]">Favourite Player</span>
        </h1>
        {!hasValidFavourite ? (
          <>
            <p className="mt-1 text-sm text-muted-foreground">
              Step 1 of 2: Select a favourite player, then jump to their personalized views.
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Your choice highlights their progress in Standings, Schedule, and Brackets.
            </p>
          </>
        ) : null}
      </div>

      {hasValidFavourite ? (
        <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-100">
          <p className="text-sm font-medium">
            Now tracking: <span className="font-semibold text-[yellowgreen]">{favouritePlayer?.name}</span>
          </p>
          <p className="mt-1 text-sm text-emerald-800/90 dark:text-emerald-100/90">
            Step 2 of 2: Open a personalized page.
          </p>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <Link
              href="/standings?fromNav=1"
              className="rounded-lg border border-emerald-300/70 bg-white px-4 py-3 text-sm font-medium text-emerald-900 transition-colors hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100 dark:hover:bg-emerald-900/60"
            >
              <span className="block">Standings</span>
              <span className="mt-1 block text-xs font-normal text-muted-foreground">
                See group stage rankings and results
              </span>
            </Link>
            <Link
              href="/presenting?fromNav=1"
              className="rounded-lg border border-emerald-300/70 bg-white px-4 py-3 text-sm font-medium text-emerald-900 transition-colors hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100 dark:hover:bg-emerald-900/60"
            >
              <span className="block">Schedule</span>
              <span className="mt-1 block text-xs font-normal text-muted-foreground">
                Track ongoing and upcoming matches
              </span>
            </Link>
            <Link
              href="/brackets?fromNav=1"
              className="rounded-lg border border-emerald-300/70 bg-white px-4 py-3 text-sm font-medium text-emerald-900 transition-colors hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100 dark:hover:bg-emerald-900/60"
            >
              <span className="block">Brackets</span>
              <span className="mt-1 block text-xs font-normal text-muted-foreground">
                Follow the road to the championship
              </span>
            </Link>
          </div>
        </div>
      ) : null}

      {!hasPlayers ? (
        <div className="mt-6 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          No players are available yet. Ask an admin to add players first.
        </div>
      ) : (
        <div className="mt-6">
          <FavouritePlayerClient
            players={players}
            initialFavouriteId={hasValidFavourite ? favouriteId : null}
          />
        </div>
      )}
    </section>
  );
}
