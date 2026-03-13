"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatAverageMetric } from "@/lib/format-average-metric";
import { clearTieBreakOverride, saveTieBreakOverride } from "@/app/tie-breaks/actions";
import type {
  GlobalRankingTieCard,
  GroupStandingTieCard,
  TieBreakState,
} from "@/app/tie-breaks/types";

type TieBreaksClientProps = {
  initialState: TieBreakState;
};

function moveItem<T>(items: T[], index: number, direction: -1 | 1) {
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= items.length) return items;
  const next = [...items];
  [next[index], next[nextIndex]] = [next[nextIndex] as T, next[index] as T];
  return next;
}

function reorderTie<T extends { tieKey: string; teams: { teamId: string }[] }>(
  ties: T[],
  tieKey: string,
  direction: -1 | 1,
  teamId: string
) {
  return ties.map((tie) => {
    if (tie.tieKey !== tieKey) return tie;
    const index = tie.teams.findIndex((team) => team.teamId === teamId);
    if (index < 0) return tie;
    return {
      ...tie,
      teams: moveItem(tie.teams, index, direction),
    };
  });
}

function orderedTeamIds(tie: { teams: { teamId: string }[] }) {
  return tie.teams.map((team) => team.teamId);
}

function TieSourceBadge({ source }: { source: "manual" | "random" }) {
  return source === "manual" ? (
    <Badge variant="default">Manual</Badge>
  ) : (
    <Badge variant="secondary">Random</Badge>
  );
}

function TieCardActions({
  disabled,
  pending,
  canClear,
  onSave,
  onClear,
}: {
  disabled: boolean;
  pending: boolean;
  canClear: boolean;
  onSave: () => void;
  onClear: () => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" onClick={onSave} disabled={disabled || pending}>
        Save Manual Order
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={onClear}
        disabled={disabled || pending || !canClear}
      >
        Clear Manual Override
      </Button>
    </div>
  );
}

export function TieBreaksClient({ initialState }: TieBreaksClientProps) {
  const [state, setState] = useState(initialState);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const runSave = (tie: GroupStandingTieCard | GlobalRankingTieCard) => {
    setMessage(null);
    startTransition(async () => {
      const result = await saveTieBreakOverride({
        categoryCode: state.categoryCode,
        scope: tie.scope,
        tieKey: tie.tieKey,
        orderedTeamIds: orderedTeamIds(tie),
      });
      if ("error" in result) {
        setMessage(result.error);
        if (result.state) setState(result.state);
        return;
      }
      setState(result.state);
      setMessage(result.message);
    });
  };

  const runClear = (tie: GroupStandingTieCard | GlobalRankingTieCard) => {
    setMessage(null);
    startTransition(async () => {
      const result = await clearTieBreakOverride({
        categoryCode: state.categoryCode,
        scope: tie.scope,
        tieKey: tie.tieKey,
      });
      if ("error" in result) {
        setMessage(result.error);
        if (result.state) setState(result.state);
        return;
      }
      setState(result.state);
      setMessage(result.message);
    });
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-muted/30 p-4">
        <p className="text-sm text-muted-foreground">
          Manual overrides only apply while the exact tied teams and metrics still match.
        </p>
        {state.isBlocked ? (
          <p className="mt-2 text-sm text-red-500">{state.blockedReason}</p>
        ) : null}
        {message ? (
          <p className={`mt-2 text-sm ${message.includes("saved") || message.includes("cleared") ? "text-emerald-500" : "text-red-500"}`}>
            {message}
          </p>
        ) : null}
      </div>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Group Standings Ties</h2>
          <p className="text-sm text-muted-foreground">
            Final fallback ties inside a group after wins, Avg PD, Avg PF, and head-to-head.
          </p>
        </div>

        {state.groupStandingTies.length === 0 ? (
          <p className="rounded-xl border border-border p-4 text-sm text-muted-foreground">
            No active group standings fallback ties for this category.
          </p>
        ) : (
          state.groupStandingTies.map((tie) => (
            <div key={tie.tieKey} className="rounded-xl border border-border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold text-foreground">
                    Group {tie.groupName}
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Wins {tie.wins} · Avg PD {formatAverageMetric(tie.avgPD)} · Avg PF{" "}
                    {formatAverageMetric(tie.avgPF)}
                  </p>
                </div>
                <TieSourceBadge source={tie.source} />
              </div>

              <div className="mt-4 space-y-2">
                {tie.teams.map((team, index) => (
                  <div
                    key={team.teamId}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/20 px-3 py-2"
                  >
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        #{index + 1} {team.teamName}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={state.isBlocked || pending || index === 0}
                        onClick={() =>
                          setState((current) => ({
                            ...current,
                            groupStandingTies: reorderTie(
                              current.groupStandingTies,
                              tie.tieKey,
                              -1,
                              team.teamId
                            ),
                          }))
                        }
                      >
                        Move Up
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={state.isBlocked || pending || index === tie.teams.length - 1}
                        onClick={() =>
                          setState((current) => ({
                            ...current,
                            groupStandingTies: reorderTie(
                              current.groupStandingTies,
                              tie.tieKey,
                              1,
                              team.teamId
                            ),
                          }))
                        }
                      >
                        Move Down
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-4">
                <TieCardActions
                  disabled={state.isBlocked}
                  pending={pending}
                  canClear={tie.source === "manual"}
                  onSave={() => runSave(tie)}
                  onClear={() => runClear(tie)}
                />
              </div>
            </div>
          ))
        )}
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Global Ranking Ties</h2>
          <p className="text-sm text-muted-foreground">
            Final fallback ties in global ranking after group rank and Avg PD.
          </p>
        </div>

        {state.globalRankingTies.length === 0 ? (
          <p className="rounded-xl border border-border p-4 text-sm text-muted-foreground">
            No active global ranking fallback ties for this category.
          </p>
        ) : (
          state.globalRankingTies.map((tie) => (
            <div key={tie.tieKey} className="rounded-xl border border-border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold text-foreground">
                    Global Ranking · Group Rank #{tie.groupRank}
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Avg PD {formatAverageMetric(tie.avgPD)}
                  </p>
                </div>
                <TieSourceBadge source={tie.source} />
              </div>

              <div className="mt-4 space-y-2">
                {tie.teams.map((team, index) => (
                  <div
                    key={team.teamId}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/20 px-3 py-2"
                  >
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        #{index + 1} {team.teamName}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Group {team.groupName}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={state.isBlocked || pending || index === 0}
                        onClick={() =>
                          setState((current) => ({
                            ...current,
                            globalRankingTies: reorderTie(
                              current.globalRankingTies,
                              tie.tieKey,
                              -1,
                              team.teamId
                            ),
                          }))
                        }
                      >
                        Move Up
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={state.isBlocked || pending || index === tie.teams.length - 1}
                        onClick={() =>
                          setState((current) => ({
                            ...current,
                            globalRankingTies: reorderTie(
                              current.globalRankingTies,
                              tie.tieKey,
                              1,
                              team.teamId
                            ),
                          }))
                        }
                      >
                        Move Down
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-4">
                <TieCardActions
                  disabled={state.isBlocked}
                  pending={pending}
                  canClear={tie.source === "manual"}
                  onSave={() => runSave(tie)}
                  onClear={() => runClear(tie)}
                />
              </div>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
