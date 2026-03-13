"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { formatAverageMetric } from "@/lib/format-average-metric";
import type {
  CategoryCode,
  PublicCompletedMatch,
  PublicStandingsSummary,
} from "@/lib/public-read-models/types";

type StandingsClientProps = {
  categories: CategoryCode[];
  initialCategoryCode: CategoryCode;
  initialData: PublicStandingsSummary;
  favouritePlayerName: string | null;
  initialGroupId: string;
  favouriteGroupByCategory: Record<CategoryCode, string>;
  isViewer: boolean;
  errorMessage: string | null;
};

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
            {match ? <span className="text-[greenyellow]">{match}</span> : null}
          </span>
        );
      })}
    </>
  );
}

function readStoredGroupId(categoryCode: CategoryCode) {
  try {
    const raw = window.localStorage.getItem(`standings:filters:${categoryCode}`);
    if (!raw) return "";
    const parsed = JSON.parse(raw) as { groupId?: string };
    return typeof parsed.groupId === "string" ? parsed.groupId : "";
  } catch {
    return "";
  }
}

function writeStoredGroupId(categoryCode: CategoryCode, groupId: string) {
  try {
    window.localStorage.setItem(
      `standings:filters:${categoryCode}`,
      JSON.stringify({ groupId })
    );
  } catch {
    // Ignore storage failures.
  }
}

