"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { invalidatePublicReadModels } from "@/lib/public-read-models/cache-tags";
import { publishBroadcastRefreshEvent } from "@/lib/supabase/broadcast-refresh-publisher";
import {
  buildGroupRemainingLoadMap,
  buildUpcomingFromSortedQueue,
  computeGroupBottleneckForPlayers,
  sortQueueMatches,
} from "@/lib/schedule/group-priority";

type CategoryFilter = "ALL" | "MD" | "WD" | "XD";
type MatchType = "GROUP" | "KNOCKOUT";
type ScheduleStage = "GROUP" | "KNOCKOUT";
type AssignmentStatus = "ACTIVE" | "CLEARED" | "CANCELED";
type CategoryCode = "MD" | "WD" | "XD";
type BlockReason = "PENDING_CHECKIN" | "MANUAL_ABSENT";

type RefereeNotificationItem = {
  id: string;
  message: string;
  createdAt: string;
  isRead: boolean;
};

type RefereeNotificationPayload = {
  stage: ScheduleStage;
  matchType: MatchType;
  matchId: string;
  courtLabel: "P5" | "P6" | "P7" | "P8" | "P9" | null;
  categoryCode: CategoryCode;
  series: "A" | "B" | null;
  round: number | null;
  matchNo: number | null;
  groupName: string | null;
  homeTeamName: string;
  awayTeamName: string;
  submittedAt: string;
  isRead?: boolean;
};

type ScheduleMatchItem = {
  key: string;
  matchId: string;
  matchType: MatchType;
  categoryCode: "MD" | "WD" | "XD";
  label: string;
  detail: string;
  series?: "A" | "B";
  round?: number;
  matchNo?: number;
  teams: {
    homeName: string;
    awayName: string;
    homePlayers: string[];
    awayPlayers: string[];
    homePlayerIds: string[];
    awayPlayerIds: string[];
    playerNames: string[];
    playerIds: string[];
  };
  restScore: number;
  bottleneckMaxLoad: number;
  bottleneckSumLoad: number;
  forcedRank?: number;
  isForced?: boolean;
  blockReason?: BlockReason;
  blockReasonLabel?: string;
  canUnblock?: boolean;
  pendingCheckInPlayerIds?: string[];
};

export type SchedulePlayingItem = {
  matchKey: string;
  matchType: MatchType;
  categoryCode: string;
  detail: string;
  homeTeam: { name: string; players: string[] } | null;
  awayTeam: { name: string; players: string[] } | null;
};

export type ScheduleActionDeltaPayload = {
  courtPatches?: Array<{ courtId: string; playing: SchedulePlayingItem | null }>;
  removeEligibleKeys?: string[];
  addEligible?: ScheduleMatchItem[];
  removeBlockedKeys?: string[];
  addBlocked?: ScheduleMatchItem[];
  inPlayPlayerIds?: string[];
  addInPlayPlayerIds?: string[];
  removeInPlayPlayerIds?: string[];
  changedMatchKeys?: {
    assigned?: string[];
    cleared?: string[];
    blocked?: string[];
    unblocked?: string[];
    completed?: string[];
  };
  infoMessage?: string;
};

export type ScheduleActionDeltaResult = {
  ok: true;
  action: "assign" | "back-to-queue" | "swap-back-to-queue" | "block" | "unblock" | "completed";
  stage: ScheduleStage;
  delta: ScheduleActionDeltaPayload;
};

export type ScheduleActionErrorResult = { error: string };
export type ScheduleActionResponse = ScheduleActionDeltaResult | ScheduleActionErrorResult;
export type ScheduleActionUnknownResult = {
  status: "unknown";
  action: string;
  stage: ScheduleStage;
  message: string;
};

type LastBatchPayload = {
  matchKeys: string[];
  playerIds: string[];
  updatedAt: string;
};

const REFEREE_SCORE_SUBMITTED_ACTION = "REFEREE_SCORE_SUBMITTED";
const REFEREE_SCORE_SUBMITTED_GROUP_ACTION = "REFEREE_SCORE_SUBMITTED_GROUP";
const REFEREE_SCORE_SUBMITTED_KNOCKOUT_ACTION = "REFEREE_SCORE_SUBMITTED_KNOCKOUT";
const REFEREE_SCORE_SUBMITTED_ACTIONS = [
  REFEREE_SCORE_SUBMITTED_ACTION,
  REFEREE_SCORE_SUBMITTED_GROUP_ACTION,
  REFEREE_SCORE_SUBMITTED_KNOCKOUT_ACTION,
] as const;

function isRefereeScoreSubmittedAction(action: string) {
  return (REFEREE_SCORE_SUBMITTED_ACTIONS as readonly string[]).includes(action);
}

const matchTypeSchema = z.enum(["GROUP", "KNOCKOUT"]);
const scheduleStageSchema = z.enum(["GROUP", "KNOCKOUT"]);
const categoryFilterSchema = z.enum(["ALL", "MD", "WD", "XD"]);
const COURT_IDS = ["C1", "C2", "C3", "C4", "C5"] as const;
const AUTO_SCHEDULE_DISABLED_MESSAGE =
  "Auto Schedule is permanently disabled. Manual scheduling only.";
const SCHEDULE_DEBUG = process.env.SCHEDULE_DEBUG === "1";
const SCHEDULE_PERF_DEBUG = process.env.SCHEDULE_PERF_DEBUG === "1";
const BROADCAST_PUBLISH_WAIT_MS = 250;

type PerfEntry = { step: string; ms: number };

function startPerfTimer() {
  return Date.now();
}

async function publishBroadcastRefresh(params: {
  stage: ScheduleStage;
  source: string;
  changeType: "assignment" | "upcoming" | "both";
}) {
  const publishAttempt = publishBroadcastRefreshEvent({
    stage: params.stage,
    source: params.source,
    reason: "view-change",
    changeType: params.changeType,
  });
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<Awaited<ReturnType<typeof publishBroadcastRefreshEvent>>>(
    (resolve) => {
      timeoutHandle = setTimeout(() => {
        resolve({
          ok: false,
          error: `Publish timeout after ${BROADCAST_PUBLISH_WAIT_MS}ms`,
        });
      }, BROADCAST_PUBLISH_WAIT_MS);
    }
  );
  const result = await Promise.race([publishAttempt, timeout]);
  if (timeoutHandle) {
    clearTimeout(timeoutHandle);
  }
  if (!result.ok) {
    console.warn("[broadcast][schedule] publish skipped", {
      stage: params.stage,
      source: params.source,
      changeType: params.changeType,
      error: result.error,
      response: result.response ?? null,
    });
  }
}

