import Link from "next/link";
import { Button } from "@/components/ui/button";
import { getRoleFromRequest } from "@/lib/auth";
import { getFavouritePlayerContext } from "@/lib/favourite-player";

export const dynamic = "force-dynamic";
export const metadata = { title: "Home" };

export default async function Home() {
  const role = await getRoleFromRequest();
  if (role === "admin") {
    return null;
  }
  const favourite = await getFavouritePlayerContext();
  const hasFavourite = Boolean(favourite);

  return (
    <section className="rounded-2xl border border-border bg-card p-6 sm:p-8">
      <h1 className="text-center font-semibold leading-snug text-foreground">
        <span className="block text-lg sm:text-2xl">Welcome to FPT Asia Pacific</span>
        <span className="block text-lg sm:text-2xl">Badminton Tournament 2026 🏸🔥</span>
      </h1>

      <div className="mt-4 border-t border-border/80 pt-4">
      {!hasFavourite ? (
        <>
          <p className="mt-3 text-center text-sm text-muted-foreground">
            Pick your favourite player and follow their journey with a personalized view.
          </p>

          <div className="mt-5 flex justify-center">
            <Button asChild>
              <Link href="/favourite-player">Pick Favourite Player</Link>
            </Button>
          </div>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            No favourite yet? No worries - jump straight into the action:
          </p>
        </>
      ) : (
        <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-100">
          <p className="text-center text-sm font-medium">
            Now tracking: <span className="font-semibold text-[yellowgreen]">{favourite?.playerName}</span>
          </p>
          <p className="mt-1 text-center text-sm text-emerald-800/90 dark:text-emerald-100/90">
            Open below personalized pages.
          </p>
        </div>
      )}

      <div className="mx-auto mt-4 grid max-w-5xl gap-3 md:grid-cols-3">
        <Link
          href="/standings?fromNav=1"
          className="rounded-lg border border-border bg-card px-4 py-3 text-center text-sm transition-colors hover:bg-accent"
        >
          <span className="block font-semibold text-foreground">Standings</span>
          <span className="mt-1 block text-xs text-muted-foreground">
            See group stage rankings and results
          </span>
        </Link>
        <Link
          href="/presenting?fromNav=1"
          className="rounded-lg border border-border bg-card px-4 py-3 text-center text-sm transition-colors hover:bg-accent"
        >
          <span className="block font-semibold text-foreground">Schedule</span>
          <span className="mt-1 block text-xs text-muted-foreground">
            Track ongoing and upcoming matches
          </span>
        </Link>
        <Link
          href="/brackets?fromNav=1"
          className="rounded-lg border border-border bg-card px-4 py-3 text-center text-sm transition-colors hover:bg-accent"
        >
          <span className="block font-semibold text-foreground">Brackets</span>
          <span className="mt-1 block text-xs text-muted-foreground">
            Follow the road to the championship
          </span>
        </Link>
      </div>

      {hasFavourite ? (
        <div className="mt-10 border-t border-border/70 pt-8 flex justify-center">
          <Button asChild variant="outline">
            <Link href="/favourite-player">Change favourite player</Link>
          </Button>
        </div>
      ) : null}
      </div>
    </section>
  );
}
