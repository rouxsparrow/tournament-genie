import { RefereeScoreboard } from "@/app/referee/components/RefereeScoreboard";
import { getScheduledMatches } from "@/lib/matches/getScheduledMatches";

export const dynamic = "force-dynamic";

export default async function RefereePage() {
  const { groupMatches, knockoutMatches, groups } = await getScheduledMatches();

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
    }));

  const knockoutItems = knockoutMatches.map((match) => ({
    id: match.id,
    stage: "KNOCKOUT" as const,
    status: match.status,
    categoryCode: match.categoryCode,
    series: match.series,
    round: match.round,
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
  }));

  const groupOptions = groups.map((group) => ({
    id: group.id,
    name: group.name,
    categoryCode: group.category.code,
  }));

  return (
    <section className="rounded-2xl border border-border bg-muted/40 p-6">
      <RefereeScoreboard matches={[...groupItems, ...knockoutItems]} groups={groupOptions} />
    </section>
  );
}
