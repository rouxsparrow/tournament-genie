"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { Badge } from "@/components/ui/badge";
import { getPresentingState } from "@/app/schedule/actions";
import { getRealtimeBrowserClient } from "@/lib/supabase/realtime-client";
import { REALTIME_CHANNELS, REALTIME_EVENTS } from "@/lib/supabase/realtime-events";

type ScheduleState = Awaited<ReturnType<typeof getPresentingState>>;
type ScheduleStage = "GROUP" | "KNOCKOUT";
type BroadcastSubscriptionStatus =
  | "CONNECTING"
  | "SUBSCRIBED"
  | "CHANNEL_ERROR"
  | "TIMED_OUT"
  | "CLOSED"
  | "UNAVAILABLE";
type RealtimeDebugState = {
  channel: string;
  event: string;
  source: string | null;
  reason: string | null;
  changeType: string | null;
  receivedAt: string;
  eventCount: number;
} | null;

const COURT_LABELS: Record<string, string> = {
  C1: "P5",
  C2: "P6",
  C3: "P7",
  C4: "P8",
  C5: "P9",
};

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

function getStatusLabel(status: BroadcastSubscriptionStatus) {
  if (status === "SUBSCRIBED") return "SUBSCRIBED";
  if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
    return "ERROR";
  }
  if (status === "UNAVAILABLE") return "ERROR";
  return "CONNECTING";
}

function getStatusBadgeClass(status: BroadcastSubscriptionStatus) {
  if (status === "SUBSCRIBED") return "border-emerald-600 text-emerald-700";
  if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
    return "border-red-600 text-red-700";
  }
  if (status === "UNAVAILABLE") return "border-red-600 text-red-700";
  return "border-amber-600 text-amber-700";
}

