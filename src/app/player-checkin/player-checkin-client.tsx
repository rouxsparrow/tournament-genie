"use client";

import { useMemo, useState, useTransition } from "react";
import { Check, RotateCcw, Search, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { setPlayerCheckIn } from "@/app/player-checkin/actions";

type PlayerCheckinItem = {
  id: string;
  name: string;
  gender: "MALE" | "FEMALE";
  checkedIn: boolean;
};

export function PlayerCheckinClient({
  initialPlayers,
}: {
  initialPlayers: PlayerCheckinItem[];
}) {
  const [players, setPlayers] = useState(initialPlayers);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string>("");
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const checkedInCount = useMemo(
    () => players.filter((player) => player.checkedIn).length,
    [players]
  );

  const selectedPlayer = useMemo(
    () => players.find((player) => player.id === selectedPlayerId) ?? null,
    [players, selectedPlayerId]
  );

  const filteredPlayers = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return players;
    return players.filter((player) => player.name.toLowerCase().includes(needle));
  }, [players, query]);

  const toggleSelectedPlayerCheckIn = () => {
    if (!selectedPlayer) return;
    const nextCheckedIn = !selectedPlayer.checkedIn;
    const previousCheckedIn = selectedPlayer.checkedIn;
    setError(null);

    setPlayers((prev) =>
      prev.map((player) =>
        player.id === selectedPlayer.id
          ? { ...player, checkedIn: nextCheckedIn }
          : player
      )
    );

    startTransition(async () => {
      const result = await setPlayerCheckIn(selectedPlayer.id, nextCheckedIn);
      if (!result || "error" in result) {
        setPlayers((prev) =>
          prev.map((player) =>
            player.id === selectedPlayer.id
              ? { ...player, checkedIn: previousCheckedIn }
              : player
          )
        );
        setError(result?.error ?? "Failed to update player check-in.");
      }
    });
  };

  return (
    <div className="mt-6 space-y-4">
      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-center">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="h-10 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm focus:border-ring focus:outline-none"
            placeholder="Search player name"
          />
        </label>
        <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
          <span className="font-semibold text-foreground">{checkedInCount}</span>
          <span className="text-muted-foreground"> / {players.length} checked in</span>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {filteredPlayers.length === 0 ? (
          <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
            No players found.
          </div>
        ) : (
          filteredPlayers.map((player) => {
            const isSelected = selectedPlayerId === player.id;
            const selectPlayer = () => {
              setError(null);
              setSelectedPlayerId(player.id);
            };
            return (
              <div
                key={player.id}
                role="button"
                tabIndex={0}
                aria-pressed={isSelected}
                onClick={selectPlayer}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    selectPlayer();
                    return;
                  }
                  if (event.key === " ") {
                    event.preventDefault();
                    selectPlayer();
                  }
                }}
                className={`rounded-xl border p-4 text-left outline-none transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                  isSelected
                    ? "border-lime-400 bg-lime-500/10 ring-1 ring-lime-400/30"
                    : "border-border bg-muted/20 hover:bg-muted/40 focus-visible:bg-muted/40"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-foreground">{player.name}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{player.gender}</div>
                  </div>
                  {player.checkedIn ? (
                    <Badge className="border-emerald-600 bg-emerald-600 text-white">
                      Checked in
                    </Badge>
                  ) : (
                    <Badge className="border-red-600 bg-red-600 text-white">Pending</Badge>
                  )}
                </div>

                {isSelected ? (
                  <div className="mt-4">
                    <Button
                      type="button"
                      size="sm"
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleSelectedPlayerCheckIn();
                      }}
                      disabled={pending}
                      className={
                        player.checkedIn
                          ? "bg-amber-600 text-white hover:bg-amber-700"
                          : "bg-emerald-600 text-white hover:bg-emerald-700"
                      }
                    >
                      {player.checkedIn ? (
                        <>
                          <RotateCcw className="mr-1 h-3.5 w-3.5" />
                          Undo check-in
                        </>
                      ) : (
                        <>
                          <Check className="mr-1 h-3.5 w-3.5" />
                          Confirm check-in
                        </>
                      )}
                    </Button>
                  </div>
                ) : (
                  <div className="mt-4 text-xs text-muted-foreground">
                    <UserCheck className="mr-1 inline h-3.5 w-3.5" />
                    Select card to update check-in
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
