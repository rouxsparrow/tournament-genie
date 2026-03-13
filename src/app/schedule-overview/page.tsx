import { prisma } from "@/lib/prisma";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  buildGroupRemainingLoadMap,
  buildUpcomingFromSortedQueue,
  computeGroupBottleneckForPlayers,
  sortQueueMatches,
  type QueuePriorityMatch,
} from "@/lib/schedule/group-priority";

export const dynamic = "force-dynamic";
export const metadata = { title: "Schedule Overview" };

const CATEGORY_ORDER = ["MD", "WD", "XD"] as const;
const COURT_COUNT = 5;
const COURT_LABELS = ["P5", "P6", "P7", "P8", "P9"] as const;
const DEFAULT_SLOT_MINUTES = 20;
const DEFAULT_START_MINUTES = 12 * 60 + 30;
const DEFAULT_BUFFER_MINUTES = 0;
const MAX_SLOTS = 500;

type CategoryCode = (typeof CATEGORY_ORDER)[number];
type QueryParam = string | string[] | undefined;

type ScheduleOverviewPageProps = {
  searchParams?: Promise<{
    slotMinutes?: QueryParam;
    startTime?: QueryParam;
    bufferMinutes?: QueryParam;
  }>;
};

type Team = {
  name: string;
  members: { player: { id: string; name: string } }[];
  category?: { code: CategoryCode };
};

type CategoryMatch = {
  id: string;
  status: "SCHEDULED" | "COMPLETED";
  group: { name: string; category: { code: CategoryCode } } | null;
  homeTeam: Team | null;
  awayTeam: Team | null;
};

function formatTimeLabel(totalMinutes: number) {
  const minutes = ((totalMinutes % 1440) + 1440) % 1440;
  const hours24 = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const period = hours24 >= 12 ? "PM" : "AM";
  const hours12 = hours24 % 12 || 12;
  return `${hours12}:${mins.toString().padStart(2, "0")} ${period}`;
}

function firstQueryValue(value: QueryParam): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function parseSlotMinutes(input: string | undefined): { value: number; error?: string } {
  if (input === undefined) {
    return { value: DEFAULT_SLOT_MINUTES };
  }

  const trimmed = input.trim();
  if (!trimmed) {
    return {
      value: DEFAULT_SLOT_MINUTES,
      error: `Slot duration is required. Using default ${DEFAULT_SLOT_MINUTES} minutes.`,
    };
  }

  if (!/^\d+$/.test(trimmed)) {
    return {
      value: DEFAULT_SLOT_MINUTES,
      error: `Slot duration must be an integer between 1 and 180. Using default ${DEFAULT_SLOT_MINUTES}.`,
    };
  }

  const parsed = Number.parseInt(trimmed, 10);
  if (parsed < 1 || parsed > 180) {
    return {
      value: DEFAULT_SLOT_MINUTES,
      error: `Slot duration out of range (1-180). Using default ${DEFAULT_SLOT_MINUTES}.`,
    };
  }

  return { value: parsed };
}

function parseStartTime(input: string | undefined): { value: number; error?: string } {
  if (input === undefined) {
    return { value: DEFAULT_START_MINUTES };
  }

  const trimmed = input.trim();
  if (!trimmed) {
    return {
      value: DEFAULT_START_MINUTES,
      error: `Start time is required. Using default ${formatTimeLabel(DEFAULT_START_MINUTES)}.`,
    };
  }

  const match24 = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (match24) {
    const hours = Number.parseInt(match24[1], 10);
    const minutes = Number.parseInt(match24[2], 10);
    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
      return { value: hours * 60 + minutes };
    }
  }

  const match12 = trimmed.match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/);
  if (match12) {
    const rawHours = Number.parseInt(match12[1], 10);
    const minutes = Number.parseInt(match12[2], 10);
    const meridiem = match12[3].toUpperCase();
    if (rawHours >= 1 && rawHours <= 12 && minutes >= 0 && minutes <= 59) {
      const hours =
        meridiem === "AM"
          ? rawHours === 12
            ? 0
            : rawHours
          : rawHours === 12
            ? 12
            : rawHours + 12;
      return { value: hours * 60 + minutes };
    }
  }

  return {
    value: DEFAULT_START_MINUTES,
    error: `Start time must be HH:MM (24h) or H:MM AM/PM. Using default ${formatTimeLabel(
      DEFAULT_START_MINUTES
    )}.`,
  };
}

