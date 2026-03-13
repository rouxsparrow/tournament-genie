"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { Check, Eye, EyeOff, X } from "lucide-react";
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
import type {
  ScheduleActionDeltaPayload,
  ScheduleActionDeltaResult,
  ScheduleActionResponse,
} from "@/app/schedule/actions";
import { getRealtimeBrowserClient } from "@/lib/supabase/realtime-client";
import {
  buildGroupRemainingLoadMap,
  buildUpcomingFromSortedQueue,
  computeGroupBottleneckForPlayers,
  sortQueueMatches,
} from "@/lib/schedule/group-priority";
import { buildAssignModalSections } from "@/lib/schedule/assign-modal";

type ScheduleState = Awaited<ReturnType<typeof getScheduleState>>;
type UserRole = "admin" | "viewer";
type CategoryFilter = "ALL" | "MD" | "WD" | "XD";
type QueueStatus = "ELIGIBLE" | "BLOCKED";
type MatchType = "GROUP" | "KNOCKOUT";
type ScheduleStage = "GROUP" | "KNOCKOUT";
type RefereeNotificationItem = NonNullable<
  Awaited<ReturnType<typeof getScheduleState>>
>["refereeNotifications"][number];
type ScheduleMatchListItem = ScheduleState["eligibleMatches"][number];

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

function stripMatchNumber(detail: string) {
  return detail
    .split("•")
    .map((part) => part.trim())
    .filter((part) => !/^Match\s+\d+/i.test(part))
    .join(" • ");
}

