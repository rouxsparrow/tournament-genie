"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { createTeam } from "@/app/teams/actions";
import { Button } from "@/components/ui/button";
import { PlayerSelect } from "@/app/teams/player-select";

type Player = {
  id: string;
  name: string;
  gender: "MALE" | "FEMALE";
};

type AvailableByCategory = {
  MD: string[];
  WD: string[];
  XD: string[];
};

type TeamFormProps = {
  players: Player[];
  availableByCategory: AvailableByCategory;
  errorMessage: string | null;
  successMessage: string | null;
};

export function TeamForm({
  players,
  availableByCategory,
  errorMessage,
  successMessage,
}: TeamFormProps) {
  const [category, setCategory] = useState<"MD" | "WD" | "XD" | "">("");

  const availablePlayers = useMemo(() => {
    if (!category) return [];
    const allowedIds = new Set(availableByCategory[category]);
    const eligible = players.filter((player) => allowedIds.has(player.id));
    if (category === "MD") {
      return eligible.filter((player) => player.gender === "MALE");
    }
    if (category === "WD") {
      return eligible.filter((player) => player.gender === "FEMALE");
    }
    return eligible;
  }, [players, availableByCategory, category]);

  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-foreground">Add team</h1>
        <Button asChild variant="outline">
          <Link href="/teams">Back</Link>
        </Button>
      </div>
      <form action={createTeam} className="mt-6 space-y-4">
        {errorMessage ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {errorMessage}
          </div>
        ) : null}
        {successMessage ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {successMessage}
          </div>
        ) : null}
        <div>
          <span className="text-sm font-medium text-muted-foreground">Category</span>
          <div className="mt-2 flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="radio"
                name="category"
                value="MD"
                className="h-4 w-4"
                onChange={() => setCategory("MD")}
                required
              />
              Men&apos;s Doubles (MD)
            </label>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="radio"
                name="category"
                value="WD"
                className="h-4 w-4"
                onChange={() => setCategory("WD")}
                required
              />
              Women&apos;s Doubles (WD)
            </label>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="radio"
                name="category"
                value="XD"
                className="h-4 w-4"
                onChange={() => setCategory("XD")}
                required
              />
              Mixed Doubles (XD)
            </label>
          </div>
        </div>
        {category ? (
          <>
            <PlayerSelect
              id="player1"
              name="player1Id"
              label="Player 1"
              players={availablePlayers}
            />
            <PlayerSelect
              id="player2"
              name="player2Id"
              label="Player 2"
              players={availablePlayers}
            />
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Select a category to see available players.
          </p>
        )}
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            name="isGroupSeed"
            className="h-4 w-4 rounded border-input"
          />
          Mark as group seed
        </label>
        <div className="flex justify-end">
          <Button type="submit">Create team</Button>
        </div>
      </form>
    </>
  );
}

