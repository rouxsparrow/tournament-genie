"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { deleteTeam } from "@/app/teams/actions";
import { GlobalFormPendingBridge } from "@/components/global-form-pending-bridge";

type TeamMember = {
  player: { name: string };
};

type Team = {
  id: string;
  name: string;
  category: { code: "MD" | "WD" | "XD" };
  members: TeamMember[];
  flags: { isGroupSeed: boolean } | null;
};

type TeamsTableProps = {
  teams: Team[];
};

function teamLabel(team: Team) {
  if (team.name) return team.name;
  const names = team.members.map((member) => member.player.name);
  return names.length === 2 ? `${names[0]} / ${names[1]}` : "Unnamed team";
}

export function TeamsTable({ teams }: TeamsTableProps) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<"ALL" | "MD" | "WD" | "XD">("ALL");

  const filteredTeams = useMemo(() => {
    const value = query.trim().toLowerCase();
    return teams.filter((team) => {
      const matchesCategory = category === "ALL" || team.category.code === category;
      const matchesQuery = value
        ? teamLabel(team).toLowerCase().includes(value)
        : true;
      return matchesCategory && matchesQuery;
    });
  }, [teams, query, category]);

  return (
    <>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="h-9 w-80 rounded-md border border-input px-3 text-sm focus:border-ring focus:outline-none"
          placeholder="Search teams"
        />
        <select
          value={category}
          onChange={(event) =>
            setCategory(event.target.value as "ALL" | "MD" | "WD" | "XD")
          }
          className="h-9 rounded-md border border-input px-3 text-sm focus:border-ring focus:outline-none"
        >
          <option value="ALL">All categories</option>
          <option value="MD">Men&apos;s Doubles (MD)</option>
          <option value="WD">Women&apos;s Doubles (WD)</option>
          <option value="XD">Mixed Doubles (XD)</option>
        </select>
      </div>
      <div className="mt-6 overflow-hidden rounded-xl border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Team</th>
              <th className="px-4 py-3">Category</th>
              <th className="px-4 py-3">Player 1</th>
              <th className="px-4 py-3">Player 2</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredTeams.length === 0 ? (
              <tr>
                <td className="px-4 py-6 text-muted-foreground" colSpan={5}>
                  No teams found.
                </td>
              </tr>
            ) : (
              filteredTeams.map((team) => {
                const [member1, member2] = team.members;
                const isGroupSeed = team.flags?.isGroupSeed ?? false;
                return (
                  <tr
                    key={team.id}
                    className={`border-t border-border ${
                      isGroupSeed ? "bg-amber-50/40 dark:bg-amber-500/10" : ""
                    }`}
                  >
                    <td className="px-4 py-4">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="min-w-0 flex-1 break-words font-medium text-foreground">
                          {teamLabel(team)}
                        </span>
                        {isGroupSeed ? (
                          <Badge
                            variant="outline"
                            className="shrink-0 whitespace-nowrap border-amber-400 text-amber-700 dark:text-amber-300"
                          >
                            Group Seed
                          </Badge>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-4 text-muted-foreground">
                      {team.category.code}
                    </td>
                    <td className="px-4 py-4 text-muted-foreground">
                      {member1?.player.name ?? "-"}
                    </td>
                    <td className="px-4 py-4 text-muted-foreground">
                      {member2?.player.name ?? "-"}
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex justify-end gap-2">
                        <Button asChild variant="outline" size="sm">
                          <Link href={`/teams/${team.id}/edit`}>Edit</Link>
                        </Button>
                        <form action={deleteTeam.bind(null, team.id)}>
                          <GlobalFormPendingBridge />
                          <Button type="submit" variant="destructive" size="sm">
                            Delete
                          </Button>
                        </form>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