function dispatchBroadcastRefresh(params: {
  stage: ScheduleStage;
  source: string;
  changeType: "assignment" | "upcoming" | "both";
}) {
  void publishBroadcastRefresh(params).catch((error: unknown) => {
    console.warn("[broadcast][schedule] async dispatch failed", {
      stage: params.stage,
      source: params.source,
      changeType: params.changeType,
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

async function invalidatePresentingStage(stage: ScheduleStage) {
  await invalidatePublicReadModels({
    type: "presenting",
    stages: [stage],
  });
}

function stopPerfTimer(
  startedAt: number,
  entries: PerfEntry[],
  step: string
) {
  entries.push({ step, ms: Date.now() - startedAt });
}

function logHotActionPerf(params: {
  action: string;
  stage: ScheduleStage;
  entries: PerfEntry[];
  meta?: Record<string, unknown>;
}) {
  if (!SCHEDULE_PERF_DEBUG) return;
  console.log("[schedule][perf][action]", {
    action: params.action,
    stage: params.stage,
    totalMs: params.entries.reduce((sum, entry) => sum + entry.ms, 0),
    entries: params.entries,
    ...(params.meta ?? {}),
  });
}

function buildMatchKey(matchType: MatchType, matchId: string) {
  return `${matchType}:${matchId}`;
}

function parseMatchKey(key: string): { matchType: MatchType; matchId: string } | null {
  const [matchType, matchId] = key.split(":");
  if ((matchType === "GROUP" || matchType === "KNOCKOUT") && matchId) {
    return { matchType, matchId };
  }
  return null;
}

function isAssignmentEmpty(assignment: {
  matchType: MatchType;
  groupMatchId: string | null;
  knockoutMatchId: string | null;
}) {
  if (assignment.matchType === "GROUP") return !assignment.groupMatchId;
  if (assignment.matchType === "KNOCKOUT") return !assignment.knockoutMatchId;
  return true;
}

function isOccupying(assignment: {
  status: AssignmentStatus;
  matchType: MatchType;
  groupMatchId: string | null;
  knockoutMatchId: string | null;
}) {
  return assignment.status === "ACTIVE" && !isAssignmentEmpty(assignment);
}

function ensureLastBatch(payload: unknown): LastBatchPayload {
  if (payload && typeof payload === "object") {
    const data = payload as Partial<LastBatchPayload>;
    if (Array.isArray(data.matchKeys) && Array.isArray(data.playerIds)) {
      return {
        matchKeys: data.matchKeys.slice(0, 5),
        playerIds: data.playerIds,
        updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : "",
      };
    }
  }
  return { matchKeys: [], playerIds: [], updatedAt: "" };
}

async function ensureCourtStageLocks(
  courts: { id: string; isLocked: boolean; lockReason: string | null }[],
  stage: ScheduleStage
) {
  if (courts.length === 0) return;
  const existingLocks = await prisma.courtStageLock.findMany({
    where: { stage, courtId: { in: courts.map((court) => court.id) } },
    select: { courtId: true },
  });
  const existingIds = new Set(existingLocks.map((lock) => lock.courtId));
  const toCreate = courts
    .filter((court) => !existingIds.has(court.id))
    .map((court) => ({
      courtId: court.id,
      stage,
      locked: stage === "GROUP" ? court.isLocked : false,
      lockReason: stage === "GROUP" ? court.lockReason : null,
    }));
  if (toCreate.length > 0) {
    await prisma.courtStageLock.createMany({ data: toCreate, skipDuplicates: true });
  }
}

async function ensureScheduleSetup(stage: ScheduleStage) {
  let configs = await prisma.scheduleConfig.findMany({
    where: { stage },
    orderBy: { createdAt: "asc" },
  });
  if (configs.length === 0) {
    configs = [
      await prisma.scheduleConfig.create({
        data: {
          stage,
          dayStartAt: new Date(),
          autoScheduleEnabled: false,
        },
      }),
    ];
  }
  let config = configs[0];
  if (configs.length > 1 || configs.some((entry) => entry.autoScheduleEnabled)) {
    await prisma.scheduleConfig.updateMany({
      where: { stage },
      data: { autoScheduleEnabled: false },
    });
    config = {
      ...config,
      autoScheduleEnabled: false,
    };
  }

  const existingCourts = await prisma.court.findMany({
    select: { id: true, isLocked: true, lockReason: true },
  });
  const existingIds = new Set(existingCourts.map((court) => court.id));
  const toCreate = COURT_IDS.filter((id) => !existingIds.has(id)).map((id) => ({
    id,
  }));
  if (toCreate.length > 0) {
    await prisma.court.createMany({ data: toCreate, skipDuplicates: true });
  }

  const courts = await prisma.court.findMany({
    select: { id: true, isLocked: true, lockReason: true },
  });
  await ensureCourtStageLocks(courts, stage);

  return config;
}

const scheduleSetupCache = new Map<ScheduleStage, { at: number }>();
const scheduleSetupInflight = new Map<ScheduleStage, Promise<void>>();
const SCHEDULE_SETUP_CACHE_TTL_MS = 60_000;

async function ensureScheduleSetupCached(stage: ScheduleStage) {
  const now = Date.now();
  const cached = scheduleSetupCache.get(stage);
  if (cached && now - cached.at < SCHEDULE_SETUP_CACHE_TTL_MS) {
    const config = await prisma.scheduleConfig.findFirst({
      where: { stage },
      orderBy: { createdAt: "asc" },
    });
    if (config) return config;
  }

  const inflight = scheduleSetupInflight.get(stage);
  if (inflight) {
    await inflight;
    const config = await prisma.scheduleConfig.findFirst({
      where: { stage },
      orderBy: { createdAt: "asc" },
    });
    if (config) return config;
  }

  const next = ensureScheduleSetup(stage)
    .then(() => {
      scheduleSetupCache.set(stage, { at: Date.now() });
    })
    .finally(() => {
      scheduleSetupInflight.delete(stage);
    });
  scheduleSetupInflight.set(stage, next);
  await next;
  const config = await prisma.scheduleConfig.findFirst({
    where: { stage },
    orderBy: { createdAt: "desc" },
  });
  if (config) return config;
  return ensureScheduleSetup(stage);
}

const ACTIVE_COURT_IDS = [...COURT_IDS];

function extractTeamPlayers(team: {
  members: { player: { id: string; name: string } }[];
}) {
  const players = team.members.map((member) => member.player);
  return {
    playerIds: players.map((player) => player.id),
    playerNames: players.map((player) => player.name),
  };
}

function extractTeamPlayerIds(team: {
  members: { player: { id: string } }[];
}) {
  return team.members.map((member) => member.player.id);
}

const scheduleTeamSelect = {
  select: {
    name: true,
    members: {
      select: {
        player: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    },
  },
} as const;

const scheduleTeamIdOnlySelect = {
  select: {
    members: {
      select: {
        player: {
          select: {
            id: true,
          },
        },
      },
    },
  },
} as const;

const scheduleGroupMatchSelect = {
  id: true,
  status: true,
  homeTeamId: true,
  awayTeamId: true,
  group: {
    select: {
      name: true,
      category: {
        select: {
          code: true,
        },
      },
    },
  },
  homeTeam: scheduleTeamSelect,
  awayTeam: scheduleTeamSelect,
} as const;

const scheduleKnockoutMatchSelect = {
  id: true,
  status: true,
  categoryCode: true,
  series: true,
  round: true,
  matchNo: true,
  isPublished: true,
  homeTeamId: true,
  awayTeamId: true,
  homeTeam: scheduleTeamSelect,
  awayTeam: scheduleTeamSelect,
} as const;

const assignmentScheduleSelect = {
  id: true,
  courtId: true,
  stage: true,
  matchType: true,
  groupMatchId: true,
  knockoutMatchId: true,
  groupMatch: { select: scheduleGroupMatchSelect },
  knockoutMatch: { select: scheduleKnockoutMatchSelect },
} as const;

const assignmentPlayerIdOnlySelect = {
  id: true,
  courtId: true,
  stage: true,
  matchType: true,
  groupMatchId: true,
  knockoutMatchId: true,
  groupMatch: {
    select: {
      id: true,
      status: true,
      homeTeam: scheduleTeamIdOnlySelect,
      awayTeam: scheduleTeamIdOnlySelect,
    },
  },
  knockoutMatch: {
    select: {
      id: true,
      status: true,
      homeTeam: scheduleTeamIdOnlySelect,
      awayTeam: scheduleTeamIdOnlySelect,
    },
  },
} as const;

function getPlayersForGroupMatch(match: {
  homeTeam: { members: { player: { id: string; name: string } }[] } | null;
  awayTeam: { members: { player: { id: string; name: string } }[] } | null;
}) {
  if (!match.homeTeam || !match.awayTeam) return [];
  const home = extractTeamPlayers(match.homeTeam);
  const away = extractTeamPlayers(match.awayTeam);
  return [...home.playerIds, ...away.playerIds];
}

function getPlayersForKnockoutMatch(match: {
  homeTeam: { members: { player: { id: string; name: string } }[] } | null;
  awayTeam: { members: { player: { id: string; name: string } }[] } | null;
}) {
  if (!match.homeTeam || !match.awayTeam) return [];
  const home = extractTeamPlayers(match.homeTeam);
  const away = extractTeamPlayers(match.awayTeam);
  return [...home.playerIds, ...away.playerIds];
}

function getPlayersForGroupMatchIds(match: {
  homeTeam: { members: { player: { id: string } }[] } | null;
  awayTeam: { members: { player: { id: string } }[] } | null;
}) {
  if (!match.homeTeam || !match.awayTeam) return [];
  return [...extractTeamPlayerIds(match.homeTeam), ...extractTeamPlayerIds(match.awayTeam)];
}

function getPlayersForKnockoutMatchIds(match: {
  homeTeam: { members: { player: { id: string } }[] } | null;
  awayTeam: { members: { player: { id: string } }[] } | null;
}) {
  if (!match.homeTeam || !match.awayTeam) return [];
  return [...extractTeamPlayerIds(match.homeTeam), ...extractTeamPlayerIds(match.awayTeam)];
}

function isListEligibleGroupMatch(match: {
  status: "SCHEDULED" | "COMPLETED";
  homeTeamId: string | null;
  awayTeamId: string | null;
}) {
  return match.status === "SCHEDULED" && !!match.homeTeamId && !!match.awayTeamId;
}

function isListEligibleKnockoutMatch(match: {
  status: "SCHEDULED" | "COMPLETED";
  homeTeamId: string | null;
  awayTeamId: string | null;
  isPublished: boolean;
}) {
  return (
    match.isPublished &&
    match.status === "SCHEDULED" &&
    !!match.homeTeamId &&
    !!match.awayTeamId
  );
}

function isCompletedMatch(match: {
  status: "SCHEDULED" | "COMPLETED";
}) {
  return match.status === "COMPLETED";
}

function hasInPlayPlayers(playerIds: string[], inPlayPlayerIds: Set<string>) {
  if (inPlayPlayerIds.size === 0) return false;
  return playerIds.some((playerId) => inPlayPlayerIds.has(playerId));
}

function hasUncheckedPlayers(playerIds: string[], uncheckedPlayerIds: Set<string>) {
  if (uncheckedPlayerIds.size === 0) return false;
  return playerIds.some((playerId) => uncheckedPlayerIds.has(playerId));
}

function isAssignableNow(playerIds: string[], inPlayPlayerIds: Set<string>) {
  return !hasInPlayPlayers(playerIds, inPlayPlayerIds);
}

async function loadUncheckedPlayerIds() {
  const uncheckedPlayers = await prisma.player.findMany({
    where: { checkedIn: false },
    select: { id: true },
  });
  return new Set(uncheckedPlayers.map((player) => player.id));
}

function buildMatchItem(params: {
  matchType: MatchType;
  matchId: string;
  categoryCode: "MD" | "WD" | "XD";
  label: string;
  detail: string;
  series?: "A" | "B";
  round?: number;
  matchNo?: number;
  homeTeam: { name: string; members: { player: { id: string; name: string } }[] } | null;
  awayTeam: { name: string; members: { player: { id: string; name: string } }[] } | null;
  restScore: number;
  bottleneckMaxLoad?: number;
  bottleneckSumLoad?: number;
  forcedRank?: number;
  isForced?: boolean;
  blockReason?: BlockReason;
  blockReasonLabel?: string;
  canUnblock?: boolean;
  pendingCheckInPlayerIds?: string[];
}): ScheduleMatchItem {
  const home = params.homeTeam
    ? extractTeamPlayers(params.homeTeam)
    : { playerIds: [], playerNames: [] };
  const away = params.awayTeam
    ? extractTeamPlayers(params.awayTeam)
    : { playerIds: [], playerNames: [] };
  return {
    key: buildMatchKey(params.matchType, params.matchId),
    matchId: params.matchId,
    matchType: params.matchType,
    categoryCode: params.categoryCode,
    label: params.label,
    detail: params.detail,
    series: params.series,
    round: params.round,
    matchNo: params.matchNo,
    teams: {
      homeName: params.homeTeam?.name ?? "TBD",
      awayName: params.awayTeam?.name ?? "TBD",
      homePlayers: home.playerNames,
      awayPlayers: away.playerNames,
      homePlayerIds: home.playerIds,
      awayPlayerIds: away.playerIds,
      playerNames: [...home.playerNames, ...away.playerNames],
      playerIds: [...home.playerIds, ...away.playerIds],
    },
    restScore: params.restScore,
    bottleneckMaxLoad: params.bottleneckMaxLoad ?? 0,
    bottleneckSumLoad: params.bottleneckSumLoad ?? 0,
    forcedRank: params.forcedRank,
    isForced:
      typeof params.isForced === "boolean"
        ? params.isForced
        : typeof params.forcedRank === "number",
    blockReason: params.blockReason,
    blockReasonLabel: params.blockReasonLabel,
    canUnblock: params.canUnblock,
    pendingCheckInPlayerIds: params.pendingCheckInPlayerIds,
  };
}

function formatKoRoundLabel(round?: number | null, matchNo?: number | null) {
  if (round === 1) return "Play-ins";
  if (round === 2) return "Quarterfinals";
  if (round === 3) return "Semifinals";
  if (round === 4 && matchNo === 2) return "Bronze";
  if (round === 4) return "Final";
  return round ? `Round ${round}` : "Round";
}

function buildPlayingFromScheduleMatchItem(match: ScheduleMatchItem): SchedulePlayingItem {
  return {
    matchKey: match.key,
    matchType: match.matchType,
    categoryCode: match.categoryCode,
    detail: match.matchType === "GROUP" ? match.label : `${match.label} • ${match.detail}`,
    homeTeam: {
      name: match.teams.homeName,
      players: match.teams.homePlayers,
    },
    awayTeam: {
      name: match.teams.awayName,
      players: match.teams.awayPlayers,
    },
  };
}

async function loadForcedRankMap(stage: ScheduleStage) {
  const forced = await prisma.forcedMatchPriority.findMany({
    where: { matchType: stage === "GROUP" ? "GROUP" : "KNOCKOUT" },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      matchType: true,
      matchId: true,
    },
  });
  const rankMap = new Map<string, number>();
  forced.forEach((entry, index) => {
    rankMap.set(buildMatchKey(entry.matchType, entry.matchId), index + 1);
  });
  return rankMap;
}

function getForcedRankFromMap(
  rankMap: Map<string, number>,
  stage: ScheduleStage,
  matchType: MatchType,
  matchId: string
) {
  if (
    (stage === "GROUP" && matchType !== "GROUP") ||
    (stage === "KNOCKOUT" && matchType !== "KNOCKOUT")
  ) {
    return undefined;
  }
  return rankMap.get(buildMatchKey(matchType, matchId));
}

function buildEligibleGroupItemFromMatch(
  match: {
    id: string;
    status: "SCHEDULED" | "COMPLETED";
    homeTeamId: string | null;
    awayTeamId: string | null;
    group: { name: string; category: { code: CategoryCode } } | null;
    homeTeam: { name: string; members: { player: { id: string; name: string } }[] } | null;
    awayTeam: { name: string; members: { player: { id: string; name: string } }[] } | null;
  },
  forcedRank?: number,
  groupRemainingLoadMap?: Map<string, number>
) {
  if (!match.group?.category || !isListEligibleGroupMatch(match)) {
    return null;
  }
  const playerIds = getPlayersForGroupMatch(match);
  const bottleneck =
    groupRemainingLoadMap
      ? computeGroupBottleneckForPlayers(playerIds, groupRemainingLoadMap)
      : { bottleneckMaxLoad: 0, bottleneckSumLoad: 0 };
  return buildMatchItem({
    matchType: "GROUP",
    matchId: match.id,
    categoryCode: match.group.category.code,
    label: `Group ${match.group.name}`,
    detail: "Group Match",
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
    restScore: 0,
    bottleneckMaxLoad: bottleneck.bottleneckMaxLoad,
    bottleneckSumLoad: bottleneck.bottleneckSumLoad,
    forcedRank,
    isForced: typeof forcedRank === "number",
  });
}

function buildEligibleKnockoutItemFromMatch(
  match: {
    id: string;
    categoryCode: CategoryCode;
    series: "A" | "B";
    round: number;
    matchNo: number;
    status: "SCHEDULED" | "COMPLETED";
    isPublished: boolean;
    homeTeamId: string | null;
    awayTeamId: string | null;
    homeTeam: { name: string; members: { player: { id: string; name: string } }[] } | null;
    awayTeam: { name: string; members: { player: { id: string; name: string } }[] } | null;
  },
  forcedRank?: number
) {
  if (!isListEligibleKnockoutMatch(match)) {
    return null;
  }
  return buildMatchItem({
    matchType: "KNOCKOUT",
    matchId: match.id,
    categoryCode: match.categoryCode,
    label: `Series ${match.series}`,
    detail: `${formatKoRoundLabel(match.round, match.matchNo)} • Match ${match.matchNo}`,
    series: match.series,
    round: match.round,
    matchNo: match.matchNo,
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
    restScore: 0,
    forcedRank,
    isForced: typeof forcedRank === "number",
  });
}

function buildManualBlockedGroupItem(match: {
  id: string;
  group: { name: string; category: { code: CategoryCode } } | null;
  homeTeam: { name: string; members: { player: { id: string; name: string } }[] } | null;
  awayTeam: { name: string; members: { player: { id: string; name: string } }[] } | null;
}) {
  if (!match.group?.category) return null;
  return buildMatchItem({
    matchType: "GROUP",
    matchId: match.id,
    categoryCode: match.group.category.code,
    label: `Group ${match.group.name}`,
    detail: "Group Match",
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
    restScore: 0,
    blockReason: "MANUAL_ABSENT",
    blockReasonLabel: "injury / absent",
    canUnblock: true,
  });
}

function buildManualBlockedKnockoutItem(match: {
  id: string;
  categoryCode: CategoryCode;
  series: "A" | "B";
  round: number;
  matchNo: number;
  homeTeam: { name: string; members: { player: { id: string; name: string } }[] } | null;
  awayTeam: { name: string; members: { player: { id: string; name: string } }[] } | null;
}) {
  return buildMatchItem({
    matchType: "KNOCKOUT",
    matchId: match.id,
    categoryCode: match.categoryCode,
    label: `Series ${match.series}`,
    detail: `${formatKoRoundLabel(match.round, match.matchNo)} • Match ${match.matchNo}`,
    series: match.series,
    round: match.round,
    matchNo: match.matchNo,
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
    restScore: 0,
    blockReason: "MANUAL_ABSENT",
    blockReasonLabel: "injury / absent",
    canUnblock: true,
  });
}

function asObjectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asStage(value: unknown): ScheduleStage | null {
  return value === "GROUP" || value === "KNOCKOUT" ? value : null;
}

function asMatchType(value: unknown): MatchType | null {
  return value === "GROUP" || value === "KNOCKOUT" ? value : null;
}

function asCategoryCode(value: unknown): CategoryCode | null {
  return value === "MD" || value === "WD" || value === "XD" ? value : null;
}

function asSeries(value: unknown): "A" | "B" | null {
  return value === "A" || value === "B" ? value : null;
}

function asCourtLabel(value: unknown): "P5" | "P6" | "P7" | "P8" | "P9" | null {
  return value === "P5" ||
    value === "P6" ||
    value === "P7" ||
    value === "P8" ||
    value === "P9"
    ? value
    : null;
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asRequiredString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function asNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function parseRefereeNotificationPayload(payload: unknown): RefereeNotificationPayload | null {
  const record = asObjectRecord(payload);
  if (!record) return null;
  const stage = asStage(record.stage);
  const matchType = asMatchType(record.matchType);
  const matchId = asRequiredString(record.matchId);
  const categoryCode = asCategoryCode(record.categoryCode);
  const homeTeamName = asRequiredString(record.homeTeamName);
  const awayTeamName = asRequiredString(record.awayTeamName);
  const submittedAt = asRequiredString(record.submittedAt);
  if (!stage || !matchType || !matchId || !categoryCode || !homeTeamName || !awayTeamName || !submittedAt) {
    return null;
  }
  return {
    stage,
    matchType,
    matchId,
    courtLabel: asCourtLabel(record.courtLabel),
    categoryCode,
    series: asSeries(record.series),
    round: asNullableNumber(record.round),
    matchNo: asNullableNumber(record.matchNo),
    groupName: asNullableString(record.groupName),
    homeTeamName,
    awayTeamName,
    submittedAt,
    isRead: asBoolean(record.isRead) ?? false,
  };
}

function refereeRoundToken(payload: RefereeNotificationPayload) {
  if (payload.stage === "GROUP") {
    return payload.groupName ? `G-${payload.groupName}` : "-";
  }
  if (payload.round === 1) return "PI";
  if (payload.round === 2) return "QF";
  if (payload.round === 3) return "SF";
  if (payload.round === 4 && payload.matchNo === 2) return "Bronze";
  if (payload.round === 4) return "F";
  if (typeof payload.round === "number") return `R${payload.round}`;
  return "-";
}

function formatRefereeNotificationMessage(payload: RefereeNotificationPayload) {
  const stageToken = payload.stage === "GROUP" ? "GS" : "KO";
  const court = payload.courtLabel ?? "-";
  if (payload.stage === "GROUP") {
    const groupToken = payload.groupName ?? "-";
    return `Court ${court} - ${payload.categoryCode} - ${stageToken} - ${groupToken} - ${payload.homeTeamName} vs ${payload.awayTeamName} finished`;
  }
  const seriesToken = payload.series ?? "-";
  const roundToken = refereeRoundToken(payload);
  return `Court ${court} - ${payload.categoryCode} - ${stageToken} - ${seriesToken} - ${roundToken} - ${payload.homeTeamName} vs ${payload.awayTeamName} finished`;
}

async function listRefereeNotifications(
  stage: ScheduleStage,
  limit = 20
): Promise<RefereeNotificationItem[]> {
  const logs = await prisma.scheduleActionLog.findMany({
    where: { action: { in: [...REFEREE_SCORE_SUBMITTED_ACTIONS] } },
    orderBy: { createdAt: "desc" },
    take: Math.max(limit * 6, 120),
  });

  const unread: RefereeNotificationItem[] = [];
  const read: RefereeNotificationItem[] = [];
  for (const entry of logs) {
    const payload = parseRefereeNotificationPayload(entry.payload);
    if (!payload || payload.stage !== stage) continue;
    const item = {
      id: entry.id,
      message: formatRefereeNotificationMessage(payload),
      createdAt: entry.createdAt.toISOString(),
      isRead: payload.isRead ?? false,
    };
    if (item.isRead) {
      read.push(item);
    } else {
      unread.push(item);
    }
    if (unread.length + read.length >= limit) break;
  }
  return [...unread, ...read].slice(0, limit);
}

function buildUpcoming(
  queueMatches: ScheduleMatchItem[],
  playingPlayerIds: Set<string>,
  stage: ScheduleStage,
  limit = 5
) {
  const upcoming = buildUpcomingFromSortedQueue(queueMatches, {
    stage,
    inPlayPlayerIds: playingPlayerIds,
    limit,
  });

  if (SCHEDULE_DEBUG) {
    console.log(
      "[schedule][debug] upcoming",
      upcoming.map((match) => ({
        key: match.key,
        forced: match.isForced ?? false,
        waiting: hasInPlayPlayers(match.teams.playerIds, playingPlayerIds),
      }))
    );
  }

  return upcoming;
}

function isPlayerRested(
  playerId: string,
  playingSet: Set<string>,
  recentlyPlayedSet: Set<string>
) {
  return !playingSet.has(playerId) && !recentlyPlayedSet.has(playerId);
}

function computeRestScore(
  playerIds: string[],
  playingSet: Set<string>,
  recentlyPlayedSet: Set<string>
) {
  if (playerIds.length === 0) return 0;
  let rested = 0;
  for (const id of playerIds) {
    if (isPlayerRested(id, playingSet, recentlyPlayedSet)) rested += 1;
  }
  return rested;
}

function sortEligible(
  matches: ScheduleMatchItem[],
  stage: ScheduleStage,
  inPlayPlayerIds: Set<string>
) {
  return sortQueueMatches(matches, { stage, inPlayPlayerIds });
}

async function buildLastBatchData(matchKeys: string[]): Promise<LastBatchPayload> {
  const parsed = matchKeys.map(parseMatchKey).filter(Boolean) as {
    matchType: MatchType;
    matchId: string;
  }[];
  const groupIds = parsed
    .filter((entry) => entry.matchType === "GROUP")
    .map((entry) => entry.matchId);
  const knockoutIds = parsed
    .filter((entry) => entry.matchType === "KNOCKOUT")
    .map((entry) => entry.matchId);

  const groupMatches = groupIds.length
    ? await prisma.match.findMany({
        where: { id: { in: groupIds } },
        select: {
          homeTeam: scheduleTeamIdOnlySelect,
          awayTeam: scheduleTeamIdOnlySelect,
        },
      })
    : [];
  const knockoutMatches = knockoutIds.length
    ? await prisma.knockoutMatch.findMany({
        where: { id: { in: knockoutIds } },
        select: {
          homeTeam: scheduleTeamIdOnlySelect,
          awayTeam: scheduleTeamIdOnlySelect,
        },
      })
    : [];

  const playerIds = new Set<string>();
  for (const match of groupMatches) {
    for (const id of getPlayersForGroupMatchIds(match)) playerIds.add(id);
  }
  for (const match of knockoutMatches) {
    for (const id of getPlayersForKnockoutMatchIds(match)) playerIds.add(id);
  }

  return {
    matchKeys,
    playerIds: Array.from(playerIds),
    updatedAt: new Date().toISOString(),
  };
}

async function updateLastBatch(configId: string, matchKey: string) {
  const config = await prisma.scheduleConfig.findUnique({ where: { id: configId } });
  if (!config) return;
  const existing = ensureLastBatch(config.lastBatch);
  const nextKeys = [matchKey, ...existing.matchKeys.filter((key) => key !== matchKey)];
  const trimmed = nextKeys.slice(0, 5);
  const payload = await buildLastBatchData(trimmed);
  await prisma.scheduleConfig.update({
    where: { id: configId },
    data: { lastBatch: payload },
  });
}

async function getInPlayPlayerIds(stage: ScheduleStage) {
  const assignments = await prisma.courtAssignment.findMany({
    where: { status: "ACTIVE", stage },
    select: {
      matchType: true,
      groupMatch: {
        select: {
          homeTeam: {
            select: {
              members: { select: { player: { select: { id: true } } } },
            },
          },
          awayTeam: {
            select: {
              members: { select: { player: { select: { id: true } } } },
            },
          },
        },
      },
      knockoutMatch: {
        select: {
          homeTeam: {
            select: {
              members: { select: { player: { select: { id: true } } } },
            },
          },
          awayTeam: {
            select: {
              members: { select: { player: { select: { id: true } } } },
            },
          },
        },
      },
    },
  });

  const playerIds = new Set<string>();
  for (const assignment of assignments) {
    if (assignment.matchType === "GROUP" && assignment.groupMatch) {
      getPlayersForGroupMatchIds(assignment.groupMatch).forEach((id) => playerIds.add(id));
    }
    if (assignment.matchType === "KNOCKOUT" && assignment.knockoutMatch) {
      getPlayersForKnockoutMatchIds(assignment.knockoutMatch).forEach((id) =>
        playerIds.add(id)
      );
    }
  }
  return playerIds;
}

async function getRecentCompletedPlayerIds(stage: ScheduleStage, limit = 5) {
  if (stage === "GROUP") {
    const groupMatches = await prisma.match.findMany({
      where: { status: "COMPLETED", stage: "GROUP" },
      orderBy: { completedAt: "desc" },
      take: limit,
      select: {
        homeTeam: scheduleTeamIdOnlySelect,
        awayTeam: scheduleTeamIdOnlySelect,
      },
    });
    const playerIds = new Set<string>();
    for (const match of groupMatches) {
      getPlayersForGroupMatchIds(match).forEach((id) => playerIds.add(id));
    }
    return playerIds;
  }

  const knockoutMatches = await prisma.knockoutMatch.findMany({
    where: { status: "COMPLETED" },
    orderBy: { completedAt: "desc" },
    take: limit,
    select: {
      homeTeam: scheduleTeamIdOnlySelect,
      awayTeam: scheduleTeamIdOnlySelect,
    },
  });
  const playerIds = new Set<string>();
  for (const match of knockoutMatches) {
    getPlayersForKnockoutMatchIds(match).forEach((id) => playerIds.add(id));
  }
  return playerIds;
}

async function loadGroupRemainingLoadMapFromDb() {
  const groupMatches = await prisma.match.findMany({
    where: {
      stage: "GROUP",
      status: "SCHEDULED",
      homeTeamId: { not: null },
      awayTeamId: { not: null },
    },
    select: {
      status: true,
      homeTeamId: true,
      awayTeamId: true,
      homeTeam: scheduleTeamIdOnlySelect,
      awayTeam: scheduleTeamIdOnlySelect,
    },
  });

  return buildGroupRemainingLoadMap(
    groupMatches.map((match) => ({
      status: match.status,
      homeTeamId: match.homeTeamId,
      awayTeamId: match.awayTeamId,
      playerIds: getPlayersForGroupMatchIds(match),
    }))
  );
}

async function getLastBatchFromAssignments(stage: ScheduleStage) {
  const assignments = await prisma.courtAssignment.findMany({
    where: { status: { in: ["ACTIVE", "CLEARED"] }, stage },
    orderBy: { assignedAt: "desc" },
    take: 5,
    include: {
      groupMatch: {
        include: {
          homeTeam: { include: { members: { include: { player: true } } } },
          awayTeam: { include: { members: { include: { player: true } } } },
        },
      },
      knockoutMatch: {
        include: {
          homeTeam: { include: { members: { include: { player: true } } } },
          awayTeam: { include: { members: { include: { player: true } } } },
        },
      },
    },
  });

  const matchKeys: string[] = [];
  const playerIds = new Set<string>();

  for (const assignment of assignments) {
    const matchKey =
      assignment.matchType === "GROUP" && assignment.groupMatchId
        ? buildMatchKey("GROUP", assignment.groupMatchId)
        : assignment.matchType === "KNOCKOUT" && assignment.knockoutMatchId
          ? buildMatchKey("KNOCKOUT", assignment.knockoutMatchId)
          : null;
    if (!matchKey) continue;
    matchKeys.push(matchKey);

    if (assignment.matchType === "GROUP" && assignment.groupMatch) {
      getPlayersForGroupMatch(assignment.groupMatch).forEach((id) => playerIds.add(id));
    }
    if (assignment.matchType === "KNOCKOUT" && assignment.knockoutMatch) {
      getPlayersForKnockoutMatch(assignment.knockoutMatch).forEach((id) =>
        playerIds.add(id)
      );
    }
  }

  return {
    matchKeys,
    playerIds: Array.from(playerIds),
    updatedAt: new Date().toISOString(),
  } satisfies LastBatchPayload;
}

async function loadScheduleMatches(stage: ScheduleStage, category: CategoryFilter) {
  if (stage === "GROUP") {
    const groupMatches = await prisma.match.findMany({
      where: {
        stage: "GROUP",
        ...(category !== "ALL" ? { group: { category: { code: category } } } : {}),
      },
      include: {
        group: { include: { category: true } },
        homeTeam: { include: { members: { include: { player: true } } } },
        awayTeam: { include: { members: { include: { player: true } } } },
      },
      orderBy: [{ group: { name: "asc" } }, { createdAt: "asc" }],
    });
    return { groupMatches, knockoutMatches: [] };
  }

  const knockoutMatches = await prisma.knockoutMatch.findMany({
    where: {
      ...(category !== "ALL" ? { categoryCode: category } : {}),
      isPublished: true,
    },
    include: {
      homeTeam: { include: { members: { include: { player: true } } } },
      awayTeam: { include: { members: { include: { player: true } } } },
    },
    orderBy: [{ series: "asc" }, { round: "asc" }, { matchNo: "asc" }],
  });

  return { groupMatches: [], knockoutMatches };
}

type LoadedScheduleMatches = Awaited<ReturnType<typeof loadScheduleMatches>>;
type LoadedGroupMatch = LoadedScheduleMatches["groupMatches"][number];
type LoadedKnockoutMatch = LoadedScheduleMatches["knockoutMatches"][number];

async function loadForcedPriorities(stage: ScheduleStage) {
  const forced = await prisma.forcedMatchPriority.findMany({
    where: { matchType: stage === "GROUP" ? "GROUP" : "KNOCKOUT" },
    orderBy: { createdAt: "desc" },
  });
  const rankMap = new Map<string, number>();
  const forcedSet = new Set<string>();
  forced.forEach((entry, index) => {
    const key = buildMatchKey(entry.matchType, entry.matchId);
    rankMap.set(key, index + 1);
    forcedSet.add(key);
  });
  return { forced, rankMap, forcedSet };
}

function buildBlockedKeys(
  blocked: { matchType: MatchType; groupMatchId: string | null; knockoutMatchId: string | null }[]
) {
  return new Set(
    blocked
      .map((entry) => {
        const matchId =
          entry.matchType === "GROUP" ? entry.groupMatchId : entry.knockoutMatchId;
        if (!matchId) return null;
        return buildMatchKey(entry.matchType, matchId);
      })
      .filter((key): key is string => Boolean(key))
  );
}

function buildAssignedMatchKeys(
  assignments: {
    matchType: MatchType;
    groupMatchId: string | null;
    knockoutMatchId: string | null;
  }[]
) {
  return new Set(
    assignments
      .map((entry) => {
        if (entry.matchType === "GROUP" && entry.groupMatchId) {
          return buildMatchKey("GROUP", entry.groupMatchId);
        }
        if (entry.matchType === "KNOCKOUT" && entry.knockoutMatchId) {
          return buildMatchKey("KNOCKOUT", entry.knockoutMatchId);
        }
        return null;
      })
      .filter((key): key is string => Boolean(key))
  );
}

function getInPlayPlayerIdsFromAssignments(
  assignments: {
    matchType: MatchType;
    groupMatch: {
      homeTeam: { members: { player: { id: string } }[] } | null;
      awayTeam: { members: { player: { id: string } }[] } | null;
    } | null;
    knockoutMatch: {
      homeTeam: { members: { player: { id: string } }[] } | null;
      awayTeam: { members: { player: { id: string } }[] } | null;
    } | null;
  }[]
) {
  const playerIds = new Set<string>();
  for (const assignment of assignments) {
    if (assignment.matchType === "GROUP" && assignment.groupMatch) {
      assignment.groupMatch.homeTeam?.members.forEach((member) =>
        playerIds.add(member.player.id)
      );
      assignment.groupMatch.awayTeam?.members.forEach((member) =>
        playerIds.add(member.player.id)
      );
    }
    if (assignment.matchType === "KNOCKOUT" && assignment.knockoutMatch) {
      assignment.knockoutMatch.homeTeam?.members.forEach((member) =>
        playerIds.add(member.player.id)
      );
      assignment.knockoutMatch.awayTeam?.members.forEach((member) =>
        playerIds.add(member.player.id)
      );
    }
  }
  return playerIds;
}

async function buildListEligibleMatches(params: {
  stage: ScheduleStage;
  category: CategoryFilter;
  excludeAssigned: boolean;
  playingSet: Set<string>;
  recentlyPlayedSet: Set<string>;
  uncheckedPlayerIds?: Set<string>;
  preloaded?: {
    groupMatches: LoadedGroupMatch[];
    knockoutMatches: LoadedKnockoutMatch[];
    blocked: {
      matchType: MatchType;
      groupMatchId: string | null;
      knockoutMatchId: string | null;
    }[];
    forcedData: Awaited<ReturnType<typeof loadForcedPriorities>>;
    assignments?: {
      matchType: MatchType;
      groupMatchId: string | null;
      knockoutMatchId: string | null;
    }[];
  };
}) {
  const { groupMatches, knockoutMatches } = params.preloaded
    ? {
        groupMatches: params.preloaded.groupMatches,
        knockoutMatches: params.preloaded.knockoutMatches,
      }
    : await loadScheduleMatches(params.stage, params.category);
  const blocked = params.preloaded
    ? params.preloaded.blocked
    : await prisma.blockedMatch.findMany({
        where: { matchType: params.stage === "GROUP" ? "GROUP" : "KNOCKOUT" },
      });
  const forcedData = params.preloaded
    ? params.preloaded.forcedData
    : await loadForcedPriorities(params.stage);
  const uncheckedPlayerIds = params.uncheckedPlayerIds ?? (await loadUncheckedPlayerIds());
  const playingSet = params.playingSet;
  const recentlyPlayedSet = params.recentlyPlayedSet;
  const groupRemainingLoadMap =
    params.stage === "GROUP"
      ? buildGroupRemainingLoadMap(
          groupMatches.map((match) => ({
            status: match.status,
            homeTeamId: match.homeTeamId,
            awayTeamId: match.awayTeamId,
            playerIds: getPlayersForGroupMatch(match),
          }))
        )
      : new Map<string, number>();

  const blockedKeys = buildBlockedKeys(blocked);

  const assignedMatchKeys = params.excludeAssigned
    ? params.preloaded?.assignments
      ? buildAssignedMatchKeys(params.preloaded.assignments)
      : buildAssignedMatchKeys(
          await prisma.courtAssignment.findMany({
            where: { status: "ACTIVE", stage: params.stage },
            select: { groupMatchId: true, knockoutMatchId: true, matchType: true },
          })
        )
    : new Set<string>();

  const eligible: ScheduleMatchItem[] = [];

  if (params.stage === "GROUP") {
    for (const match of groupMatches) {
      if (!match.group || !match.group.category) continue;
      const matchKey = buildMatchKey("GROUP", match.id);
      if (assignedMatchKeys.has(matchKey)) continue;
      if (blockedKeys.has(matchKey)) continue;
      if (!isListEligibleGroupMatch(match)) continue;
      const playerIds = getPlayersForGroupMatch(match);
      const bottleneck = computeGroupBottleneckForPlayers(playerIds, groupRemainingLoadMap);
      if (hasUncheckedPlayers(playerIds, uncheckedPlayerIds)) continue;
      eligible.push(
        buildMatchItem({
          matchType: "GROUP",
          matchId: match.id,
          categoryCode: match.group.category.code,
          label: `Group ${match.group.name}`,
          detail: "Group Match",
          homeTeam: match.homeTeam,
          awayTeam: match.awayTeam,
          restScore: computeRestScore(playerIds, playingSet, recentlyPlayedSet),
          bottleneckMaxLoad: bottleneck.bottleneckMaxLoad,
          bottleneckSumLoad: bottleneck.bottleneckSumLoad,
          forcedRank: forcedData.rankMap.get(matchKey),
          isForced: forcedData.forcedSet.has(matchKey),
        })
      );
    }
  }

  if (params.stage === "KNOCKOUT") {
    for (const match of knockoutMatches) {
      const matchKey = buildMatchKey("KNOCKOUT", match.id);
      if (assignedMatchKeys.has(matchKey)) continue;
      if (blockedKeys.has(matchKey)) continue;
      if (!isListEligibleKnockoutMatch(match)) continue;
      const playerIds = getPlayersForKnockoutMatch(match);
      if (hasUncheckedPlayers(playerIds, uncheckedPlayerIds)) continue;
      eligible.push(
        buildMatchItem({
          matchType: "KNOCKOUT",
          matchId: match.id,
          categoryCode: match.categoryCode,
          label: `Series ${match.series}`,
          detail: `${formatKoRoundLabel(match.round, match.matchNo)} • Match ${match.matchNo}`,
          series: match.series,
          round: match.round,
          matchNo: match.matchNo,
          homeTeam: match.homeTeam,
          awayTeam: match.awayTeam,
          restScore: computeRestScore(playerIds, playingSet, recentlyPlayedSet),
          forcedRank: forcedData.rankMap.get(matchKey),
          isForced: forcedData.forcedSet.has(matchKey),
        })
      );
    }
  }

  return sortEligible(eligible, params.stage, playingSet);
}

async function clearInvalidAssignments(params: {
  assignments: {
    id: string;
    matchType: MatchType;
    groupMatchId: string | null;
    knockoutMatchId: string | null;
  }[];
  blockedKeys: Set<string>;
}) {
  const invalidAssignmentIds: string[] = [];

  const groupIds = params.assignments
    .filter((assignment) => assignment.matchType === "GROUP" && assignment.groupMatchId)
    .map((assignment) => assignment.groupMatchId as string);
  const knockoutIds = params.assignments
    .filter((assignment) => assignment.matchType === "KNOCKOUT" && assignment.knockoutMatchId)
    .map((assignment) => assignment.knockoutMatchId as string);

  const groupMatches = groupIds.length
    ? await prisma.match.findMany({ where: { id: { in: groupIds } } })
    : [];
  const knockoutMatches = knockoutIds.length
    ? await prisma.knockoutMatch.findMany({ where: { id: { in: knockoutIds } } })
    : [];

  const groupById = new Map(groupMatches.map((match) => [match.id, match]));
  const knockoutById = new Map(knockoutMatches.map((match) => [match.id, match]));

  for (const assignment of params.assignments) {
    if (assignment.matchType === "GROUP" && assignment.groupMatchId) {
      const match = groupById.get(assignment.groupMatchId);
      const key = buildMatchKey("GROUP", assignment.groupMatchId);
      if (!match || isCompletedMatch(match) || !isListEligibleGroupMatch(match)) {
        invalidAssignmentIds.push(assignment.id);
      } else if (params.blockedKeys.has(key)) {
        invalidAssignmentIds.push(assignment.id);
      }
    }

    if (assignment.matchType === "KNOCKOUT" && assignment.knockoutMatchId) {
      const match = knockoutById.get(assignment.knockoutMatchId);
      const key = buildMatchKey("KNOCKOUT", assignment.knockoutMatchId);
      if (!match || isCompletedMatch(match) || !isListEligibleKnockoutMatch(match)) {
        invalidAssignmentIds.push(assignment.id);
      } else if (params.blockedKeys.has(key)) {
        invalidAssignmentIds.push(assignment.id);
      }
    }
  }

  if (invalidAssignmentIds.length > 0) {
    await prisma.courtAssignment.updateMany({
      where: { id: { in: invalidAssignmentIds } },
      data: { status: "CLEARED", clearedAt: new Date() },
    });
  }

  return invalidAssignmentIds;
}

async function loadScheduleSnapshot(params: {
  stage: ScheduleStage;
  activeCourtIds: string[];
}) {
  const stageMatchType = params.stage === "GROUP" ? "GROUP" : "KNOCKOUT";
  const courts = await prisma.court.findMany({
    where: { id: { in: params.activeCourtIds } },
  });
  const locks = await prisma.courtStageLock.findMany({
    where: { stage: params.stage, courtId: { in: params.activeCourtIds } },
  });
  const assignments = await prisma.courtAssignment.findMany({
    where: {
      status: "ACTIVE",
      stage: params.stage,
      courtId: { in: params.activeCourtIds },
    },
    select: {
      id: true,
      courtId: true,
      status: true,
      stage: true,
      matchType: true,
      groupMatchId: true,
      knockoutMatchId: true,
    },
  });
  const inPlayPlayerIds = await getInPlayPlayerIds(params.stage);
  const recentlyPlayedSet = await getRecentCompletedPlayerIds(params.stage);
  const uncheckedPlayerIds = await loadUncheckedPlayerIds();
  const eligibleSource = await loadScheduleMatches(params.stage, "ALL");
  const blocked = await prisma.blockedMatch.findMany({
    where: { matchType: stageMatchType },
  });
  const forcedData = await loadForcedPriorities(params.stage);

  return {
    courts,
    locks,
    assignments,
    inPlayPlayerIds,
    recentlyPlayedSet,
    uncheckedPlayerIds,
    eligibleSource,
    blocked,
    forcedData,
  };
}

async function applyAutoSchedule(params: {
  stage: ScheduleStage;
  configId: string;
  autoEnabled: boolean;
  eligible: ScheduleMatchItem[];
  activeCourtIds: string[];
  snapshot?: Awaited<ReturnType<typeof loadScheduleSnapshot>>;
}) {
  const telemetry = {
    lockAcquired: 0,
    lockSkipped: 0,
    createAttempted: 0,
    createInserted: 0,
    createSkippedConflict: 0,
  };
  if (!params.autoEnabled) return telemetry;

  let assignedCount = 0;
  let loopGuard = 0;
  const snapshot =
    params.snapshot ??
    (await loadScheduleSnapshot({
      stage: params.stage,
      activeCourtIds: params.activeCourtIds,
    }));
  const inPlayPlayerIds = snapshot.inPlayPlayerIds;
  const assignedMatchKeysForLastBatch: string[] = [];

  const loadActiveAssignments = async (tx: Prisma.TransactionClient) =>
    tx.courtAssignment.findMany({
      where: {
        status: "ACTIVE",
        stage: params.stage,
        courtId: { in: params.activeCourtIds },
      },
      select: {
        id: true,
        courtId: true,
        status: true,
        stage: true,
        matchType: true,
        groupMatchId: true,
        knockoutMatchId: true,
      },
    });

  const lockScope = params.stage === "GROUP" ? 1 : 2;
  const lockNamespace = 91027;
  const advisoryLockKey = BigInt(lockNamespace * 10 + lockScope);

  await prisma.$transaction(async (tx) => {
    const lockResult = await tx.$queryRaw<Array<{ locked: boolean }>>`
      SELECT pg_try_advisory_xact_lock(${advisoryLockKey}) AS locked
    `;
    const locked = Boolean(lockResult[0]?.locked);
    if (!locked) {
      telemetry.lockSkipped += 1;
      return;
    }
    telemetry.lockAcquired += 1;

    const ghostIds = snapshot.assignments
      .filter((assignment) => isAssignmentEmpty(assignment))
      .map((assignment) => assignment.id);
    if (ghostIds.length > 0) {
      await tx.courtAssignment.updateMany({
        where: { id: { in: ghostIds } },
        data: { status: "CLEARED", clearedAt: new Date() },
      });
      await tx.scheduleActionLog.create({
        data: {
          action: "AUTO_CLEAR_GHOST_ASSIGNMENTS",
          payload: { stage: params.stage, count: ghostIds.length },
        },
      });
      snapshot.assignments = snapshot.assignments.filter(
        (assignment) => !ghostIds.includes(assignment.id)
      );
    }

    while (loopGuard < 10) {
      loopGuard += 1;

      const {
        courts,
        locks,
        assignments,
        recentlyPlayedSet,
        uncheckedPlayerIds,
        eligibleSource,
        blocked,
        forcedData,
      } = snapshot;
      const groupRemainingLoadMap =
        params.stage === "GROUP"
          ? buildGroupRemainingLoadMap(
              eligibleSource.groupMatches.map((match) => ({
                status: match.status,
                homeTeamId: match.homeTeamId,
                awayTeamId: match.awayTeamId,
                playerIds: getPlayersForGroupMatch(match),
              }))
            )
          : new Map<string, number>();

      if (SCHEDULE_DEBUG) {
        console.log("[schedule] active assignments", {
          stage: params.stage,
          activeAssignments: assignments.slice(0, 3).map((assignment) => ({
            courtId: assignment.courtId,
            stage: assignment.stage,
            matchKey:
              assignment.matchType === "GROUP" && assignment.groupMatchId
                ? buildMatchKey("GROUP", assignment.groupMatchId)
                : assignment.matchType === "KNOCKOUT" && assignment.knockoutMatchId
                  ? buildMatchKey("KNOCKOUT", assignment.knockoutMatchId)
                  : null,
          })),
        });
      }

      const assignedCourtIds = new Set(
        assignments.filter((entry) => isOccupying(entry)).map((entry) => entry.courtId)
      );
      const lockByCourt = new Map(locks.map((lock) => [lock.courtId, lock]));
      const freeCourts = courts
        .filter(
          (court) =>
            !lockByCourt.get(court.id)?.locked && !assignedCourtIds.has(court.id)
        )
        .sort((a, b) => a.id.localeCompare(b.id));

      const activeCount = courts.length;
      const freeCount = freeCourts.length;

      const assignedMatchKeys = new Set(
        assignments
          .map((entry) => {
            if (entry.matchType === "GROUP" && entry.groupMatchId) {
              return buildMatchKey("GROUP", entry.groupMatchId);
            }
            if (entry.matchType === "KNOCKOUT" && entry.knockoutMatchId) {
              return buildMatchKey("KNOCKOUT", entry.knockoutMatchId);
            }
            return null;
          })
          .filter((key): key is string => Boolean(key))
      );

      const lastBatchPlayerIds = recentlyPlayedSet;
      const blockedKeys = new Set(
        blocked
          .map((entry) => {
            const matchId =
              entry.matchType === "GROUP" ? entry.groupMatchId : entry.knockoutMatchId;
            if (!matchId) return null;
            return buildMatchKey(entry.matchType, matchId);
          })
          .filter((key): key is string => Boolean(key))
      );
      const eligible: ScheduleMatchItem[] = [];

      if (params.stage === "GROUP") {
        for (const match of eligibleSource.groupMatches) {
          if (!match.group || !match.group.category) continue;
          const matchKey = buildMatchKey("GROUP", match.id);
          if (assignedMatchKeys.has(matchKey)) continue;
          if (blockedKeys.has(matchKey)) continue;
          if (!isListEligibleGroupMatch(match)) continue;
          const playerIds = getPlayersForGroupMatch(match);
          const bottleneck = computeGroupBottleneckForPlayers(playerIds, groupRemainingLoadMap);
          if (hasUncheckedPlayers(playerIds, uncheckedPlayerIds)) continue;
          eligible.push(
            buildMatchItem({
              matchType: "GROUP",
              matchId: match.id,
              categoryCode: match.group.category.code,
              label: `Group ${match.group.name}`,
              detail: "Group Match",
              homeTeam: match.homeTeam,
              awayTeam: match.awayTeam,
              restScore: computeRestScore(playerIds, inPlayPlayerIds, lastBatchPlayerIds),
              bottleneckMaxLoad: bottleneck.bottleneckMaxLoad,
              bottleneckSumLoad: bottleneck.bottleneckSumLoad,
              forcedRank: forcedData.rankMap.get(matchKey),
            })
          );
        }
      }

      if (params.stage === "KNOCKOUT") {
        for (const match of eligibleSource.knockoutMatches) {
          const matchKey = buildMatchKey("KNOCKOUT", match.id);
          if (assignedMatchKeys.has(matchKey)) continue;
          if (blockedKeys.has(matchKey)) continue;
          if (!isListEligibleKnockoutMatch(match)) continue;
          const playerIds = getPlayersForKnockoutMatch(match);
          if (hasUncheckedPlayers(playerIds, uncheckedPlayerIds)) continue;
          eligible.push(
            buildMatchItem({
              matchType: "KNOCKOUT",
              matchId: match.id,
              categoryCode: match.categoryCode,
              label: `Series ${match.series}`,
              detail: `${formatKoRoundLabel(match.round, match.matchNo)} • Match ${match.matchNo}`,
              series: match.series,
              round: match.round,
              matchNo: match.matchNo,
              homeTeam: match.homeTeam,
              awayTeam: match.awayTeam,
              restScore: computeRestScore(playerIds, inPlayPlayerIds, lastBatchPlayerIds),
              forcedRank: forcedData.rankMap.get(matchKey),
            })
          );
        }
      }

      const eligibleSorted = sortEligible(eligible, params.stage, inPlayPlayerIds);
      const assignableNow = eligibleSorted.filter((match) =>
        isAssignableNow(match.teams.playerIds, inPlayPlayerIds)
      );
      const eligibleCount = eligibleSorted.length;

      const firstSkippedReason =
        eligibleSorted.length > 0 && assignableNow.length === 0
          ? {
              matchKey: eligibleSorted[0].key,
              overlapPlayerIds: eligibleSorted[0].teams.playerIds.filter((id) =>
                inPlayPlayerIds.has(id)
              ),
            }
          : null;

      const ghostActiveCount = assignments.filter((assignment) =>
        isAssignmentEmpty(assignment)
      ).length;
      const occupyingCount = assignments.filter((assignment) => isOccupying(assignment)).length;

      if (SCHEDULE_DEBUG) {
        console.log("[schedule] auto", {
          activeCourtsCount: activeCount,
          freeCourtsCount: freeCount,
          eligibleCount,
          assignableCount: assignableNow.length,
          assignedCount,
          firstSkippedReason,
          ghostActiveCount,
          occupyingCount,
        });
      }

      if (freeCourts.length === 0 || eligibleSorted.length === 0) break;

      const targetCourt = freeCourts[0];
      const next = assignableNow[0];
      if (!next) break;

      const blockedNow = await tx.blockedMatch.findFirst({
        where:
          next.matchType === "GROUP"
            ? { matchType: "GROUP", groupMatchId: next.matchId }
            : { matchType: "KNOCKOUT", knockoutMatchId: next.matchId },
        select: { id: true },
      });
      if (blockedNow) {
        snapshot.blocked = await tx.blockedMatch.findMany({
          where: { matchType: params.stage === "GROUP" ? "GROUP" : "KNOCKOUT" },
        });
        continue;
      }

      const assignment = {
        courtId: targetCourt.id,
        stage: params.stage,
        matchType: next.matchType,
        groupMatchId: next.matchType === "GROUP" ? next.matchId : null,
        knockoutMatchId: next.matchType === "KNOCKOUT" ? next.matchId : null,
      };

      const existingEmpty = assignments.find(
        (entry) =>
          entry.courtId === targetCourt.id &&
          entry.stage === params.stage &&
          entry.status === "ACTIVE" &&
          isAssignmentEmpty(entry)
      );

      if (existingEmpty) {
        const duplicateForMatch = await tx.courtAssignment.findFirst({
          where: {
            status: "ACTIVE",
            stage: params.stage,
            id: { not: existingEmpty.id },
            ...(assignment.matchType === "GROUP"
              ? { groupMatchId: assignment.groupMatchId }
              : { knockoutMatchId: assignment.knockoutMatchId }),
          },
          select: { id: true },
        });
        if (duplicateForMatch) {
          snapshot.assignments = await loadActiveAssignments(tx);
          continue;
        }
        await tx.courtAssignment.update({
          where: { id: existingEmpty.id },
          data: {
            matchType: assignment.matchType,
            groupMatchId: assignment.groupMatchId,
            knockoutMatchId: assignment.knockoutMatchId,
            assignedAt: new Date(),
            clearedAt: null,
            status: "ACTIVE",
          },
        });
      } else {
        telemetry.createAttempted += 1;
        const inserted = await tx.courtAssignment.createMany({
          data: [assignment],
          skipDuplicates: true,
        });
        if (inserted.count === 0) {
          telemetry.createSkippedConflict += 1;
          snapshot.assignments = await loadActiveAssignments(tx);
          continue;
        }
        telemetry.createInserted += inserted.count;
      }

      await tx.scheduleActionLog.create({
        data: { action: "AUTO_ASSIGN", payload: assignment },
      });

      const existingIndex = assignments.findIndex(
        (entry) =>
          entry.courtId === assignment.courtId &&
          entry.stage === assignment.stage &&
          entry.status === "ACTIVE" &&
          isAssignmentEmpty(entry)
      );
      const nextAssignment = {
        id: existingIndex >= 0 ? assignments[existingIndex].id : `NEW_${Date.now()}`,
        courtId: assignment.courtId,
        status: "ACTIVE" as AssignmentStatus,
        stage: assignment.stage,
        matchType: assignment.matchType,
        groupMatchId: assignment.groupMatchId,
        knockoutMatchId: assignment.knockoutMatchId,
      };
      if (existingIndex >= 0) {
        assignments[existingIndex] = nextAssignment;
      } else {
        assignments.push(nextAssignment);
      }
      for (const id of next.teams.playerIds) inPlayPlayerIds.add(id);

      const matchKey = buildMatchKey(
        assignment.matchType,
        assignment.matchType === "GROUP"
          ? (assignment.groupMatchId as string)
          : (assignment.knockoutMatchId as string)
      );
      assignedMatchKeysForLastBatch.push(matchKey);
      assignedCount += 1;
    }
  });

  if (assignedMatchKeysForLastBatch.length > 0) {
    const config = await prisma.scheduleConfig.findUnique({ where: { id: params.configId } });
    if (config) {
      const existing = ensureLastBatch(config.lastBatch);
      const nextKeys = [
        ...assignedMatchKeysForLastBatch.reverse(),
        ...existing.matchKeys.filter((key) => !assignedMatchKeysForLastBatch.includes(key)),
      ].slice(0, 5);
      const payload = await buildLastBatchData(nextKeys);
      await prisma.scheduleConfig.update({
        where: { id: params.configId },
        data: { lastBatch: payload },
      });
    }
  }
  return telemetry;
}

export async function getScheduleState(
  filters?: {
    category?: CategoryFilter;
    stage?: ScheduleStage;
  },
  options?: { mode?: "full" | "presenting" }
) {
  const category =
    filters?.category && categoryFilterSchema.safeParse(filters.category).success
      ? filters.category
      : "ALL";
  const stage =
    filters?.stage && scheduleStageSchema.safeParse(filters.stage).success
      ? filters.stage
      : "GROUP";

  const perfEntries: PerfEntry[] = [];

  const ensureStartedAt = startPerfTimer();
  const config = await ensureScheduleSetupCached(stage);
  stopPerfTimer(ensureStartedAt, perfEntries, "ensureScheduleSetup");
  const activeCourtIds = ACTIVE_COURT_IDS;

  const stageMatchType = stage === "GROUP" ? "GROUP" : "KNOCKOUT";
  const initialReadsStartedAt = startPerfTimer();
  const [
    courts,
    locks,
    assignmentIds,
    blocked,
    forcedData,
    matchPool,
    uncheckedPlayerIds,
  ] = await Promise.all([
      prisma.court.findMany({ orderBy: { id: "asc" } }),
      prisma.courtStageLock.findMany({ where: { stage } }),
      prisma.courtAssignment.findMany({
      where: { status: "ACTIVE", stage },
      select: {
        id: true,
        matchType: true,
        groupMatchId: true,
        knockoutMatchId: true,
      },
    }),
      prisma.blockedMatch.findMany({
        where: { matchType: stageMatchType },
      }),
      loadForcedPriorities(stage),
      loadScheduleMatches(stage, "ALL"),
      loadUncheckedPlayerIds(),
    ]);
  stopPerfTimer(initialReadsStartedAt, perfEntries, "initialReadBundle");
  const effectiveAutoScheduleEnabled = false;

  const blockedKeys = buildBlockedKeys(blocked);
  const matchPoolCount =
    stage === "GROUP" ? matchPool.groupMatches.length : matchPool.knockoutMatches.length;

  const clearInvalidStartedAt = startPerfTimer();
  await clearInvalidAssignments({
    assignments: assignmentIds,
    blockedKeys,
  });
  stopPerfTimer(clearInvalidStartedAt, perfEntries, "clearInvalidAssignments");

  const activeAssignmentsReadStartedAt = startPerfTimer();
  const activeAssignments = await prisma.courtAssignment.findMany({
    where: { status: "ACTIVE", stage },
    include: {
      groupMatch: {
        include: {
          group: { include: { category: true } },
          homeTeam: { include: { members: { include: { player: true } } } },
          awayTeam: { include: { members: { include: { player: true } } } },
        },
      },
      knockoutMatch: {
        include: {
          homeTeam: { include: { members: { include: { player: true } } } },
          awayTeam: { include: { members: { include: { player: true } } } },
        },
      },
    },
  });
  stopPerfTimer(activeAssignmentsReadStartedAt, perfEntries, "activeAssignmentsRead");

  const assignedMatchKeys = buildAssignedMatchKeys(activeAssignments);

  const supplementalReadsStartedAt = startPerfTimer();
  const [recentlyPlayedSet] = await Promise.all([getRecentCompletedPlayerIds(stage)]);
  const inPlayPlayerIds = getInPlayPlayerIdsFromAssignments(activeAssignments);
  stopPerfTimer(supplementalReadsStartedAt, perfEntries, "inPlayAndRecentReads");
  const includeLastBatch = options?.mode !== "presenting";
  const lastBatchStartedAt = startPerfTimer();
  const lastBatch =
    includeLastBatch && config.lastBatch
      ? ensureLastBatch(config.lastBatch)
      : includeLastBatch
        ? await getLastBatchFromAssignments(stage)
        : null;
  if (includeLastBatch) stopPerfTimer(lastBatchStartedAt, perfEntries, "lastBatchRead");
  const eligibleBuildStartedAt = startPerfTimer();
  const eligibleSorted = await buildListEligibleMatches({
    stage,
    category,
    excludeAssigned: true,
    playingSet: inPlayPlayerIds,
    recentlyPlayedSet,
    uncheckedPlayerIds,
    ...(category === "ALL"
      ? {
          preloaded: {
            groupMatches: matchPool.groupMatches,
            knockoutMatches: matchPool.knockoutMatches,
            blocked,
            forcedData,
            assignments: activeAssignments,
          },
        }
      : {}),
  });
  stopPerfTimer(eligibleBuildStartedAt, perfEntries, "eligibleBuild");

  const invalidForcedKeys = forcedData.forced
    .map((entry) => buildMatchKey(entry.matchType, entry.matchId))
    .filter((key) => !eligibleSorted.find((match) => match.key === key));
  if (invalidForcedKeys.length > 0) {
    await prisma.forcedMatchPriority.deleteMany({
      where: {
        OR: invalidForcedKeys.map((key) => {
          const parsed = parseMatchKey(key);
          return parsed
            ? { matchType: parsed.matchType, matchId: parsed.matchId }
            : undefined;
        }).filter(Boolean) as { matchType: MatchType; matchId: string }[],
      },
    });
  }

  const autoScheduleStartedAt = startPerfTimer();
  const autoScheduleTelemetry = await applyAutoSchedule({
    stage,
    configId: config.id,
    autoEnabled: effectiveAutoScheduleEnabled,
    eligible: eligibleSorted,
    activeCourtIds,
    snapshot: ({
      courts: (() => {
        const activeCourtIdSet = new Set<string>(activeCourtIds);
        return courts.filter((court) => activeCourtIdSet.has(court.id));
      })(),
      locks,
      assignments: activeAssignments.map((entry) => ({
        id: entry.id,
        courtId: entry.courtId,
        status: entry.status,
        stage: entry.stage,
        matchType: entry.matchType,
        groupMatchId: entry.groupMatchId,
        knockoutMatchId: entry.knockoutMatchId,
      })),
      inPlayPlayerIds,
      recentlyPlayedSet,
      uncheckedPlayerIds,
      eligibleSource: {
        groupMatches: matchPool.groupMatches,
        knockoutMatches: matchPool.knockoutMatches,
      },
      blocked,
      forcedData,
    } as Awaited<ReturnType<typeof loadScheduleSnapshot>>),
  });
  stopPerfTimer(autoScheduleStartedAt, perfEntries, "applyAutoSchedule");

  const refreshedAssignments =
    effectiveAutoScheduleEnabled
      ? await prisma.courtAssignment.findMany({
          where: { status: "ACTIVE", stage },
          include: {
            groupMatch: {
              include: {
                group: { include: { category: true } },
                homeTeam: { include: { members: { include: { player: true } } } },
                awayTeam: { include: { members: { include: { player: true } } } },
              },
            },
            knockoutMatch: {
              include: {
                homeTeam: { include: { members: { include: { player: true } } } },
                awayTeam: { include: { members: { include: { player: true } } } },
              },
            },
          },
        })
      : activeAssignments;

  const lockByCourt = new Map(locks.map((lock) => [lock.courtId, lock]));
  const playingByCourtEntries = refreshedAssignments.reduce<
    Array<
      readonly [
        string,
        {
          matchKey: string;
          matchType: MatchType;
          categoryCode: string;
          detail: string;
          homeTeam: { name: string; players: string[] } | null;
          awayTeam: { name: string; players: string[] } | null;
        }
      ]
    >
  >((entries, assignment) => {
      if (assignment.matchType === "GROUP") {
        const match = assignment.groupMatch;
        if (!match || !assignment.groupMatchId) return entries;
        const matchKey = buildMatchKey("GROUP", assignment.groupMatchId);
        const detail = match.group
          ? `Group ${match.group.name}`
          : "Group Match";
        const homeTeam = match.homeTeam
          ? {
              name: match.homeTeam.name,
              players: match.homeTeam.members.map((member) => member.player.name),
            }
          : null;
        const awayTeam = match.awayTeam
          ? {
              name: match.awayTeam.name,
              players: match.awayTeam.members.map((member) => member.player.name),
            }
          : null;
        entries.push([
          assignment.courtId,
          {
            matchKey,
            matchType: assignment.matchType,
            categoryCode: match.group?.category.code ?? "MD",
            detail,
            homeTeam,
            awayTeam,
          },
        ] as const);
        return entries;
      }

      const match = assignment.knockoutMatch;
      if (!match || !assignment.knockoutMatchId) return entries;
      const matchKey = buildMatchKey("KNOCKOUT", assignment.knockoutMatchId);
      const detail = `Series ${match.series} • ${formatKoRoundLabel(match.round, match.matchNo)} • Match ${match.matchNo}`;
      const homeTeam = match.homeTeam
        ? {
            name: match.homeTeam.name,
            players: match.homeTeam.members.map((member) => member.player.name),
          }
        : null;
      const awayTeam = match.awayTeam
        ? {
            name: match.awayTeam.name,
            players: match.awayTeam.members.map((member) => member.player.name),
          }
        : null;
      entries.push([
        assignment.courtId,
        {
          matchKey,
          matchType: assignment.matchType,
          categoryCode: match.categoryCode,
          detail,
          homeTeam,
          awayTeam,
        },
      ] as const);
      return entries;
    }, []);

  const playingByCourt = new Map(playingByCourtEntries);

  const assignedAfterAuto = new Set(
    refreshedAssignments
      .map((assignment) =>
        assignment.matchType === "GROUP"
          ? assignment.groupMatchId
            ? buildMatchKey("GROUP", assignment.groupMatchId)
            : null
          : assignment.knockoutMatchId
            ? buildMatchKey("KNOCKOUT", assignment.knockoutMatchId)
            : null
      )
      .filter((key): key is string => Boolean(key))
  );
  const eligibleFinal = eligibleSorted.filter((match) => !assignedAfterAuto.has(match.key));
  const includeCounts = options?.mode !== "presenting";
  const assignableCount = includeCounts
    ? eligibleFinal.filter((match) =>
        isAssignableNow(match.teams.playerIds, inPlayPlayerIds)
      ).length
    : 0;
  const upcomingAssignableCount = includeCounts
    ? buildUpcoming(eligibleFinal, inPlayPlayerIds, stage, 5).filter((match) =>
        isAssignableNow(match.teams.playerIds, inPlayPlayerIds)
      ).length
    : 0;

  const includeBlockedDetails = options?.mode !== "presenting";
  const blockedList = includeBlockedDetails
    ? await (async () => {
        const pendingBlockedByKey = new Map<string, ScheduleMatchItem>();
        if (stage === "GROUP") {
          for (const match of matchPool.groupMatches) {
            if (!match.group || !match.group.category) continue;
            if (!isListEligibleGroupMatch(match)) continue;
            const matchKey = buildMatchKey("GROUP", match.id);
            if (assignedAfterAuto.has(matchKey)) continue;
            const playerIds = getPlayersForGroupMatch(match);
            if (!hasUncheckedPlayers(playerIds, uncheckedPlayerIds)) continue;
            const pendingCheckInPlayerIds = playerIds.filter((id) =>
              uncheckedPlayerIds.has(id)
            );
            pendingBlockedByKey.set(
              matchKey,
              buildMatchItem({
                matchType: "GROUP",
                matchId: match.id,
                categoryCode: match.group.category.code,
                label: `Group ${match.group.name}`,
                detail: "Group Match",
                homeTeam: match.homeTeam,
                awayTeam: match.awayTeam,
                restScore: 0,
                blockReason: "PENDING_CHECKIN",
                blockReasonLabel: "pending checked in",
                canUnblock: false,
                pendingCheckInPlayerIds,
              })
            );
          }
        } else {
          for (const match of matchPool.knockoutMatches) {
            if (!isListEligibleKnockoutMatch(match)) continue;
            const matchKey = buildMatchKey("KNOCKOUT", match.id);
            if (assignedAfterAuto.has(matchKey)) continue;
            const playerIds = getPlayersForKnockoutMatch(match);
            if (!hasUncheckedPlayers(playerIds, uncheckedPlayerIds)) continue;
            const pendingCheckInPlayerIds = playerIds.filter((id) =>
              uncheckedPlayerIds.has(id)
            );
            pendingBlockedByKey.set(
              matchKey,
              buildMatchItem({
                matchType: "KNOCKOUT",
                matchId: match.id,
                categoryCode: match.categoryCode,
                label: `Series ${match.series}`,
                detail: `${formatKoRoundLabel(match.round, match.matchNo)} • Match ${match.matchNo}`,
                series: match.series,
                round: match.round,
                matchNo: match.matchNo,
                homeTeam: match.homeTeam,
                awayTeam: match.awayTeam,
                restScore: 0,
                blockReason: "PENDING_CHECKIN",
                blockReasonLabel: "pending checked in",
                canUnblock: false,
                pendingCheckInPlayerIds,
              })
            );
          }
        }

        const blockedGroupIds = blocked
          .filter((entry) => entry.matchType === "GROUP" && entry.groupMatchId)
          .map((entry) => entry.groupMatchId as string);
        const blockedKnockoutIds = blocked
          .filter((entry) => entry.matchType === "KNOCKOUT" && entry.knockoutMatchId)
          .map((entry) => entry.knockoutMatchId as string);
        const blockedGroupMatches = blockedGroupIds.length
          ? await prisma.match.findMany({
              where: { id: { in: blockedGroupIds } },
              include: {
                group: { include: { category: true } },
                homeTeam: { include: { members: { include: { player: true } } } },
                awayTeam: { include: { members: { include: { player: true } } } },
              },
            })
          : [];
        const blockedKnockoutMatches = blockedKnockoutIds.length
          ? await prisma.knockoutMatch.findMany({
              where: { id: { in: blockedKnockoutIds } },
              include: {
                homeTeam: { include: { members: { include: { player: true } } } },
                awayTeam: { include: { members: { include: { player: true } } } },
              },
            })
          : [];
        const blockedGroupById = new Map(
          blockedGroupMatches.map((match) => [match.id, match])
        );
        const blockedKnockoutById = new Map(
          blockedKnockoutMatches.map((match) => [match.id, match])
        );

        const blockedByKey = new Map<string, ScheduleMatchItem>(pendingBlockedByKey);
        for (const entry of blocked) {
          if (entry.matchType === "GROUP" && entry.groupMatchId) {
            const match = blockedGroupById.get(entry.groupMatchId);
            if (!match || !match.group || !match.group.category) continue;
            const key = buildMatchKey("GROUP", match.id);
            if (blockedByKey.has(key)) continue;
            blockedByKey.set(
              key,
              buildMatchItem({
              matchType: "GROUP",
              matchId: match.id,
              categoryCode: match.group.category.code,
              label: `Group ${match.group.name}`,
              detail: "Group Match",
              homeTeam: match.homeTeam,
              awayTeam: match.awayTeam,
              restScore: 0,
                blockReason: "MANUAL_ABSENT",
                blockReasonLabel: "injury / absent",
                canUnblock: true,
              })
            );
            continue;
          }
          if (entry.matchType === "KNOCKOUT" && entry.knockoutMatchId) {
            const match = blockedKnockoutById.get(entry.knockoutMatchId);
            if (!match) continue;
            const key = buildMatchKey("KNOCKOUT", match.id);
            if (blockedByKey.has(key)) continue;
            blockedByKey.set(
              key,
              buildMatchItem({
              matchType: "KNOCKOUT",
              matchId: match.id,
              categoryCode: match.categoryCode,
              label: `Series ${match.series}`,
              detail: `${formatKoRoundLabel(match.round, match.matchNo)} • Match ${match.matchNo}`,
              series: match.series,
              round: match.round,
              matchNo: match.matchNo,
              homeTeam: match.homeTeam,
              awayTeam: match.awayTeam,
              restScore: 0,
                blockReason: "MANUAL_ABSENT",
                blockReasonLabel: "injury / absent",
                canUnblock: true,
              })
            );
            continue;
          }
        }

        return sortEligible([...blockedByKey.values()], stage, new Set<string>());
      })()
    : [];

  const finalAssemblyStartedAt = startPerfTimer();
  const upcoming = buildUpcoming(eligibleFinal, inPlayPlayerIds, stage, 5);

  if (SCHEDULE_DEBUG) {
    console.log(
      "[schedule][debug] forcedKeys",
      `count=${eligibleFinal.filter((match) => match.isForced).length}`,
      eligibleFinal.filter((match) => match.isForced).slice(0, 20).map((match) => match.key)
    );
    console.log(
      "[schedule][debug] queue-top",
      eligibleFinal.slice(0, 15).map((match, index) => ({
        idx: index,
        key: match.key,
        forced: match.isForced ?? false,
        rest: `${match.restScore}/4`,
        players: match.teams.playerIds,
        label: match.label,
      }))
    );
  }

  const assignedCourtIds = new Set(activeAssignments.map((assignment) => assignment.courtId));
  const lockedCourtIds = courts
    .filter((court) => lockByCourt.get(court.id)?.locked)
    .map((court) => court.id);
  const freeCourtsCount = courts.filter(
    (court) => !lockByCourt.get(court.id)?.locked && !assignedCourtIds.has(court.id)
  ).length;
  const debugNote =
    freeCourtsCount === 0
      ? `locked=${lockedCourtIds.length} assigned=${assignedCourtIds.size}`
      : undefined;
  const refereeNotifications = await listRefereeNotifications(stage, 20);
  stopPerfTimer(finalAssemblyStartedAt, perfEntries, "finalAssembly");

  if (SCHEDULE_PERF_DEBUG) {
    console.log("[schedule][perf]", {
      stage,
      category,
      totalMs: perfEntries.reduce((sum, item) => sum + item.ms, 0),
      entries: perfEntries,
      eligibleCount: eligibleSorted.length,
      assignedCount: refreshedAssignments.length,
      blockedCount: blocked.length,
      notificationsCount: refereeNotifications.length,
      autoScheduleTelemetry,
    });
  }

  return {
    stage,
    matchPoolCount,
    config: {
      id: config.id,
      autoScheduleEnabled: false,
      autoScheduleFunctionEnabled: false,
      lastBatch: lastBatch ?? { matchKeys: [], playerIds: [], updatedAt: "" },
    },
    courts: courts.map((court) => {
      const lock = lockByCourt.get(court.id);
      return {
        id: court.id,
        isLocked: lock?.locked ?? false,
        lockReason: lock?.lockReason ?? null,
        playing: playingByCourt.get(court.id) ?? null,
      };
    }),
    eligibleMatches: eligibleFinal,
    upcomingMatches: upcoming,
    refereeNotifications,
    blockedMatches: blockedList.filter(Boolean) as ScheduleMatchItem[],
    inPlayPlayerIds: Array.from(inPlayPlayerIds),
    recentlyPlayedPlayerIds: Array.from(recentlyPlayedSet),
    assignableCount,
    upcomingAssignableCount,
    debug:
      options?.mode === "presenting"
        ? {
            stage,
            activeCourtsCount: 0,
            lockedCourtsCount: 0,
            assignedCourtsCount: 0,
            freeCourtsCount: 0,
            lockedCourtIds: [],
            assignedCourtIds: [],
            activeAssignmentIds: [],
            assignmentMatchKeys: [],
            note: undefined,
          }
        : {
            stage,
            activeCourtsCount: courts.length,
            lockedCourtsCount: lockedCourtIds.length,
            assignedCourtsCount: assignedCourtIds.size,
            freeCourtsCount,
            lockedCourtIds,
            assignedCourtIds: Array.from(assignedCourtIds),
            activeAssignmentIds: activeAssignments.map((assignment) => assignment.id),
            assignmentMatchKeys: Array.from(assignedMatchKeys),
            note: debugNote,
          },
  };
}

export async function getPresentingState(filters?: {
  category?: CategoryFilter;
  stage?: ScheduleStage;
}) {
  return getScheduleState(filters, { mode: "presenting" });
}

export async function getRefereeNotifications(stage: ScheduleStage) {
  const guard = await requireAdmin({ onFail: "return" });
  if (guard) return guard;
  const parsedStage = scheduleStageSchema.safeParse(stage);
  if (!parsedStage.success) return { error: "Invalid stage." };
  const notifications = await listRefereeNotifications(stage, 20);
  return { notifications };
}

export async function clearRefereeNotifications(stage: ScheduleStage) {
  const guard = await requireAdmin({ onFail: "return" });
  if (guard) return guard;
  const parsedStage = scheduleStageSchema.safeParse(stage);
  if (!parsedStage.success) return { error: "Invalid stage." };

  const logs = await prisma.scheduleActionLog.findMany({
    where: { action: { in: [...REFEREE_SCORE_SUBMITTED_ACTIONS] } },
    select: { id: true, payload: true },
  });

  const deleteIds = logs
    .filter((entry) => parseRefereeNotificationPayload(entry.payload)?.stage === stage)
    .map((entry) => entry.id);

  if (deleteIds.length > 0) {
    await prisma.scheduleActionLog.deleteMany({
      where: { id: { in: deleteIds } },
    });
  }

  revalidatePath("/schedule");
  return { ok: true };
}

export async function toggleRefereeNotificationRead(
  stage: ScheduleStage,
  notificationId: string,
  isRead: boolean
) {
  const guard = await requireAdmin({ onFail: "return" });
  if (guard) return guard;
  const parsedStage = scheduleStageSchema.safeParse(stage);
  if (!parsedStage.success) return { error: "Invalid stage." };
  if (!notificationId) return { error: "Invalid notification." };

  const log = await prisma.scheduleActionLog.findUnique({
    where: { id: notificationId },
    select: { id: true, action: true, payload: true },
  });
  if (!log || !isRefereeScoreSubmittedAction(log.action)) {
    return { error: "Notification not found." };
  }

  const payload = parseRefereeNotificationPayload(log.payload);
  if (!payload || payload.stage !== stage) {
    return { error: "Notification stage mismatch." };
  }

  const raw = asObjectRecord(log.payload) ?? {};
  await prisma.scheduleActionLog.update({
    where: { id: notificationId },
    data: {
      payload: {
        ...raw,
        isRead,
      },
    },
  });

  revalidatePath("/schedule");
  return { ok: true };
}

export async function toggleAutoSchedule(stage: ScheduleStage, enabled: boolean) {
  const guard = await requireAdmin({ onFail: "return" });
  if (guard) return guard;
  const parsedStage = scheduleStageSchema.safeParse(stage);
  if (!parsedStage.success) return { error: "Invalid stage." };
  void enabled;
  return { error: AUTO_SCHEDULE_DISABLED_MESSAGE };
}

export async function lockCourt(courtId: string, locked: boolean, stage: ScheduleStage) {
  const guard = await requireAdmin({ onFail: "return" });
  if (guard) return guard;
  const parsedStage = scheduleStageSchema.safeParse(stage);
  if (!parsedStage.success) return { error: "Invalid stage." };

  await ensureScheduleSetup(stage);
  await prisma.courtStageLock.upsert({
    where: { courtId_stage: { courtId, stage } },
    update: { locked, lockReason: locked ? "Manual lock" : null },
    create: { courtId, stage, locked, lockReason: locked ? "Manual lock" : null },
  });
  await prisma.scheduleActionLog.create({
    data: { action: locked ? "COURT_LOCK" : "COURT_UNLOCK", payload: { stage, courtId } },
  });
  revalidatePath("/schedule");
  await invalidatePresentingStage(stage);
  return { ok: true };
}

export async function backToQueue(
  courtId: string,
  stage: ScheduleStage
): Promise<ScheduleActionResponse> {
  const perfEntries: PerfEntry[] = [];
  const guard = await requireAdmin({ onFail: "return" });
  if (guard) return guard;
  const parsedStage = scheduleStageSchema.safeParse(stage);
  if (!parsedStage.success) return { error: "Invalid stage." };

  const readStartedAt = startPerfTimer();
  await ensureScheduleSetup(stage);
  const assignment = await prisma.courtAssignment.findFirst({
    where: { courtId, status: "ACTIVE", stage },
    select: assignmentScheduleSelect,
  });
  stopPerfTimer(readStartedAt, perfEntries, "validate-read");
  if (!assignment) {
    logHotActionPerf({ action: "backToQueue", stage, entries: perfEntries, meta: { skipped: true } });
    return { ok: true, action: "back-to-queue", stage, delta: {} };
  }

  const removedPlayerIds =
    assignment.matchType === "GROUP" && assignment.groupMatch
      ? getPlayersForGroupMatch(assignment.groupMatch)
      : assignment.matchType === "KNOCKOUT" && assignment.knockoutMatch
        ? getPlayersForKnockoutMatch(assignment.knockoutMatch)
        : [];
  const writeStartedAt = startPerfTimer();
  await prisma.courtAssignment.update({
    where: { id: assignment.id },
    data: { status: "CANCELED", clearedAt: new Date() },
  });
  await prisma.scheduleActionLog.create({
    data: { action: "BACK_TO_QUEUE", payload: { stage, courtId } },
  });
  stopPerfTimer(writeStartedAt, perfEntries, "write");

  const deltaStartedAt = startPerfTimer();
  const removedMatchKey =
    assignment.matchType === "GROUP" && assignment.groupMatchId
      ? buildMatchKey("GROUP", assignment.groupMatchId)
      : assignment.matchType === "KNOCKOUT" && assignment.knockoutMatchId
        ? buildMatchKey("KNOCKOUT", assignment.knockoutMatchId)
        : null;
  const addEligible: ScheduleMatchItem[] = [];
  const uncheckedPlayerIds = await loadUncheckedPlayerIds();
  let forcedRankMap: Map<string, number> | null = null;
  let groupRemainingLoadMap: Map<string, number> | null = null;
  const getForcedRank = async (matchType: MatchType, matchId: string) => {
    if (!forcedRankMap) {
      forcedRankMap = await loadForcedRankMap(stage);
    }
    return getForcedRankFromMap(forcedRankMap, stage, matchType, matchId);
  };
  const getGroupRemainingLoadMap = async () => {
    if (!groupRemainingLoadMap) {
      groupRemainingLoadMap = await loadGroupRemainingLoadMapFromDb();
    }
    return groupRemainingLoadMap;
  };

  if (assignment.matchType === "GROUP" && assignment.groupMatchId && assignment.groupMatch) {
    const playerIds = getPlayersForGroupMatch(assignment.groupMatch);
    const blocked = await prisma.blockedMatch.findFirst({
      where: { matchType: "GROUP", groupMatchId: assignment.groupMatchId },
      select: { id: true },
    });
    if (!blocked && !hasUncheckedPlayers(playerIds, uncheckedPlayerIds)) {
      const forcedRank = await getForcedRank("GROUP", assignment.groupMatchId);
      const item = buildEligibleGroupItemFromMatch(
        assignment.groupMatch,
        forcedRank,
        await getGroupRemainingLoadMap()
      );
      if (item) addEligible.push(item);
    }
  }

  if (assignment.matchType === "KNOCKOUT" && assignment.knockoutMatchId && assignment.knockoutMatch) {
    const playerIds = getPlayersForKnockoutMatch(assignment.knockoutMatch);
    const blocked = await prisma.blockedMatch.findFirst({
      where: { matchType: "KNOCKOUT", knockoutMatchId: assignment.knockoutMatchId },
      select: { id: true },
    });
    if (!blocked && !hasUncheckedPlayers(playerIds, uncheckedPlayerIds)) {
      const forcedRank = await getForcedRank("KNOCKOUT", assignment.knockoutMatchId);
      const item = buildEligibleKnockoutItemFromMatch(assignment.knockoutMatch, forcedRank);
      if (item) addEligible.push(item);
    }
  }
  stopPerfTimer(deltaStartedAt, perfEntries, "delta-build");

  const invalidateStartedAt = startPerfTimer();
  await invalidatePresentingStage(stage);
  stopPerfTimer(invalidateStartedAt, perfEntries, "cache-invalidate");

  const broadcastDispatchStartedAt = startPerfTimer();
  dispatchBroadcastRefresh({
    stage,
    source: "schedule-action",
    changeType: "both",
  });
  stopPerfTimer(broadcastDispatchStartedAt, perfEntries, "broadcast-dispatch");
  logHotActionPerf({ action: "backToQueue", stage, entries: perfEntries });

  return {
    ok: true,
    action: "back-to-queue",
    stage,
    delta: {
      courtPatches: [{ courtId, playing: null }],
      addEligible,
      removeInPlayPlayerIds: removedPlayerIds,
      changedMatchKeys: {
        cleared: removedMatchKey ? [removedMatchKey] : [],
      },
    },
  };
}

export async function swapBackToQueue(
  courtId: string,
  stage: ScheduleStage
): Promise<ScheduleActionResponse> {
  const perfEntries: PerfEntry[] = [];
  const guard = await requireAdmin({ onFail: "return" });
  if (guard) return guard;
  const parsedStage = scheduleStageSchema.safeParse(stage);
  if (!parsedStage.success) return { error: "Invalid stage." };

  const readStartedAt = startPerfTimer();
  const config = await ensureScheduleSetup(stage);
  const assignment = await prisma.courtAssignment.findFirst({
    where: { courtId, status: "ACTIVE", stage },
    select: assignmentScheduleSelect,
  });
  stopPerfTimer(readStartedAt, perfEntries, "validate-read");
  if (!assignment) {
    logHotActionPerf({ action: "swapBackToQueue", stage, entries: perfEntries, meta: { skipped: true } });
    return { ok: true, action: "swap-back-to-queue", stage, delta: {} };
  }

  const inPlayPlayerIds = await getInPlayPlayerIds(stage);
  if (assignment.matchType === "GROUP" && assignment.groupMatch) {
    getPlayersForGroupMatch(assignment.groupMatch).forEach((id) => inPlayPlayerIds.delete(id));
  }
  if (assignment.matchType === "KNOCKOUT" && assignment.knockoutMatch) {
    getPlayersForKnockoutMatch(assignment.knockoutMatch).forEach((id) => inPlayPlayerIds.delete(id));
  }

  const queueReadStartedAt = startPerfTimer();
  const eligibleSorted = await buildListEligibleMatches({
    stage,
    category: "ALL",
    excludeAssigned: true,
    playingSet: inPlayPlayerIds,
    recentlyPlayedSet: await getRecentCompletedPlayerIds(stage),
  });
  const next = eligibleSorted.find((match) =>
    isAssignableNow(match.teams.playerIds, inPlayPlayerIds)
  );
  stopPerfTimer(queueReadStartedAt, perfEntries, "queue-read");

  const writeStartedAt = startPerfTimer();
  await prisma.courtAssignment.update({
    where: { id: assignment.id },
    data: { status: "CANCELED", clearedAt: new Date() },
  });
  stopPerfTimer(writeStartedAt, perfEntries, "write-clear");

  const deltaStartedAt = startPerfTimer();
  const removedMatchKey =
    assignment.matchType === "GROUP" && assignment.groupMatchId
      ? buildMatchKey("GROUP", assignment.groupMatchId)
      : assignment.matchType === "KNOCKOUT" && assignment.knockoutMatchId
        ? buildMatchKey("KNOCKOUT", assignment.knockoutMatchId)
        : null;
  const addEligible: ScheduleMatchItem[] = [];
  const uncheckedPlayerIds = await loadUncheckedPlayerIds();
  let forcedRankMap: Map<string, number> | null = null;
  let groupRemainingLoadMap: Map<string, number> | null = null;
  const getForcedRank = async (matchType: MatchType, matchId: string) => {
    if (!forcedRankMap) {
      forcedRankMap = await loadForcedRankMap(stage);
    }
    return getForcedRankFromMap(forcedRankMap, stage, matchType, matchId);
  };
  const getGroupRemainingLoadMap = async () => {
    if (!groupRemainingLoadMap) {
      groupRemainingLoadMap = await loadGroupRemainingLoadMapFromDb();
    }
    return groupRemainingLoadMap;
  };

  if (assignment.matchType === "GROUP" && assignment.groupMatchId && assignment.groupMatch) {
    const playerIds = getPlayersForGroupMatch(assignment.groupMatch);
    const blocked = await prisma.blockedMatch.findFirst({
      where: { matchType: "GROUP", groupMatchId: assignment.groupMatchId },
      select: { id: true },
    });
    if (!blocked && !hasUncheckedPlayers(playerIds, uncheckedPlayerIds)) {
      const forcedRank = await getForcedRank("GROUP", assignment.groupMatchId);
      const item = buildEligibleGroupItemFromMatch(
        assignment.groupMatch,
        forcedRank,
        await getGroupRemainingLoadMap()
      );
      if (item) addEligible.push(item);
    }
  }
  if (assignment.matchType === "KNOCKOUT" && assignment.knockoutMatchId && assignment.knockoutMatch) {
    const playerIds = getPlayersForKnockoutMatch(assignment.knockoutMatch);
    const blocked = await prisma.blockedMatch.findFirst({
      where: { matchType: "KNOCKOUT", knockoutMatchId: assignment.knockoutMatchId },
      select: { id: true },
    });
    if (!blocked && !hasUncheckedPlayers(playerIds, uncheckedPlayerIds)) {
      const forcedRank = await getForcedRank("KNOCKOUT", assignment.knockoutMatchId);
      const item = buildEligibleKnockoutItemFromMatch(assignment.knockoutMatch, forcedRank);
      if (item) addEligible.push(item);
    }
  }
  stopPerfTimer(deltaStartedAt, perfEntries, "delta-build");

  if (!next) {
    const emptyWriteStartedAt = startPerfTimer();
    await prisma.scheduleActionLog.create({
      data: { action: "BACK_TO_QUEUE_EMPTY", payload: { stage, courtId } },
    });
    stopPerfTimer(emptyWriteStartedAt, perfEntries, "write-log");

    const invalidateStartedAt = startPerfTimer();
    await invalidatePresentingStage(stage);
    stopPerfTimer(invalidateStartedAt, perfEntries, "cache-invalidate");

    const broadcastDispatchStartedAt = startPerfTimer();
    dispatchBroadcastRefresh({
      stage,
      source: "schedule-action",
      changeType: "both",
    });
    stopPerfTimer(broadcastDispatchStartedAt, perfEntries, "broadcast-dispatch");
    logHotActionPerf({
      action: "swapBackToQueue",
      stage,
      entries: perfEntries,
      meta: { assignedReplacement: false },
    });
    return {
      ok: true,
      action: "swap-back-to-queue",
      stage,
      delta: {
        courtPatches: [{ courtId, playing: null }],
        addEligible,
        inPlayPlayerIds: Array.from(inPlayPlayerIds),
        changedMatchKeys: {
          cleared: removedMatchKey ? [removedMatchKey] : [],
        },
        infoMessage: "No assignable match available; court is now empty.",
      },
    };
  }

  const assignWriteStartedAt = startPerfTimer();
  await prisma.courtAssignment.create({
    data: {
      courtId,
      stage,
      matchType: next.matchType,
      groupMatchId: next.matchType === "GROUP" ? next.matchId : null,
      knockoutMatchId: next.matchType === "KNOCKOUT" ? next.matchId : null,
    },
  });
  await prisma.scheduleActionLog.create({
    data: {
      action: "BACK_TO_QUEUE_SWAP",
      payload: { stage, courtId, matchType: next.matchType, matchId: next.matchId },
    },
  });
  stopPerfTimer(assignWriteStartedAt, perfEntries, "write-assign");

  const lastBatchStartedAt = startPerfTimer();
  await updateLastBatch(config.id, buildMatchKey(next.matchType, next.matchId));
  stopPerfTimer(lastBatchStartedAt, perfEntries, "last-batch");
  next.teams.playerIds.forEach((id) => inPlayPlayerIds.add(id));

  const invalidateStartedAt = startPerfTimer();
  await invalidatePresentingStage(stage);
  stopPerfTimer(invalidateStartedAt, perfEntries, "cache-invalidate");

  const broadcastDispatchStartedAt = startPerfTimer();
  dispatchBroadcastRefresh({
    stage,
    source: "schedule-action",
    changeType: "both",
  });
  stopPerfTimer(broadcastDispatchStartedAt, perfEntries, "broadcast-dispatch");
  logHotActionPerf({
    action: "swapBackToQueue",
    stage,
    entries: perfEntries,
    meta: { assignedReplacement: true },
  });
  return {
    ok: true,
    action: "swap-back-to-queue",
    stage,
    delta: {
      courtPatches: [
        {
          courtId,
          playing: buildPlayingFromScheduleMatchItem(next),
        },
      ],
      addEligible,
      removeEligibleKeys: [next.key],
      inPlayPlayerIds: Array.from(inPlayPlayerIds),
      addInPlayPlayerIds: next.teams.playerIds,
      changedMatchKeys: {
        assigned: [next.key],
        cleared: removedMatchKey ? [removedMatchKey] : [],
      },
    },
  };
}

export async function blockMatch(
  matchType: MatchType,
  matchId: string,
  stage: ScheduleStage
): Promise<ScheduleActionResponse> {
  const perfEntries: PerfEntry[] = [];
  const guard = await requireAdmin({ onFail: "return" });
  if (guard) return guard;
  const parsed = matchTypeSchema.safeParse(matchType);
  const parsedStage = scheduleStageSchema.safeParse(stage);
  if (!parsed.success) return { error: "Invalid match type." };
  if (!parsedStage.success) return { error: "Invalid stage." };
  if (matchType !== stage) return { error: "Stage mismatch." };

  const readStartedAt = startPerfTimer();
  await ensureScheduleSetup(stage);
  const targetMatchKey = buildMatchKey(matchType, matchId);
  const activeAssignments = await prisma.courtAssignment.findMany({
    where:
      matchType === "GROUP"
        ? { status: "ACTIVE", stage, groupMatchId: matchId }
        : { status: "ACTIVE", stage, knockoutMatchId: matchId },
    select: { courtId: true },
  });
  const groupMatch =
    matchType === "GROUP"
      ? await prisma.match.findUnique({
          where: { id: matchId },
          select: scheduleGroupMatchSelect,
        })
      : null;
  const knockoutMatch =
    matchType === "KNOCKOUT"
      ? await prisma.knockoutMatch.findUnique({
          where: { id: matchId },
          select: scheduleKnockoutMatchSelect,
        })
      : null;
  stopPerfTimer(readStartedAt, perfEntries, "validate-read");

  const writeStartedAt = startPerfTimer();
  await prisma.blockedMatch.deleteMany({
    where:
      matchType === "GROUP"
        ? { matchType, groupMatchId: matchId }
        : { matchType, knockoutMatchId: matchId },
  });
  await prisma.blockedMatch.create({
    data:
      matchType === "GROUP"
        ? { matchType, groupMatchId: matchId, reason: "injury / absent" }
        : { matchType, knockoutMatchId: matchId, reason: "injury / absent" },
  });

  await prisma.courtAssignment.updateMany({
    where:
      matchType === "GROUP"
        ? { status: "ACTIVE", stage, groupMatchId: matchId }
        : { status: "ACTIVE", stage, knockoutMatchId: matchId },
    data: { status: "CANCELED", clearedAt: new Date() },
  });

  await prisma.scheduleActionLog.create({
    data: { action: "BLOCK_MATCH", payload: { stage, matchType, matchId } },
  });
  stopPerfTimer(writeStartedAt, perfEntries, "write");

  const deltaStartedAt = startPerfTimer();
  const addBlocked: ScheduleMatchItem[] = [];
  if (groupMatch) {
    const item = buildManualBlockedGroupItem(groupMatch);
    if (item) addBlocked.push(item);
  } else if (knockoutMatch) {
    addBlocked.push(buildManualBlockedKnockoutItem(knockoutMatch));
  }
  const removeInPlayPlayerIds =
    activeAssignments.length > 0
      ? groupMatch
        ? getPlayersForGroupMatch(groupMatch)
        : knockoutMatch
          ? getPlayersForKnockoutMatch(knockoutMatch)
          : []
      : [];
  stopPerfTimer(deltaStartedAt, perfEntries, "delta-build");

  const invalidateStartedAt = startPerfTimer();
  await invalidatePresentingStage(stage);
  stopPerfTimer(invalidateStartedAt, perfEntries, "cache-invalidate");

  const broadcastDispatchStartedAt = startPerfTimer();
  dispatchBroadcastRefresh({
    stage,
    source: "schedule-action",
    changeType: "both",
  });
  stopPerfTimer(broadcastDispatchStartedAt, perfEntries, "broadcast-dispatch");
  logHotActionPerf({
    action: "blockMatch",
    stage,
    entries: perfEntries,
    meta: {
      affectedCourts: activeAssignments.length,
    },
  });

  return {
    ok: true,
    action: "block",
    stage,
    delta: {
      courtPatches: activeAssignments.map((assignment) => ({
        courtId: assignment.courtId,
        playing: null,
      })),
      removeEligibleKeys: [targetMatchKey],
      addBlocked,
      removeInPlayPlayerIds,
      changedMatchKeys: {
        blocked: [targetMatchKey],
        cleared: activeAssignments.length > 0 ? [targetMatchKey] : [],
      },
    },
  };
}

export async function unblockMatch(
  matchType: MatchType,
  matchId: string,
  stage: ScheduleStage
): Promise<ScheduleActionResponse> {
  const perfEntries: PerfEntry[] = [];
  const guard = await requireAdmin({ onFail: "return" });
  if (guard) return guard;
  const parsed = matchTypeSchema.safeParse(matchType);
  const parsedStage = scheduleStageSchema.safeParse(stage);
  if (!parsed.success) return { error: "Invalid match type." };
  if (!parsedStage.success) return { error: "Invalid stage." };
  if (matchType !== stage) return { error: "Stage mismatch." };

  const readStartedAt = startPerfTimer();
  const targetMatchKey = buildMatchKey(matchType, matchId);
  const uncheckedPlayerIds = await loadUncheckedPlayerIds();
  let addEligible: ScheduleMatchItem[] = [];
  let forcedRankMap: Map<string, number> | null = null;
  let groupRemainingLoadMap: Map<string, number> | null = null;
  const getForcedRank = async (nextMatchType: MatchType, nextMatchId: string) => {
    if (!forcedRankMap) {
      forcedRankMap = await loadForcedRankMap(stage);
    }
    return getForcedRankFromMap(forcedRankMap, stage, nextMatchType, nextMatchId);
  };
  const getGroupRemainingLoadMap = async () => {
    if (!groupRemainingLoadMap) {
      groupRemainingLoadMap = await loadGroupRemainingLoadMapFromDb();
    }
    return groupRemainingLoadMap;
  };

  if (matchType === "GROUP") {
    const match = await prisma.match.findUnique({
      where: { id: matchId },
      select: scheduleGroupMatchSelect,
    });
    if (match && hasUncheckedPlayers(getPlayersForGroupMatch(match), uncheckedPlayerIds)) {
      return { error: "Match is pending checked in." };
    }
    if (match) {
      const forcedRank = await getForcedRank("GROUP", matchId);
      const item = buildEligibleGroupItemFromMatch(
        match,
        forcedRank,
        await getGroupRemainingLoadMap()
      );
      if (item) addEligible = [item];
    }
  } else {
    const match = await prisma.knockoutMatch.findUnique({
      where: { id: matchId },
      select: scheduleKnockoutMatchSelect,
    });
    if (match && hasUncheckedPlayers(getPlayersForKnockoutMatch(match), uncheckedPlayerIds)) {
      return { error: "Match is pending checked in." };
    }
    if (match) {
      const forcedRank = await getForcedRank("KNOCKOUT", matchId);
      const item = buildEligibleKnockoutItemFromMatch(match, forcedRank);
      if (item) addEligible = [item];
    }
  }
  stopPerfTimer(readStartedAt, perfEntries, "validate-read");

  const writeStartedAt = startPerfTimer();
  await prisma.blockedMatch.deleteMany({
    where:
      matchType === "GROUP"
        ? { matchType, groupMatchId: matchId }
        : { matchType, knockoutMatchId: matchId },
  });
  await prisma.scheduleActionLog.create({
    data: { action: "UNBLOCK_MATCH", payload: { stage, matchType, matchId } },
  });
  stopPerfTimer(writeStartedAt, perfEntries, "write");

  const deltaStartedAt = startPerfTimer();
  stopPerfTimer(deltaStartedAt, perfEntries, "delta-build");

  const invalidateStartedAt = startPerfTimer();
  await invalidatePresentingStage(stage);
  stopPerfTimer(invalidateStartedAt, perfEntries, "cache-invalidate");

  const broadcastDispatchStartedAt = startPerfTimer();
  dispatchBroadcastRefresh({
    stage,
    source: "schedule-action",
    changeType: "upcoming",
  });
  stopPerfTimer(broadcastDispatchStartedAt, perfEntries, "broadcast-dispatch");
  logHotActionPerf({ action: "unblockMatch", stage, entries: perfEntries });

  return {
    ok: true,
    action: "unblock",
    stage,
    delta: {
      removeBlockedKeys: [targetMatchKey],
      addEligible,
      changedMatchKeys: {
        unblocked: [targetMatchKey],
      },
    },
  };
}

export async function markCompleted(
  courtId: string,
  stage: ScheduleStage
): Promise<ScheduleActionResponse> {
  const perfEntries: PerfEntry[] = [];
  const guard = await requireAdmin({ onFail: "return" });
  if (guard) return guard;
  const parsedStage = scheduleStageSchema.safeParse(stage);
  if (!parsedStage.success) return { error: "Invalid stage." };

  const readStartedAt = startPerfTimer();
  await ensureScheduleSetup(stage);
  const assignment = await prisma.courtAssignment.findFirst({
    where: { courtId, status: "ACTIVE", stage },
    select: assignmentPlayerIdOnlySelect,
  });
  stopPerfTimer(readStartedAt, perfEntries, "validate-read");
  if (!assignment) {
    logHotActionPerf({ action: "markCompleted", stage, entries: perfEntries, meta: { skipped: true } });
    return { ok: true, action: "completed", stage, delta: {} };
  }

  const completedMatchKey =
    assignment.matchType === "GROUP" && assignment.groupMatchId
      ? buildMatchKey("GROUP", assignment.groupMatchId)
      : assignment.matchType === "KNOCKOUT" && assignment.knockoutMatchId
        ? buildMatchKey("KNOCKOUT", assignment.knockoutMatchId)
        : null;

  if (assignment.matchType === "GROUP" && assignment.groupMatchId) {
    if (!assignment.groupMatch || !isCompletedMatch(assignment.groupMatch)) {
      return { error: "Match not completed yet." };
    }
  }

  if (assignment.matchType === "KNOCKOUT" && assignment.knockoutMatchId) {
    if (!assignment.knockoutMatch || !isCompletedMatch(assignment.knockoutMatch)) {
      return { error: "Match not completed yet." };
    }
  }

  const writeStartedAt = startPerfTimer();
  await prisma.courtAssignment.update({
    where: { id: assignment.id },
    data: { status: "CLEARED", clearedAt: new Date() },
  });
  await prisma.scheduleActionLog.create({
    data: { action: "MARK_COMPLETED", payload: { stage, courtId } },
  });
  stopPerfTimer(writeStartedAt, perfEntries, "write");

  const deltaStartedAt = startPerfTimer();
  const removeInPlayPlayerIds =
    assignment.matchType === "GROUP" && assignment.groupMatch
      ? getPlayersForGroupMatchIds(assignment.groupMatch)
      : assignment.matchType === "KNOCKOUT" && assignment.knockoutMatch
        ? getPlayersForKnockoutMatchIds(assignment.knockoutMatch)
        : [];
  stopPerfTimer(deltaStartedAt, perfEntries, "delta-build");

  const invalidateStartedAt = startPerfTimer();
  await invalidatePresentingStage(stage);
  stopPerfTimer(invalidateStartedAt, perfEntries, "cache-invalidate");

  const broadcastDispatchStartedAt = startPerfTimer();
  dispatchBroadcastRefresh({
    stage,
    source: "schedule-action",
    changeType: "both",
  });
  stopPerfTimer(broadcastDispatchStartedAt, perfEntries, "broadcast-dispatch");
  logHotActionPerf({ action: "markCompleted", stage, entries: perfEntries });

  return {
    ok: true,
    action: "completed",
    stage,
    delta: {
      courtPatches: [{ courtId, playing: null }],
      removeInPlayPlayerIds,
      changedMatchKeys: {
        cleared: completedMatchKey ? [completedMatchKey] : [],
        completed: completedMatchKey ? [completedMatchKey] : [],
      },
    },
  };
}

export async function assignNext(params: {
  courtId: string;
  matchType: MatchType;
  matchId: string;
  stage: ScheduleStage;
}): Promise<ScheduleActionResponse> {
  const perfEntries: PerfEntry[] = [];
  const guard = await requireAdmin({ onFail: "return" });
  if (guard) return guard;
  const parsed = matchTypeSchema.safeParse(params.matchType);
  const parsedStage = scheduleStageSchema.safeParse(params.stage);
  if (!parsed.success) return { error: "Invalid match type." };
  if (!parsedStage.success) return { error: "Invalid stage." };
  if (params.matchType !== params.stage) return { error: "Stage mismatch." };

  const readStartedAt = startPerfTimer();
  const config = await ensureScheduleSetup(params.stage);
  const courtLock = await prisma.courtStageLock.findUnique({
    where: { courtId_stage: { courtId: params.courtId, stage: params.stage } },
  });
  if (courtLock?.locked) return { error: "Court is locked." };

  const existingCourtAssignments = await prisma.courtAssignment.findMany({
    where: { courtId: params.courtId, status: "ACTIVE", stage: params.stage },
    select: assignmentScheduleSelect,
  });
  const inPlayPlayerIds = await getInPlayPlayerIds(params.stage);
  for (const assignment of existingCourtAssignments) {
    if (assignment.matchType === "GROUP" && assignment.groupMatch) {
      getPlayersForGroupMatch(assignment.groupMatch).forEach((id) => inPlayPlayerIds.delete(id));
      continue;
    }
    if (assignment.matchType === "KNOCKOUT" && assignment.knockoutMatch) {
      getPlayersForKnockoutMatch(assignment.knockoutMatch).forEach((id) =>
        inPlayPlayerIds.delete(id)
      );
    }
  }
  const uncheckedPlayerIds = await loadUncheckedPlayerIds();

  const blocked = await prisma.blockedMatch.findFirst({
    where:
      params.matchType === "GROUP"
        ? { matchType: params.matchType, groupMatchId: params.matchId }
        : { matchType: params.matchType, knockoutMatchId: params.matchId },
    select: { id: true },
  });
  if (blocked) return { error: "Match is blocked." };

  let selectedMatchItem: ScheduleMatchItem | null = null;
  let selectedPlayerIds: string[] = [];
  if (params.matchType === "GROUP") {
    const match = await prisma.match.findUnique({
      where: { id: params.matchId },
      select: scheduleGroupMatchSelect,
    });
    if (!match || !isListEligibleGroupMatch(match)) return { error: "Match not eligible." };
    const playerIds = getPlayersForGroupMatch(match);
    if (hasUncheckedPlayers(playerIds, uncheckedPlayerIds)) {
      return { error: "Match is pending checked in." };
    }
    if (!isAssignableNow(playerIds, inPlayPlayerIds)) {
      return { error: "Match has players already on court." };
    }
    if (hasInPlayPlayers(playerIds, inPlayPlayerIds)) {
      return { error: "Match has players already on court." };
    }
    selectedPlayerIds = playerIds;
    selectedMatchItem = buildEligibleGroupItemFromMatch(match);
    if (!selectedMatchItem) return { error: "Match not eligible." };
  } else {
    const match = await prisma.knockoutMatch.findUnique({
      where: { id: params.matchId },
      select: scheduleKnockoutMatchSelect,
    });
    if (!match || !isListEligibleKnockoutMatch(match)) return { error: "Match not eligible." };
    const playerIds = getPlayersForKnockoutMatch(match);
    if (hasUncheckedPlayers(playerIds, uncheckedPlayerIds)) {
      return { error: "Match is pending checked in." };
    }
    if (!isAssignableNow(playerIds, inPlayPlayerIds)) {
      return { error: "Match has players already on court." };
    }
    if (hasInPlayPlayers(playerIds, inPlayPlayerIds)) {
      return { error: "Match has players already on court." };
    }
    selectedPlayerIds = playerIds;
    selectedMatchItem = buildEligibleKnockoutItemFromMatch(match);
    if (!selectedMatchItem) return { error: "Match not eligible." };
  }
  stopPerfTimer(readStartedAt, perfEntries, "validate-read");

  const writeStartedAt = startPerfTimer();
  const existingCourtAssignmentIds = existingCourtAssignments.map((assignment) => assignment.id);
  const existingWhere: Prisma.CourtAssignmentWhereInput = {
    status: "ACTIVE",
    stage: params.stage,
    ...(params.matchType === "GROUP"
      ? { groupMatchId: params.matchId }
      : { knockoutMatchId: params.matchId }),
  };
  if (existingCourtAssignmentIds.length > 0) {
    existingWhere.id = { notIn: existingCourtAssignmentIds };
  }
  const existing = await prisma.courtAssignment.findFirst({
    where: existingWhere,
  });
  if (existing) return { error: "Match already assigned." };

  if (existingCourtAssignmentIds.length > 0) {
    await prisma.courtAssignment.updateMany({
      where: { id: { in: existingCourtAssignmentIds } },
      data: { status: "CANCELED", clearedAt: new Date() },
    });
  }

  await prisma.courtAssignment.create({
    data: {
      courtId: params.courtId,
      stage: params.stage,
      matchType: params.matchType,
      groupMatchId: params.matchType === "GROUP" ? params.matchId : null,
      knockoutMatchId: params.matchType === "KNOCKOUT" ? params.matchId : null,
    },
  });

  await prisma.scheduleActionLog.create({
    data: {
      action: "ASSIGN_NEXT",
      payload: {
        stage: params.stage,
        courtId: params.courtId,
        matchType: params.matchType,
        matchId: params.matchId,
      },
    },
  });
  stopPerfTimer(writeStartedAt, perfEntries, "write");

  const deltaStartedAt = startPerfTimer();
  for (const playerId of selectedPlayerIds) {
    inPlayPlayerIds.add(playerId);
  }

  const assignedMatchKey = buildMatchKey(params.matchType, params.matchId);
  const clearedMatchKeys: string[] = [];
  const addEligible: ScheduleMatchItem[] = [];
  let forcedRankMap: Map<string, number> | null = null;
  let groupRemainingLoadMap: Map<string, number> | null = null;
  const getForcedRank = async (matchType: MatchType, matchId: string) => {
    if (!forcedRankMap) {
      forcedRankMap = await loadForcedRankMap(params.stage);
    }
    return getForcedRankFromMap(forcedRankMap, params.stage, matchType, matchId);
  };
  const getGroupRemainingLoadMap = async () => {
    if (!groupRemainingLoadMap) {
      groupRemainingLoadMap = await loadGroupRemainingLoadMapFromDb();
    }
    return groupRemainingLoadMap;
  };
  for (const assignment of existingCourtAssignments) {
    const clearedMatchKey =
      assignment.matchType === "GROUP" && assignment.groupMatchId
        ? buildMatchKey("GROUP", assignment.groupMatchId)
        : assignment.matchType === "KNOCKOUT" && assignment.knockoutMatchId
          ? buildMatchKey("KNOCKOUT", assignment.knockoutMatchId)
          : null;
    if (clearedMatchKey) {
      clearedMatchKeys.push(clearedMatchKey);
    }
    if (!clearedMatchKey || clearedMatchKey === assignedMatchKey) {
      continue;
    }

    if (assignment.matchType === "GROUP" && assignment.groupMatchId && assignment.groupMatch) {
      const playerIds = getPlayersForGroupMatch(assignment.groupMatch);
      const blockedCurrent = await prisma.blockedMatch.findFirst({
        where: { matchType: "GROUP", groupMatchId: assignment.groupMatchId },
        select: { id: true },
      });
      if (!blockedCurrent && !hasUncheckedPlayers(playerIds, uncheckedPlayerIds)) {
        const forcedRank = await getForcedRank("GROUP", assignment.groupMatchId);
        const item = buildEligibleGroupItemFromMatch(
          assignment.groupMatch,
          forcedRank,
          await getGroupRemainingLoadMap()
        );
        if (item) addEligible.push(item);
      }
      continue;
    }

    if (
      assignment.matchType === "KNOCKOUT" &&
      assignment.knockoutMatchId &&
      assignment.knockoutMatch
    ) {
      const playerIds = getPlayersForKnockoutMatch(assignment.knockoutMatch);
      const blockedCurrent = await prisma.blockedMatch.findFirst({
        where: { matchType: "KNOCKOUT", knockoutMatchId: assignment.knockoutMatchId },
        select: { id: true },
      });
      if (!blockedCurrent && !hasUncheckedPlayers(playerIds, uncheckedPlayerIds)) {
        const forcedRank = await getForcedRank("KNOCKOUT", assignment.knockoutMatchId);
        const item = buildEligibleKnockoutItemFromMatch(assignment.knockoutMatch, forcedRank);
        if (item) addEligible.push(item);
      }
    }
  }
  stopPerfTimer(deltaStartedAt, perfEntries, "delta-build");

  const lastBatchStartedAt = startPerfTimer();
  await updateLastBatch(config.id, buildMatchKey(params.matchType, params.matchId));
  stopPerfTimer(lastBatchStartedAt, perfEntries, "last-batch");
  const invalidateStartedAt = startPerfTimer();
  await invalidatePresentingStage(params.stage);
  stopPerfTimer(invalidateStartedAt, perfEntries, "cache-invalidate");

  const broadcastDispatchStartedAt = startPerfTimer();
  dispatchBroadcastRefresh({
    stage: params.stage,
    source: "schedule-action",
    changeType: "both",
  });
  stopPerfTimer(broadcastDispatchStartedAt, perfEntries, "broadcast-dispatch");
  logHotActionPerf({
    action: "assignNext",
    stage: params.stage,
    entries: perfEntries,
    meta: { replacedAssignments: existingCourtAssignments.length },
  });

  return {
    ok: true,
    action: "assign",
    stage: params.stage,
    delta: {
      courtPatches: [
        {
          courtId: params.courtId,
          playing: buildPlayingFromScheduleMatchItem(selectedMatchItem),
        },
      ],
      removeEligibleKeys: [assignedMatchKey],
      addEligible,
      inPlayPlayerIds: Array.from(inPlayPlayerIds),
      changedMatchKeys: {
        assigned: [assignedMatchKey],
        cleared: Array.from(new Set(clearedMatchKeys)),
      },
    },
  };
}

export async function forceNext(
  matchType: MatchType,
  matchId: string,
  stage: ScheduleStage
) {
  const guard = await requireAdmin({ onFail: "return" });
  if (guard) return guard;
  const parsed = matchTypeSchema.safeParse(matchType);
  const parsedStage = scheduleStageSchema.safeParse(stage);
  if (!parsed.success) return { error: "Invalid match type." };
  if (!parsedStage.success) return { error: "Invalid stage." };
  if (matchType !== stage) return { error: "Stage mismatch." };
  const uncheckedPlayerIds = await loadUncheckedPlayerIds();

  if (matchType === "GROUP") {
    const match = await prisma.match.findUnique({
      where: { id: matchId },
      include: {
        homeTeam: { include: { members: { include: { player: true } } } },
        awayTeam: { include: { members: { include: { player: true } } } },
      },
    });
    if (!match || !isListEligibleGroupMatch(match)) {
      return { error: "Match not eligible." };
    }
    if (hasUncheckedPlayers(getPlayersForGroupMatch(match), uncheckedPlayerIds)) {
      return { error: "Match is pending checked in." };
    }
  } else {
    const match = await prisma.knockoutMatch.findUnique({
      where: { id: matchId },
      include: {
        homeTeam: { include: { members: { include: { player: true } } } },
        awayTeam: { include: { members: { include: { player: true } } } },
      },
    });
    if (!match || !isListEligibleKnockoutMatch(match)) {
      return { error: "Match not eligible." };
    }
    if (hasUncheckedPlayers(getPlayersForKnockoutMatch(match), uncheckedPlayerIds)) {
      return { error: "Match is pending checked in." };
    }
  }

  await prisma.forcedMatchPriority.upsert({
    where: { matchType_matchId: { matchType, matchId } },
    update: { createdAt: new Date() },
    create: { matchType, matchId },
  });

  await prisma.scheduleActionLog.create({
    data: { action: "FORCE_NEXT", payload: { stage, matchType, matchId } },
  });
  await publishBroadcastRefresh({
    stage,
    source: "schedule-action",
    changeType: "upcoming",
  });
  revalidatePath("/schedule");
  await invalidatePresentingStage(stage);
  return { ok: true };
}

export async function clearForcedPriority(
  matchType: MatchType,
  matchId: string,
  stage: ScheduleStage
) {
  const guard = await requireAdmin({ onFail: "return" });
  if (guard) return guard;
  const parsed = matchTypeSchema.safeParse(matchType);
  const parsedStage = scheduleStageSchema.safeParse(stage);
  if (!parsed.success) return { error: "Invalid match type." };
  if (!parsedStage.success) return { error: "Invalid stage." };
  if (matchType !== stage) return { error: "Stage mismatch." };

  await prisma.forcedMatchPriority.deleteMany({
    where: { matchType, matchId },
  });
  await prisma.scheduleActionLog.create({
    data: { action: "FORCE_CLEAR", payload: { stage, matchType, matchId } },
  });
  await publishBroadcastRefresh({
    stage,
    source: "schedule-action",
    changeType: "upcoming",
  });
  revalidatePath("/schedule");
  await invalidatePresentingStage(stage);
  return { ok: true };
}

export async function resetQueueForcedPriorities(stage: ScheduleStage) {
  const guard = await requireAdmin({ onFail: "return" });
  if (guard) return guard;
  const parsedStage = scheduleStageSchema.safeParse(stage);
  if (!parsedStage.success) return { error: "Invalid stage." };

  await prisma.forcedMatchPriority.deleteMany({
    where: { matchType: stage === "GROUP" ? "GROUP" : "KNOCKOUT" },
  });
  await prisma.scheduleActionLog.create({
    data: { action: "FORCE_RESET", payload: { stage } },
  });
  await publishBroadcastRefresh({
    stage,
    source: "schedule-action",
    changeType: "upcoming",
  });
  revalidatePath("/schedule");
  await invalidatePresentingStage(stage);
  return { ok: true };
}