function parseBufferMinutes(input: string | undefined): { value: number; error?: string } {
  if (input === undefined) {
    return { value: DEFAULT_BUFFER_MINUTES };
  }

  const trimmed = input.trim();
  if (!trimmed) {
    return {
      value: DEFAULT_BUFFER_MINUTES,
      error: `Buffer time is required. Using default ${DEFAULT_BUFFER_MINUTES} minutes.`,
    };
  }

  if (!/^\d+$/.test(trimmed)) {
    return {
      value: DEFAULT_BUFFER_MINUTES,
      error: `Buffer time must be an integer between 0 and 10. Using default ${DEFAULT_BUFFER_MINUTES}.`,
    };
  }

  const parsed = Number.parseInt(trimmed, 10);
  if (parsed < 0 || parsed > 10) {
    return {
      value: DEFAULT_BUFFER_MINUTES,
      error: `Buffer time out of range (0-10). Using default ${DEFAULT_BUFFER_MINUTES}.`,
    };
  }

  return { value: parsed };
}

function extractPlayerIdList(match: {
  homeTeam: Team | null;
  awayTeam: Team | null;
}) {
  const homePlayers = match.homeTeam?.members.map((member) => member.player.id) ?? [];
  const awayPlayers = match.awayTeam?.members.map((member) => member.player.id) ?? [];
  return [...homePlayers, ...awayPlayers];
}

function getCategoryCode(match: CategoryMatch): CategoryCode {
  return (
    match.group?.category.code ??
    match.homeTeam?.category?.code ??
    match.awayTeam?.category?.code ??
    "MD"
  );
}

