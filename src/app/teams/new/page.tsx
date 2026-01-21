import { prisma } from "@/lib/prisma";
import { TeamForm } from "@/app/teams/new/team-form";

export const dynamic = "force-dynamic";

type TeamsNewPageProps = {
  searchParams?: Promise<{ error?: string; success?: string }>;
};

export default async function TeamsNewPage({ searchParams }: TeamsNewPageProps) {
  const players = await prisma.player.findMany({
    orderBy: { name: "asc" },
  });
  const teamMembers = await prisma.teamMember.findMany({
    include: { team: { include: { category: true } } },
  });
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const errorMessage = resolvedSearchParams?.error
    ? decodeURIComponent(resolvedSearchParams.error)
    : null;
  const successMessage = resolvedSearchParams?.success
    ? decodeURIComponent(resolvedSearchParams.success)
    : null;

  const categories = ["MD", "WD", "XD"] as const;
  const availableByCategory = categories.reduce(
    (acc, code) => {
      const usedPlayerIds = new Set(
        teamMembers
          .filter((member) => member.team.category.code === code)
          .map((member) => member.playerId)
      );
      acc[code] = players
        .filter((player) => !usedPlayerIds.has(player.id))
        .map((player) => player.id);
      return acc;
    },
    { MD: [] as string[], WD: [] as string[], XD: [] as string[] }
  );

  return (
    <section className="rounded-2xl border border-border bg-card p-8">
      <TeamForm
        players={players}
        availableByCategory={availableByCategory}
        errorMessage={errorMessage}
        successMessage={successMessage}
      />
    </section>
  );
}
