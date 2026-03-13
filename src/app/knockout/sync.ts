import "server-only";

import { buildSecondChanceHomeAssignments } from "@/app/knockout/bracket-layout";
import { prisma } from "@/lib/prisma";

type CategoryCode = "MD" | "WD" | "XD";
type MatchStatus = "SCHEDULED" | "COMPLETED";

type KnockoutMatchSnapshot = {
  id: string;
  categoryCode: CategoryCode;
  series: "A" | "B";
  round: number;
  matchNo: number;
  homeTeamId: string | null;
  awayTeamId: string | null;
  winnerTeamId: string | null;
  status: MatchStatus;
  nextMatchId: string | null;
  nextSlot: number | null;
  games: { gameNumber: number; homePoints: number; awayPoints: number }[];
};

async function getScoringMode() {
  const settings = await prisma.tournamentSettings.findFirst({
    orderBy: { createdAt: "desc" },
  });
  return settings?.scoringMode ?? "SINGLE_GAME_21";
}

function deriveWinnerFromGames(
  match: KnockoutMatchSnapshot,
  scoringMode: "SINGLE_GAME_21" | "BEST_OF_3_21"
) {
  if (!match.homeTeamId || !match.awayTeamId) return null;
  const games = [...match.games].sort((a, b) => a.gameNumber - b.gameNumber);
  if (games.length === 0) return null;

  if (scoringMode === "SINGLE_GAME_21") {
    const game = games[0];
    if (game.homePoints === game.awayPoints) return null;
    return game.homePoints > game.awayPoints
      ? match.homeTeamId
      : match.awayTeamId;
  }

  let homeWins = 0;
  let awayWins = 0;
  for (const game of games) {
    if (game.homePoints === game.awayPoints) continue;
    if (game.homePoints > game.awayPoints) homeWins += 1;
    else awayWins += 1;
  }
  if (homeWins >= 2) return match.homeTeamId;
  if (awayWins >= 2) return match.awayTeamId;
  return null;
}

function maxRoundForSeries(matches: KnockoutMatchSnapshot[], series: "A" | "B") {
  return matches
    .filter((match) => match.series === series)
    .reduce((max, match) => Math.max(max, match.round), 0);
}

function getLoserTeamId(
  match: KnockoutMatchSnapshot,
  scoringMode: "SINGLE_GAME_21" | "BEST_OF_3_21"
) {
  if (!match.homeTeamId || !match.awayTeamId) return null;
  const winner = match.winnerTeamId ?? deriveWinnerFromGames(match, scoringMode);
  if (!winner) return null;
  return winner === match.homeTeamId ? match.awayTeamId : match.homeTeamId;
}

