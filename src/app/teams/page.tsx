import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { TeamsTable } from "@/app/teams/teams-table";

export default async function TeamsPage() {
  const teams = await prisma.team.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      category: true,
      members: {
        include: { player: true },
      },
      flags: true,
    },
  });

  return (
    <section className="rounded-2xl border border-border bg-card p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Teams</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Create and manage teams by category.
          </p>
        </div>
        <Button asChild>
          <Link href="/teams/new">Add team</Link>
        </Button>
      </div>
      <TeamsTable teams={teams} />
    </section>
  );
}

