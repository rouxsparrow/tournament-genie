import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { PlayersTable } from "@/app/players/players-table";

export default async function PlayersPage() {
  const players = await prisma.player.findMany({
    orderBy: { createdAt: "desc" },
  });

  return (
    <section className="rounded-2xl border border-border bg-card p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Players</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Create and manage tournament players.
          </p>
        </div>
        <Button asChild>
          <Link href="/players/new">Add player</Link>
        </Button>
      </div>
      <PlayersTable players={players} />
    </section>
  );
}

