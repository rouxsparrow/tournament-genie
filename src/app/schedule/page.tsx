import Link from "next/link";
import { getScheduleState } from "@/app/schedule/actions";
import { ScheduleClient } from "@/app/schedule/schedule-client";
import { Button } from "@/components/ui/button";
import { getRoleFromRequest } from "@/lib/auth";
import { getFavouritePlayerContext } from "@/lib/favourite-player";

export const dynamic = "force-dynamic";

export default async function SchedulePage({
  searchParams,
}: {
  searchParams?: Promise<{ stage?: string | string[]; fromNav?: string }>;
}) {
  const resolvedParams = (await searchParams) ?? {};
  const stageParam =
    typeof resolvedParams.stage === "string" ? resolvedParams.stage.toLowerCase() : "";
  const stage = stageParam === "ko" ? "KNOCKOUT" : "GROUP";
  const fromNav = resolvedParams.fromNav === "1";
  const role = await getRoleFromRequest();
  const favourite = await getFavouritePlayerContext();
  const isViewer = role === "viewer";
  let state = await getScheduleState({ category: "ALL", stage });
  let resolvedStage = stage;

  if (isViewer && fromNav) {
    const groupState =
      stage === "GROUP" ? state : await getScheduleState({ category: "ALL", stage: "GROUP" });
    const favouriteId = favourite?.playerId ?? null;
    const hasAssigned = groupState.courts.some((court) => Boolean(court.playing));
    const hasUpcomingFavourite =
      favouriteId &&
      groupState.upcomingMatches.some((match) => match.teams.playerIds.includes(favouriteId));

    if (!hasAssigned && !hasUpcomingFavourite) {
      resolvedStage = "KNOCKOUT";
      state = await getScheduleState({ category: "ALL", stage: "KNOCKOUT" });
    } else {
      state = groupState;
      resolvedStage = "GROUP";
    }
  }
  const groupHref = "/schedule?stage=group";
  const koHref = "/schedule?stage=ko";

  return (
    <section className="rounded-2xl border border-border bg-card p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Schedule</h1>
          {role === "admin" ? (
            <p className="mt-1 text-sm text-muted-foreground">
              Live court assignments and real-time scheduling controls.
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Button
            asChild
            size="sm"
            variant={resolvedStage === "GROUP" ? "default" : "outline"}
          >
            <Link href={groupHref}>Group Stage</Link>
          </Button>
          <Button
            asChild
            size="sm"
            variant={resolvedStage === "KNOCKOUT" ? "default" : "outline"}
          >
            <Link href={koHref}>Knockout</Link>
          </Button>
        </div>
      </div>

      <div className="mt-6">
        <ScheduleClient
          initialState={state}
          role={role}
          favouritePlayerName={favourite?.playerName ?? null}
        />
      </div>
    </section>
  );
}
