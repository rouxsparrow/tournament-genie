"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { useGlobalTransition } from "@/components/use-global-transition";
import {
  clearMatchesKnockout,
  fetchKnockoutMatches,
  generateMatchesKnockout,
  randomizeAllKnockoutResultsDev,
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
  series: "A" | "B";
  round: number;
  matchNo: number;
  status: "SCHEDULED" | "COMPLETED" | "WALKOVER";
  winnerTeamId: string | null;
  games: MatchGame[];
  homeTeam: Team | null;
  awayTeam: Team | null;
};

type KnockoutMatchesSectionProps = {
  categoryCode: "MD" | "WD" | "XD";
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
  if (round === 4) return "Final";
  return `Round ${round}`;
}

export function KnockoutMatchesSection({
  categoryCode,
  matches,
  isDev,
  scoringMode,
}: KnockoutMatchesSectionProps) {
  const [pending, startTransition] = useGlobalTransition();
  const [items, setItems] = useState(matches);
  const [series, setSeries] = useState<"ALL" | "A" | "B">("ALL");
  const [round, setRound] = useState("ALL");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setItems(matches);
    setError(null);
  }, [matches]);

  const availableRounds = useMemo(() => {
    const unique = Array.from(
      new Set(
        matches
          .filter((match) => (series === "ALL" ? true : match.series === series))
          .map((match) => match.round)
      )
    ).sort((a, b) => a - b);
    return unique.map((roundNo) => ({
      value: String(roundNo),
      label: roundLabel(roundNo),
    }));
  }, [matches, series]);

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
    if (series !== "ALL") {
      filtered = filtered.filter((match) => match.series === series);
    }
    if (round !== "ALL") {
      filtered = filtered.filter((match) => String(match.round) === round);
    }
    if (!search.trim()) return filtered;
    const query = search.trim().toLowerCase();
    return filtered.filter((match) => {
      const home = teamSearchText(match.homeTeam);
      const away = teamSearchText(match.awayTeam);
      return home.includes(query) || away.includes(query);
    });
  }, [items, round, search, series]);

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
            Buttons below apply to Knockout matches only.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const formData = new FormData(event.currentTarget);
              startTransition(async () => {
                const result = await generateMatchesKnockout(formData);
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
            <input type="hidden" name="category" value={categoryCode} />
            <input type="hidden" name="series" value={series} />
            <Button type="submit" disabled={pending}>
              Generate matches
            </Button>
          </form>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const formData = new FormData(event.currentTarget);
              startTransition(async () => {
                const result = await clearMatchesKnockout(formData);
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
            <input type="hidden" name="category" value={categoryCode} />
            <input type="hidden" name="series" value={series} />
            <Button type="submit" variant="outline" disabled={pending}>
              Clear matches
            </Button>
          </form>
          {isDev ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
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
              <input type="hidden" name="category" value={categoryCode} />
              <input type="hidden" name="series" value={series} />
              <input type="hidden" name="round" value={round} />
              <input type="hidden" name="search" value={search} />
              <Button type="submit" variant="destructive" disabled={pending}>
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

      <div className="mt-4 grid gap-3 md:grid-cols-3">
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
            const scoreSummary = match.games
              .slice()
              .sort((a, b) => a.gameNumber - b.gameNumber)
              .map((game) => `${game.homePoints}-${game.awayPoints}`)
              .join(", ");
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
                    {roundLabel(match.round)}{" "}
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
                <div className="grid gap-2 sm:grid-cols-2">
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
                  {scoringMode === "BEST_OF_3_21" ? (
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
                  {scoringMode === "BEST_OF_3_21" ? (
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
