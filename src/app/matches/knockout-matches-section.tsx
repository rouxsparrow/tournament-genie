"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { useGlobalTransition } from "@/components/use-global-transition";
import {
  fetchKnockoutMatches,
  randomizeAllKnockoutResultsDev,
  setFinalBestOf3,
  undoKnockoutMatchResult,
  upsertKnockoutMatchScore,
} from "@/app/matches/actions";

type TeamMember = {
  player: { name: string };
};

type Team = {
  id: string;
  name: string;
  members: TeamMember[];
};

type MatchGame = {
  gameNumber: number;
  homePoints: number;
  awayPoints: number;
};

type KnockoutMatchItem = {
  id: string;
  categoryCode: "MD" | "WD" | "XD";
  series: "A" | "B";
  round: number;
  matchNo: number;
  status: "SCHEDULED" | "COMPLETED" | "WALKOVER";
  winnerTeamId: string | null;
  isBestOf3: boolean;
  games: MatchGame[];
  homeTeam: Team | null;
  awayTeam: Team | null;
};

type KnockoutMatchesSectionProps = {
  categoryCode: "ALL" | "MD" | "WD" | "XD";
  matches: KnockoutMatchItem[];
  isDev: boolean;
  scoringMode: "SINGLE_GAME_21" | "BEST_OF_3_21";
};

function teamLabel(team: Team | null) {
  if (!team) return "TBD";
  if (team.name) return team.name;
  const names = team.members.map((member) => member.player.name);
  return names.length === 2 ? `${names[0]} / ${names[1]}` : "Unnamed team";
}

function teamSearchText(team: Team | null) {
  if (!team) return "";
  const names = team.members.map((member) => member.player.name).join(" ");
  return `${team.name} ${names}`.trim().toLowerCase();
}

function roundLabel(round: number) {
  if (round === 1) return "Play-ins";
  if (round === 2) return "Quarterfinals";
  if (round === 3) return "Semifinals";
  if (round === 4) return "Finals";
  return `Round ${round}`;
}

function matchRoundLabel(round: number, matchNo: number) {
  if (round === 4 && matchNo === 1) return "Final";
  if (round === 4 && matchNo === 2) return "Bronze Medal Match";
  return roundLabel(round);
}