export function StandingsClient({
  categories,
  initialCategoryCode,
  initialData,
  favouritePlayerName,
  initialGroupId,
  favouriteGroupByCategory,
  isViewer,
  errorMessage,
}: StandingsClientProps) {
  const router = useRouter();
  const [selectedCategory, setSelectedCategory] = useState<CategoryCode>(initialCategoryCode);
  const [summaryByCategory, setSummaryByCategory] = useState<
    Partial<Record<CategoryCode, PublicStandingsSummary>>
  >({ [initialCategoryCode]: initialData });
  const [groupId, setGroupId] = useState(initialGroupId || "");
  const [loadingCategory, setLoadingCategory] = useState(false);
  const [collapsedMatchesByGroup, setCollapsedMatchesByGroup] = useState<Record<string, boolean>>(
    () => Object.fromEntries(initialData.groups.map((entry) => [entry.group.id, true]))
  );
  const [matchesByGroupId, setMatchesByGroupId] = useState<Record<string, PublicCompletedMatch[]>>(
    {}
  );
  const [loadingMatchesByGroupId, setLoadingMatchesByGroupId] = useState<Record<string, boolean>>(
    {}
  );
  const [matchesErrorByGroupId, setMatchesErrorByGroupId] = useState<Record<string, string>>({});
  const loadingCategoryRef = useRef<Map<CategoryCode, Promise<PublicStandingsSummary>>>(
    new Map()
  );

  const currentSummary = summaryByCategory[selectedCategory];

  useEffect(() => {
    if (initialGroupId) return;
    const stored = readStoredGroupId(initialCategoryCode);
    if (stored) setGroupId(stored);
  }, [initialCategoryCode, initialGroupId]);

  useEffect(() => {
    writeStoredGroupId(selectedCategory, groupId);
  }, [groupId, selectedCategory]);

  useEffect(() => {
    if (!currentSummary) return;
    setCollapsedMatchesByGroup((previous) => {
      const next = { ...previous };
      currentSummary.groups.forEach((entry) => {
        if (typeof next[entry.group.id] === "undefined") {
          next[entry.group.id] = true;
        }
      });
      return next;
    });
  }, [currentSummary]);

  const updateUrl = useCallback((categoryCode: CategoryCode, nextGroupId: string) => {
    const params = new URLSearchParams(window.location.search);
    params.set("category", categoryCode);
    if (nextGroupId) {
      params.set("groupId", nextGroupId);
    } else {
      params.delete("groupId");
    }
    params.delete("fromNav");
    const query = params.toString();
    router.replace(query ? `/standings?${query}` : "/standings", { scroll: false });
  }, [router]);

  const fetchCategorySummary = useCallback(
    async (categoryCode: CategoryCode) => {
      if (summaryByCategory[categoryCode]) return summaryByCategory[categoryCode];

      const inflight = loadingCategoryRef.current.get(categoryCode);
      if (inflight) return inflight;

      const request = (async () => {
        const response = await fetch(`/api/public/standings/summary?category=${categoryCode}`, {
          cache: "no-store",
        });
        if (!response.ok) throw new Error("Unable to load standings summary.");
        const payload = (await response.json()) as PublicStandingsSummary;
        setSummaryByCategory((previous) => ({ ...previous, [categoryCode]: payload }));
        return payload;
      })();

      loadingCategoryRef.current.set(categoryCode, request);
      try {
        return await request;
      } finally {
        loadingCategoryRef.current.delete(categoryCode);
      }
    },
    [summaryByCategory]
  );

  useEffect(() => {
    categories
      .filter((categoryCode) => categoryCode !== selectedCategory)
      .forEach((categoryCode) => {
        if (!summaryByCategory[categoryCode]) {
          void fetchCategorySummary(categoryCode);
        }
      });
  }, [categories, fetchCategorySummary, selectedCategory, summaryByCategory]);

  const handleCategorySelect = useCallback(
    async (categoryCode: CategoryCode) => {
      if (categoryCode === selectedCategory) return;

      const storedGroupId = readStoredGroupId(categoryCode);
      const fallbackGroupId = favouriteGroupByCategory[categoryCode] || "";
      const nextGroupId = storedGroupId || fallbackGroupId;

      setSelectedCategory(categoryCode);
      setGroupId(nextGroupId);
      updateUrl(categoryCode, nextGroupId);

      if (!summaryByCategory[categoryCode]) {
        setLoadingCategory(true);
        try {
          await fetchCategorySummary(categoryCode);
        } finally {
          setLoadingCategory(false);
        }
      }
    },
    [
      favouriteGroupByCategory,
      fetchCategorySummary,
      selectedCategory,
      summaryByCategory,
      updateUrl,
    ]
  );

  const filteredGroups = useMemo(() => {
    if (!currentSummary) return [];
    if (!groupId) return currentSummary.groups;
    return currentSummary.groups.filter((entry) => entry.group.id === groupId);
  }, [currentSummary, groupId]);

  const handleGroupFilterChange = useCallback(
    (nextGroupId: string) => {
      setGroupId(nextGroupId);
      updateUrl(selectedCategory, nextGroupId);
    },
    [selectedCategory, updateUrl]
  );

  const toggleCompletedMatches = useCallback(
    async (groupIdToToggle: string, completedCount: number) => {
      const currentlyCollapsed = collapsedMatchesByGroup[groupIdToToggle] ?? true;
      const shouldExpand = currentlyCollapsed;

      setCollapsedMatchesByGroup((previous) => ({
        ...previous,
        [groupIdToToggle]: !currentlyCollapsed,
      }));

      if (!shouldExpand || completedCount === 0 || matchesByGroupId[groupIdToToggle]) {
        return;
      }

      setLoadingMatchesByGroupId((previous) => ({ ...previous, [groupIdToToggle]: true }));
      setMatchesErrorByGroupId((previous) => {
        const next = { ...previous };
        delete next[groupIdToToggle];
        return next;
      });

      try {
        const response = await fetch(
          `/api/public/standings/group-matches?groupId=${encodeURIComponent(groupIdToToggle)}`,
          { cache: "no-store" }
        );
        if (!response.ok) throw new Error("Unable to load completed matches.");
        const payload = (await response.json()) as {
          groupId: string;
          matches: PublicCompletedMatch[];
        };
        setMatchesByGroupId((previous) => ({
          ...previous,
          [groupIdToToggle]: payload.matches,
        }));
      } catch (error) {
        setMatchesErrorByGroupId((previous) => ({
          ...previous,
          [groupIdToToggle]: error instanceof Error ? error.message : "Unable to load matches.",
        }));
      } finally {
        setLoadingMatchesByGroupId((previous) => ({ ...previous, [groupIdToToggle]: false }));
      }
    },
    [collapsedMatchesByGroup, matchesByGroupId]
  );

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Standings</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            View group-stage rankings and completed results.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {categories.map((categoryCode) => (
            <Button
              key={categoryCode}
              variant={categoryCode === selectedCategory ? "default" : "outline"}
              size="sm"
              onClick={() => {
                void handleCategorySelect(categoryCode);
              }}
            >
              {categoryCode}
            </Button>
          ))}
        </div>
      </div>

      {errorMessage ? (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {errorMessage}
        </div>
      ) : null}

      <div className="mt-6 space-y-6">
        <div className="space-y-2">
          <div className="min-w-[200px] max-w-sm">
            <label className="text-xs font-medium text-muted-foreground">Filter group</label>
            <select
              value={groupId}
              onChange={(event) => handleGroupFilterChange(event.target.value)}
              className="mt-1 w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none"
            >
              <option value="">All groups</option>
              {(currentSummary?.groups ?? []).map((groupEntry) => (
                <option key={groupEntry.group.id} value={groupEntry.group.id}>
                  Group {groupEntry.group.name}
                </option>
              ))}
            </select>
          </div>
          {loadingCategory ? (
            <p className="text-xs text-muted-foreground">Loading {selectedCategory} standings...</p>
          ) : null}
        </div>

        {loadingCategory && !currentSummary ? (
          <p className="text-sm text-muted-foreground">Loading {selectedCategory} standings...</p>
        ) : filteredGroups.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {isViewer
              ? "No standings available for this selection yet."
              : "Create groups for this category to view standings."}
          </p>
        ) : (
          <div className="space-y-6">
            {filteredGroups.map(({ group, standings, completedCount }) => {
              const isCollapsed = collapsedMatchesByGroup[group.id] ?? true;
              const completedMatches = matchesByGroupId[group.id] ?? [];
              const scoresByMatch = new Map(
                completedMatches.map((match) => [
                  match.id,
                  [...match.games].sort((a, b) => a.gameNumber - b.gameNumber),
                ])
              );
              const isLoadingMatches = loadingMatchesByGroupId[group.id] ?? false;
              const matchesError = matchesErrorByGroupId[group.id] ?? null;

              return (
                <div key={group.id} className="rounded-xl border border-border p-5">
                  <div className="flex w-full items-center gap-3">
                    <h2 className="text-lg font-semibold text-foreground">Group {group.name}</h2>
                    <p className="ml-auto text-right text-sm text-muted-foreground">
                      {group.teamCount} team{group.teamCount === 1 ? "" : "s"}
                    </p>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5 text-[11px] leading-5 text-muted-foreground sm:text-xs">
                    <span className="rounded-md bg-muted/60 px-2 py-0.5">W = Wins</span>
                    <span className="rounded-md bg-muted/60 px-2 py-0.5">L = Losses</span>
                    <span className="rounded-md bg-muted/60 px-2 py-0.5">PF = Points For</span>
                    <span className="rounded-md bg-muted/60 px-2 py-0.5">PA = Points Against</span>
                    <span className="rounded-md bg-muted/60 px-2 py-0.5">
                      Avg PD = Point Diff / Matches Played
                    </span>
                  </div>

                  <div className="mt-4 hidden overflow-x-auto md:block">
                    <table className="w-full text-left text-sm">
                      <thead className="border-b border-border text-xs uppercase text-muted-foreground">
                        <tr>
                          <th className="w-12 py-2 pr-2 text-center">Rank</th>
                          <th className="py-2 pr-2">Team</th>
                          <th className="w-12 py-2 pr-2 text-right">W</th>
                          <th className="w-12 py-2 pr-2 text-right">L</th>
                          <th className="w-16 py-2 pr-2 text-right">PF</th>
                          <th className="w-16 py-2 pr-2 text-right">PA</th>
                          <th className="w-20 py-2 pr-2 text-right">Avg PD</th>
                        </tr>
                      </thead>
                      <tbody>
                        {standings.map((row, index) => {
                          const label = row.teamName || "Unknown team";
                          return (
                            <tr
                              key={row.teamId}
                              className="border-b border-border/60 odd:bg-muted/25 even:bg-background hover:bg-muted/50"
                            >
                              <td className="py-2 pr-2 text-center font-medium tabular-nums text-foreground">
                                {index + 1}
                              </td>
                              <td className="py-2 pr-2 font-semibold text-foreground">
                                {highlightName(label, favouritePlayerName)}
                              </td>
                              <td className="py-2 pr-2 text-right tabular-nums text-emerald-300">
                                {row.wins}
                              </td>
                              <td className="py-2 pr-2 text-right tabular-nums text-rose-300">
                                {row.losses}
                              </td>
                              <td className="py-2 pr-2 text-right tabular-nums">{row.pointsFor}</td>
                              <td className="py-2 pr-2 text-right tabular-nums">{row.pointsAgainst}</td>
                              <td className="py-2 pr-2 text-right tabular-nums">
                                {formatAverageMetric(row.avgPointDiff)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div className="mt-4 space-y-3 md:hidden">
                    {standings.map((row, index) => {
                      const label = row.teamName || "Unknown team";
                      return (
                        <div
                          key={row.teamId}
                          className="rounded-lg border border-border px-3 py-2 odd:bg-muted/25 even:bg-background"
                        >
                          <p className="text-sm text-foreground">
                            <span className="mr-2 font-semibold tabular-nums">#{index + 1}</span>
                            <span className="font-semibold">
                              {highlightName(label, favouritePlayerName)}
                            </span>
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                            <span className="text-emerald-300">W</span>{" "}
                            <span className="font-semibold text-emerald-300">{row.wins}</span> ·{" "}
                            <span className="text-rose-300">L</span>{" "}
                            <span className="font-semibold text-rose-300">{row.losses}</span> · PF{" "}
                            <span className="font-semibold text-foreground">{row.pointsFor}</span> · PA{" "}
                            <span className="font-semibold text-foreground">{row.pointsAgainst}</span> · Avg PD{" "}
                            <span className="font-semibold text-foreground">
                              {formatAverageMetric(row.avgPointDiff)}
                            </span>
                          </p>
                        </div>
                      );
                    })}
                  </div>

                  <div className="mt-6 rounded-lg border border-border p-4">
                    <button
                      type="button"
                      onClick={() => {
                        void toggleCompletedMatches(group.id, completedCount);
                      }}
                      className="w-full text-left text-sm font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                      aria-expanded={!isCollapsed}
                      aria-controls={`completed-${group.id}`}
                    >
                      {isCollapsed
                        ? `Show completed matches (${completedCount})`
                        : `Hide completed matches (${completedCount})`}
                    </button>
                    {completedCount === 0 ? (
                      <p className="mt-2 text-sm text-muted-foreground">No completed matches yet.</p>
                    ) : !isCollapsed ? (
                      <div id={`completed-${group.id}`} className="mt-3 space-y-3">
                        {isLoadingMatches ? (
                          <p className="text-sm text-muted-foreground">Loading completed matches...</p>
                        ) : matchesError ? (
                          <p className="text-sm text-red-500">{matchesError}</p>
                        ) : completedMatches.length === 0 ? (
                          <p className="text-sm text-muted-foreground">No completed matches yet.</p>
                        ) : (
                          completedMatches.map((match) => {
                            const scores = scoresByMatch.get(match.id) ?? [];
                            const homeLabel = match.homeTeamName || "TBD";
                            const awayLabel = match.awayTeamName || "TBD";
                            const homeWon = Boolean(
                              match.winnerTeamId &&
                                match.homeTeamId &&
                                match.winnerTeamId === match.homeTeamId
                            );
                            const awayWon = Boolean(
                              match.winnerTeamId &&
                                match.awayTeamId &&
                                match.winnerTeamId === match.awayTeamId
                            );
                            const scoreSummary =
                              scores.length === 0
                                ? "-"
                                : scores
                                    .map((game) => `${game.homePoints}-${game.awayPoints}`)
                                    .join(", ");

                            return (
                              <div key={match.id} className="rounded-md border border-border p-3">
                                <p className="text-sm text-foreground">
                                  <span className={homeWon ? "font-semibold" : ""}>
                                    {highlightName(homeLabel, favouritePlayerName)}
                                  </span>{" "}
                                  {homeWon ? (
                                    <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                                      Winner
                                    </span>
                                  ) : null}{" "}
                                  <span className="text-muted-foreground">vs</span>{" "}
                                  <span className={awayWon ? "font-semibold" : ""}>
                                    {highlightName(awayLabel, favouritePlayerName)}
                                  </span>{" "}
                                  {awayWon ? (
                                    <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                                      Winner
                                    </span>
                                  ) : null}
                                </p>
                                <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                                  <span className="font-semibold text-foreground md:font-normal md:text-muted-foreground">
                                    Score: {scoreSummary}
                                  </span>
                                </p>
                              </div>
                            );
                          })
                        )}
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
