"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

type PlayerItem = {
  id: string;
  name: string;
};

type FavouritePlayerClientProps = {
  players: PlayerItem[];
  initialFavouriteId: string | null;
};

const highlightClass = "text-[greenyellow]";

export function FavouritePlayerClient({
  players,
  initialFavouriteId,
}: FavouritePlayerClientProps) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [favouriteId, setFavouriteId] = useState<string | null>(initialFavouriteId);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return players;
    return players.filter((player) => player.name.toLowerCase().includes(term));
  }, [players, search]);

  async function setFavourite(playerId: string | null) {
    setError(null);
    try {
      await fetch("/api/favourite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId }),
      });
      setFavouriteId(playerId);
      router.refresh();
    } catch (err) {
      setError("Unable to save favourite player.");
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <label className="text-xs font-medium text-muted-foreground">
          Search player
        </label>
        <input
          className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          placeholder="Type a player name..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="space-y-2">
        {filtered.map((player) => {
          const isFavourite = favouriteId === player.id;
          return (
            <div
              key={player.id}
              className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3"
            >
              <div className="text-sm font-medium text-foreground">
                <span className={isFavourite ? highlightClass : ""}>
                  {player.name}
                </span>
                {isFavourite ? (
                  <span className="ml-2 text-xs text-muted-foreground">
                    (Favourite)
                  </span>
                ) : null}
              </div>
              <Button
                size="sm"
                variant={isFavourite ? "outline" : "default"}
                onClick={() => setFavourite(isFavourite ? null : player.id)}
              >
                {isFavourite ? "Unfavourite" : "Favourite"}
              </Button>
            </div>
          );
        })}
        {filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground">No players found.</p>
        ) : null}
      </div>
    </div>
  );
}
