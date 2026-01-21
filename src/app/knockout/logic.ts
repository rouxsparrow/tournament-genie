import { prisma } from "@/lib/prisma";
import { computeStandings } from "@/app/standings/actions";

type CategoryCode = "MD" | "WD" | "XD";

type StandingStats = {
  teamId: string;
  wins: number;
  pointDiff: number;
  pointsFor: number;
  pointsAgainst: number;
  played: number;
  avgPA: number;
};

type SeedInput = {
  teamId: string;
  groupRank: number;
  groupId: string;
  avgPA: number;
  stats: StandingStats;
  isKnockOutSeed: boolean;
};

export function nextPowerOfTwo(value: number) {
  let power = 1;
  while (power < value) power *= 2;
  return power;
}

export function buildSeedOrder(size: number): number[] {
  if (size === 1) return [1];
  const prev = buildSeedOrder(size / 2);
  return [...prev, ...prev.map((seed) => size + 1 - seed)];
}

export function sortSeeds(seeds: SeedInput[]) {
  const sorted = [...seeds].sort((a, b) => {
    if (a.groupRank !== b.groupRank) return a.groupRank - b.groupRank;
    if (b.stats.wins !== a.stats.wins) return b.stats.wins - a.stats.wins;
    if (b.stats.pointDiff !== a.stats.pointDiff) return b.stats.pointDiff - a.stats.pointDiff;
    if (b.stats.pointsFor !== a.stats.pointsFor) return b.stats.pointsFor - a.stats.pointsFor;
    return a.teamId.localeCompare(b.teamId);
  });

  const knockoutSeeds = sorted.filter((seed) => seed.isKnockOutSeed);
  const remaining = sorted.filter((seed) => !seed.isKnockOutSeed);
  return [...knockoutSeeds, ...remaining];
}

export async function loadSeedInputs(categoryCode: CategoryCode, series: "A" | "B") {
  const qualifiers = await prisma.seriesQualifier.findMany({
    where: { categoryCode, series },
    include: {
      team: { include: { flags: true } },
      group: true,
    },
  });

  const groupIds = [...new Set(qualifiers.map((qualifier) => qualifier.groupId))];
  const standingsList = await Promise.all(
    groupIds.map((groupId) => computeStandings(groupId))
  );
  const standingsByTeam = new Map<string, StandingStats>();

  for (const entry of standingsList) {
    if (!entry) continue;
    for (const row of entry.standings) {
      const avgPA = row.played > 0 ? row.pointsAgainst / row.played : 0;
      standingsByTeam.set(row.teamId, {
        teamId: row.teamId,
        wins: row.wins,
        pointDiff: row.pointDiff,
        pointsFor: row.pointsFor,
        pointsAgainst: row.pointsAgainst,
        played: row.played,
        avgPA,
      });
    }
  }

  return qualifiers.map((qualifier) => ({
    teamId: qualifier.teamId,
    groupRank: qualifier.groupRank,
    groupId: qualifier.groupId,
    avgPA: standingsByTeam.get(qualifier.teamId)?.avgPA ?? 0,
    stats: standingsByTeam.get(qualifier.teamId) ?? {
      teamId: qualifier.teamId,
      wins: 0,
      pointDiff: 0,
      pointsFor: 0,
      pointsAgainst: 0,
      played: 0,
      avgPA: 0,
    },
    isKnockOutSeed: qualifier.team.flags?.isKnockOutSeed ?? false,
  }));
}

type GlobalRankingEntry = {
  teamId: string;
  teamName: string;
  groupId: string;
  groupName: string;
  groupRank: number;
  avgPA: number;
  played: number;
};

async function getGlobalDrawOrder(params: {
  categoryCode: CategoryCode;
  tieKey: string;
  teamIds: string[];
}) {
  const sortedIds = [...params.teamIds].sort();
  const drawKey = `global:${params.categoryCode}:${params.tieKey}:${sortedIds.join(",")}`;

  const existing = await prisma.knockoutRandomDraw.findUnique({
    where: { drawKey },
  });
  if (existing && typeof existing.payload === "object" && existing.payload) {
    const payload = existing.payload as { orderedTeamIds?: string[] };
    if (Array.isArray(payload.orderedTeamIds)) {
      return payload.orderedTeamIds;
    }
  }

  const shuffled = [...sortedIds];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  try {
    await prisma.knockoutRandomDraw.create({
      data: {
        categoryCode: params.categoryCode,
        series: "A",
        round: 0,
        drawKey,
        payload: { orderedTeamIds: shuffled },
      },
    });
    return shuffled;
  } catch (error) {
    const fallback = await prisma.knockoutRandomDraw.findUnique({ where: { drawKey } });
    if (fallback && typeof fallback.payload === "object" && fallback.payload) {
      const payload = fallback.payload as { orderedTeamIds?: string[] };
      if (Array.isArray(payload.orderedTeamIds)) {
        return payload.orderedTeamIds;
      }
    }
    throw error;
  }
}

