import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { TeamsTable } from "@/app/teams/teams-table";
import { ImportSection } from "@/components/import-section";

export const dynamic = "force-dynamic";
export const metadata = { title: "Teams" };

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
      <div className="mt-6 space-y-6">
        <ImportSection
          title="Import teams"
          description="Bulk upload teams from a CSV or XLSX template."
          importUrl="/api/import/teams"
          importLabel="Teams"
          templateLinks={[
            {
              href: "/api/templates/teams.csv",
              label: "Download Teams Template (CSV)",
            },
            {
              href: "/api/templates/teams.xlsx",
              label: "Download Teams Template (XLSX)",
            },
          ]}
        />
        <TeamsTable teams={teams} />
      </div>
    </section>
  );
}
