"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { undoMatchResult, upsertMatchScore } from "@/app/matches/actions";

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

type MatchItem = {
  id: string;
  status: "SCHEDULED" | "COMPLETED" | "WALKOVER";
  winnerTeamId: string | null;
  group: { id: string; name: string };
  homeTeam: Team | null;
  awayTeam: Team | null;
  games: MatchGame[];
};

type MatchesListClientProps = {
  categoryCode: "MD" | "WD" | "XD";
  groups: { id: string; name: string }[];
  matches: MatchItem[];
  initialFilters?: { search?: string; groupId?: string };
  scoringMode: "SINGLE_GAME_21" | "BEST_OF_3_21";
  isStageLocked: boolean;
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

function matchScoreSummary(match: MatchItem) {
  if (match.status === "SCHEDULED") return "-";
  if (match.games.length === 0) return "-";
  return match.games
    .sort((a, b) => a.gameNumber - b.gameNumber)
    .map((game) => `${game.homePoints}-${game.awayPoints}`)
    .join(", ");
}

export function MatchesListClient({
  categoryCode,
  groups,
  matches,
  initialFilters,
  scoringMode,
  isStageLocked,
}: MatchesListClientProps) {
  const storageKey = `matches:filters:${categoryCode}`;
  const [search, setSearch] = useState(initialFilters?.search ?? "");
  const [groupId, setGroupId] = useState(initialFilters?.groupId ?? "");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem(storageKey);
    const shouldHydrateFromStorage =
      !initialFilters?.search && !initialFilters?.groupId;
    if (stored && shouldHydrateFromStorage) {
      try {
        const parsed = JSON.parse(stored) as { search?: string; groupId?: string };
        if (typeof parsed.search === "string") setSearch(parsed.search);
        if (typeof parsed.groupId === "string") setGroupId(parsed.groupId);
      } catch {
        // Ignore invalid stored filters.
      }
    }
    setMounted(true);
  }, [initialFilters?.groupId, initialFilters?.search, storageKey]);

  useEffect(() => {
    if (!mounted) return;
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({ search, groupId })
    );
  }, [groupId, mounted, search, storageKey]);

  const filteredMatches = useMemo(() => {
    let filtered = matches;
    if (groupId) {
      filtered = filtered.filter((match) => match.group.id === groupId);
    }
    if (!search.trim()) return filtered;
    const query = search.trim().toLowerCase();
    return filtered.filter((match) => {
      const home = teamSearchText(match.homeTeam);
      const away = teamSearchText(match.awayTeam);
      return home.includes(query) || away.includes(query);
    });
  }, [groupId, matches, search]);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[1fr,auto] lg:items-end">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Matches</h2>
          <p className="text-sm text-muted-foreground">
            {filteredMatches.length} match
            {filteredMatches.length === 1 ? "" : "es"}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3 lg:justify-end">
          <div className="min-w-[200px]">
            <label className="text-xs font-medium text-muted-foreground">
              Filter group
            </label>
            <select
              value={groupId}
              onChange={(event) => setGroupId(event.target.value)}
              className="mt-1 w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none"
            >
              <option value="">All groups</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  Group {group.name}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-[260px]">
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
      </div>

      {filteredMatches.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No matches found for this filter.
        </p>
      ) : (
        <div className="space-y-4">
          {filteredMatches.map((match) => {
            const games = [...match.games].sort(
              (a, b) => a.gameNumber - b.gameNumber
            );
            const statusText =
              match.status === "COMPLETED" || match.status === "WALKOVER"
                ? "Completed"
                : "Scheduled";
            const statusClass =
              match.status === "COMPLETED" || match.status === "WALKOVER"
                ? "bg-emerald-500 text-white"
                : "bg-amber-700 text-amber-100";
            const winnerLabel =
              match.winnerTeamId === match.homeTeam?.id
                ? teamLabel(match.homeTeam)
                : match.winnerTeamId === match.awayTeam?.id
                  ? teamLabel(match.awayTeam)
                  : "TBD";

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
                      Group {match.group.name}
                    </p>
                  </div>
                  <div className="text-right">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusClass}`}
                    >
                      {statusText}
                    </span>
                    <div className="mt-2 text-sm text-foreground">
                      <p className="font-semibold">
                        Score{" "}
                        <span className="font-medium text-muted-foreground">
                          {matchScoreSummary(match)}
                        </span>
                      </p>
                      <p className="font-semibold">
                        Winner{" "}
                        <span className="font-medium text-muted-foreground">
                          {winnerLabel}
                        </span>
                      </p>
                    </div>
                  </div>
                </div>

                <form action={upsertMatchScore} className="mt-4 grid gap-2">
                  <input type="hidden" name="matchId" value={match.id} />
                  <input type="hidden" name="category" value={categoryCode} />
                  <input type="hidden" name="filterGroupId" value={groupId} />
                  <input type="hidden" name="filterSearch" value={search} />
                  <input type="hidden" name="filterView" value="group" />

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
                        defaultValue={games[0]?.homePoints ?? ""}
                        disabled={isStageLocked}
                        required
                      />
                      <input
                        name="game1Away"
                        type="number"
                        min={0}
                        className="w-full rounded-md border border-input bg-card px-2 py-1 text-xs text-foreground focus:border-ring focus:outline-none"
                        placeholder="Away"
                        defaultValue={games[0]?.awayPoints ?? ""}
                        disabled={isStageLocked}
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
                          defaultValue={games[1]?.homePoints ?? ""}
                          disabled={isStageLocked}
                          required
                        />
                        <input
                          name="game2Away"
                          type="number"
                          min={0}
                          className="w-full rounded-md border border-input bg-card px-2 py-1 text-xs text-foreground focus:border-ring focus:outline-none"
                          placeholder="Away"
                          defaultValue={games[1]?.awayPoints ?? ""}
                          disabled={isStageLocked}
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
                          defaultValue={games[2]?.homePoints ?? ""}
                          disabled={isStageLocked}
                        />
                        <input
                          name="game3Away"
                          type="number"
                          min={0}
                          className="w-full rounded-md border border-input bg-card px-2 py-1 text-xs text-foreground focus:border-ring focus:outline-none"
                          placeholder="Away"
                          defaultValue={games[2]?.awayPoints ?? ""}
                          disabled={isStageLocked}
                        />
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" type="submit" disabled={isStageLocked}>
                      Save result
                    </Button>
                  </div>
                </form>
                {match.status !== "SCHEDULED" ? (
                  <form action={undoMatchResult} className="mt-2">
                    <input type="hidden" name="matchId" value={match.id} />
                    <input type="hidden" name="category" value={categoryCode} />
                    <input type="hidden" name="filterGroupId" value={groupId} />
                    <input type="hidden" name="filterSearch" value={search} />
                    <input type="hidden" name="filterView" value="group" />
                    <Button
                      size="sm"
                      type="submit"
                      variant="outline"
                      disabled={isStageLocked}
                    >
                      Undo
                    </Button>
                  </form>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