function renderTeamLineWithRestHighlight(params: {
  players: string[];
  playerIds: string[];
  fallback: string;
  favouritePlayerName: string | null;
  inPlayPlayerIds: Set<string>;
  notRestedPlayerIds: Set<string>;
  pendingCheckInPlayerIds?: Set<string>;
}): ReactNode {
  const sideHasInPlay = params.playerIds.some((id) => params.inPlayPlayerIds.has(id));
  const sideHasNotRested = params.playerIds.some((id) => params.notRestedPlayerIds.has(id));
  const sideHasPendingCheckIn = params.playerIds.some((id) =>
    params.pendingCheckInPlayerIds?.has(id)
  );
  if (params.players.length === 0) {
    const fallbackLabel = highlightName(params.fallback, params.favouritePlayerName);
    const fallbackClassName = [
      sideHasNotRested ? "rounded-sm bg-red-500/15 px-1 dark:bg-red-400/30" : "",
      sideHasInPlay ? "text-orange-500" : "",
      sideHasPendingCheckIn ? "text-red-600 dark:text-red-400" : "",
    ]
      .filter(Boolean)
      .join(" ");
    return fallbackClassName ? <span className={fallbackClassName}>{fallbackLabel}</span> : fallbackLabel;
  }

  return (
    <>
      {params.players.map((playerName, index) => {
        const playerId = params.playerIds[index];
        const isInPlayPlayer = playerId ? params.inPlayPlayerIds.has(playerId) : false;
        const isNotRestedPlayer = playerId ? params.notRestedPlayerIds.has(playerId) : false;
        const isPendingCheckInPlayer = playerId
          ? params.pendingCheckInPlayerIds?.has(playerId)
          : false;
        const playerClassName = [
          isNotRestedPlayer ? "rounded-sm bg-red-500/15 px-1 dark:bg-red-400/30" : "",
          isInPlayPlayer ? "text-orange-500" : "",
          isPendingCheckInPlayer ? "text-red-600 dark:text-red-400" : "",
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <span key={`${playerName}-${playerId ?? index}`}>
            {index > 0 ? <span className="text-muted-foreground"> + </span> : null}
            <span className={playerClassName || undefined}>
              {highlightName(playerName, params.favouritePlayerName)}
            </span>
          </span>
        );
      })}
    </>
  );
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

function splitTeamNameLines(label: string) {
  const parts = label
    .split(/\s+\+\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : [label];
}

function hasInPlayConflict(
  playerIds: string[],
  inPlayPlayerIds: Set<string>
) {
  return playerIds.some((playerId) => inPlayPlayerIds.has(playerId));
}

function isAssignableNow(playerIds: string[], inPlayPlayerIds: Set<string>) {
  return !hasInPlayConflict(playerIds, inPlayPlayerIds);
}

function computeRestScore(
  playerIds: string[],
  inPlayPlayerIds: Set<string>,
  recentlyPlayedPlayerIds: Set<string>
) {
  if (playerIds.length === 0) return 0;
  let rested = 0;
  for (const playerId of playerIds) {
    if (!inPlayPlayerIds.has(playerId) && !recentlyPlayedPlayerIds.has(playerId)) {
      rested += 1;
    }
  }
  return rested;
}

function sortScheduleMatches(
  matches: ScheduleState["eligibleMatches"],
  stage: ScheduleStage,
  inPlayPlayerIds: Set<string>
) {
  return sortQueueMatches(matches, { stage, inPlayPlayerIds });
}

function recomputeGroupBottleneck(
  matches: ScheduleState["eligibleMatches"]
): ScheduleState["eligibleMatches"] {
  const groupMatches = matches.filter((match) => match.matchType === "GROUP");
  if (groupMatches.length === 0) return matches;

  const remainingLoadMap = buildGroupRemainingLoadMap(
    groupMatches.map((match) => ({
      status: "SCHEDULED" as const,
      homeTeamId: match.teams.homePlayerIds.length > 0 ? "HOME" : null,
      awayTeamId: match.teams.awayPlayerIds.length > 0 ? "AWAY" : null,
      playerIds: match.teams.playerIds,
    }))
  );

  return matches.map((match) => {
    if (match.matchType !== "GROUP") return match;
    const bottleneck = computeGroupBottleneckForPlayers(match.teams.playerIds, remainingLoadMap);
    return {
      ...match,
      bottleneckMaxLoad: bottleneck.bottleneckMaxLoad,
      bottleneckSumLoad: bottleneck.bottleneckSumLoad,
    };
  });
}

function buildUpcomingMatches(
  queueMatches: ScheduleState["eligibleMatches"],
  inPlayPlayerIds: Set<string>,
  stage: ScheduleStage,
  limit = 5
) {
  return buildUpcomingFromSortedQueue(queueMatches, {
    stage,
    inPlayPlayerIds,
    limit,
  });
}

function applyScheduleActionDelta(
  previousState: ScheduleState,
  delta: ScheduleActionDeltaPayload
): ScheduleState | null {
  try {
    const courtPatchMap = new Map((delta.courtPatches ?? []).map((patch) => [patch.courtId, patch]));
    const nextCourts = previousState.courts.map((court) => {
      const patch = courtPatchMap.get(court.id);
      if (!patch) return court;
      return {
        ...court,
        playing: patch.playing,
      };
    });

    const removeEligibleKeys = new Set(delta.removeEligibleKeys ?? []);
    for (const key of delta.changedMatchKeys?.assigned ?? []) removeEligibleKeys.add(key);
    for (const key of delta.changedMatchKeys?.blocked ?? []) removeEligibleKeys.add(key);
    for (const key of delta.changedMatchKeys?.completed ?? []) removeEligibleKeys.add(key);

    const removeBlockedKeys = new Set(delta.removeBlockedKeys ?? []);
    for (const key of delta.changedMatchKeys?.unblocked ?? []) removeBlockedKeys.add(key);

    const eligibleMap = new Map(previousState.eligibleMatches.map((match) => [match.key, match]));
    for (const key of removeEligibleKeys) {
      eligibleMap.delete(key);
    }
    for (const added of delta.addEligible ?? []) {
      eligibleMap.set(added.key, added);
    }

    const blockedMap = new Map(previousState.blockedMatches.map((match) => [match.key, match]));
    for (const key of removeBlockedKeys) {
      blockedMap.delete(key);
    }
    for (const added of delta.addBlocked ?? []) {
      blockedMap.set(added.key, added);
      eligibleMap.delete(added.key);
    }
    for (const added of delta.addEligible ?? []) {
      blockedMap.delete(added.key);
    }

    const inPlaySet = new Set(delta.inPlayPlayerIds ?? previousState.inPlayPlayerIds ?? []);
    for (const playerId of delta.removeInPlayPlayerIds ?? []) {
      inPlaySet.delete(playerId);
    }
    for (const playerId of delta.addInPlayPlayerIds ?? []) {
      inPlaySet.add(playerId);
    }
    const inPlayPlayerIds = Array.from(inPlaySet);
    const recentlyPlayedSet = new Set(previousState.recentlyPlayedPlayerIds ?? []);

    const eligibleWithRest = Array.from(eligibleMap.values()).map((match) => ({
      ...match,
      restScore: computeRestScore(match.teams.playerIds, inPlaySet, recentlyPlayedSet),
    }));
    const eligibleWithBottleneck = recomputeGroupBottleneck(eligibleWithRest);
    const stage = previousState.stage as ScheduleStage;
    const eligibleSorted = sortScheduleMatches(eligibleWithBottleneck, stage, inPlaySet);
    const upcomingMatches = buildUpcomingMatches(eligibleSorted, inPlaySet, stage, 5);
    const assignableCount = eligibleSorted.filter((match) =>
      isAssignableNow(match.teams.playerIds, inPlaySet)
    ).length;
    const upcomingAssignableCount = upcomingMatches.filter((match) =>
      isAssignableNow(match.teams.playerIds, inPlaySet)
    ).length;

    return {
      ...previousState,
      courts: nextCourts,
      eligibleMatches: eligibleSorted,
      upcomingMatches,
      blockedMatches: sortScheduleMatches(
        Array.from(blockedMap.values()),
        stage,
        new Set<string>()
      ),
      inPlayPlayerIds,
      assignableCount,
      upcomingAssignableCount,
    };
  } catch {
    return null;
  }
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
  initialView,
}: {
  initialState: ScheduleState;
  role: UserRole;
  favouritePlayerName: string | null;
  initialView: "courts" | "queue";
}) {
  const isAdmin = role === "admin";
  const router = useRouter();
  const [state, setState] = useState<ScheduleState>(initialState);
  const stateRef = useRef(state);
  const stage = state.stage as ScheduleStage;
  const effectiveView = isAdmin ? initialView : "courts";
  const [category, setCategory] = useState<CategoryFilter>("ALL");
  const [statusFilter, setStatusFilter] = useState<QueueStatus>("ELIGIBLE");
  const [search, setSearch] = useState("");
  const [assignSearch, setAssignSearch] = useState("");
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
  const [isHotActionInFlight, setIsHotActionInFlight] = useState(false);
  const [isPending, startTransition] = useGlobalTransition();
  const [isAutoScheduleSubmitting, setIsAutoScheduleSubmitting] = useState(false);
  const inPlayPlayerIds = useMemo(
    () => new Set(state.inPlayPlayerIds ?? []),
    [state.inPlayPlayerIds]
  );
  const notRestedPlayerIds = useMemo(() => {
    const union = new Set(state.inPlayPlayerIds ?? []);
    for (const id of state.recentlyPlayedPlayerIds ?? []) {
      union.add(id);
    }
    return union;
  }, [state.inPlayPlayerIds, state.recentlyPlayedPlayerIds]);
  const scheduleDebug = process.env.NEXT_PUBLIC_SCHEDULE_DEBUG === "1";
  const autoScheduleFunctionEnabled =
    state.config.autoScheduleFunctionEnabled ?? true;
  const autoScheduleStageValue =
    autoScheduleOverride?.stage === stage
      ? autoScheduleOverride.value
      : state.config.autoScheduleEnabled;
  const autoSchedule = autoScheduleFunctionEnabled && autoScheduleStageValue;
  const isActionDisabled = isPending || isAutoScheduleSubmitting || isHotActionInFlight;

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    setState(initialState);
    stateRef.current = initialState;
    setRefereeNotifications(initialState.refereeNotifications ?? []);
  }, [initialState]);

  const refreshState = useCallback(async () => {
    try {
      const next = await getScheduleState({ category: "ALL", stage });
      setState(next);
      stateRef.current = next;
      setRefereeNotifications(next.refereeNotifications ?? []);
      return true;
    } catch {
      return false;
    }
  }, [stage]);

  if (scheduleDebug) {
    console.log(
      "[schedule][debug][client] upcoming",
      state.upcomingMatches.map((match) => ({
        key: match.key,
        forced: match.isForced ?? false,
        waiting: hasInPlayConflict(match.teams.playerIds, inPlayPlayerIds),
      }))
    );
    console.log(
      "[schedule][debug][client] queue",
      state.eligibleMatches.slice(0, 10).map((match) => ({
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

    void refreshNotifications();
    const interval = setInterval(() => {
      void refreshNotifications();
    }, 30000);

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
        logDebug("state refresh", { eventCount });
        void refreshState().then((ok) => {
          if (!ok) {
            logDebug("router.refresh fallback", { eventCount });
            router.refresh();
          }
        });
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
  }, [autoSchedule, isAdmin, refreshState, router, scheduleDebug, stage]);

  const handleAction = async <T,>(action: () => Promise<T>) => {
    if (isHotActionInFlight) return;
    setError(null);
    startTransition(async () => {
      const result = (await action()) as { error?: string } | undefined;
      if (result?.error) {
        setError(result.error);
        setAutoScheduleOverride(null);
        return;
      }
      setAutoScheduleOverride(null);
      const refreshed = await refreshState();
      if (!refreshed) {
        router.refresh();
      }
    });
  };

  const handleHotAction = useCallback(
    async (params: {
      actionLabel: string;
      request: () => Promise<ScheduleActionResponse>;
      onApplied?: (result: ScheduleActionDeltaResult) => void;
    }) => {
      if (isHotActionInFlight) return;
      setError(null);
      setIsHotActionInFlight(true);
      try {
        const result = await params.request();
        if ("error" in result) {
          setError(result.error);
          return;
        }
        if (!result.ok || result.stage !== stage) {
          setError(`${params.actionLabel} failed. Please try again.`);
          return;
        }

        const nextState = applyScheduleActionDelta(stateRef.current, result.delta);
        if (!nextState) {
          setError("Unable to update schedule board in-place. Please retry.");
          return;
        }

        stateRef.current = nextState;
        setState(nextState);
        if (result.delta.infoMessage) {
          setError(result.delta.infoMessage);
        }
        params.onApplied?.(result);
      } catch {
        setError(`${params.actionLabel} request failed. Please retry.`);
      } finally {
        setIsHotActionInFlight(false);
      }
    },
    [isHotActionInFlight, stage]
  );

  const eligibleFiltered = useMemo(() => {
    return state.eligibleMatches.filter((match) => {
      if (category !== "ALL" && match.categoryCode !== category) return false;
      if (search.trim()) {
        const needle = search.trim().toLowerCase();
        const haystack = match.teams.playerNames.join(" ").toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }, [state.eligibleMatches, category, search]);

  const blockedFiltered = useMemo(() => {
    return state.blockedMatches.filter((match) => {
      if (category !== "ALL" && match.categoryCode !== category) return false;
      if (search.trim()) {
        const needle = search.trim().toLowerCase();
        const haystack = match.teams.playerNames.join(" ").toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }, [state.blockedMatches, category, search]);
  const queueMatchCount =
    statusFilter === "ELIGIBLE" ? eligibleFiltered.length : blockedFiltered.length;

  const upcomingFiltered = useMemo(() => {
    return state.upcomingMatches.filter((match) => {
      if (category !== "ALL" && match.categoryCode !== category) return false;
      if (search.trim()) {
        const needle = search.trim().toLowerCase();
        const haystack = match.teams.playerNames.join(" ").toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }, [state.upcomingMatches, category, search]);

  const assignModalSections = useMemo(
    () =>
      buildAssignModalSections({
        upcomingMatches: upcomingFiltered,
        queueMatches: eligibleFiltered,
        inPlayPlayerIds,
      }),
    [eligibleFiltered, inPlayPlayerIds, upcomingFiltered]
  );
  const allAssignableForModal = useMemo(
    () => [
      ...assignModalSections.assignableUpcoming,
      ...assignModalSections.assignableQueueOverflow,
    ],
    [assignModalSections]
  );
  const assignModalSectionsFiltered = useMemo(() => {
    const needle = assignSearch.trim().toLowerCase();
    const filterBySearch = (matches: ScheduleMatchListItem[]) => {
      if (!needle) return matches;
      return matches.filter((match) =>
        match.teams.playerNames.join(" ").toLowerCase().includes(needle)
      );
    };
    const assignableUpcoming = filterBySearch(assignModalSections.assignableUpcoming);
    const assignableQueueOverflow = filterBySearch(
      assignModalSections.assignableQueueOverflow
    );
    return {
      assignableUpcoming,
      assignableQueueOverflow,
      all: [...assignableUpcoming, ...assignableQueueOverflow],
    };
  }, [assignModalSections, assignSearch]);
  const selectedMatchForModal =
    allAssignableForModal.find((entry) => entry.key === selectedMatchKey) ?? null;
  const selectedMatchHasConflict = selectedMatchForModal
    ? hasInPlayConflict(selectedMatchForModal.teams.playerIds, inPlayPlayerIds)
    : false;
  const isSelectedHiddenByFilter =
    Boolean(selectedMatchForModal) &&
    !assignModalSectionsFiltered.all.some((match) => match.key === selectedMatchKey);

  return (
    <div className="space-y-6">
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

      {stage === "KNOCKOUT" && state.matchPoolCount === 0 ? (
        <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          No knockout matches available. Generate brackets first.
        </div>
      ) : null}

      {effectiveView === "courts" ? (
        <div className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-10">
          <section className="rounded-xl border border-border bg-card p-4 xl:col-span-7">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-foreground">Playing</h2>
              {isAdmin && autoScheduleFunctionEnabled ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className={
                    autoSchedule
                      ? "border-lime-300 bg-lime-300 text-slate-950 hover:bg-lime-400 hover:text-slate-950 dark:!border-lime-300 dark:!bg-lime-300 dark:!text-slate-950 dark:hover:!bg-lime-400"
                      : undefined
                  }
                  disabled={isActionDisabled}
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
                      const refreshed = await refreshState();
                      if (!refreshed) {
                        router.refresh();
                      }
                    } finally {
                      setIsAutoScheduleSubmitting(false);
                    }
                  }}
                >
                  Auto Schedule {autoSchedule ? "ON" : "OFF"}
                </Button>
              ) : null}
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {state.courts.map((court) => {
                const playing = court.playing;
                const showNoAssignable =
                  autoSchedule &&
                  !court.isLocked &&
                  !playing &&
                  state.eligibleMatches.length > 0 &&
                  state.upcomingAssignableCount === 0;
                return (
                  <div
                    key={court.id}
                    className="flex h-full flex-col rounded-xl border border-border bg-card p-4 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h3 className="text-lg font-semibold text-foreground">
                          {courtLabel(court.id)}
                        </h3>
                      </div>
                      {isAdmin ? (
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="destructive"
                            onClick={() => {
                              if (!playing) return;
                              const matchId = playing.matchKey.split(":")[1] ?? "";
                              if (!matchId) return;
                              handleHotAction({
                                actionLabel: "Block match",
                                request: () => blockMatch(playing.matchType, matchId, stage),
                              });
                            }}
                            disabled={!playing || isActionDisabled}
                          >
                            Block Match
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant={court.isLocked ? "outline" : "default"}
                            onClick={() =>
                              handleAction(() =>
                                lockCourt(court.id, !court.isLocked, stage)
                              )
                            }
                            disabled={isActionDisabled}
                          >
                            {court.isLocked ? "Unlock Court" : "Lock Court"}
                          </Button>
                        </div>
                      ) : null}
                    </div>

                    <div className="mt-4 min-h-[190px] rounded-lg border border-border bg-muted/40 p-3 text-sm">
                      {playing ? (
                        <div className="flex min-h-[166px] flex-col">
                          <div className="text-xs text-muted-foreground">
                            {playing.categoryCode}
                            {playing.detail ? ` • ${stripMatchNumber(playing.detail)}` : ""}
                          </div>
                          <div className="mt-1 space-y-2 text-sm text-center text-foreground">
                            <div className="space-y-1 break-words font-medium">
                              {splitTeamNameLines(playing.homeTeam?.name ?? "TBD").map((line, index) => (
                                <div key={`home-${line}-${index}`}>
                                  {highlightName(line, favouritePlayerName)}
                                </div>
                              ))}
                            </div>
                            <div className="py-0.5 text-center text-xs font-medium uppercase tracking-wide text-muted-foreground">
                              ----vs----
                            </div>
                            <div className="space-y-1 break-words font-medium translate-y-2">
                              {splitTeamNameLines(playing.awayTeam?.name ?? "TBD").map((line, index) => (
                                <div key={`away-${line}-${index}`}>
                                  {highlightName(line, favouritePlayerName)}
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="flex min-h-[166px] w-full items-center justify-center text-xs text-muted-foreground">
                          No match assigned.
                        </div>
                      )}
                    </div>
                    <div className="mt-1 min-h-3 text-xs text-muted-foreground">
                      {showNoAssignable
                        ? "No assignable match (players currently playing)"
                        : null}
                    </div>

                    {isAdmin ? (
                      <div className="space-y-2">
                        <Button
                          type="button"
                          size="sm"
                          className="w-full"
                          onClick={() => {
                            setAssignSearch("");
                            setSelectedMatchKey(assignModalSections.defaultSelectedKey);
                            setModal({ type: "assign", courtId: court.id });
                          }}
                          disabled={isActionDisabled || court.isLocked}
                        >
                          Assign
                        </Button>
                        <div className="grid grid-cols-2 gap-2">
                          <Button
                            type="button"
                            size="sm"
                            className="w-full border-orange-500 bg-orange-500 text-white hover:bg-orange-600"
                            onClick={() =>
                              handleHotAction({
                                actionLabel: "Back to queue",
                                request: () => backToQueue(court.id, stage),
                              })
                            }
                            disabled={!playing || isActionDisabled}
                          >
                            Back to Q
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            className="w-full border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700"
                            onClick={() =>
                              handleHotAction({
                                actionLabel: "Mark completed",
                                request: () => markCompleted(court.id, stage),
                              })
                            }
                            disabled={!playing || isActionDisabled}
                          >
                            Completed
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>

          <div className="space-y-4 xl:col-span-3">
            <section className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-foreground">Upcoming</h2>
                {isAdmin && autoScheduleFunctionEnabled ? (
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
                            {match.categoryCode}
                            {match.label ? ` • ${match.label}` : ""}
                            {match.detail ? ` • ${stripMatchNumber(match.detail)}` : ""}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {isAdmin ? (
                            <div
                              className={`rounded-full border px-2 py-1 text-xs ${restBadgeClass(
                                match.restScore
                              )}`}
                            >
                              <span className="rounded-sm bg-red-500/15 px-1 dark:bg-red-400/30">
                                {match.restScore}
                              </span>{" "}
                              / 4 rest
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
                      <div className="mt-2 space-y-1 text-center text-sm text-foreground">
                        <div className="font-medium">
                          {renderTeamLineWithRestHighlight({
                            players: match.teams.homePlayers,
                            playerIds: match.teams.homePlayerIds,
                            fallback: match.teams.homeName,
                            favouritePlayerName,
                            inPlayPlayerIds,
                            notRestedPlayerIds,
                          })}
                        </div>
                        <div className="text-center text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          ----vs----
                        </div>
                        <div className="font-medium">
                          {renderTeamLineWithRestHighlight({
                            players: match.teams.awayPlayers,
                            playerIds: match.teams.awayPlayerIds,
                            fallback: match.teams.awayName,
                            favouritePlayerName,
                            inPlayPlayerIds,
                            notRestedPlayerIds,
                          })}
                        </div>
                      </div>
                      {match.isForced ? (
                        <div className="mt-2">
                          <Badge variant="outline" className="border-red-600 text-red-600">
                            Forced
                          </Badge>
                        </div>
                      ) : null}
                      {isAdmin && hasInPlayConflict(match.teams.playerIds, inPlayPlayerIds) ? (
                        <div className="mt-2">
                          <Badge className="border-orange-500 bg-orange-500 text-white">
                            Waiting
                          </Badge>
                        </div>
                      ) : null}
                  </div>
                ))}
              </div>
            </section>
          </div>
          </div>
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
                  disabled={isActionDisabled || refereeNotifications.length === 0}
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
                          disabled={isActionDisabled}
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
      ) : (
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold text-foreground">Queue</h2>
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
              <input
                className="h-9 w-56 rounded-md border border-border bg-background px-3 py-2 text-sm"
                placeholder="Search player name"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <Button type="button" variant="outline" onClick={() => setSearch("")} size="sm">
                Clear
              </Button>
              <span className="text-xs text-muted-foreground">
                {queueMatchCount} {queueMatchCount === 1 ? "match" : "matches"}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => handleAction(() => resetQueueForcedPriorities(stage))}
                disabled={isActionDisabled}
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
                          <span className="rounded-sm bg-red-500/15 px-1 dark:bg-red-400/30">
                            {match.restScore}
                          </span>{" "}
                          / 4 rest
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
                      {renderTeamLineWithRestHighlight({
                        players: match.teams.homePlayers,
                        playerIds: match.teams.homePlayerIds,
                        fallback: match.teams.homeName,
                        favouritePlayerName,
                        inPlayPlayerIds,
                        notRestedPlayerIds,
                      })}
                      <span className="text-muted-foreground"> vs </span>
                      {renderTeamLineWithRestHighlight({
                        players: match.teams.awayPlayers,
                        playerIds: match.teams.awayPlayerIds,
                        fallback: match.teams.awayName,
                        favouritePlayerName,
                        inPlayPlayerIds,
                        notRestedPlayerIds,
                      })}
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
                        disabled={isActionDisabled}
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
                          disabled={isActionDisabled}
                        >
                          Back to correct position
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          handleHotAction({
                            actionLabel: "Block match",
                            request: () => blockMatch(match.matchType, match.matchId, stage),
                          })
                        }
                        disabled={isActionDisabled}
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
              blockedFiltered.map((match) => {
                const pendingCheckInPlayerIds = new Set(match.pendingCheckInPlayerIds ?? []);
                return (
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
                    {match.blockReason === "PENDING_CHECKIN" ? (
                      <Badge className="border-red-600 bg-red-600 text-white">
                        pending checked in
                      </Badge>
                    ) : (
                      <div className="text-xs text-muted-foreground">
                        {match.blockReasonLabel ?? "injury / absent"}
                      </div>
                    )}
                  </div>
                  <div className="mt-2 text-sm text-foreground">
                    {renderTeamLineWithRestHighlight({
                      players: match.teams.homePlayers,
                      playerIds: match.teams.homePlayerIds,
                      fallback: match.teams.homeName,
                      favouritePlayerName,
                      inPlayPlayerIds,
                      notRestedPlayerIds,
                      pendingCheckInPlayerIds,
                    })}
                    <span className="text-muted-foreground"> vs </span>
                    {renderTeamLineWithRestHighlight({
                      players: match.teams.awayPlayers,
                      playerIds: match.teams.awayPlayerIds,
                      fallback: match.teams.awayName,
                      favouritePlayerName,
                      inPlayPlayerIds,
                      notRestedPlayerIds,
                      pendingCheckInPlayerIds,
                    })}
                  </div>
                  {match.canUnblock ?? true ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        onClick={() =>
                          handleHotAction({
                            actionLabel: "Unblock match",
                            request: () => unblockMatch(match.matchType, match.matchId, stage),
                          })
                        }
                        disabled={isActionDisabled}
                      >
                        Unblock
                      </Button>
                    </div>
                  ) : null}
                </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {modal && isAdmin ? (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 p-4">
          <div className="flex max-h-[80vh] w-full max-w-3xl flex-col rounded-xl border border-border bg-card p-5 shadow-lg">
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
            <div className="mt-4 flex min-h-0 flex-1 flex-col space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs text-muted-foreground">
                  Select one match card to assign to this court.
                </div>
                <input
                  className="h-9 w-full rounded-md border border-border bg-background px-3 py-2 text-sm sm:w-64"
                  placeholder="Search player name"
                  value={assignSearch}
                  onChange={(event) => setAssignSearch(event.target.value)}
                />
              </div>
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
                {assignModalSectionsFiltered.all.length === 0 ? (
                  <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
                    No assignable matches.
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Upcoming
                      </div>
                      {assignModalSectionsFiltered.assignableUpcoming.length === 0 ? (
                        <div className="rounded-lg border border-border bg-muted/20 p-3 text-sm text-muted-foreground">
                          No assignable matches in Upcoming.
                        </div>
                      ) : (
                        assignModalSectionsFiltered.assignableUpcoming.map((match) => {
                          const isSelected = match.key === selectedMatchKey;
                          return (
                            <button
                              key={match.key}
                              type="button"
                              aria-pressed={isSelected}
                              onClick={() => setSelectedMatchKey(match.key)}
                              className={`w-full rounded-lg border p-3 text-left transition ${
                                isSelected
                                  ? "border-lime-400 bg-lime-500/10 ring-1 ring-lime-400/30"
                                  : "border-border bg-muted/30 hover:border-border/70 hover:bg-muted/50"
                              }`}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="text-xs text-muted-foreground">
                                  {match.categoryCode} • {match.label} • {match.detail}
                                </div>
                                <div className="flex items-center gap-2">
                                  <div
                                    className={`rounded-full border px-2 py-1 text-xs ${restBadgeClass(
                                      match.restScore
                                    )}`}
                                  >
                                    <span className="rounded-sm bg-red-500/15 px-1 dark:bg-red-400/30">
                                      {match.restScore}
                                    </span>{" "}
                                    / 4 rest
                                    {match.restScore === 0 ? " (warning)" : ""}
                                  </div>
                                  {match.isForced ? (
                                    <Badge variant="outline" className="border-red-600 text-red-600">
                                      Forced
                                    </Badge>
                                  ) : null}
                                  {isSelected ? (
                                    <Badge className="border-lime-500 bg-lime-500 text-slate-950">
                                      <Check className="mr-1 h-3.5 w-3.5" />
                                      Selected
                                    </Badge>
                                  ) : null}
                                </div>
                              </div>
                              <div className="mt-2 space-y-1 text-sm text-foreground">
                                <div className="font-medium">
                                  {renderTeamLineWithRestHighlight({
                                    players: match.teams.homePlayers,
                                    playerIds: match.teams.homePlayerIds,
                                    fallback: match.teams.homeName,
                                    favouritePlayerName,
                                    inPlayPlayerIds,
                                    notRestedPlayerIds,
                                  })}
                                </div>
                                <div className="text-center text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                  ----vs----
                                </div>
                                <div className="font-medium">
                                  {renderTeamLineWithRestHighlight({
                                    players: match.teams.awayPlayers,
                                    playerIds: match.teams.awayPlayerIds,
                                    fallback: match.teams.awayName,
                                    favouritePlayerName,
                                    inPlayPlayerIds,
                                    notRestedPlayerIds,
                                  })}
                                </div>
                              </div>
                            </button>
                          );
                        })
                      )}
                    </div>
                    <div className="border-t border-border" />
                    <div className="space-y-2">
                      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        More from Queue
                      </div>
                      {assignModalSectionsFiltered.assignableQueueOverflow.length === 0 ? (
                        <div className="rounded-lg border border-border bg-muted/20 p-3 text-sm text-muted-foreground">
                          No additional assignable matches.
                        </div>
                      ) : (
                        assignModalSectionsFiltered.assignableQueueOverflow.map((match) => {
                          const isSelected = match.key === selectedMatchKey;
                          return (
                            <button
                              key={match.key}
                              type="button"
                              aria-pressed={isSelected}
                              onClick={() => setSelectedMatchKey(match.key)}
                              className={`w-full rounded-lg border p-3 text-left transition ${
                                isSelected
                                  ? "border-lime-400 bg-lime-500/10 ring-1 ring-lime-400/30"
                                  : "border-border bg-muted/30 hover:border-border/70 hover:bg-muted/50"
                              }`}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="text-xs text-muted-foreground">
                                  {match.categoryCode} • {match.label} • {match.detail}
                                </div>
                                <div className="flex items-center gap-2">
                                  <div
                                    className={`rounded-full border px-2 py-1 text-xs ${restBadgeClass(
                                      match.restScore
                                    )}`}
                                  >
                                    <span className="rounded-sm bg-red-500/15 px-1 dark:bg-red-400/30">
                                      {match.restScore}
                                    </span>{" "}
                                    / 4 rest
                                    {match.restScore === 0 ? " (warning)" : ""}
                                  </div>
                                  {match.isForced ? (
                                    <Badge variant="outline" className="border-red-600 text-red-600">
                                      Forced
                                    </Badge>
                                  ) : null}
                                  {isSelected ? (
                                    <Badge className="border-lime-500 bg-lime-500 text-slate-950">
                                      <Check className="mr-1 h-3.5 w-3.5" />
                                      Selected
                                    </Badge>
                                  ) : null}
                                </div>
                              </div>
                              <div className="mt-2 space-y-1 text-sm text-foreground">
                                <div className="font-medium">
                                  {renderTeamLineWithRestHighlight({
                                    players: match.teams.homePlayers,
                                    playerIds: match.teams.homePlayerIds,
                                    fallback: match.teams.homeName,
                                    favouritePlayerName,
                                    inPlayPlayerIds,
                                    notRestedPlayerIds,
                                  })}
                                </div>
                                <div className="text-center text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                  ----vs----
                                </div>
                                <div className="font-medium">
                                  {renderTeamLineWithRestHighlight({
                                    players: match.teams.awayPlayers,
                                    playerIds: match.teams.awayPlayerIds,
                                    fallback: match.teams.awayName,
                                    favouritePlayerName,
                                    inPlayPlayerIds,
                                    notRestedPlayerIds,
                                  })}
                                </div>
                              </div>
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>
              {isSelectedHiddenByFilter ? (
                <div className="text-xs text-muted-foreground">
                  Selected match hidden by filter.
                </div>
              ) : null}
              <div className="flex justify-center gap-2 border-t border-border pt-3">
                <Button
                  type="button"
                  onClick={() => {
                      if (!selectedMatchForModal) return;
                      handleHotAction({
                        actionLabel: "Assignment",
                        request: () =>
                          assignNext({
                          courtId: modal.courtId,
                          matchType: selectedMatchForModal.matchType,
                          matchId: selectedMatchForModal.matchId,
                          stage,
                          }),
                        onApplied: () => {
                          setModal(null);
                        },
                      });
                  }}
                  disabled={isActionDisabled || !selectedMatchForModal || selectedMatchHasConflict}
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
