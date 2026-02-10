"use client";

import { useEffect, useMemo, useState } from "react";

type TeamMember = {
  player: { name: string };
};

type Team = {
  id: string;
  name: string;
  members: TeamMember[];
};

type StandingRow = {
  teamId: string;
  teamName: string;
  wins: number;
  losses: number;
  played: number;
  pointsFor: number;
  pointsAgainst: number;
  pointDiff: number;
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
  homeTeamId: string | null;
  awayTeamId: string | null;
  games: MatchGame[];
};

type GroupData = {
  group: {
    id: string;
    name: string;
    teams: { team: Team }[];
  };
  standings: StandingRow[];
  matches: MatchItem[];
};

type StandingsClientProps = {
  categoryCode: "MD" | "WD" | "XD";
  favouritePlayerName: string | null;
  initialGroupId: string;
  groups: { id: string; name: string }[];
  groupData: GroupData[];
};

function teamLabel(team: Team | null) {
  if (!team) return "TBD";
  if (team.name) return team.name;
  const names = team.members.map((member) => member.player.name);
  return names.length === 2 ? `${names[0]} / ${names[1]}` : "Unnamed team";
}

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

export function StandingsClient({
  categoryCode,
  groups,
  groupData,
  favouritePlayerName,
  initialGroupId,
}: StandingsClientProps) {
  const storageKey = `standings:filters:${categoryCode}`;
  const [groupId, setGroupId] = useState(() => {
    if (initialGroupId) return initialGroupId;
    if (typeof window === "undefined") return "";
    const stored = window.localStorage.getItem(storageKey);
    if (!stored) return "";
    try {
      const parsed = JSON.parse(stored) as { groupId?: string };
      return typeof parsed.groupId === "string" ? parsed.groupId : "";
    } catch {
      return "";
    }
  });
  const [collapsedMatchesByGroup, setCollapsedMatchesByGroup] = useState<Record<string, boolean>>(() => {
    const isMobile =
      typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches;
    return Object.fromEntries(groupData.map((entry) => [entry.group.id, isMobile]));
  });

  useEffect(() => {
    window.localStorage.setItem(storageKey, JSON.stringify({ groupId }));
  }, [groupId, storageKey]);

  const filteredGroups = useMemo(() => {
    if (!groupId) return groupData;
    return groupData.filter((entry) => entry.group.id === groupId);
  }, [groupData, groupId]);

  return (
    <div className="mt-6 space-y-6">
      <div className="space-y-2">
        <div className="min-w-[200px] max-w-sm">
          <label className="text-xs font-medium text-muted-foreground">Filter group</label>
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
        <div className="flex flex-wrap gap-1.5 text-[11px] leading-5 text-muted-foreground sm:text-xs">
          <span className="rounded-md bg-muted/60 px-2 py-0.5">W = Wins</span>
          <span className="rounded-md bg-muted/60 px-2 py-0.5">L = Losses</span>
          <span className="rounded-md bg-muted/60 px-2 py-0.5">PF = Points For</span>
          <span className="rounded-md bg-muted/60 px-2 py-0.5">PA = Points Against</span>
          <span className="rounded-md bg-muted/60 px-2 py-0.5">PD = Point Diff</span>
        </div>
      </div>

      {filteredGroups.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Create groups for this category to view standings.
        </p>
      ) : (
        <div className="space-y-6">
          {filteredGroups.map(({ group, standings, matches }) => {
            const teams = group.teams.map((entry) => entry.team);
            const completedMatches = matches.filter((match) => match.status !== "SCHEDULED");
            const completedCount = completedMatches.length;
            const isCollapsed = collapsedMatchesByGroup[group.id] ?? false;
            const scoresByMatch = new Map(
              matches.map((match) => [
                match.id,
                [...match.games].sort((a, b) => a.gameNumber - b.gameNumber),
              ])
            );

            return (
              <div key={group.id} className="rounded-xl border border-border p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-foreground">Group {group.name}</h2>
                    <p className="text-sm text-muted-foreground">
                      {teams.length} team{teams.length === 1 ? "" : "s"}
                    </p>
                  </div>
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
                        <th className="w-16 py-2 pr-2 text-right">PD</th>
                      </tr>
                    </thead>
                    <tbody>
                      {standings.map((row, index) => {
                        const team = teams.find((entry) => entry.id === row.teamId);
                        const label = team ? teamLabel(team) : row.teamName || "Unknown team";
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
                            <td className="py-2 pr-2 text-right tabular-nums">{row.wins}</td>
                            <td className="py-2 pr-2 text-right tabular-nums">{row.losses}</td>
                            <td className="py-2 pr-2 text-right tabular-nums">{row.pointsFor}</td>
                            <td className="py-2 pr-2 text-right tabular-nums">{row.pointsAgainst}</td>
                            <td className="py-2 pr-2 text-right tabular-nums">
                              {row.pointDiff > 0 ? `+${row.pointDiff}` : row.pointDiff}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="mt-4 space-y-3 md:hidden">
                  {standings.map((row, index) => {
                    const team = teams.find((entry) => entry.id === row.teamId);
                    const label = team ? teamLabel(team) : row.teamName || "Unknown team";
                    return (
                      <div
                        key={row.teamId}
                        className="rounded-lg border border-border px-3 py-2 odd:bg-muted/25 even:bg-background"
                      >
                        <p className="text-sm text-foreground">
                          <span className="mr-2 font-semibold tabular-nums">#{index + 1}</span>
                          <span className="font-semibold">{highlightName(label, favouritePlayerName)}</span>
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                          W <span className="font-semibold text-foreground">{row.wins}</span> · L{" "}
                          <span className="font-semibold text-foreground">{row.losses}</span> · PF{" "}
                          <span className="font-semibold text-foreground">{row.pointsFor}</span> · PA{" "}
                          <span className="font-semibold text-foreground">{row.pointsAgainst}</span> · PD{" "}
                          <span className="font-semibold text-foreground">
                            {row.pointDiff > 0 ? `+${row.pointDiff}` : row.pointDiff}
                          </span>
                        </p>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-6 rounded-lg border border-border p-4">
                  <button
                    type="button"
                    onClick={() =>
                      setCollapsedMatchesByGroup((previous) => ({
                        ...previous,
                        [group.id]: !(previous[group.id] ?? false),
                      }))
                    }
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
                      {completedMatches.map((match) => {
                        const scores = scoresByMatch.get(match.id) ?? [];
                        const homeTeam = teams.find((team) => team.id === match.homeTeamId);
                        const awayTeam = teams.find((team) => team.id === match.awayTeamId);
                        const homeLabel = homeTeam ? teamLabel(homeTeam) : "TBD";
                        const awayLabel = awayTeam ? teamLabel(awayTeam) : "TBD";
                        const homeWon = Boolean(
                          match.winnerTeamId && match.homeTeamId && match.winnerTeamId === match.homeTeamId
                        );
                        const awayWon = Boolean(
                          match.winnerTeamId && match.awayTeamId && match.winnerTeamId === match.awayTeamId
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
                      })}
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
