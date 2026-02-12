import Link from "next/link";
import { getScheduleState } from "@/app/schedule/actions";
import { ScheduleClient } from "@/app/schedule/schedule-client";
import { Button } from "@/components/ui/button";
import { GlobalLoadingProvider } from "@/components/global-loading-provider";
import { getRoleFromRequest } from "@/lib/auth";
import { getFavouritePlayerContext } from "@/lib/favourite-player";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const metadata = { title: "Schedule" };

export default async function SchedulePage({
  searchParams,
}: {
  searchParams?: Promise<{ stage?: string | string[] }>;
}) {
  const resolvedParams = (await searchParams) ?? {};
  const stageParam =
    typeof resolvedParams.stage === "string" ? resolvedParams.stage.toLowerCase() : "";
  const stage = stageParam === "ko" ? "KNOCKOUT" : "GROUP";
  const role = await getRoleFromRequest();
  if (role === "viewer") {
    redirect("/presenting");
  }
  const favourite = await getFavouritePlayerContext();
  const resolvedStage = stage;
  const state = await getScheduleState({ category: "ALL", stage: resolvedStage });
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
        <GlobalLoadingProvider>
          <ScheduleClient
            initialState={state}
            role={role}
            favouritePlayerName={favourite?.playerName ?? null}
          />
        </GlobalLoadingProvider>
      </div>
    </section>
  );
}
