"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Heart, HeartOff } from "lucide-react";

type PlayerItem = {
  id: string;
  name: string;
};

type FavouritePlayerClientProps = {
  players: PlayerItem[];
  initialFavouriteId: string | null;
};

const selectedRowClass =
  "border-primary/50 bg-primary/5 ring-2 ring-primary/20 dark:border-primary/60 dark:bg-primary/10";

export function FavouritePlayerClient({
  players,
  initialFavouriteId,
}: FavouritePlayerClientProps) {
  const router = useRouter();

  const safeInitialFavouriteId = useMemo(
    () => (players.some((player) => player.id === initialFavouriteId) ? initialFavouriteId : null),
    [initialFavouriteId, players]
  );

  const [search, setSearch] = useState("");
  const [favouriteId, setFavouriteId] = useState<string | null>(safeInitialFavouriteId);
  const [selectedId, setSelectedId] = useState<string | null>(safeInitialFavouriteId);
  const [isEditorOpen, setIsEditorOpen] = useState(!safeInitialFavouriteId);
  const [isSaving, setIsSaving] = useState(false);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return players;
    return players.filter((player) => player.name.toLowerCase().includes(term));
  }, [players, search]);

  const hasFavourite = Boolean(favouriteId);

  async function persistFavourite(playerId: string | null) {
    setIsSaving(true);

    try {
      const response = await fetch("/api/favourite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId }),
      });
      if (!response.ok) {
        throw new Error("save failed");
      }
      setFavouriteId(playerId);
      setSelectedId(playerId);
      setIsEditorOpen(!playerId);
      router.refresh();
    } catch {
      // Keep UI unchanged on save failure.
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      {hasFavourite && !isEditorOpen ? (
        <div className="flex items-center justify-center gap-2">
          <Button type="button" variant="outline" onClick={() => setIsEditorOpen(true)}>
            Change favourite player
          </Button>
        </div>
      ) : (
        <>
          <div>
            <label
              htmlFor="player-search"
              className="text-xs font-medium text-muted-foreground"
            >
              Search Player
            </label>
            <input
              id="player-search"
              name="playerSearch"
              autoComplete="off"
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              placeholder="Type a player name…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        </>
      )}

      {isEditorOpen ? (
        <div role="radiogroup" aria-label="Favourite player selection" className="space-y-2">
          {filtered.map((player) => {
            const isSelected = selectedId === player.id;
            const isCurrentFavourite = favouriteId === player.id;

            return (
              <div
                key={player.id}
                role="radio"
                aria-checked={isSelected}
                tabIndex={0}
                onClick={() => setSelectedId(player.id)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  setSelectedId(player.id);
                }}
                className={`flex w-full items-center justify-between rounded-lg border border-border bg-card px-4 py-3 text-left transition-colors hover:bg-accent focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] ${isSelected ? selectedRowClass : ""}`}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    aria-hidden="true"
                    className={`size-4 shrink-0 rounded-full border ${isSelected ? "border-primary bg-primary" : "border-muted-foreground/40 bg-transparent"}`}
                  />
                  <span className="truncate text-sm font-medium text-foreground">
                    {player.name}
                  </span>
                </div>
                <div className="ml-3 flex items-center gap-2">
                  {isCurrentFavourite ? (
                    <span className="text-xs font-medium text-muted-foreground">
                      Current Favourite
                    </span>
                  ) : null}
                  {isSelected ? (
                    <Button
                      type="button"
                      size="icon"
                      variant={isCurrentFavourite ? "outline" : "default"}
                      disabled={isSaving}
                      aria-label={
                        isCurrentFavourite
                          ? `Remove ${player.name} from favourite`
                          : `Set ${player.name} as favourite`
                      }
                      onClick={(event) => {
                        event.stopPropagation();
                        void persistFavourite(isCurrentFavourite ? null : player.id);
                      }}
                    >
                      {isCurrentFavourite ? (
                        <HeartOff className="size-4" aria-hidden="true" />
                      ) : (
                        <Heart className="size-4" aria-hidden="true" />
                      )}
                    </Button>
                  ) : null}
                </div>
              </div>
            );
          })}
          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground">No players found.</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
