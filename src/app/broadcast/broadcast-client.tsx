"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { getPresentingState } from "@/app/schedule/actions";
import { getRealtimeBrowserClient } from "@/lib/supabase/realtime-client";

type ScheduleState = Awaited<ReturnType<typeof getPresentingState>>;
type ScheduleStage = "GROUP" | "KNOCKOUT";

const COURT_LABELS: Record<string, string> = {
  C1: "P5",
  C2: "P6",
  C3: "P7",
  C4: "P8",
  C5: "P9",
};

const REALTIME_TABLES = [
  "courtAssignment",
  "CourtAssignment",
  "blockedMatch",
  "BlockedMatch",
  "match",
  "Match",
  "knockoutMatch",
  "KnockoutMatch",
  "scheduleConfig",
  "ScheduleConfig",
];

function courtLabel(courtId: string) {
  return `Court ${COURT_LABELS[courtId] ?? courtId}`;
}

function trimSeriesLabel(label: string) {
  return label.replace(/^Series\s+/i, "").trim();
}

function stripMatchNumber(detail: string) {
  return detail
    .split("•")
    .map((part) => part.trim())
    .filter((part) => !/^Match\s+\d+/i.test(part))
    .join(" • ");
}

function formatMetaLine(match: ScheduleState["upcomingMatches"][number]) {
  if (match.matchType === "KNOCKOUT") {
    const series = trimSeriesLabel(match.label);
    const round = stripMatchNumber(match.detail);
    return `${match.categoryCode} • ${series} • ${round}`;
  }
  return `${match.categoryCode} • ${match.detail}`;
}

function formatPlayingMeta(
  playing: NonNullable<ScheduleState["courts"][number]["playing"]>
) {
  if (playing.matchType === "KNOCKOUT") {
    const detail = stripMatchNumber(playing.detail);
    return `${playing.categoryCode} • ${detail}`;
  }
  return `${playing.categoryCode} • ${playing.detail}`;
}

export function BroadcastClient({ state }: { state: ScheduleState }) {
  const router = useRouter();
  const stage = state.stage as ScheduleStage;

  useEffect(() => {
    let pollInterval: ReturnType<typeof setInterval> | null = null;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;

    const scheduleRefresh = () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        router.refresh();
      }, 350);
    };

    const startFallbackPolling = () => {
      if (pollInterval) return;
      pollInterval = setInterval(() => {
        router.refresh();
      }, 60000);
    };

    const stopFallbackPolling = () => {
      if (!pollInterval) return;
      clearInterval(pollInterval);
      pollInterval = null;
    };

    const supabase = getRealtimeBrowserClient();
    if (!supabase) {
      startFallbackPolling();
      return () => {
        stopFallbackPolling();
        if (refreshTimer) clearTimeout(refreshTimer);
      };
    }

    const channel = supabase.channel(`broadcast-live-${stage.toLowerCase()}`);
    for (const table of REALTIME_TABLES) {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        () => {
          stopFallbackPolling();
          scheduleRefresh();
        }
      );
    }

    channel.subscribe((status: string) => {
      if (status === "SUBSCRIBED") {
        stopFallbackPolling();
        return;
      }
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        startFallbackPolling();
      }
    });

    return () => {
      stopFallbackPolling();
      if (refreshTimer) clearTimeout(refreshTimer);
      void supabase.removeChannel(channel);
    };
  }, [router, stage]);

  const upcoming = state.upcomingMatches;

  return (
    <div className="space-y-6">
      {stage === "KNOCKOUT" && state.matchPoolCount === 0 ? (
        <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          No knockout matches available. Generate brackets first.
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-12">
        <section className="presenting-neon rounded-xl border border-border bg-card p-4 lg:col-span-8">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-foreground">Playing</h2>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {state.courts.map((court) => {
              const playing = court.playing;
              return (
                <div
                  key={court.id}
                  className="rounded-xl border border-border bg-card p-4 shadow-[0_1px_2px_rgba(0,0,0,0.08)]"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <h3 className="text-base font-semibold text-foreground md:text-lg whitespace-nowrap">
                      {courtLabel(court.id)}
                    </h3>
                    {playing ? (
                      <div className="text-xs font-medium text-muted-foreground text-right">
                        {formatPlayingMeta(playing)}
                      </div>
                    ) : null}
                  </div>

                  <div className="mt-4 presenting-neon rounded-lg border border-border bg-muted/40 p-3 text-sm shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
                    {playing ? (
                      <div className="space-y-2">
                        <div className="text-base font-semibold text-foreground">
                          {playing.homeTeam?.name ?? "TBD"}
                          <span className="block text-sm font-medium text-foreground/60">
                            Vs.
                          </span>
                          {playing.awayTeam?.name ?? "TBD"}
                        </div>
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground">No match assigned.</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-4 lg:col-span-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-foreground">Upcoming</h2>
          </div>
          <div className="mt-4 space-y-3">
            {upcoming.length === 0 ? (
              <div className="text-sm text-muted-foreground">No upcoming matches.</div>
            ) : null}
            {upcoming.map((match) => (
              <div
                key={match.key}
                className="rounded-lg border border-border bg-muted/40 p-3 shadow-[0_1px_2px_rgba(0,0,0,0.06)]"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="text-xs text-muted-foreground">
                      {formatMetaLine(match)}
                    </div>
                  </div>
                  {match.isForced ? (
                    <Badge variant="outline" className="border-red-600 text-red-600">
                      Forced
                    </Badge>
                  ) : null}
                </div>
                <div className="mt-2 text-sm font-semibold text-foreground">
                  {match.teams.homeName}
                  <span className="block text-xs font-medium text-foreground/60">
                    Vs.
                  </span>
                  {match.teams.awayName}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
