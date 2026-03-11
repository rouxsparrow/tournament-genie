import Link from "next/link";
import { PresentingClient } from "@/app/presenting/presenting-client";
import { Button } from "@/components/ui/button";
import { getRoleFromRequest } from "@/lib/auth";
import { getFavouritePlayerContext } from "@/lib/favourite-player";
import {
  getCachedPresentingState,
  resolvePresentingStageForViewerFromNav,
} from "@/lib/public-read-models/loaders";

export const dynamic = "force-dynamic";
export const metadata = { title: "Live Schedule" };

export default async function PresentingPage({
  searchParams,
}: {
  searchParams?: Promise<{ stage?: string | string[]; fromNav?: string }>;
}) {
  const resolvedParams = (await searchParams) ?? {};
  const stageParam =
    typeof resolvedParams.stage === "string" ? resolvedParams.stage.toLowerCase() : "";
  const requestedStage = stageParam === "ko" ? "KNOCKOUT" : "GROUP";
  const fromNav = resolvedParams.fromNav === "1";

  const role = await getRoleFromRequest();
  const favourite = await getFavouritePlayerContext();

  const resolvedStage =
    role === "viewer" && fromNav
      ? await resolvePresentingStageForViewerFromNav(favourite?.playerId ?? null)
      : requestedStage;

  const state = await getCachedPresentingState(resolvedStage);
  const groupHref = "/presenting?stage=group";
  const koHref = "/presenting?stage=ko";

  return (
    <section className="rounded-2xl border border-border bg-card p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Live Matches</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild size="sm" variant={resolvedStage === "GROUP" ? "default" : "outline"}>
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
        <PresentingClient state={state} favouritePlayerName={favourite?.playerName ?? null} />
      </div>
    </section>
  );
}
