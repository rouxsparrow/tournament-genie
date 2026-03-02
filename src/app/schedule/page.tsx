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
  searchParams?: Promise<{ stage?: string | string[]; view?: string | string[] }>;
}) {
  const resolvedParams = (await searchParams) ?? {};
  const stageParam =
    typeof resolvedParams.stage === "string" ? resolvedParams.stage.toLowerCase() : "";
  const viewParam =
    typeof resolvedParams.view === "string" ? resolvedParams.view.toLowerCase() : "";
  const stage = stageParam === "ko" ? "KNOCKOUT" : "GROUP";
  const view = viewParam === "queue" ? "queue" : "courts";
  const role = await getRoleFromRequest();
  if (role === "viewer") {
    redirect("/presenting");
  }
  const favourite = await getFavouritePlayerContext();
  const resolvedStage = stage;
  const state = await getScheduleState({ category: "ALL", stage: resolvedStage });
  const groupHref = `/schedule?stage=group&view=${view}`;
  const koHref = `/schedule?stage=ko&view=${view}`;
  const courtsHref = `/schedule?stage=${resolvedStage === "GROUP" ? "group" : "ko"}&view=courts`;
  const queueHref = `/schedule?stage=${resolvedStage === "GROUP" ? "group" : "ko"}&view=queue`;

  return (
    <div className="lg:relative lg:left-1/2 lg:right-1/2 lg:-mx-[50vw] lg:w-screen lg:px-6 xl:px-10">
      <section className="rounded-2xl border border-border bg-card p-4 md:p-6 lg:mx-auto lg:max-w-[1560px] lg:p-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex w-full flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold text-foreground">Schedule</h1>
              <div className="ml-auto flex items-center gap-2">
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
            {role === "admin" ? (
              <p className="mt-1 text-sm text-muted-foreground">
                Live court assignments and real-time scheduling controls.
              </p>
            ) : null}
            {role === "admin" ? (
              <div className="mt-3 flex items-center gap-2">
                <Button
                  asChild
                  size="sm"
                  variant={view === "courts" ? "default" : "outline"}
                >
                  <Link href={courtsHref}>Live Courts</Link>
                </Button>
                <Button
                  asChild
                  size="sm"
                  variant={view === "queue" ? "default" : "outline"}
                >
                  <Link href={queueHref}>Queue</Link>
                </Button>
                <span className="text-xs text-muted-foreground">
                  Color code: <span className="font-medium text-orange-500">orange</span> = waiting,{" "}
                  <span className="rounded-sm bg-red-500/15 px-1 font-medium text-foreground dark:bg-red-400/30">
                    red tint
                  </span>{" "}
                  = not rested.
                </span>
              </div>
            ) : null}
          </div>
        </div>

        <div className="mt-6">
          <GlobalLoadingProvider>
            <ScheduleClient
              initialState={state}
              role={role}
              favouritePlayerName={favourite?.playerName ?? null}
              initialView={view}
            />
          </GlobalLoadingProvider>
        </div>
      </section>
    </div>
  );
}
