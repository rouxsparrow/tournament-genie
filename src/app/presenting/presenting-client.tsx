"use client";

import { Badge } from "@/components/ui/badge";
import { getPresentingState } from "@/app/schedule/actions";

type ScheduleState = Awaited<ReturnType<typeof getPresentingState>>;

type ScheduleStage = "GROUP" | "KNOCKOUT";

const COURT_LABELS: Record<string, string> = {
  C1: "P5",
  C2: "P6",
  C3: "P7",
  C4: "P8",
  C5: "P9",
};

function courtLabel(courtId: string) {
  return COURT_LABELS[courtId] ?? courtId;
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
            {match ? <span className="text-[yellowgreen]">{match}</span> : null}
          </span>
        );
      })}
    </>
  );
}

function trimSeriesLabel(label: string) {
  return label.replace(/^Series\s+/i, "").trim();
}

function stripMatchNumber(detail: string) {
  return detail
    .split("•")
    .map((part) => part.trim())
    .filter((part) => !/^Match\s+\d+/i.test(part))
    .join(" • ");
}

function formatMetaLine(match: ScheduleState["upcomingMatches"][number]) {
  if (match.matchType === "KNOCKOUT") {
    const series = trimSeriesLabel(match.label);
    const round = stripMatchNumber(match.detail);
    return `${match.categoryCode} • ${series} • ${round}`;
  }
  return `${match.categoryCode} • ${match.detail}`;
}

function formatPlayingMeta(
  playing: NonNullable<ScheduleState["courts"][number]["playing"]>
) {
  if (playing.matchType === "KNOCKOUT") {
    const detail = stripMatchNumber(playing.detail);
    return `${playing.categoryCode} • ${detail}`;
  }
  return `${playing.categoryCode} • ${playing.detail}`;
}

export function PresentingClient({
  state,
  favouritePlayerName,
}: {
  state: ScheduleState;
  favouritePlayerName: string | null;
}) {
  const stage = state.stage as ScheduleStage;

  const upcoming = state.upcomingMatches;

  return (
    <div className="space-y-6">
      {stage === "KNOCKOUT" && state.matchPoolCount === 0 ? (
        <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          No knockout matches available. Generate brackets first.
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-12">
        <section className="rounded-xl border border-border bg-card p-4 lg:col-span-8">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-foreground">Playing</h2>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {state.courts.map((court) => {
              const playing = court.playing;
              return (
                <div
                  key={court.id}
                  className="rounded-xl border border-border bg-card p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="text-lg font-semibold text-foreground">
                        {courtLabel(court.id)}
                      </h3>
                    </div>
                  </div>

                  <div className="mt-4 rounded-lg border border-border bg-muted/40 p-3 text-sm">
                    {playing ? (
                      <div className="space-y-2">
                        <div className="text-xs text-muted-foreground">
                          {formatPlayingMeta(playing)}
                        </div>
                        <div className="text-sm text-foreground">
                          {highlightName(
                            playing.homeTeam?.name ?? "TBD",
                            favouritePlayerName
                          )}{" "}
                          Vs.
                          <br />
                          {highlightName(
                            playing.awayTeam?.name ?? "TBD",
                            favouritePlayerName
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground">No match assigned.</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-4 lg:col-span-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-foreground">Upcoming</h2>
          </div>
          <div className="mt-4 space-y-3">
            {upcoming.length === 0 ? (
              <div className="text-sm text-muted-foreground">No upcoming matches.</div>
            ) : null}
            {upcoming.map((match) => (
              <div
                key={match.key}
                className="rounded-lg border border-border bg-muted/40 p-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="text-xs text-muted-foreground">
                      {formatMetaLine(match)}
                    </div>
                  </div>
                  {match.isForced ? (
                    <Badge variant="outline" className="border-red-600 text-red-600">
                      Forced
                    </Badge>
                  ) : null}
                </div>
                <div className="mt-2 text-sm text-foreground">
                  {highlightName(match.teams.homeName, favouritePlayerName)} Vs.
                  <br />
                  {highlightName(match.teams.awayName, favouritePlayerName)}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
