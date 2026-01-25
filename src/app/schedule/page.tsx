import Link from "next/link";
import { getScheduleState } from "@/app/schedule/actions";
import { ScheduleClient } from "@/app/schedule/schedule-client";
import { Button } from "@/components/ui/button";
import { getRoleFromRequest } from "@/lib/auth";

export const dynamic = "force-dynamic";

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
  const state = await getScheduleState({ category: "ALL", stage });
  const groupHref = "/schedule?stage=group";
  const koHref = "/schedule?stage=ko";

  return (
    <section className="rounded-2xl border border-border bg-card p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Schedule</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Live court assignments and real-time scheduling controls.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild size="sm" variant={stage === "GROUP" ? "default" : "outline"}>
            <Link href={groupHref}>Group Stage</Link>
          </Button>
          <Button asChild size="sm" variant={stage === "KNOCKOUT" ? "default" : "outline"}>
            <Link href={koHref}>Knockout</Link>
          </Button>
        </div>
      </div>

      <div className="mt-6">
        <ScheduleClient initialState={state} role={role} />
      </div>
    </section>
  );
}
