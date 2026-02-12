"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  lockGroupStage,
  randomizeFilteredGroupMatchResults,
  unlockGroupStage,
  undoMatchResult,
  upsertMatchScore,
} from "@/app/matches/actions";
import { GlobalFormPendingBridge } from "@/components/global-form-pending-bridge";

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
  categoryCode: "MD" | "WD" | "XD";
  status: "SCHEDULED" | "COMPLETED" | "WALKOVER";
  winnerTeamId: string | null;
  group: { id: string; name: string };
  homeTeam: Team | null;
  awayTeam: Team | null;
  games: MatchGame[];
};

type MatchesListClientProps = {
  categoryCode: "ALL" | "MD" | "WD" | "XD";
  matches: MatchItem[];
  initialFilters?: { search?: string; groupId?: string };
  scoringMode: "SINGLE_GAME_21" | "BEST_OF_3_21";
  stageLockByCategory: { MD: boolean; WD: boolean; XD: boolean };
  isDev: boolean;
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
  matches,
  initialFilters,
  scoringMode,
  stageLockByCategory,
  isDev,
}: MatchesListClientProps) {
  const storageKey = `matches:filters:${categoryCode}`;
  const shouldHydrateFromStorage = initialFilters === undefined;
  const [categoryFilter, setCategoryFilter] = useState<"ALL" | "MD" | "WD" | "XD">(
    categoryCode
  );
  const [search, setSearch] = useState(initialFilters?.search ?? "");
  const [groupId, setGroupId] = useState(initialFilters?.groupId ?? "");
  const [status, setStatus] = useState<"ALL" | "COMPLETED" | "SCHEDULED">("ALL");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setCategoryFilter(categoryCode);
  }, [categoryCode]);

  useEffect(() => {
    const stored = window.localStorage.getItem(storageKey);
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
  }, [shouldHydrateFromStorage, storageKey]);

  useEffect(() => {
    if (!mounted) return;
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({ search, groupId })
    );
  }, [groupId, mounted, search, storageKey]);

  const isAllCategories = categoryFilter === "ALL";

  useEffect(() => {
    if (!isAllCategories) return;
    if (groupId !== "") {
      setGroupId("");
    }
  }, [groupId, isAllCategories]);

  const availableGroups = useMemo(() => {
    if (isAllCategories) return [];

    const items = matches.filter((match) => match.categoryCode === categoryFilter);

    const deduped = new Map<string, string>();
    for (const match of items) {
      deduped.set(match.group.id, match.group.name);
    }

    return [...deduped.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) =>
        a.name.localeCompare(b.name, undefined, {
          numeric: true,
          sensitivity: "base",
        })
      );
  }, [categoryFilter, isAllCategories, matches]);

  useEffect(() => {
    if (!groupId) return;
    const isStillValid = availableGroups.some((group) => group.id === groupId);
    if (!isStillValid) {
      setGroupId("");
    }
  }, [availableGroups, groupId]);

  const filteredMatches = useMemo(() => {
    let filtered = matches;
    if (categoryFilter !== "ALL") {
      filtered = filtered.filter((match) => match.categoryCode === categoryFilter);
    }
    if (status !== "ALL") {
      filtered = filtered.filter((match) =>
        status === "COMPLETED"
          ? match.status === "COMPLETED" || match.status === "WALKOVER"
          : match.status === "SCHEDULED"
      );
    }
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
  }, [categoryFilter, groupId, matches, search, status]);

  const selectedCategoryLockState =
    categoryFilter === "ALL" ? false : stageLockByCategory[categoryFilter];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[180px]">
            <label className="text-xs font-medium text-muted-foreground">
              Categories
            </label>
            <select
              value={categoryFilter}
              onChange={(event) =>
                setCategoryFilter(event.target.value as "ALL" | "MD" | "WD" | "XD")
              }
              className="mt-1 w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none"
            >
              <option value="ALL">All categories</option>
              <option value="MD">MD</option>
              <option value="WD">WD</option>
              <option value="XD">XD</option>
            </select>
          </div>
          <div className="min-w-[200px]">
            <label className="text-xs font-medium text-muted-foreground">
              Filter group
            </label>
            <select
              value={groupId}
              onChange={(event) => setGroupId(event.target.value)}
              disabled={isAllCategories}
              className="mt-1 w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none"
            >
              <option value="">All groups</option>
              {availableGroups.map((group) => (
                <option key={group.id} value={group.id}>
                  Group {group.name}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-[260px]">
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
          <div className="flex min-w-[240px] items-end gap-2">
            <form action={lockGroupStage}>
              <GlobalFormPendingBridge />
              <input type="hidden" name="category" value={categoryFilter} />
              <input type="hidden" name="pageCategory" value={categoryCode} />
              <input type="hidden" name="filterGroupId" value={groupId} />
              <input type="hidden" name="filterSearch" value={search} />
              <input type="hidden" name="filterView" value="group" />
              <Button
                size="sm"
                type="submit"
                disabled={categoryFilter === "ALL" || selectedCategoryLockState}
              >
                Lock group stage
              </Button>
            </form>
            <form action={unlockGroupStage}>
              <GlobalFormPendingBridge />
              <input type="hidden" name="category" value={categoryFilter} />
              <input type="hidden" name="pageCategory" value={categoryCode} />
              <input type="hidden" name="filterGroupId" value={groupId} />
              <input type="hidden" name="filterSearch" value={search} />
              <input type="hidden" name="filterView" value="group" />
              <Button
                size="sm"
                type="submit"
                variant="outline"
                disabled={categoryFilter === "ALL" || !selectedCategoryLockState}
              >
                Unlock
              </Button>
            </form>
          </div>
          {isDev ? (
            <form action={randomizeFilteredGroupMatchResults}>
              <GlobalFormPendingBridge />
              <input type="hidden" name="category" value={categoryFilter} />
              <input type="hidden" name="filterGroupId" value={groupId} />
              <input type="hidden" name="filterSearch" value={search} />
              <input type="hidden" name="filterView" value="group" />
              <Button
                type="submit"
                variant="destructive"
                size="sm"
                disabled={categoryFilter === "ALL"}
              >
                ⚠️ Randomize match results (DEV)
              </Button>
            </form>
          ) : null}
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
            const isMatchLocked = stageLockByCategory[match.categoryCode];
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
                      {match.categoryCode} - Group {match.group.name}
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
                  <GlobalFormPendingBridge />
                  <input type="hidden" name="matchId" value={match.id} />
                  <input type="hidden" name="category" value={match.categoryCode} />
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
                        disabled={isMatchLocked}
                        required
                      />
                      <input
                        name="game1Away"
                        type="number"
                        min={0}
                        className="w-full rounded-md border border-input bg-card px-2 py-1 text-xs text-foreground focus:border-ring focus:outline-none"
                        placeholder="Away"
                        defaultValue={games[0]?.awayPoints ?? ""}
                        disabled={isMatchLocked}
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
                          disabled={isMatchLocked}
                          required
                        />
                        <input
                          name="game2Away"
                          type="number"
                          min={0}
                          className="w-full rounded-md border border-input bg-card px-2 py-1 text-xs text-foreground focus:border-ring focus:outline-none"
                          placeholder="Away"
                          defaultValue={games[1]?.awayPoints ?? ""}
                          disabled={isMatchLocked}
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
                          disabled={isMatchLocked}
                        />
                        <input
                          name="game3Away"
                          type="number"
                          min={0}
                          className="w-full rounded-md border border-input bg-card px-2 py-1 text-xs text-foreground focus:border-ring focus:outline-none"
                          placeholder="Away"
                          defaultValue={games[2]?.awayPoints ?? ""}
                          disabled={isMatchLocked}
                        />
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" type="submit" disabled={isMatchLocked}>
                      Save result
                    </Button>
                  </div>
                </form>
                {match.status !== "SCHEDULED" ? (
                  <form action={undoMatchResult} className="mt-2">
                    <GlobalFormPendingBridge />
                    <input type="hidden" name="matchId" value={match.id} />
                    <input type="hidden" name="category" value={match.categoryCode} />
                    <input type="hidden" name="filterGroupId" value={groupId} />
                    <input type="hidden" name="filterSearch" value={search} />
                    <input type="hidden" name="filterView" value="group" />
                    <Button
                      size="sm"
                      type="submit"
                      variant="outline"
                      disabled={isMatchLocked}
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