export async function loadGlobalGroupRanking(categoryCode: CategoryCode) {
  const groups = await prisma.group.findMany({
    where: { category: { code: categoryCode } },
    orderBy: { name: "asc" },
  });

  const standingsList = await Promise.all(
    groups.map((group) => computeStandings(group.id))
  );

  const entries: GlobalRankingEntry[] = [];

  for (const result of standingsList) {
    if (!result) continue;
    result.standings.forEach((row, index) => {
      const avgPA = row.played > 0 ? row.pointsAgainst / row.played : 0;
      entries.push({
        teamId: row.teamId,
        teamName: row.teamName,
        groupId: result.group.id,
        groupName: result.group.name,
        groupRank: index + 1,
        avgPA,
        played: row.played,
      });
    });
  }

  const sorted = [...entries].sort((a, b) => {
    if (a.groupRank !== b.groupRank) return a.groupRank - b.groupRank;
    if (a.avgPA !== b.avgPA) return a.avgPA - b.avgPA;
    return a.teamId.localeCompare(b.teamId);
  });

  const resolved: GlobalRankingEntry[] = [];
  let index = 0;
  while (index < sorted.length) {
    let nextIndex = index + 1;
    const key = `${sorted[index].groupRank}:${sorted[index].avgPA.toFixed(4)}`;
    while (
      nextIndex < sorted.length &&
      `${sorted[nextIndex].groupRank}:${sorted[nextIndex].avgPA.toFixed(4)}` === key
    ) {
      nextIndex += 1;
    }

    const tieGroup = sorted.slice(index, nextIndex);
    if (tieGroup.length > 1) {
      const order = await getGlobalDrawOrder({
        categoryCode,
        tieKey: key,
        teamIds: tieGroup.map((entry) => entry.teamId),
      });
      const ordered = order
        .map((id) => tieGroup.find((entry) => entry.teamId === id))
        .filter((entry): entry is GlobalRankingEntry => Boolean(entry));
      resolved.push(...ordered);
    } else {
      resolved.push(...tieGroup);
    }

    index = nextIndex;
  }

  return resolved.map((entry, idx) => ({
    ...entry,
    globalRank: idx + 1,
  }));
}

export function buildStandardBracket(teamIds: string[], startRound = 2) {
  const teamCount = teamIds.length;
  const bracketSize = nextPowerOfTwo(teamCount);
  const seedOrder = buildSeedOrder(bracketSize);
  const seededTeams = new Array<string | null>(bracketSize).fill(null);

  seedOrder.forEach((seed, index) => {
    const team = teamIds[seed - 1] ?? null;
    seededTeams[index] = team;
  });

  const rounds = Math.log2(bracketSize);
  const matches: {
    round: number;
    matchNo: number;
    homeTeamId: string | null;
    awayTeamId: string | null;
  }[] = [];

  for (let roundOffset = 0; roundOffset < rounds; roundOffset += 1) {
    const round = startRound + roundOffset;
    const matchCount = bracketSize / Math.pow(2, roundOffset + 1);
    for (let matchNo = 1; matchNo <= matchCount; matchNo += 1) {
      if (roundOffset === 0) {
        const index = (matchNo - 1) * 2;
        matches.push({
          round,
          matchNo,
          homeTeamId: seededTeams[index] ?? null,
          awayTeamId: seededTeams[index + 1] ?? null,
        });
      } else {
        matches.push({
          round,
          matchNo,
          homeTeamId: null,
          awayTeamId: null,
        });
      }
    }
  }

  return matches;
}

