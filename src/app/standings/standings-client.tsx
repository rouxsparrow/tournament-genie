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
  groups: { id: string; name: string }[];
  groupData: GroupData[];
};

function teamLabel(team: Team | null) {
  if (!team) return "TBD";
  if (team.name) return team.name;
  const names = team.members.map((member) => member.player.name);
  return names.length === 2 ? `${names[0]} / ${names[1]}` : "Unnamed team";
}

export function StandingsClient({
  categoryCode,
  groups,
  groupData,
}: StandingsClientProps) {
  const storageKey = `standings:filters:${categoryCode}`;
  const [groupId, setGroupId] = useState("");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem(storageKey);
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as { groupId?: string };
        if (typeof parsed.groupId === "string") setGroupId(parsed.groupId);
      } catch {
        // Ignore invalid stored filters.
      }
    }
    setMounted(true);
  }, [storageKey]);

  useEffect(() => {
    if (!mounted) return;
    window.localStorage.setItem(storageKey, JSON.stringify({ groupId }));
  }, [groupId, mounted, storageKey]);

  const filteredGroups = useMemo(() => {
    if (!groupId) return groupData;
    return groupData.filter((entry) => entry.group.id === groupId);
  }, [groupData, groupId]);

  return (
    <div className="mt-6 space-y-6">
      <div className="flex flex-wrap items-end gap-3">
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
      </div>

      {filteredGroups.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Create groups for this category to view standings.
        </p>
      ) : (
        <div className="space-y-6">
          {filteredGroups.map(({ group, standings, matches }) => {
            const teams = group.teams.map((entry) => entry.team);
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
                    <h2 className="text-lg font-semibold text-foreground">
                      Group {group.name}
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      {teams.length} team{teams.length === 1 ? "" : "s"}
                    </p>
                  </div>
                </div>

                <div className="mt-4 overflow-x-auto">
                  <table className="w-full min-w-[420px] text-left text-sm">
                    <thead className="border-b border-border text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="py-2 pr-2">Team</th>
                        <th className="py-2 pr-2">W</th>
                        <th className="py-2 pr-2">L</th>
                        <th className="py-2 pr-2">PF</th>
                        <th className="py-2 pr-2">PA</th>
                        <th className="py-2 pr-2">PD</th>
                      </tr>
                    </thead>
                    <tbody>
                      {standings.map((row) => {
                        const team = teams.find((entry) => entry.id === row.teamId);
                        const label = team ? teamLabel(team) : row.teamName || "Unknown team";
                        return (
                          <tr key={row.teamId} className="border-b border-border/60">
                            <td className="py-2 pr-2 text-foreground">{label}</td>
                            <td className="py-2 pr-2">{row.wins}</td>
                            <td className="py-2 pr-2">{row.losses}</td>
                            <td className="py-2 pr-2">{row.pointsFor}</td>
                            <td className="py-2 pr-2">{row.pointsAgainst}</td>
                            <td className="py-2 pr-2">{row.pointDiff}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="mt-6 rounded-lg border border-border p-4">
                  <h3 className="text-sm font-semibold text-foreground">
                    Completed matches
                  </h3>
                  {matches.filter((match) => match.status !== "SCHEDULED").length === 0 ? (
                    <p className="mt-2 text-sm text-muted-foreground">
                      No completed matches yet.
                    </p>
                  ) : (
                    <div className="mt-3 space-y-3">
                      {matches
                        .filter((match) => match.status !== "SCHEDULED")
                        .map((match) => {
                          const scores = scoresByMatch.get(match.id) ?? [];
                          const homeTeam = teams.find(
                            (team) => team.id === match.homeTeamId
                          );
                          const awayTeam = teams.find(
                            (team) => team.id === match.awayTeamId
                          );
                          const winnerLabel =
                            match.winnerTeamId === match.homeTeamId
                              ? teamLabel(homeTeam ?? teams[0])
                              : match.winnerTeamId === match.awayTeamId
                                ? teamLabel(awayTeam ?? teams[0])
                                : "TBD";
                          const scoreSummary =
                            scores.length === 0
                              ? "-"
                              : scores
                                  .map(
                                    (game) =>
                                      `${game.homePoints}-${game.awayPoints}`
                                  )
                                  .join(", ");

                          return (
                            <div
                              key={match.id}
                              className="rounded-md border border-border p-3"
                            >
                              <p className="text-sm font-medium text-foreground">
                                {homeTeam ? teamLabel(homeTeam) : "TBD"} vs{" "}
                                {awayTeam ? teamLabel(awayTeam) : "TBD"}
                              </p>
                              <p className="mt-1 text-xs text-muted-foreground">
                                Score: {scoreSummary} · Winner: {winnerLabel}
                              </p>
                            </div>
                          );
                        })}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
