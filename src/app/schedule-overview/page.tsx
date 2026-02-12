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

export const dynamic = "force-dynamic";
export const metadata = { title: "Schedule Overview" };

const CATEGORY_ORDER = ["MD", "WD", "XD"] as const;
const COURT_COUNT = 5;
const COURT_LABELS = ["P5", "P6", "P7", "P8", "P9"] as const;
const SLOT_MINUTES = 20;
const START_MINUTES = 12 * 60 + 30;
const MAX_SLOTS = 500;

type CategoryCode = (typeof CATEGORY_ORDER)[number];

type Team = {
  name: string;
  members: { player: { id: string; name: string } }[];
  category?: { code: CategoryCode };
};

type CategoryMatch = {
  id: string;
  status: "SCHEDULED" | "COMPLETED" | "WALKOVER";
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

function hasOverlap(playerIds: string[], playingSet: Set<string>) {
  return playerIds.some((id) => playingSet.has(id));
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

export default async function ScheduleOverviewPage() {
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
  const plannedTotalMatches = new Map<string, number>();
  matchPlayers.forEach((players) => {
    players.forEach((playerId) => {
      plannedTotalMatches.set(playerId, (plannedTotalMatches.get(playerId) ?? 0) + 1);
    });
  });
  for (let slotIndex = 0; slotIndex < MAX_SLOTS; slotIndex += 1) {
    if (remainingPool.length === 0) break;
    const slotPickedPlayers = new Set<string>();
    const slotEntries: {
      match: CategoryMatch | null;
      restCount: number;
      playerWouldBe: Map<string, number>;
    }[] = [];
    const playedThisSlot = new Set<string>();

    for (let courtIndex = 0; courtIndex < COURT_COUNT; courtIndex += 1) {
      const sortedCandidates = [...remainingPool].sort((a, b) => {
        const aPlayers = matchPlayers.get(a.id) ?? extractPlayerIdList(a);
        const bPlayers = matchPlayers.get(b.id) ?? extractPlayerIdList(b);

        const aPenalty = aPlayers.reduce((sum, id) => {
          if (lastPlayedSlot.get(id) !== slotIndex - 1) return sum;
          const matchCount = plannedTotalMatches.get(id) ?? 0;
          return sum + matchCount;
        }, 0);
        const bPenalty = bPlayers.reduce((sum, id) => {
          if (lastPlayedSlot.get(id) !== slotIndex - 1) return sum;
          const matchCount = plannedTotalMatches.get(id) ?? 0;
          return sum + matchCount;
        }, 0);
        if (aPenalty !== bPenalty) return aPenalty - bPenalty;

        const aRest = aPlayers.reduce((count, id) => {
          return lastPlayedSlot.get(id) === slotIndex - 1 ? count : count + 1;
        }, 0);
        const bRest = bPlayers.reduce((count, id) => {
          return lastPlayedSlot.get(id) === slotIndex - 1 ? count : count + 1;
        }, 0);
        if (aRest !== bRest) return bRest - aRest;

        const categoryA = getCategoryCode(a);
        const categoryB = getCategoryCode(b);
        const categoryOrder =
          (categoryRank.get(categoryA) ?? 0) - (categoryRank.get(categoryB) ?? 0);
        if (categoryOrder !== 0) return categoryOrder;

        const groupA = a.group?.name ?? "";
        const groupB = b.group?.name ?? "";
        if (groupA !== groupB) return groupA.localeCompare(groupB);
        return a.id.localeCompare(b.id);
      });

      const candidate = sortedCandidates.find((match) => {
        const playerIds = matchPlayers.get(match.id) ?? extractPlayerIdList(match);
        if (hasOverlap(playerIds, slotPickedPlayers)) return false;
        return playerIds.every((id) => {
          const slots = playedSlotsByPlayer.get(id) ?? [];
          const last = slots[slots.length - 1];
          const prev = slots[slots.length - 2];
          if (last === slotIndex - 1 && prev === slotIndex - 2) return false;
          const wouldInc = last === slotIndex - 1 ? 1 : 0;
          const currentTotal = totalConsecutiveMatches.get(id) ?? 0;
          return currentTotal + wouldInc <= 2;
        });
      });

      if (!candidate) {
        slotEntries.push({ match: null, restCount: 0, playerWouldBe: new Map() });
        continue;
      }

      const candidatePlayers =
        matchPlayers.get(candidate.id) ?? extractPlayerIdList(candidate);
      const restCount = candidatePlayers.reduce((count, id) => {
        return lastPlayedSlot.get(id) === slotIndex - 1 ? count : count + 1;
      }, 0);
      const playerWouldBe = new Map<string, number>();
      candidatePlayers.forEach((id) => {
        playerWouldBe.set(
          id,
          streakLenIfPicked(id, slotIndex, playedSlotsByPlayer)
        );
      });

      slotEntries.push({ match: candidate, restCount, playerWouldBe });
      candidatePlayers.forEach((id) => {
        slotPickedPlayers.add(id);
        playedThisSlot.add(id);
      });
      const pickedIndex = remainingPool.findIndex((match) => match.id === candidate.id);
      if (pickedIndex >= 0) remainingPool.splice(pickedIndex, 1);
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
            (20-min slots, Group Stage only)
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Analytics-only: generated from ALL group stage matches (ignores
            completion status).
          </p>
        </div>
      </div>

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
                    START_MINUTES + slotIndex * SLOT_MINUTES
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
