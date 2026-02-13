"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { Eye, EyeOff, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useGlobalTransition } from "@/components/use-global-transition";
import {
  assignNext,
  backToQueue,
  blockMatch,
  clearRefereeNotifications,
  clearForcedPriority,
  forceNext,
  getRefereeNotifications,
  getScheduleState,
  lockCourt,
  markCompleted,
  resetQueueForcedPriorities,
  toggleRefereeNotificationRead,
  toggleAutoSchedule,
  unblockMatch,
} from "@/app/schedule/actions";
import { getRealtimeBrowserClient } from "@/lib/supabase/realtime-client";

type ScheduleState = Awaited<ReturnType<typeof getScheduleState>>;
type UserRole = "admin" | "viewer";
type CategoryFilter = "ALL" | "MD" | "WD" | "XD";
type QueueStatus = "ELIGIBLE" | "BLOCKED";
type MatchType = "GROUP" | "KNOCKOUT";
type ScheduleStage = "GROUP" | "KNOCKOUT";
type RefereeNotificationItem = NonNullable<
  Awaited<ReturnType<typeof getScheduleState>>
>["refereeNotifications"][number];

type ModalState =
  | null
  | { type: "assign"; courtId: string };

const COURT_LABELS: Record<string, string> = {
  C1: "P5",
  C2: "P6",
  C3: "P7",
  C4: "P8",
  C5: "P9",
};

function courtLabel(courtId: string) {
  return COURT_LABELS[courtId] ?? courtId;
}

function seriesLabel(match: ScheduleState["eligibleMatches"][number]) {
  if (match.matchType === "KNOCKOUT") {
    const normalized = match.label.replace(/^Series\s+/i, "").trim();
    return normalized || match.label;
  }
  return match.label;
}

function roundLabel(match: ScheduleState["eligibleMatches"][number]) {
  if (match.matchType !== "KNOCKOUT") return match.detail || "Group";
  if (match.round === 1) return "PI";
  if (match.round === 2) return "QF";
  if (match.round === 3) return "SF";
  if (match.round === 4 && match.matchNo === 2) return "Bronze";
  if (match.round === 4) return "Final";
  return match.round ? `R${match.round}` : "Round";
}

function assignPlayersLabel(match: ScheduleState["eligibleMatches"][number]) {
  const home =
    match.teams.homePlayers.length > 0
      ? match.teams.homePlayers.join(" + ")
      : match.teams.homeName;
  const away =
    match.teams.awayPlayers.length > 0
      ? match.teams.awayPlayers.join(" + ")
      : match.teams.awayName;
  return `${home} vs ${away}`;
}

function assignOptionLabel(match: ScheduleState["eligibleMatches"][number]) {
  return `${match.categoryCode}·${seriesLabel(match)}·${roundLabel(match)}·${assignPlayersLabel(
    match
  )}`;
}

function matchTypeLabel(matchType: MatchType) {
  return matchType === "GROUP" ? "Group" : "KO";
}

function restBadgeClass(restScore: number) {
  return restScore === 0
    ? "border-red-200 bg-red-50 text-red-700"
    : "border-border";
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlightName(label: string, favouriteName: string | null) {
  if (!favouriteName) return label;
  const pattern = new RegExp(escapeRegExp(favouriteName), "gi");
  const parts = label.split(pattern);
  if (parts.length === 1) return label;
  const matches = label.match(pattern) ?? [];
  return (
    <>
      {parts.map((part, index) => {
        const match = matches[index];
        return (
          <span key={`${part}-${index}`}>
            {part}
            {match ? <span className="text-[yellowgreen]">{match}</span> : null}
          </span>
        );
      })}
    </>
  );
}

function hasInPlayConflict(
  playerIds: string[],
  inPlayPlayerIds: Set<string>
) {
  return playerIds.some((playerId) => inPlayPlayerIds.has(playerId));
}

function formatNotificationTime(timestamp: string) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "UTC",
  }).format(date);
}