function hashString(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

function streakLenIfPicked(
  playerId: string,
  slotIndex: number,
  playedSlotsByPlayer: Map<string, number[]>
) {
  const slots = playedSlotsByPlayer.get(playerId) ?? [];
  const last = slots[slots.length - 1];
  const prev = slots[slots.length - 2];
  if (last === slotIndex - 1) {
    if (prev === slotIndex - 2) return 3;
    return 2;
  }
  return 1;
}

export default async function ScheduleOverviewPage({
  searchParams,
}: ScheduleOverviewPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const rawSlotMinutes = firstQueryValue(resolvedSearchParams?.slotMinutes);
  const rawStartTime = firstQueryValue(resolvedSearchParams?.startTime);
  const rawBufferMinutes = firstQueryValue(resolvedSearchParams?.bufferMinutes);

  const slotMinutesResult = parseSlotMinutes(rawSlotMinutes);
  const startTimeResult = parseStartTime(rawStartTime);
  const bufferMinutesResult = parseBufferMinutes(rawBufferMinutes);
  const resolvedSlotMinutes = slotMinutesResult.value;
  const resolvedStartMinutes = startTimeResult.value;
  const resolvedBufferMinutes = bufferMinutesResult.value;
  const slotStepMinutes = resolvedSlotMinutes + resolvedBufferMinutes;
  const slotMinutesInputValue = rawSlotMinutes ?? String(DEFAULT_SLOT_MINUTES);
  const startTimeInputValue = rawStartTime ?? formatTimeLabel(DEFAULT_START_MINUTES);
  const bufferMinutesInputValue = rawBufferMinutes ?? String(DEFAULT_BUFFER_MINUTES);
  const criteriaWarnings = [
    slotMinutesResult.error,
    startTimeResult.error,
    bufferMinutesResult.error,
  ].filter((message): message is string => Boolean(message));

  const matches = await prisma.match.findMany({
    where: {
      stage: "GROUP",
      homeTeamId: { not: null },
      awayTeamId: { not: null },
    },
    include: {
      group: { include: { category: true } },
      homeTeam: {
        include: { category: true, members: { include: { player: true } } },
      },
      awayTeam: {
        include: { category: true, members: { include: { player: true } } },
      },
    },
  });

  const blockedIds = new Set<string>();

  const categoryRank = new Map(CATEGORY_ORDER.map((code, index) => [code, index]));
  const playerNameMap = new Map<string, string>();
  const playerCategories = new Map<string, Set<CategoryCode>>();
  matches.forEach((match) => {
    const categoryCode = getCategoryCode(match as CategoryMatch);
    match.homeTeam?.members.forEach((member) => {
      playerNameMap.set(member.player.id, member.player.name);
      const categories = playerCategories.get(member.player.id) ?? new Set();
      categories.add(categoryCode);
      playerCategories.set(member.player.id, categories);
    });
    match.awayTeam?.members.forEach((member) => {
      playerNameMap.set(member.player.id, member.player.name);
      const categories = playerCategories.get(member.player.id) ?? new Set();
      categories.add(categoryCode);
      playerCategories.set(member.player.id, categories);
    });
  });
  const remainingPool = matches.filter((match) => !blockedIds.has(match.id));
  const scheduledSlots: {
    match: CategoryMatch | null;
    restCount: number;
    playerWouldBe: Map<string, number>;
  }[][] = [];
  const playedSlotsByPlayer = new Map<string, number[]>();
  const lastPlayedSlot = new Map<string, number | null>();
  const totalConsecutiveMatches = new Map<string, number>();
  const matchPlayers = new Map<string, string[]>(
    remainingPool.map((match) => [match.id, extractPlayerIdList(match)])
  );
  for (let slotIndex = 0; slotIndex < MAX_SLOTS; slotIndex += 1) {
    if (remainingPool.length === 0) break;
    const slotEntries: {
      match: CategoryMatch | null;
      restCount: number;
      playerWouldBe: Map<string, number>;
    }[] = [];
    const playedThisSlot = new Set<string>();
    const groupRemainingLoadMap = buildGroupRemainingLoadMap(
      remainingPool.map((match) => ({
        status: match.status,
        homeTeamId: match.homeTeam ? "HOME" : null,
        awayTeamId: match.awayTeam ? "AWAY" : null,
        playerIds: matchPlayers.get(match.id) ?? extractPlayerIdList(match),
      }))
    );
    type OverviewCandidate = QueuePriorityMatch & {
      match: CategoryMatch;
      playerIds: string[];
    };
    const candidateQueue: OverviewCandidate[] = remainingPool.flatMap((match) => {
      const playerIds = matchPlayers.get(match.id) ?? extractPlayerIdList(match);
      const eligibleByConsecutive = playerIds.every((id) => {
        const slots = playedSlotsByPlayer.get(id) ?? [];
        const last = slots[slots.length - 1];
        const prev = slots[slots.length - 2];
        if (last === slotIndex - 1 && prev === slotIndex - 2) return false;
        const wouldInc = last === slotIndex - 1 ? 1 : 0;
        const currentTotal = totalConsecutiveMatches.get(id) ?? 0;
        return currentTotal + wouldInc <= 2;
      });
      if (!eligibleByConsecutive) return [];

      const restCount = playerIds.reduce((count, id) => {
        return lastPlayedSlot.get(id) === slotIndex - 1 ? count : count + 1;
      }, 0);
      const bottleneck = computeGroupBottleneckForPlayers(playerIds, groupRemainingLoadMap);
      return [
        {
          match,
          playerIds,
          matchId: match.id,
          matchType: "GROUP",
          restScore: restCount,
          isForced: false,
          bottleneckMaxLoad: bottleneck.bottleneckMaxLoad,
          bottleneckSumLoad: bottleneck.bottleneckSumLoad,
          teams: { playerIds },
        },
      ];
    });
    const sortedQueue = sortQueueMatches(candidateQueue, {
      stage: "GROUP",
      inPlayPlayerIds: new Set<string>(),
    });
    const selectedMatches = buildUpcomingFromSortedQueue(sortedQueue, {
      stage: "GROUP",
      inPlayPlayerIds: new Set<string>(),
      limit: COURT_COUNT,
    });

    selectedMatches.forEach((candidate) => {
      const restCount = candidate.playerIds.reduce((count, id) => {
        return lastPlayedSlot.get(id) === slotIndex - 1 ? count : count + 1;
      }, 0);
      const playerWouldBe = new Map<string, number>();
      candidate.playerIds.forEach((id) => {
        playerWouldBe.set(id, streakLenIfPicked(id, slotIndex, playedSlotsByPlayer));
      });
      slotEntries.push({ match: candidate.match, restCount, playerWouldBe });
      candidate.playerIds.forEach((id) => {
        playedThisSlot.add(id);
      });
    });

    for (let index = slotEntries.length; index < COURT_COUNT; index += 1) {
      slotEntries.push({ match: null, restCount: 0, playerWouldBe: new Map() });
    }

    const selectedIds = new Set(selectedMatches.map((candidate) => candidate.match.id));
    for (let index = remainingPool.length - 1; index >= 0; index -= 1) {
      if (selectedIds.has(remainingPool[index].id)) {
        remainingPool.splice(index, 1);
      }
    }

    scheduledSlots.push(slotEntries);

    for (const playerId of playedThisSlot) {
      const slots = playedSlotsByPlayer.get(playerId) ?? [];
      const last = slots[slots.length - 1];
      if (last === slotIndex - 1) {
        totalConsecutiveMatches.set(
          playerId,
          (totalConsecutiveMatches.get(playerId) ?? 0) + 1
        );
      }
      slots.push(slotIndex);
      playedSlotsByPlayer.set(playerId, slots);
      lastPlayedSlot.set(playerId, slotIndex);
    }

    if (slotEntries.every((entry) => !entry.match) && remainingPool.length > 0) {
      console.warn(
        `[schedule-overview] slot ${slotIndex} scheduled 0 matches; remaining ${remainingPool.length}`
      );
    }
  }

  const hasOverflow = remainingPool.length > 0;
  const slotCount = scheduledSlots.length;
  const courts = Array.from(
    { length: COURT_COUNT },
    (_value, index) => COURT_LABELS[index] ?? `Court ${index + 1}`
  );
  const slotPlayers = new Map<number, Set<string>>();
  const slotConsecutive = new Map<number, Set<string>>();
  scheduledSlots.forEach((entries, slotIndex) => {
    const players = new Set<string>();
    entries.forEach((entry) => {
      entry.playerWouldBe.forEach((_value, playerId) => players.add(playerId));
    });
    slotPlayers.set(slotIndex, players);
  });
  for (let slotIndex = 0; slotIndex < slotCount; slotIndex += 1) {
    const current = slotPlayers.get(slotIndex) ?? new Set<string>();
    const prev = slotPlayers.get(slotIndex - 1) ?? new Set<string>();
    const intersection = new Set<string>();
    current.forEach((id) => {
      if (prev.has(id)) intersection.add(id);
    });
    slotConsecutive.set(slotIndex, intersection);
  }
  const palette = [
    "bg-amber-200 text-amber-900 dark:bg-amber-300/40 dark:text-amber-100",
    "bg-lime-200 text-lime-900 dark:bg-lime-300/40 dark:text-lime-100",
    "bg-sky-200 text-sky-900 dark:bg-sky-300/40 dark:text-sky-100",
    "bg-fuchsia-200 text-fuchsia-900 dark:bg-fuchsia-300/40 dark:text-fuchsia-100",
    "bg-rose-200 text-rose-900 dark:bg-rose-300/40 dark:text-rose-100",
    "bg-emerald-200 text-emerald-900 dark:bg-emerald-300/40 dark:text-emerald-100",
    "bg-violet-200 text-violet-900 dark:bg-violet-300/40 dark:text-violet-100",
    "bg-orange-200 text-orange-900 dark:bg-orange-300/40 dark:text-orange-100",
    "bg-teal-200 text-teal-900 dark:bg-teal-300/40 dark:text-teal-100",
    "bg-cyan-200 text-cyan-900 dark:bg-cyan-300/40 dark:text-cyan-100",
    "bg-green-200 text-green-900 dark:bg-green-300/40 dark:text-green-100",
    "bg-indigo-200 text-indigo-900 dark:bg-indigo-300/40 dark:text-indigo-100",
    "bg-red-200 text-red-900 dark:bg-red-300/40 dark:text-red-100",
    "bg-yellow-200 text-yellow-900 dark:bg-yellow-300/40 dark:text-yellow-100",
    "bg-blue-200 text-blue-900 dark:bg-blue-300/40 dark:text-blue-100",
    "bg-purple-200 text-purple-900 dark:bg-purple-300/40 dark:text-purple-100",
    "bg-pink-200 text-pink-900 dark:bg-pink-300/40 dark:text-pink-100",
    "bg-slate-200 text-slate-900 dark:bg-slate-300/40 dark:text-slate-100",
    "bg-zinc-200 text-zinc-900 dark:bg-zinc-300/40 dark:text-zinc-100",
    "bg-neutral-200 text-neutral-900 dark:bg-neutral-300/40 dark:text-neutral-100",
  ];
  const playerColorMap = new Map<string, string>();
  const debugEnabled = process.env.NEXT_PUBLIC_SCHEDULE_OVERVIEW_DEBUG === "1";
  if (debugEnabled) {
    playedSlotsByPlayer.forEach((slots, playerId) => {
      let streak = 1;
      let maxStreak = 1;
      for (let index = 1; index < slots.length; index += 1) {
        if (slots[index] === slots[index - 1] + 1) {
          streak += 1;
          maxStreak = Math.max(maxStreak, streak);
        } else {
          streak = 1;
        }
      }
      if (maxStreak >= 3) {
        throw new Error(
          `Overview streak violation: ${playerId} maxStreak=${maxStreak}`
        );
      }
    });
  }

  const rankingRows = Array.from(playedSlotsByPlayer.entries()).map(([playerId, slots]) => {
    const sortedSlots = [...slots].sort((a, b) => a - b);
    let totalConsecutiveMatches = 0;
    let maxRun = 0;
    let currentRun = 0;
    for (let index = 0; index < sortedSlots.length; index += 1) {
      if (index === 0 || sortedSlots[index] !== sortedSlots[index - 1] + 1) {
        currentRun = 1;
      } else {
        currentRun += 1;
        totalConsecutiveMatches += 1;
      }
      if (currentRun > maxRun) maxRun = currentRun;
    }
    return {
      playerId,
      name: playerNameMap.get(playerId) ?? "Unknown",
      totalConsecutiveMatches,
      maxRun,
      totalMatches: sortedSlots.length,
      categories: Array.from(playerCategories.get(playerId) ?? [])
        .sort((a, b) => (categoryRank.get(a) ?? 0) - (categoryRank.get(b) ?? 0))
        .join(", "),
    };
  });

  rankingRows.sort((a, b) => {
    if (a.totalConsecutiveMatches !== b.totalConsecutiveMatches) {
      return b.totalConsecutiveMatches - a.totalConsecutiveMatches;
    }
    if (a.totalMatches !== b.totalMatches) return b.totalMatches - a.totalMatches;
    return a.name.localeCompare(b.name);
  });

  return (
    <section className="rounded-2xl border border-border bg-card p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">
            Schedule Overview
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Overview enforces no more than two consecutive slots per player.
            ({resolvedSlotMinutes}-min slots + {resolvedBufferMinutes}-min buffer, starts{" "}
            {formatTimeLabel(resolvedStartMinutes)}, Group Stage only)
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Analytics-only: generated from ALL group stage matches (ignores
            completion status).
          </p>
        </div>
      </div>

      <form
        method="GET"
        className="mt-4 grid gap-3 rounded-xl border border-border bg-muted/30 p-4 md:grid-cols-[minmax(0,220px)_minmax(0,220px)_minmax(0,220px)_auto] md:items-end"
      >
        <div>
          <label
            htmlFor="slotMinutes"
            className="text-xs font-medium text-muted-foreground"
          >
            Slot duration (minutes)
          </label>
          <input
            id="slotMinutes"
            name="slotMinutes"
            type="text"
            defaultValue={slotMinutesInputValue}
            className="mt-1 h-9 w-full rounded-md border border-input px-3 text-sm focus:border-ring focus:outline-none"
            placeholder="20"
          />
        </div>
        <div>
          <label
            htmlFor="bufferMinutes"
            className="text-xs font-medium text-muted-foreground"
          >
            Buffer time between slots (minutes)
          </label>
          <input
            id="bufferMinutes"
            name="bufferMinutes"
            type="text"
            defaultValue={bufferMinutesInputValue}
            className="mt-1 h-9 w-full rounded-md border border-input px-3 text-sm focus:border-ring focus:outline-none"
            placeholder="0"
          />
        </div>
        <div>
          <label
            htmlFor="startTime"
            className="text-xs font-medium text-muted-foreground"
          >
            Start time
          </label>
          <input
            id="startTime"
            name="startTime"
            type="text"
            defaultValue={startTimeInputValue}
            className="mt-1 h-9 w-full rounded-md border border-input px-3 text-sm focus:border-ring focus:outline-none"
            placeholder="12:30 PM or 13:10"
          />
        </div>
        <div className="md:pb-[1px]">
          <Button type="submit" size="sm">
            Regenerate overview
          </Button>
        </div>
      </form>

      {criteriaWarnings.length > 0 ? (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          <p>Some criteria were invalid and defaults were applied:</p>
          <ul className="mt-1 list-disc pl-5">
            {criteriaWarnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {hasOverflow ? (
        <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          Unable to schedule all matches under strict consecutive ≤2 constraint.
          Remaining: {remainingPool.length}
        </p>
      ) : null}

      {slotCount === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">
          No group stage matches found.
        </p>
      ) : (
        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr),320px]">
          <div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[120px]">Time</TableHead>
                  {courts.map((court) => (
                    <TableHead key={court}>{court}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {scheduledSlots.map((slotMatches, slotIndex) => {
                  const timeLabel = formatTimeLabel(
                    resolvedStartMinutes + slotIndex * slotStepMinutes
                  );

                  return (
                    <TableRow key={`${timeLabel}-${slotIndex}`}>
                      <TableCell className="font-medium">{timeLabel}</TableCell>
                      {slotMatches.map((entry, cellIndex) => {
                        const match = entry.match;
                        const restScore = entry.restCount;
                        const currentConsecutive =
                          slotConsecutive.get(slotIndex) ?? new Set<string>();
                        const nextConsecutive =
                          slotConsecutive.get(slotIndex + 1) ?? new Set<string>();
                        const highlightSet = new Set<string>([
                          ...currentConsecutive,
                          ...nextConsecutive,
                        ]);
                        if (!match) {
                          return (
                            <TableCell
                              key={`empty-${slotIndex}-${cellIndex}`}
                              className="text-sm text-muted-foreground"
                            >
                              —
                            </TableCell>
                          );
                        }
                        const categoryCode = getCategoryCode(match);
                        const groupLabel = match.group?.name
                          ? `Group ${match.group.name}`
                          : null;
                        const homePlayers = match.homeTeam?.members ?? [];
                        const awayPlayers = match.awayTeam?.members ?? [];

                        return (
                          <TableCell key={match.id}>
                            <div className="space-y-1">
                              <p className="text-xs font-semibold text-muted-foreground">
                                {groupLabel
                                  ? `${categoryCode} • ${groupLabel}`
                                  : categoryCode}
                              </p>
                              <div className="text-sm text-foreground">
                                <div>
                                  {homePlayers.map((member, index) => {
                                    const playerId = member.player.id;
                                    const shouldHighlight = highlightSet.has(playerId);
                                    if (!playerColorMap.has(playerId)) {
                                      const color = palette[hashString(playerId) % palette.length];
                                      playerColorMap.set(playerId, color);
                                    }
                                    const colorClass = playerColorMap.get(playerId) ?? "";
                                    const highlight = shouldHighlight
                                      ? `rounded-sm px-1 ${colorClass}`
                                      : "text-foreground";
                                    return (
                                      <span key={playerId} className={highlight}>
                                        {member.player.name}
                                        {index < homePlayers.length - 1 ? " / " : ""}
                                      </span>
                                    );
                                  })}
                                </div>
                                <div className="text-xs text-muted-foreground">vs</div>
                                <div>
                                  {awayPlayers.map((member, index) => {
                                    const playerId = member.player.id;
                                    const shouldHighlight = highlightSet.has(playerId);
                                    if (!playerColorMap.has(playerId)) {
                                      const color = palette[hashString(playerId) % palette.length];
                                      playerColorMap.set(playerId, color);
                                    }
                                    const colorClass = playerColorMap.get(playerId) ?? "";
                                    const highlight = shouldHighlight
                                      ? `rounded-sm px-1 ${colorClass}`
                                      : "text-foreground";
                                    return (
                                      <span key={playerId} className={highlight}>
                                        {member.player.name}
                                        {index < awayPlayers.length - 1 ? " / " : ""}
                                      </span>
                                    );
                                  })}
                                </div>
                              </div>
                              <Badge variant="secondary" className="text-xs">
                                Rest: {restScore}/4
                              </Badge>
                            </div>
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <Card className="h-fit">
            <CardHeader>
              <CardTitle>Consecutive Ranking</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="max-h-[520px] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[52px]">Rank</TableHead>
                      <TableHead>Player</TableHead>
                      <TableHead className="text-right">
                        Total Consecutive Matches
                      </TableHead>
                      <TableHead className="text-right">
                        Total Matches Played
                      </TableHead>
                      <TableHead>Categories</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rankingRows.map((row, index) => (
                      <TableRow key={row.playerId}>
                        <TableCell className="font-medium">{index + 1}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <span>{row.name}</span>
                            {row.maxRun >= 3 ? (
                              <span className="text-xs font-semibold text-red-600">
                                streak 3+
                              </span>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          {row.totalConsecutiveMatches}
                        </TableCell>
                        <TableCell className="text-right">{row.totalMatches}</TableCell>
                        <TableCell>{row.categories}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </section>
  );
}
