import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { PlayersTable } from "@/app/players/players-table";
import { ImportSection } from "@/components/import-section";

export const dynamic = "force-dynamic";
export const metadata = { title: "Players" };

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
      <div className="mt-6 space-y-6">
        <ImportSection
          title="Import players"
          description="Bulk upload players from a CSV or XLSX template."
          importUrl="/api/import/players"
          importLabel="Players"
          templateLinks={[
            {
              href: "/api/templates/players.csv",
              label: "Download Players Template (CSV)",
            },
            {
              href: "/api/templates/players.xlsx",
              label: "Download Players Template (XLSX)",
            },
          ]}
        />
        <PlayersTable players={players} />
      </div>
    </section>
  );
}