export function BroadcastClient({ state }: { state: ScheduleState }) {
  const router = useRouter();
  const stage = state.stage as ScheduleStage;
  const broadcastDebug = process.env.NEXT_PUBLIC_SCHEDULE_DEBUG === "1";
  const hasRealtimeEnv =
    Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
    Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const [subscriptionStatus, setSubscriptionStatus] =
    useState<BroadcastSubscriptionStatus>("CONNECTING");
  const [lastRealtimeEvent, setLastRealtimeEvent] = useState<RealtimeDebugState>(null);

  useEffect(() => {
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    let eventCount = 0;
    const mode = "realtime" as const;
    let disposed = false;
    const activeChannels: RealtimeChannel[] = [];

    const log = (
      message: string,
      extra?: Record<string, string | number | boolean | null | undefined>
    ) => {
      if (!broadcastDebug) return;
      const payload = {
        stage,
        mode,
        ...(extra ?? {}),
      };
      console.log(`[broadcast][updates] ${message}`, payload);
      void fetch("/api/broadcast/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stage,
          mode,
          message,
          extra: payload,
        }),
        keepalive: true,
      }).catch(() => undefined);
    };

    const warn = (
      message: string,
      extra?: Record<string, string | number | boolean | null | undefined>
    ) => {
      if (!broadcastDebug) return;
      const payload = {
        stage,
        mode,
        ...(extra ?? {}),
      };
      console.warn(`[broadcast][updates] ${message}`, payload);
      void fetch("/api/broadcast/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stage,
          mode,
          message,
          extra: payload,
        }),
        keepalive: true,
      }).catch(() => undefined);
    };

    const scheduleRefresh = () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        log("router.refresh", { source: "realtime", eventCount });
        router.refresh();
      }, 350);
    };

    const supabase = getRealtimeBrowserClient();
    if (!supabase) {
      warn("supabase client unavailable; realtime disabled", {
        hasUrl: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
        hasAnonKey: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
      });
      return () => {
        if (refreshTimer) clearTimeout(refreshTimer);
      };
    }

    const start = async () => {
      const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (anonKey) {
        try {
          await supabase.realtime.setAuth(anonKey);
          log("realtime auth set");
        } catch (error) {
          warn("realtime auth failed", {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      if (disposed) return;

      const refreshChannel = supabase.channel(REALTIME_CHANNELS.broadcastRefresh[stage]);
      activeChannels.push(refreshChannel);
      refreshChannel.on(
        "broadcast",
        { event: REALTIME_EVENTS.BROADCAST_REFRESH_REQUIRED },
        (payload) => {
          eventCount += 1;
          const source =
            typeof payload.payload?.source === "string" ? payload.payload.source : null;
          const reason =
            typeof payload.payload?.reason === "string" ? payload.payload.reason : null;
          const changeType =
            typeof payload.payload?.changeType === "string"
              ? payload.payload.changeType
              : null;
          setLastRealtimeEvent({
            channel: REALTIME_CHANNELS.broadcastRefresh[stage],
            event: payload.event,
            source,
            reason,
            changeType,
            receivedAt: new Date().toISOString(),
            eventCount,
          });
          log("realtime event", {
            eventType: payload.event,
            channel: REALTIME_CHANNELS.broadcastRefresh[stage],
            source,
            reason,
            changeType,
            eventCount,
          });
          scheduleRefresh();
        }
      );

      refreshChannel.subscribe((status: string, err?: Error) => {
        const nextStatus = (
          status === "SUBSCRIBED" ||
          status === "CHANNEL_ERROR" ||
          status === "TIMED_OUT" ||
          status === "CLOSED"
            ? status
            : "CONNECTING"
        ) as BroadcastSubscriptionStatus;
        setSubscriptionStatus(nextStatus);
        log("channel status", {
          status,
          channel: REALTIME_CHANNELS.broadcastRefresh[stage],
          error: err?.message ?? null,
        });
        if (status === "SUBSCRIBED") {
          log("realtime connected", { channel: REALTIME_CHANNELS.broadcastRefresh[stage] });
          return;
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          log("realtime unavailable", {
            status,
            channel: REALTIME_CHANNELS.broadcastRefresh[stage],
            error: err?.message ?? null,
          });
        }
      });
    };

    void start();

    return () => {
      disposed = true;
      log("cleanup", { eventCount });
      if (refreshTimer) clearTimeout(refreshTimer);
      activeChannels.forEach((channel) => {
        void supabase.removeChannel(channel);
      });
    };
  }, [broadcastDebug, router, stage]);

  const upcoming = state.upcomingMatches;
  const effectiveSubscriptionStatus: BroadcastSubscriptionStatus = hasRealtimeEnv
    ? subscriptionStatus
    : "UNAVAILABLE";

  return (
    <div className="space-y-6">
      {broadcastDebug ? (
        <div className="flex items-center justify-end gap-2 text-xs">
          <span className="font-mono text-muted-foreground">
            {REALTIME_CHANNELS.broadcastRefresh[stage]}
          </span>
          <Badge variant="outline" className={getStatusBadgeClass(effectiveSubscriptionStatus)}>
            {getStatusLabel(effectiveSubscriptionStatus)}
          </Badge>
        </div>
      ) : null}
      {broadcastDebug ? (
        <div className="rounded-lg border border-amber-400/60 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          <div className="font-semibold">Realtime Debug</div>
          <div className="mt-1">
            Last event:{" "}
            {lastRealtimeEvent
              ? `${lastRealtimeEvent.event} @ ${lastRealtimeEvent.channel}`
              : "none yet"}
          </div>
          <div>
            Source: {lastRealtimeEvent?.source ?? "-"} • Count:{" "}
            {lastRealtimeEvent?.eventCount ?? 0}
          </div>
          <div>Reason: {lastRealtimeEvent?.reason ?? "-"}</div>
          <div>Change: {lastRealtimeEvent?.changeType ?? "-"}</div>
          <div>
            Received:{" "}
            {lastRealtimeEvent
              ? new Date(lastRealtimeEvent.receivedAt).toLocaleTimeString()
              : "-"}
          </div>
        </div>
      ) : null}

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