export async function syncKnockoutPropagation(categoryCode: CategoryCode) {
  let updated = 0;
  const scoringMode = await getScoringMode();

  for (let pass = 0; pass < 5; pass += 1) {
    const passUpdates = await prisma.$transaction(async (tx) => {
      let changed = 0;

      const config = await tx.categoryConfig.findUnique({
        where: { categoryCode },
      });
      const secondChanceEnabled =
        categoryCode === "WD" ? false : config?.secondChanceEnabled ?? true;

      const matches = await tx.knockoutMatch.findMany({
        where: { categoryCode },
        include: { games: true },
        orderBy: [
          { series: "asc" },
          { round: "asc" },
          { matchNo: "asc" },
        ],
      });

      const matchById = new Map<string, KnockoutMatchSnapshot>(
        matches.map((match) => [match.id, match as KnockoutMatchSnapshot])
      );

      async function clearDownstreamSlot(
        matchId: string,
        clearedTeamId: string
      ) {
        const match = matchById.get(matchId);
        if (!match?.nextMatchId || !match.nextSlot) return;

        const nextMatch = matchById.get(match.nextMatchId);
        if (!nextMatch) return;

        const slotField = match.nextSlot === 1 ? "homeTeamId" : "awayTeamId";
        const currentSlot = nextMatch[slotField];
        if (currentSlot !== clearedTeamId) return;

        const previousWinner = nextMatch.winnerTeamId;
        const shouldReset =
          previousWinner === clearedTeamId ||
          !nextMatch.homeTeamId ||
          !nextMatch.awayTeamId;

        if (shouldReset) {
          await tx.knockoutGameScore.deleteMany({
            where: { knockoutMatchId: nextMatch.id },
          });
        }

        await tx.knockoutMatch.update({
          where: { id: nextMatch.id },
          data: {
            [slotField]: null,
            ...(shouldReset
              ? {
                  winnerTeamId: null,
                  status: "SCHEDULED",
                  completedAt: null,
                }
              : {}),
          },
        });

        nextMatch[slotField] = null;
        if (shouldReset) {
          nextMatch.winnerTeamId = null;
          nextMatch.status = "SCHEDULED";
        }
        changed += 1;

        if (shouldReset && previousWinner) {
          await clearDownstreamSlot(nextMatch.id, previousWinner);
        }
      }

      for (const match of matches as KnockoutMatchSnapshot[]) {
        let winnerTeamId = match.winnerTeamId;
        const derivedWinner =
          !winnerTeamId ? deriveWinnerFromGames(match, scoringMode) : null;

        if (winnerTeamId && derivedWinner && winnerTeamId !== derivedWinner) {
          throw new Error(
            `Winner mismatch for match ${match.id}: expected ${winnerTeamId}, got ${derivedWinner}.`
          );
        }

        if (!winnerTeamId && derivedWinner) {
          winnerTeamId = derivedWinner;
          await tx.knockoutMatch.update({
            where: { id: match.id },
            data: { winnerTeamId, status: "COMPLETED" },
          });
          changed += 1;
        } else if (winnerTeamId && match.status === "SCHEDULED") {
          await tx.knockoutMatch.update({
            where: { id: match.id },
            data: { status: "COMPLETED" },
          });
          changed += 1;
        }

        if (!winnerTeamId || !match.nextMatchId || !match.nextSlot) continue;

        const nextMatch = matchById.get(match.nextMatchId);
        if (!nextMatch) continue;

        const slotField = match.nextSlot === 1 ? "homeTeamId" : "awayTeamId";
        const currentSlot = nextMatch[slotField];

        if (currentSlot && currentSlot !== winnerTeamId) {
          if (nextMatch.winnerTeamId) {
            await clearDownstreamSlot(nextMatch.id, nextMatch.winnerTeamId);
          }
          await tx.knockoutGameScore.deleteMany({
            where: { knockoutMatchId: nextMatch.id },
          });
          await tx.knockoutMatch.update({
            where: { id: nextMatch.id },
            data: {
              [slotField]: winnerTeamId,
              winnerTeamId: null,
              status: "SCHEDULED",
              completedAt: null,
            },
          });
          nextMatch[slotField] = winnerTeamId;
          nextMatch.winnerTeamId = null;
          nextMatch.status = "SCHEDULED";
          changed += 1;
          continue;
        }

        if (!currentSlot) {
          await tx.knockoutMatch.update({
            where: { id: nextMatch.id },
            data: { [slotField]: winnerTeamId },
          });
          nextMatch[slotField] = winnerTeamId;
          changed += 1;
        }
      }

      if (secondChanceEnabled) {
        const isDev = process.env.NODE_ENV !== "production";
        const playInsEnabled =
          categoryCode === "WD" ? false : config?.playInsEnabled ?? false;
        const maxRoundA = maxRoundForSeries(matches as KnockoutMatchSnapshot[], "A");
        const maxRoundB = maxRoundForSeries(matches as KnockoutMatchSnapshot[], "B");
        const qfRoundA = maxRoundA > 0 ? 2 : 0;
        const qfRoundB = maxRoundB > 0 ? 2 : 0;

        if (qfRoundA > 0 && qfRoundB > 0) {
          const seriesAQFs = (matches as KnockoutMatchSnapshot[])
            .filter((match) => match.series === "A" && match.round === qfRoundA)
            .sort((a, b) => a.matchNo - b.matchNo);
          const seriesBQFs = (matches as KnockoutMatchSnapshot[])
            .filter((match) => match.series === "B" && match.round === qfRoundB)
            .sort((a, b) => a.matchNo - b.matchNo);

          if (isDev) {
            const aLoserIds = seriesAQFs.flatMap((match) => {
              const winner =
                match.winnerTeamId ?? deriveWinnerFromGames(match, scoringMode);
              if (!winner || !match.homeTeamId || !match.awayTeamId) return [];
              return [
                winner === match.homeTeamId ? match.awayTeamId : match.homeTeamId,
              ];
            });
            const conflicts = seriesBQFs.filter(
              (match) => match.awayTeamId && aLoserIds.includes(match.awayTeamId)
            );
            if (conflicts.length > 0) {
              console.warn(
                "Second chance conflict: A-drop loser appears in B QF base slot.",
                conflicts.map((match) => match.matchNo)
              );
            }
          }

          const completedLosers = seriesAQFs.flatMap((match) => {
            const winnerTeamId =
              match.winnerTeamId ?? deriveWinnerFromGames(match, scoringMode);
            if (!winnerTeamId || !match.homeTeamId || !match.awayTeamId) {
              return [];
            }
            return [
              {
                matchNo: match.matchNo,
                teamId:
                  winnerTeamId === match.homeTeamId
                    ? match.awayTeamId
                    : match.homeTeamId,
              },
            ];
          });

          const desiredHomeByMatchNo = new Map<number, string>();
          if (playInsEnabled) {
            completedLosers.forEach((loser) => {
              desiredHomeByMatchNo.set(loser.matchNo, loser.teamId);
            });
          } else {
            const loserSeeds = completedLosers.length
              ? await tx.knockoutSeed.findMany({
                  where: {
                    categoryCode,
                    series: "A",
                    teamId: { in: completedLosers.map((loser) => loser.teamId) },
                  },
                  orderBy: { seedNo: "asc" },
                })
              : [];
            buildSecondChanceHomeAssignments(
              loserSeeds.map((seed) => seed.teamId)
            ).forEach((assignment) => {
              desiredHomeByMatchNo.set(assignment.matchNo, assignment.homeTeamId);
            });
          }

          for (const target of seriesBQFs) {
            const desiredHomeTeamId =
              desiredHomeByMatchNo.get(target.matchNo) ?? null;
            if (target.homeTeamId === desiredHomeTeamId) continue;

            if (target.winnerTeamId) {
              await clearDownstreamSlot(target.id, target.winnerTeamId);
            }

            if (target.homeTeamId || target.winnerTeamId) {
              await tx.knockoutGameScore.deleteMany({
                where: { knockoutMatchId: target.id },
              });
            }

            await tx.knockoutMatch.update({
              where: { id: target.id },
              data: {
                homeTeamId: desiredHomeTeamId,
                winnerTeamId: null,
                status: "SCHEDULED",
                completedAt: null,
              },
            });
            target.homeTeamId = desiredHomeTeamId;
            target.winnerTeamId = null;
            target.status = "SCHEDULED";
            changed += 1;
          }
        }
      }

      for (const series of ["A", "B"] as const) {
        const sfMatches = (matches as KnockoutMatchSnapshot[])
          .filter((match) => match.series === series && match.round === 3)
          .sort((a, b) => a.matchNo - b.matchNo);
        const bronzeMatch = (matches as KnockoutMatchSnapshot[]).find(
          (match) => match.series === series && match.round === 4 && match.matchNo === 2
        );

        if (!bronzeMatch) continue;

        for (const sfMatch of sfMatches) {
          if (sfMatch.matchNo !== 1 && sfMatch.matchNo !== 2) continue;
          const slotField = sfMatch.matchNo === 1 ? "homeTeamId" : "awayTeamId";
          const loserTeamId = getLoserTeamId(sfMatch, scoringMode);
          const currentSlot = bronzeMatch[slotField];

          if (loserTeamId) {
            if (currentSlot === loserTeamId) continue;
            await tx.knockoutGameScore.deleteMany({
              where: { knockoutMatchId: bronzeMatch.id },
            });
            await tx.knockoutMatch.update({
              where: { id: bronzeMatch.id },
              data: {
                [slotField]: loserTeamId,
                winnerTeamId: null,
                status: "SCHEDULED",
              },
            });
            bronzeMatch[slotField] = loserTeamId;
            bronzeMatch.winnerTeamId = null;
            bronzeMatch.status = "SCHEDULED";
            changed += 1;
            continue;
          }

          if (currentSlot) {
            await tx.knockoutGameScore.deleteMany({
              where: { knockoutMatchId: bronzeMatch.id },
            });
            await tx.knockoutMatch.update({
              where: { id: bronzeMatch.id },
              data: {
                [slotField]: null,
                winnerTeamId: null,
                status: "SCHEDULED",
              },
            });
            bronzeMatch[slotField] = null;
            bronzeMatch.winnerTeamId = null;
            bronzeMatch.status = "SCHEDULED";
            changed += 1;
          }
        }
      }

      return changed;
    });

    updated += passUpdates;
    if (passUpdates === 0) break;
  }

  return { updated };
}