export function KnockoutMatchesSection({
  categoryCode,
  matches,
  isDev,
  scoringMode,
}: KnockoutMatchesSectionProps) {
  const [pending, startTransition] = useGlobalTransition();
  const [items, setItems] = useState(matches);
  const [categoryFilter, setCategoryFilter] = useState<"ALL" | "MD" | "WD" | "XD">(
    categoryCode
  );
  const [series, setSeries] = useState<"ALL" | "A" | "B">("ALL");
  const [round, setRound] = useState("ALL");
  const [status, setStatus] = useState<"ALL" | "COMPLETED" | "SCHEDULED">("ALL");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setItems(matches);
    setError(null);
  }, [matches]);

  useEffect(() => {
    setCategoryFilter(categoryCode);
  }, [categoryCode]);

  const availableRounds = useMemo(() => {
    const unique = Array.from(
      new Set(
        matches
          .filter((match) =>
            categoryFilter === "ALL" ? true : match.categoryCode === categoryFilter
          )
          .filter((match) => (series === "ALL" ? true : match.series === series))
          .map((match) => match.round)
      )
    ).sort((a, b) => a - b);
    return unique.map((roundNo) => ({
      value: String(roundNo),
      label: roundLabel(roundNo),
    }));
  }, [categoryFilter, matches, series]);

  useEffect(() => {
    if (series === "ALL") return;
    if (round === "ALL") return;
    const stillExists = availableRounds.some((entry) => entry.value === round);
    if (!stillExists) {
      setRound("ALL");
    }
  }, [availableRounds, round, series]);

  const filteredMatches = useMemo(() => {
    let filtered = items;
    if (categoryFilter !== "ALL") {
      filtered = filtered.filter((match) => match.categoryCode === categoryFilter);
    }
    if (series !== "ALL") {
      filtered = filtered.filter((match) => match.series === series);
    }
    if (round !== "ALL") {
      filtered = filtered.filter((match) => String(match.round) === round);
    }
    if (status !== "ALL") {
      filtered = filtered.filter((match) =>
        status === "COMPLETED"
          ? match.status === "COMPLETED" || match.status === "WALKOVER"
          : match.status === "SCHEDULED"
      );
    }
    if (!search.trim()) return filtered;
    const query = search.trim().toLowerCase();
    return filtered.filter((match) => {
      const home = teamSearchText(match.homeTeam);
      const away = teamSearchText(match.awayTeam);
      return home.includes(query) || away.includes(query);
    });
  }, [categoryFilter, items, round, search, series, status]);

  const statusBadge = (status: KnockoutMatchItem["status"]) => {
    if (status === "COMPLETED" || status === "WALKOVER") {
      return "bg-emerald-500 text-white";
    }
    return "bg-amber-700 text-amber-100";
  };

  const statusText = (status: KnockoutMatchItem["status"]) => {
    if (status === "COMPLETED" || status === "WALKOVER") return "Completed";
    return "Scheduled";
  };

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">
            Knockout Matches
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Knockout scoring and result management.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isDev ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (categoryFilter === "ALL") {
                  setError("Select a category in filter to randomize matches.");
                  return;
                }
                const formData = new FormData(event.currentTarget);
                startTransition(async () => {
                  const result = await randomizeAllKnockoutResultsDev(formData);
                  if (result?.error) {
                    setError(result.error);
                    return;
                  }
                  const refreshed = await fetchKnockoutMatches({ categoryCode });
                  setItems(refreshed);
                  setError(null);
                });
              }}
            >
              <input type="hidden" name="category" value={categoryFilter} />
              <input type="hidden" name="series" value={series} />
              <input type="hidden" name="round" value={round} />
              <input type="hidden" name="search" value={search} />
              <Button
                type="submit"
                variant="destructive"
                disabled={pending || categoryFilter === "ALL"}
              >
                ⚠️ Randomize match results (DEV)
              </Button>
            </form>
          ) : null}
        </div>
      </div>

      {error ? (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <div>
          <label className="text-xs font-medium text-muted-foreground">
            Categories
          </label>
          <select
            value={categoryFilter}
            onChange={(event) =>
              setCategoryFilter(
                event.target.value as "ALL" | "MD" | "WD" | "XD"
              )
            }
            className="mt-1 w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none"
          >
            <option value="ALL">All categories</option>
            <option value="MD">MD</option>
            <option value="WD">WD</option>
            <option value="XD">XD</option>
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">
            Series
          </label>
          <select
            value={series}
            onChange={(event) =>
              setSeries(event.target.value as "ALL" | "A" | "B")
            }
            className="mt-1 w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none"
          >
            <option value="ALL">All series</option>
            <option value="A">Series A</option>
            <option value="B">Series B</option>
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">
            Round
          </label>
          <select
            value={round}
            onChange={(event) => setRound(event.target.value)}
            className="mt-1 w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none"
          >
            <option value="ALL">All rounds</option>
            {availableRounds.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">
            Status
          </label>
          <select
            value={status}
            onChange={(event) =>
              setStatus(event.target.value as "ALL" | "COMPLETED" | "SCHEDULED")
            }
            className="mt-1 w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none"
          >
            <option value="ALL">All</option>
            <option value="COMPLETED">Completed</option>
            <option value="SCHEDULED">Scheduled</option>
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">
            Search by player
          </label>
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Type a player name"
            className="mt-1 w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none"
          />
        </div>
      </div>

      {filteredMatches.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          No knockout matches found for this filter.
        </p>
      ) : (
        <div className="mt-4 space-y-3">
          {filteredMatches.map((match) => {
            const matchScoringMode =
              match.round === 4 && match.matchNo === 1 && match.isBestOf3
                ? "BEST_OF_3_21"
                : scoringMode;
            const scoreSummary = match.games
              .slice()
              .sort((a, b) => a.gameNumber - b.gameNumber)
              .map((game) => `${game.homePoints}-${game.awayPoints}`)
              .join(", ");
            const isFinal = match.round === 4 && match.matchNo === 1;
            return (
              <div key={match.id} className="rounded-lg border border-border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm text-foreground">
                    {teamLabel(match.homeTeam)}{" "}
                    <span className="text-emerald-500">Vs.</span>{" "}
                    {teamLabel(match.awayTeam)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {match.categoryCode} · {matchRoundLabel(match.round, match.matchNo)}{" "}
                    · Series {match.series} · Match {match.matchNo}
                  </p>
                </div>
                <div className="text-right">
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusBadge(match.status)}`}
                  >
                    {statusText(match.status)}
                  </span>
                  <div className="mt-2 text-xs text-muted-foreground">
                    <p>
                      Score:{" "}
                      {scoreSummary ? scoreSummary : "-"}
                    </p>
                    <p>
                      Winner:{" "}
                      {match.winnerTeamId === match.homeTeam?.id
                        ? teamLabel(match.homeTeam)
                        : match.winnerTeamId === match.awayTeam?.id
                          ? teamLabel(match.awayTeam)
                          : "TBD"}
                    </p>
                  </div>
                </div>
              </div>
              {isFinal ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    const formData = new FormData(event.currentTarget);
                    startTransition(async () => {
                      const result = await setFinalBestOf3(formData);
                      if (result?.error) {
                        setError(result.error);
                        return;
                      }
                      const refreshed = await fetchKnockoutMatches({ categoryCode });
                      setItems(refreshed);
                      setError(null);
                    });
                  }}
                  className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
                >
                  <input type="hidden" name="matchId" value={match.id} />
                  <input
                    id={`final-best-of-3-${match.id}`}
                    name="isBestOf3"
                    type="checkbox"
                    className="h-4 w-4 rounded border border-input"
                    checked={match.isBestOf3}
                    onChange={(event) => {
                      const formData = new FormData();
                      formData.set("matchId", match.id);
                      formData.set("isBestOf3", String(event.target.checked));
                      startTransition(async () => {
                        const result = await setFinalBestOf3(formData);
                        if (result?.error) {
                          setError(result.error);
                          return;
                        }
                        const refreshed = await fetchKnockoutMatches({ categoryCode });
                        setItems(refreshed);
                        setError(null);
                      });
                    }}
                  />
                  <label htmlFor={`final-best-of-3-${match.id}`}>
                    Final is Best-of-3
                  </label>
                </form>
              ) : null}
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const formData = new FormData(event.currentTarget);
                  startTransition(async () => {
                    const result = await upsertKnockoutMatchScore(formData);
                    if (result?.error) {
                      setError(result.error);
                      return;
                    }
                    const refreshed = await fetchKnockoutMatches({ categoryCode });
                    setItems(refreshed);
                    setError(null);
                  });
                }}
                className="mt-4 grid gap-2"
              >
                <input type="hidden" name="matchId" value={match.id} />
                <div className="grid gap-2">
                  <div className="space-y-1 text-xs">
                    <div className="text-muted-foreground">Game 1</div>
                    <div className="grid grid-cols-2 items-center gap-2">
                    <input
                      name="game1Home"
                      type="number"
                      min={0}
                      className="w-full rounded-md border border-input bg-card px-2 py-1 text-xs text-foreground focus:border-ring focus:outline-none"
                      placeholder="Home"
                      defaultValue={match.games[0]?.homePoints ?? ""}
                      required
                    />
                    <input
                      name="game1Away"
                      type="number"
                      min={0}
                      className="w-full rounded-md border border-input bg-card px-2 py-1 text-xs text-foreground focus:border-ring focus:outline-none"
                      placeholder="Away"
                      defaultValue={match.games[0]?.awayPoints ?? ""}
                      required
                    />
                    </div>
                  </div>
                  {matchScoringMode === "BEST_OF_3_21" ? (
                    <div className="space-y-1 text-xs">
                      <div className="text-muted-foreground">Game 2</div>
                      <div className="grid grid-cols-2 items-center gap-2">
                      <input
                        name="game2Home"
                        type="number"
                        min={0}
                        className="w-full rounded-md border border-input bg-card px-2 py-1 text-xs text-foreground focus:border-ring focus:outline-none"
                        placeholder="Home"
                        defaultValue={match.games[1]?.homePoints ?? ""}
                        required
                      />
                      <input
                        name="game2Away"
                        type="number"
                        min={0}
                        className="w-full rounded-md border border-input bg-card px-2 py-1 text-xs text-foreground focus:border-ring focus:outline-none"
                        placeholder="Away"
                        defaultValue={match.games[1]?.awayPoints ?? ""}
                        required
                      />
                      </div>
                    </div>
                  ) : null}
                  {matchScoringMode === "BEST_OF_3_21" ? (
                    <div className="space-y-1 text-xs">
                      <div className="text-muted-foreground">Game 3</div>
                      <div className="grid grid-cols-2 items-center gap-2">
                      <input
                        name="game3Home"
                        type="number"
                        min={0}
                        className="w-full rounded-md border border-input bg-card px-2 py-1 text-xs text-foreground focus:border-ring focus:outline-none"
                        placeholder="Home"
                        defaultValue={match.games[2]?.homePoints ?? ""}
                      />
                      <input
                        name="game3Away"
                        type="number"
                        min={0}
                        className="w-full rounded-md border border-input bg-card px-2 py-1 text-xs text-foreground focus:border-ring focus:outline-none"
                        placeholder="Away"
                        defaultValue={match.games[2]?.awayPoints ?? ""}
                      />
                      </div>
                    </div>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" type="submit" disabled={pending}>
                    Save result
                  </Button>
                </div>
              </form>
              {match.status !== "SCHEDULED" ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    const formData = new FormData(event.currentTarget);
                    startTransition(async () => {
                      const result = await undoKnockoutMatchResult(formData);
                      if (result?.error) {
                        setError(result.error);
                        return;
                      }
                      const refreshed = await fetchKnockoutMatches({ categoryCode });
                      setItems(refreshed);
                      setError(null);
                    });
                  }}
                  className="mt-2"
                >
                  <input type="hidden" name="matchId" value={match.id} />
                  <Button size="sm" type="submit" variant="outline" disabled={pending}>
                    Undo
                  </Button>
                </form>
              ) : null}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
