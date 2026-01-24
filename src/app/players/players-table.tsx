"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { deletePlayer } from "@/app/players/actions";
import { GlobalFormPendingBridge } from "@/components/global-form-pending-bridge";

type Player = {
  id: string;
  name: string;
  gender: string;
};

type PlayersTableProps = {
  players: Player[];
};

export function PlayersTable({ players }: PlayersTableProps) {
  const [query, setQuery] = useState("");

  const filteredPlayers = useMemo(() => {
    const value = query.trim().toLowerCase();
    if (!value) return players;
    return players.filter((player) =>
      player.name.toLowerCase().includes(value)
    );
  }, [players, query]);

  return (
    <>
      <div className="mt-4">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="h-9 w-80 rounded-md border border-input px-3 text-sm focus:border-ring focus:outline-none"
          placeholder="Search players"
        />
      </div>
      <div className="mt-6 overflow-hidden rounded-xl border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Gender</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredPlayers.length === 0 ? (
              <tr>
                <td className="px-4 py-6 text-muted-foreground" colSpan={3}>
                  No players found.
                </td>
              </tr>
            ) : (
              filteredPlayers.map((player) => (
                <tr key={player.id} className="border-t border-border">
                  <td className="px-4 py-4 font-medium text-foreground">
                    {player.name}
                  </td>
                  <td className="px-4 py-4 text-muted-foreground">
                    {player.gender}
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex justify-end gap-2">
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/players/${player.id}/edit`}>Edit</Link>
                      </Button>
                      <form action={deletePlayer.bind(null, player.id)}>
                        <GlobalFormPendingBridge />
                        <Button type="submit" variant="destructive" size="sm">
                          Delete
                        </Button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