export function buildSeriesBPlayInBracket(teamIds: string[]) {
  const teamCount = teamIds.length;
  if (teamCount <= 8 || (teamCount & (teamCount - 1)) === 0) {
    return {
      matches: buildStandardBracket(teamIds, 2),
      playInTargets: [],
    };
  }

  const playInMatches = teamCount - 8;
  const playInTeamsCount = playInMatches * 2;
  const topSeedCount = teamCount - playInTeamsCount;

  const topSeeds = teamIds.slice(0, topSeedCount);
  const playInTeams = teamIds.slice(topSeedCount);

  const qfMatches = 4;
  const qfSlots: { matchNo: number; slot: 1 | 2 }[] = [];
  for (let matchNo = 1; matchNo <= qfMatches; matchNo += 1) {
    qfSlots.push({ matchNo, slot: 1 });
    qfSlots.push({ matchNo, slot: 2 });
  }
  const seedOrder = [1, 8, 4, 5, 2, 7, 3, 6];
  const qfAssignments = qfSlots.map((slot, index) => ({
    ...slot,
    seedNo: seedOrder[index],
    teamId: null as string | null,
  }));
  topSeeds.forEach((teamId, index) => {
    const seedNo = index + 1;
    const target = qfAssignments.find((slot) => slot.seedNo === seedNo);
    if (target) target.teamId = teamId;
  });

  const remainingSlots = qfAssignments.filter((slot) => !slot.teamId);

  const matches: {
    round: number;
    matchNo: number;
    homeTeamId: string | null;
    awayTeamId: string | null;
  }[] = [];

  let left = 0;
  let right = playInTeams.length - 1;
  let matchNo = 1;
  while (left < right) {
    matches.push({
      round: 1,
      matchNo,
      homeTeamId: playInTeams[left] ?? null,
      awayTeamId: playInTeams[right] ?? null,
    });
    left += 1;
    right -= 1;
    matchNo += 1;
  }

  for (let matchNo = 1; matchNo <= qfMatches; matchNo += 1) {
    const homeTeamId =
      qfAssignments.find((slot) => slot.matchNo === matchNo && slot.slot === 1)?.teamId ??
      null;
    const awayTeamId =
      qfAssignments.find((slot) => slot.matchNo === matchNo && slot.slot === 2)?.teamId ??
      null;
    matches.push({
      round: 2,
      matchNo,
      homeTeamId,
      awayTeamId,
    });
  }

  for (let matchNo = 1; matchNo <= 2; matchNo += 1) {
    matches.push({ round: 3, matchNo, homeTeamId: null, awayTeamId: null });
  }
  matches.push({ round: 4, matchNo: 1, homeTeamId: null, awayTeamId: null });

  const playInTargets = remainingSlots.map((slot, index) => ({
    matchNo: index + 1,
    nextRound: 2,
    nextMatchNo: slot.matchNo,
    nextSlot: slot.slot,
  }));

  return { matches, playInTargets };
}

export function buildSecondChanceSeriesBBracket(params: {
  topSeeds: string[];
  playInTeams: string[];
  aLoserSlots: number;
}) {
  const matches: {
    round: number;
    matchNo: number;
    homeTeamId: string | null;
    awayTeamId: string | null;
    nextMatchIndex?: { round: number; matchNo: number; slot: 1 | 2 };
  }[] = [];

  const playInMatches = Math.floor(params.playInTeams.length / 2);

  for (let index = 0; index < playInMatches; index += 1) {
    matches.push({
      round: 1,
      matchNo: index + 1,
      homeTeamId: params.playInTeams[index * 2] ?? null,
      awayTeamId: params.playInTeams[index * 2 + 1] ?? null,
      nextMatchIndex: { round: 2, matchNo: index === 0 ? 2 : 4, slot: 1 },
    });
  }

  const qfMatches = 4;
  for (let matchNo = 1; matchNo <= qfMatches; matchNo += 1) {
    matches.push({
      round: 2,
      matchNo,
      homeTeamId: null,
      awayTeamId: null,
    });
  }

  if (params.topSeeds[0]) {
    const match = matches.find((entry) => entry.round === 2 && entry.matchNo === 1);
    if (match) match.homeTeamId = params.topSeeds[0];
  }
  if (params.topSeeds[1]) {
    const match = matches.find((entry) => entry.round === 2 && entry.matchNo === 3);
    if (match) match.homeTeamId = params.topSeeds[1];
  }

  let remainingLoserSlots = params.aLoserSlots;
  const qfEntries = matches.filter((entry) => entry.round === 2);
  for (const entry of qfEntries) {
    if (remainingLoserSlots === 0) break;
    if (!entry.awayTeamId) {
      remainingLoserSlots -= 1;
    }
  }

  for (let matchNo = 1; matchNo <= 2; matchNo += 1) {
    matches.push({ round: 3, matchNo, homeTeamId: null, awayTeamId: null });
  }
  matches.push({ round: 4, matchNo: 1, homeTeamId: null, awayTeamId: null });

  return matches;
}
