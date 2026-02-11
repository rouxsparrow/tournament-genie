import { RefereeScoreboard } from "@/app/referee/components/RefereeScoreboard";
import { getScheduledMatches } from "@/lib/matches/getScheduledMatches";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const metadata = { title: "Referee Scoresheet" };

const COURT_LABELS: Record<string, "P5" | "P6" | "P7" | "P8" | "P9"> = {
  C1: "P5",
  C2: "P6",
  C3: "P7",
  C4: "P8",
  C5: "P9",
};

export default async function RefereePage() {
  const [{ groupMatches, knockoutMatches, groups }, settings] = await Promise.all([
    getScheduledMatches(),
    prisma.tournamentSettings.findFirst({
      orderBy: { createdAt: "desc" },
      select: { scoringMode: true },
    }),
  ]);

  const groupItems = groupMatches
    .filter((match) => match.group)
    .map((match) => ({
      id: match.id,
      stage: "GROUP" as const,
      status: match.status,
      categoryCode: match.group?.category.code ?? "MD",
      groupId: match.group?.id ?? "",
      groupName: match.group?.name ?? "",
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      court: match.courtAssignments[0]
        ? (COURT_LABELS[match.courtAssignments[0].courtId] ?? null)
        : null,
    }));

  const knockoutItems = knockoutMatches.map((match) => ({
    id: match.id,
    stage: "KNOCKOUT" as const,
    status: match.status,
    categoryCode: match.categoryCode,
    series: match.series,
    round: match.round,
    matchNo: match.matchNo,
    isBestOf3: match.isBestOf3,
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
    court: match.courtAssignments[0]
      ? (COURT_LABELS[match.courtAssignments[0].courtId] ?? null)
      : null,
  }));

  const groupOptions = groups.map((group) => ({
    id: group.id,
    name: group.name,
    categoryCode: group.category.code,
  }));

  return (
    <section className="rounded-2xl border border-border bg-muted/40 p-6">
      <RefereeScoreboard
        matches={[...groupItems, ...knockoutItems]}
        groups={groupOptions}
        scoringMode={settings?.scoringMode ?? "SINGLE_GAME_21"}
      />
    </section>
  );
}
