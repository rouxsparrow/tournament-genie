import { prisma } from "@/lib/prisma";
import { FavouritePlayerClient } from "@/app/favourite-player-client";
import { getFavouritePlayerId } from "@/lib/favourite-player";
import { getRoleFromRequest } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Home" };

export default async function Home() {
  const role = await getRoleFromRequest();
  if (role === "admin") {
    return null;
  }
  const favouriteId = await getFavouritePlayerId();
  const players = await prisma.player.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return (
    <section className="rounded-2xl border border-border bg-card p-8">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">
          Select your favourite player
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your favourite player will personalize standings and brackets.
        </p>
        {favouriteId ? (
          <p className="mt-2 text-sm text-foreground">
            Your favourite player is{" "}
            <span className="text-[yellowgreen]">
              {players.find((player) => player.id === favouriteId)?.name ?? "TBD"}
            </span>
            .
            <br />
            <br />
            Track their:
            <br />
            Group Stage performance on <b>Standings</b>
            <br />
            Knockout Stage performance on <b>Brackets</b>
            <br />
            Upcoming matches on <b>Schedule</b>
          </p>
        ) : null}
      </div>

      <div className="mt-6">
        <FavouritePlayerClient
          players={players}
          initialFavouriteId={favouriteId}
        />
      </div>
    </section>
  );
}