export function ScheduleClient({
  initialState,
  role,
  favouritePlayerName,
}: {
  initialState: ScheduleState;
  role: UserRole;
  favouritePlayerName: string | null;
}) {
  const isAdmin = role === "admin";
  const router = useRouter();
  const stage = initialState.stage as ScheduleStage;
  const [view, setView] = useState<"courts" | "queue">("courts");
  const effectiveView = isAdmin ? view : "courts";
  const [category, setCategory] = useState<CategoryFilter>("ALL");
  const [statusFilter, setStatusFilter] = useState<QueueStatus>("ELIGIBLE");
  const [search, setSearch] = useState("");
  const [autoScheduleOverride, setAutoScheduleOverride] = useState<{
    stage: ScheduleStage;
    value: boolean;
  } | null>(null);
  const [modal, setModal] = useState<ModalState>(null);
  const [selectedMatchKey, setSelectedMatchKey] = useState("");
  const [refereeNotifications, setRefereeNotifications] = useState<RefereeNotificationItem[]>(
    initialState.refereeNotifications ?? []
  );
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useGlobalTransition();
  const [isAutoScheduleSubmitting, setIsAutoScheduleSubmitting] = useState(false);
  const inPlayPlayerIds = useMemo(
    () => new Set(initialState.inPlayPlayerIds ?? []),
    [initialState.inPlayPlayerIds]
  );
  const scheduleDebug = process.env.NEXT_PUBLIC_SCHEDULE_DEBUG === "1";
  const autoSchedule =
    autoScheduleOverride?.stage === stage
      ? autoScheduleOverride.value
      : initialState.config.autoScheduleEnabled;

  if (scheduleDebug) {
    console.log(
      "[schedule][debug][client] upcoming",
      initialState.upcomingMatches.map((match) => ({
        key: match.key,
        forced: match.isForced ?? false,
        waiting: hasInPlayConflict(match.teams.playerIds, inPlayPlayerIds),
      }))
    );
    console.log(
      "[schedule][debug][client] queue",
      initialState.eligibleMatches.slice(0, 10).map((match) => ({
        key: match.key,
        forced: match.isForced ?? false,
      }))
    );
  }

  useEffect(() => {
    if (!isAdmin) return;

    let isMounted = true;
    const refreshNotifications = async () => {
      const result = await getRefereeNotifications(stage);
      if (!isMounted || !result || "error" in result) return;
      setRefereeNotifications(result.notifications);
    };

    const interval = setInterval(() => {
      void refreshNotifications();
    }, 10000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [isAdmin, stage]);

  useEffect(() => {
    if (!isAdmin || !autoSchedule) return;

    const supabase = getRealtimeBrowserClient();
    if (!supabase) return;

    let disposed = false;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    let activeChannel: RealtimeChannel | null = null;
    let eventCount = 0;

    const channelName =
      stage === "GROUP" ? "schedule-auto-group" : "schedule-auto-knockout";

    const logDebug = (
      message: string,
      extra?: Record<string, string | number | boolean | null | undefined>
    ) => {
      if (!scheduleDebug) return;
      console.log("[schedule][realtime][client]", {
        stage,
        autoSchedule,
        channelName,
        message,
        ...(extra ?? {}),
      });
    };

    const scheduleRefresh = () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        logDebug("router.refresh", { eventCount });
        router.refresh();
      }, 350);
    };

    const start = async () => {
      const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (anonKey) {
        try {
          await supabase.realtime.setAuth(anonKey);
        } catch (error) {
          logDebug("setAuth failed", {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      if (disposed) return;

      const channel = supabase.channel(channelName);
      activeChannel = channel;

      channel.on("broadcast", { event: "match_completed" }, (payload) => {
        eventCount += 1;
        logDebug("event", {
          eventType: payload.event,
          source:
            typeof payload.payload?.source === "string"
              ? payload.payload.source
              : undefined,
          eventCount,
        });
        scheduleRefresh();
      });

      channel.subscribe((status: string, err?: Error) => {
        logDebug("channel status", {
          status,
          error: err?.message ?? null,
        });
      });
    };

    void start();

    return () => {
      disposed = true;
      if (refreshTimer) clearTimeout(refreshTimer);
      if (activeChannel) {
        void supabase.removeChannel(activeChannel);
      }
      logDebug("cleanup", { eventCount });
    };
  }, [autoSchedule, isAdmin, router, scheduleDebug, stage]);

  const handleAction = async <T,>(action: () => Promise<T>) => {
    setError(null);
    startTransition(async () => {
      const result = (await action()) as { error?: string } | undefined;
      if (result?.error) {
        setError(result.error);
        setAutoScheduleOverride(null);
        return;
      }
      router.refresh();
    });
  };

  const eligibleFiltered = useMemo(() => {
    return initialState.eligibleMatches.filter((match) => {
      if (category !== "ALL" && match.categoryCode !== category) return false;
      if (search.trim()) {
        const needle = search.trim().toLowerCase();
        const haystack = match.teams.playerNames.join(" ").toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }, [initialState.eligibleMatches, category, search]);

  const blockedFiltered = useMemo(() => {
    return initialState.blockedMatches.filter((match) => {
      if (category !== "ALL" && match.categoryCode !== category) return false;
      if (search.trim()) {
        const needle = search.trim().toLowerCase();
        const haystack = match.teams.playerNames.join(" ").toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }, [initialState.blockedMatches, category, search]);

  const upcomingFiltered = useMemo(() => {
    return initialState.upcomingMatches.filter((match) => {
      if (category !== "ALL" && match.categoryCode !== category) return false;
      if (search.trim()) {
        const needle = search.trim().toLowerCase();
        const haystack = match.teams.playerNames.join(" ").toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }, [initialState.upcomingMatches, category, search]);

  const eligibleForModal = eligibleFiltered;

  return (
    <div className="space-y-6">
      {isAdmin ? (
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="grid gap-3 lg:grid-cols-[1fr,auto] lg:items-center">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-muted-foreground">Category</span>
                <select
                  className="rounded-md border border-border bg-background px-2 py-1 text-sm"
                  value={category}
                  onChange={(event) => setCategory(event.target.value as CategoryFilter)}
                >
                  <option value="ALL">All</option>
                  <option value="MD">MD</option>
                  <option value="WD">WD</option>
                  <option value="XD">XD</option>
                </select>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={view === "courts" ? "default" : "outline"}
                  onClick={() => setView("courts")}
                >
                  Live Courts
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={view === "queue" ? "default" : "outline"}
                  onClick={() => setView("queue")}
                >
                  Queue
                </Button>
              </div>

              <Button
                type="button"
                size="sm"
                variant="outline"
                className={
                  autoSchedule
                    ? "border-lime-300 bg-lime-300 text-slate-950 hover:bg-lime-400 hover:text-slate-950 dark:!border-lime-300 dark:!bg-lime-300 dark:!text-slate-950 dark:hover:!bg-lime-400"
                    : undefined
                }
                disabled={isPending || isAutoScheduleSubmitting}
                onClick={async () => {
                  if (isAutoScheduleSubmitting) return;
                  const next = !autoSchedule;
                  setAutoScheduleOverride({ stage, value: next });
                  setError(null);
                  setIsAutoScheduleSubmitting(true);
                  try {
                    const result = (await toggleAutoSchedule(stage, next)) as
                      | { error?: string }
                      | undefined;
                    if (result?.error) {
                      setError(result.error);
                      setAutoScheduleOverride(null);
                      return;
                    }
                    router.refresh();
                  } finally {
                    setIsAutoScheduleSubmitting(false);
                  }
                }}
              >
                Auto Schedule {autoSchedule ? "ON" : "OFF"}
              </Button>
            </div>

            <div className="flex items-center gap-2">
              <input
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm lg:w-64"
                placeholder="Search player name"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <Button type="button" variant="outline" onClick={() => setSearch("")} size="sm">
                Clear
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <span>{error}</span>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            className="h-6 w-6 shrink-0 rounded-md text-red-700 hover:bg-red-200 hover:text-red-800"
            onClick={() => setError(null)}
            aria-label="Dismiss error"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : null}

      {stage === "KNOCKOUT" && initialState.matchPoolCount === 0 ? (
        <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          No knockout matches available. Generate brackets first.
        </div>
      ) : null}

      {effectiveView === "courts" ? (
        <div className="space-y-6">
          <section className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-foreground">Playing</h2>
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {initialState.courts.map((court) => {
                const playing = court.playing;
                const showNoAssignable =
                  autoSchedule &&
                  !court.isLocked &&
                  !playing &&
                  initialState.eligibleMatches.length > 0 &&
                  initialState.upcomingAssignableCount === 0;
                return (
                  <div
                    key={court.id}
                    className="rounded-xl border border-border bg-card p-4 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h3 className="text-lg font-semibold text-foreground">
                          {courtLabel(court.id)}
                        </h3>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {court.isLocked ? "Locked" : "Unlocked"}
                        </div>
                      </div>
                      {isAdmin ? (
                        <Button
                          type="button"
                          size="sm"
                          variant={court.isLocked ? "outline" : "default"}
                          onClick={() =>
                            handleAction(() =>
                              lockCourt(court.id, !court.isLocked, stage)
                            )
                          }
                        >
                          {court.isLocked ? "Unlock" : "Lock"}
                        </Button>
                      ) : null}
                    </div>

                    <div className="mt-4 rounded-lg border border-border bg-muted/40 p-3 text-sm">
                      {playing ? (
                        <div className="space-y-2">
                          <div className="text-xs text-muted-foreground">
                            {matchTypeLabel(playing.matchType)} • {playing.categoryCode}
                          </div>
                          <div className="font-medium text-foreground">
                            {playing.detail}
                          </div>
                          <div className="text-sm text-foreground">
                            {highlightName(
                              playing.homeTeam?.name ?? "TBD",
                              favouritePlayerName
                            )}{" "}
                            vs{" "}
                            {highlightName(
                              playing.awayTeam?.name ?? "TBD",
                              favouritePlayerName
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="text-xs text-muted-foreground">No match assigned.</div>
                      )}
                    </div>
                    {showNoAssignable ? (
                      <div className="mt-2 text-xs text-muted-foreground">
                        No assignable match (players currently playing)
                      </div>
                    ) : null}

                    {isAdmin ? (
                      <div className="mt-4 flex flex-wrap gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => handleAction(() => backToQueue(court.id, stage))}
                          disabled={!playing || isPending}
                        >
                          Back to Queue
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            if (!playing) return;
                            const matchId = playing.matchKey.split(":")[1] ?? "";
                            if (!matchId) return;
                            handleAction(() =>
                              blockMatch(playing.matchType, matchId, stage)
                            );
                          }}
                          disabled={!playing || isPending}
                        >
                          Block
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => handleAction(() => markCompleted(court.id, stage))}
                          disabled={!playing || isPending}
                        >
                          Completed
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => {
                            setSelectedMatchKey(eligibleForModal[0]?.key ?? "");
                            setModal({ type: "assign", courtId: court.id });
                          }}
                          disabled={isPending}
                        >
                          Assign Next
                        </Button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>

          <div className="grid gap-4 xl:grid-cols-3">
            <section className="rounded-xl border border-border bg-card p-4 xl:col-span-2">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-foreground">Upcoming</h2>
                {isAdmin ? (
                  <div className="text-xs text-muted-foreground">
                    {autoSchedule ? "Auto Schedule ON" : "Auto Schedule OFF"}
                  </div>
                ) : null}
              </div>
              <div className="mt-4 space-y-3">
                {upcomingFiltered.length === 0 ? (
                  <div className="text-sm text-muted-foreground">No upcoming matches.</div>
                ) : null}
                {upcomingFiltered.map((match) => (
                  <div
                    key={match.key}
                    className="rounded-lg border border-border bg-muted/40 p-3"
                  >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <div className="text-xs text-muted-foreground">
                            {matchTypeLabel(match.matchType)} • {match.categoryCode}
                          </div>
                          <div className="text-sm font-semibold text-foreground">
                            {match.label}
                          </div>
                          <div className="text-xs text-muted-foreground">{match.detail}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          {isAdmin ? (
                            <div
                              className={`rounded-full border px-2 py-1 text-xs ${restBadgeClass(
                                match.restScore
                              )}`}
                            >
                              {match.restScore}/4 rest
                              {match.restScore === 0 ? " (warning)" : ""}
                            </div>
                          ) : null}
                          {match.isForced ? (
                            <Badge variant="outline" className="border-red-600 text-red-600">
                              Forced
                            </Badge>
                          ) : null}
                        </div>
                      </div>
                      <div className="mt-2 text-sm text-foreground">
                        {highlightName(match.teams.homeName, favouritePlayerName)} vs{" "}
                        {highlightName(match.teams.awayName, favouritePlayerName)}
                      </div>
                      {match.isForced ? (
                        <div className="mt-2">
                          <Badge variant="outline" className="border-red-600 text-red-600">
                            Forced
                          </Badge>
                        </div>
                      ) : null}
                      {isAdmin && hasInPlayConflict(match.teams.playerIds, inPlayPlayerIds) ? (
                        <div className="mt-2 text-xs text-amber-600">
                          Waiting (players currently playing)
                        </div>
                      ) : null}
                  </div>
                ))}
              </div>
            </section>
            {isAdmin ? (
              <section className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h2 className="text-base font-semibold text-foreground">Notifications</h2>
                    <div className="mt-1 text-xs text-muted-foreground">
                      Referee submissions
                    </div>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={isPending || refereeNotifications.length === 0}
                    onClick={() =>
                      handleAction(async () => {
                        const result = await clearRefereeNotifications(stage);
                        if (!result || "error" in result) return result;
                        setRefereeNotifications([]);
                        return result;
                      })
                    }
                  >
                    Clear all
                  </Button>
                </div>
                <div className="mt-4 max-h-[26rem] space-y-2 overflow-y-auto pr-1">
                  {refereeNotifications.length === 0 ? (
                    <div className="text-xs text-muted-foreground">
                      No referee notifications yet.
                    </div>
                  ) : (
                    refereeNotifications.map((item) => (
                      <div
                        key={item.id}
                        className={`rounded-lg border p-3 ${
                          item.isRead
                            ? "border-border bg-muted/30"
                            : "border-amber-500/50 bg-amber-500/10"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="text-xs text-foreground">{item.message}</div>
                          <button
                            type="button"
                            className="inline-flex h-6 w-6 items-center justify-center rounded border border-border text-muted-foreground hover:text-foreground"
                            onClick={() =>
                              handleAction(async () => {
                                const nextIsRead = !item.isRead;
                                const result = await toggleRefereeNotificationRead(
                                  stage,
                                  item.id,
                                  nextIsRead
                                );
                                if (!result || "error" in result) return result;
                                setRefereeNotifications((prev) => {
                                  const updated = prev.map((entry) =>
                                    entry.id === item.id
                                      ? { ...entry, isRead: nextIsRead }
                                      : entry
                                  );
                                  const unread = updated.filter((entry) => !entry.isRead);
                                  const read = updated.filter((entry) => entry.isRead);
                                  return [...unread, ...read];
                                });
                                return result;
                              })
                            }
                            aria-label={item.isRead ? "Mark as unread" : "Mark as read"}
                          >
                            {item.isRead ? (
                              <EyeOff className="h-3.5 w-3.5" />
                            ) : (
                              <Eye className="h-3.5 w-3.5" />
                            )}
                          </button>
                        </div>
                        <div className="mt-1 text-[11px] text-muted-foreground">
                          {formatNotificationTime(item.createdAt)}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </section>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-foreground">Queue</h2>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => handleAction(() => resetQueueForcedPriorities(stage))}
              >
                Reset the Queue
              </Button>
              <span className="text-xs text-muted-foreground">Status</span>
              <select
                className="rounded-md border border-border bg-background px-2 py-1 text-sm"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as QueueStatus)}
              >
                <option value="ELIGIBLE">Eligible</option>
                <option value="BLOCKED">Blocked</option>
              </select>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {statusFilter === "ELIGIBLE" ? (
              eligibleFiltered.length === 0 ? (
                <div className="text-sm text-muted-foreground">No eligible matches.</div>
              ) : (
                eligibleFiltered.map((match) => (
                  <div
                    key={match.key}
                    className="rounded-lg border border-border bg-muted/40 p-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="text-xs text-muted-foreground">
                          {matchTypeLabel(match.matchType)} • {match.categoryCode}
                        </div>
                        <div className="text-sm font-semibold text-foreground">
                          {match.label}
                        </div>
                        <div className="text-xs text-muted-foreground">{match.detail}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div
                          className={`rounded-full border px-2 py-1 text-xs ${restBadgeClass(
                            match.restScore
                          )}`}
                        >
                          {match.restScore}/4 rest
                          {match.restScore === 0 ? " (warning)" : ""}
                        </div>
                        {match.isForced ? (
                          <Badge variant="outline" className="border-red-600 text-red-600">
                            Forced
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                    <div className="mt-2 text-sm text-foreground">
                      {match.teams.homeName} vs {match.teams.awayName}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        onClick={() =>
                          handleAction(() =>
                            forceNext(match.matchType, match.matchId, stage)
                          )
                        }
                      >
                        Force Next
                      </Button>
                      {match.forcedRank ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            handleAction(() =>
                              clearForcedPriority(
                                match.matchType,
                                match.matchId,
                                stage
                              )
                            )
                          }
                        >
                          Back to correct position
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          handleAction(() =>
                            blockMatch(match.matchType, match.matchId, stage)
                          )
                        }
                      >
                        Block
                      </Button>
                    </div>
                  </div>
                ))
              )
            ) : blockedFiltered.length === 0 ? (
              <div className="text-sm text-muted-foreground">No blocked matches.</div>
            ) : (
              blockedFiltered.map((match) => (
                <div
                  key={match.key}
                  className="rounded-lg border border-border bg-muted/40 p-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="text-xs text-muted-foreground">
                        {matchTypeLabel(match.matchType)} • {match.categoryCode}
                      </div>
                      <div className="text-sm font-semibold text-foreground">
                        {match.label}
                      </div>
                      <div className="text-xs text-muted-foreground">{match.detail}</div>
                    </div>
                    <div className="text-xs text-muted-foreground">injury / absent</div>
                  </div>
                  <div className="mt-2 text-sm text-foreground">
                    {match.teams.homeName} vs {match.teams.awayName}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                        type="button"
                        size="sm"
                        onClick={() =>
                          handleAction(() =>
                            unblockMatch(match.matchType, match.matchId, stage)
                          )
                        }
                      >
                        Unblock
                      </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {modal && isAdmin ? (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-xl border border-border bg-card p-5 shadow-lg">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-foreground">
                Assign match to {courtLabel(modal.courtId)}
              </h3>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setModal(null)}
              >
                Close
              </Button>
            </div>
            <div className="mt-4 space-y-4">
              <div>
                <label className="text-xs text-muted-foreground">Match</label>
                <select
                  className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  value={selectedMatchKey}
                  onChange={(event) => setSelectedMatchKey(event.target.value)}
                >
                  {eligibleForModal.length === 0 ? (
                    <option value="">No eligible matches</option>
                  ) : (
                    eligibleForModal.map((match) => {
                      const isConflict = hasInPlayConflict(
                        match.teams.playerIds,
                        inPlayPlayerIds
                      );
                      return (
                        <option
                          key={match.key}
                          value={match.key}
                          disabled={isConflict}
                        >
                          {assignOptionLabel(match)}
                        {isConflict ? " (players currently playing)" : ""}
                        </option>
                      );
                    })
                  )}
                </select>
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  onClick={() => {
                      const match = eligibleForModal.find(
                        (entry) => entry.key === selectedMatchKey
                      );
                      if (!match) return;
                      handleAction(async () => {
                        const result = await assignNext({
                          courtId: modal.courtId,
                          matchType: match.matchType,
                          matchId: match.matchId,
                          stage,
                        });
                        setModal(null);
                        return result;
                      });
                  }}
                  disabled={isPending}
                >
                  Confirm assignment
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
