import { getScheduleState } from "@/app/schedule/actions";
import { ScheduleClient } from "@/app/schedule/schedule-client";

export const dynamic = "force-dynamic";

export default async function SchedulePage() {
  const state = await getScheduleState({ category: "ALL", showKo: true });

  return (
    <section className="rounded-2xl border border-border bg-card p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Schedule</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Live court assignments and real-time scheduling controls.
          </p>
        </div>
      </div>

      <div className="mt-6">
        <ScheduleClient initialState={state} />
      </div>
    </section>
  );
}
