import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getRoleFromRequest } from "@/lib/auth";
import { PlayerCheckinClient } from "@/app/player-checkin/player-checkin-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Player Check-in" };

export default async function PlayerCheckinPage() {
  const role = await getRoleFromRequest();
  if (role !== "admin") {
    redirect("/presenting");
  }

  const players = await prisma.player.findMany({
    orderBy: [{ name: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      name: true,
      gender: true,
      checkedIn: true,
    },
  });

  return (
    <section className="rounded-2xl border border-border bg-card p-8">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Player Check-in</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Mark players who have arrived so their matches can be scheduled.
        </p>
      </div>
      <PlayerCheckinClient initialPlayers={players} />
    </section>
  );
}
