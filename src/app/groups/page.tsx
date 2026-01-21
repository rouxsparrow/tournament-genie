import Link from "next/link";
import { prisma } from "@/lib/prisma";
import {
  assignTeamToGroup,
  createGroupsManual,
  deleteGroup,
  lockGroupAssignment,
  randomizeGroups,
  unlockGroupAssignment,
  unassignTeam,
} from "@/app/groups/actions";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

type GroupsPageProps = {
  searchParams?: Promise<{ category?: string; error?: string }>;
};

const categories = ["MD", "WD", "XD"] as const;

function teamLabel(team: {
  name: string;
  members: { player: { name: string } }[];
}) {
  if (team.name) return team.name;
  const names = team.members.map((member) => member.player.name);
  return names.length === 2 ? `${names[0]} / ${names[1]}` : "Unnamed team";
}

export default async function GroupsPage({ searchParams }: GroupsPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const selectedCategory = categories.includes(
    resolvedSearchParams?.category as (typeof categories)[number]
  )
    ? (resolvedSearchParams?.category as (typeof categories)[number])
    : "MD";
  const errorMessage = resolvedSearchParams?.error
    ? decodeURIComponent(resolvedSearchParams.error)
    : null;

  const category = await prisma.category.findUnique({
    where: { code: selectedCategory },
  });

  const assignmentLock = await prisma.groupAssignmentLock.findUnique({
    where: { categoryCode: selectedCategory },
  });
  const isAssignmentLocked = assignmentLock?.locked ?? false;

  const groups = category
    ? await prisma.group.findMany({
        where: { categoryId: category.id },
        orderBy: { name: "asc" },
        include: {
          teams: {
            include: {
              team: {
                include: {
                  members: { include: { player: true } },
                },
              },
            },
          },
        },
      })
    : [];

  const teams = category
    ? await prisma.team.findMany({
        where: { categoryId: category.id },
        orderBy: { createdAt: "desc" },
        include: {
          members: { include: { player: true } },
        },
      })
    : [];

  const assignedTeamIds = new Set(
    groups.flatMap((group) => group.teams.map((entry) => entry.teamId))
  );

  const unassignedTeams = teams.filter((team) => !assignedTeamIds.has(team.id));

  return (
    <section className="rounded-2xl border border-border bg-card p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Groups</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Create groups and assign teams per category.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {categories.map((categoryCode) => (
            <Button
              key={categoryCode}
              asChild
              variant={categoryCode === selectedCategory ? "default" : "outline"}
              size="sm"
            >
              <Link href={`/groups?category=${categoryCode}`}>
                {categoryCode}
              </Link>
            </Button>
          ))}
        </div>
      </div>

      {errorMessage ? (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {errorMessage}
        </div>
      ) : null}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-muted px-4 py-3">
        <div>
          <p className="text-sm font-medium text-foreground">
            Group assignment is {isAssignmentLocked ? "locked" : "unlocked"}.
          </p>
          <p className="text-xs text-muted-foreground">
            Locking prevents reassignment and randomization.
          </p>
        </div>
        <div className="flex gap-2">
          <form action={lockGroupAssignment}>
            <input type="hidden" name="category" value={selectedCategory} />
            <Button size="sm" type="submit" disabled={isAssignmentLocked}>
              Lock group assignment
            </Button>
          </form>
          <form action={unlockGroupAssignment}>
            <input type="hidden" name="category" value={selectedCategory} />
            <Button size="sm" type="submit" variant="outline" disabled={!isAssignmentLocked}>
              Unlock
            </Button>
          </form>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[2fr,1fr]">
        <div className="space-y-6">
          <div className="rounded-xl border border-border p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-foreground">Groups</h2>
              <span className="text-sm text-muted-foreground">
                {groups.length} total
              </span>
            </div>
            {groups.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">
                No groups yet for this category.
              </p>
            ) : (
              <ul className="mt-4 space-y-3">
                {groups.map((group) => (
                  <li
                    key={group.id}
                    className="flex items-center justify-between rounded-lg border border-border px-4 py-3"
                  >
                    <div>
                      <p className="font-medium text-foreground">
                        Group {group.name}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {group.teams.length} team
                        {group.teams.length === 1 ? "" : "s"}
                      </p>
                    </div>
                    <form action={deleteGroup.bind(null, group.id)}>
                      <Button
                        variant="destructive"
                        size="sm"
                        type="submit"
                        disabled={isAssignmentLocked}
                      >
                        Delete
                      </Button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-xl border border-border p-5">
            <h2 className="text-lg font-semibold text-foreground">
              Manual assignments
            </h2>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div className="rounded-lg border border-border p-4">
                <h3 className="text-sm font-semibold text-muted-foreground">
                  Unassigned teams
                </h3>
                {unassignedTeams.length === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    All teams are assigned.
                  </p>
                ) : (
                  <div className="mt-3 space-y-3">
                    {unassignedTeams.map((team) => (
                      <form
                        key={team.id}
                        action={assignTeamToGroup}
                        className="rounded-md border border-border p-3"
                      >
                        <input type="hidden" name="teamId" value={team.id} />
                        <p className="text-sm font-medium text-foreground">
                          {teamLabel(team)}
                        </p>
                        <div className="mt-2 flex gap-2">
                          <select
                            name="groupId"
                            className="w-full rounded-md border border-input px-3 py-2 text-sm focus:border-ring focus:outline-none"
                            defaultValue=""
                            required
                            disabled={isAssignmentLocked}
                          >
                            <option value="" disabled>
                              Select group
                            </option>
                            {groups.map((group) => (
                              <option key={group.id} value={group.id}>
                                Group {group.name}
                              </option>
                            ))}
                          </select>
                          <Button type="submit" size="sm" disabled={isAssignmentLocked}>
                            Assign
                          </Button>
                        </div>
                      </form>
                    ))}
                  </div>
                )}
              </div>
              <div className="rounded-lg border border-border p-4">
                <h3 className="text-sm font-semibold text-muted-foreground">
                  Assigned teams
                </h3>
                {groups.length === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    Create groups to assign teams.
                  </p>
                ) : (
                  <div className="mt-3 space-y-4">
                    {groups.map((group) => (
                      <div key={group.id}>
                        <p className="text-sm font-semibold text-foreground">
                          Group {group.name}
                        </p>
                        {group.teams.length === 0 ? (
                          <p className="mt-1 text-sm text-muted-foreground">
                            No teams assigned.
                          </p>
                        ) : (
                          <ul className="mt-2 space-y-2">
                            {group.teams.map((entry) => (
                              <li
                                key={entry.teamId}
                                className="flex items-center justify-between rounded-md border border-border px-3 py-2"
                              >
                                <span className="text-sm text-foreground">
                                  {teamLabel(entry.team)}
                                </span>
                                <form
                                  action={unassignTeam.bind(
                                    null,
                                    entry.teamId
                                  )}
                                >
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    type="submit"
                                    disabled={isAssignmentLocked}
                                  >
                                    Unassign
                                  </Button>
                                </form>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-xl border border-border p-5">
            <h2 className="text-lg font-semibold text-foreground">
              Create groups
            </h2>
            <form action={createGroupsManual} className="mt-4 space-y-3">
              <input type="hidden" name="category" value={selectedCategory} />
              <div>
                <label
                  htmlFor="groupCount"
                  className="text-sm font-medium text-muted-foreground"
                >
                  Number of groups
                </label>
                <input
                  id="groupCount"
                  name="groupCount"
                  type="number"
                  min={1}
                  max={32}
                  defaultValue={4}
                  className="mt-2 w-full rounded-md border border-input px-3 py-2 text-sm focus:border-ring focus:outline-none"
                  required
                  disabled={isAssignmentLocked}
                />
              </div>
              <Button type="submit" className="w-full" disabled={isAssignmentLocked}>
                Create groups
              </Button>
            </form>
          </div>

          <div className="rounded-xl border border-border p-5">
            <h2 className="text-lg font-semibold text-foreground">
              Randomize groups
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Uses group seeds only for group placement. Knockout seeding is
              unaffected.
            </p>
            <form action={randomizeGroups} className="mt-4">
              <input type="hidden" name="category" value={selectedCategory} />
              <Button
                type="submit"
                className="w-full"
                variant="outline"
                disabled={isAssignmentLocked}
              >
                Randomize groups
              </Button>
            </form>
          </div>
        </div>
      </div>
    </section>
  );
}
