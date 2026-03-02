import Link from "next/link";
import { prisma } from "@/lib/prisma";
import {
  assignTeamToGroup,
  clearGroupStageMatchesFromGroups,
  createGroupsManual,
  deleteAllGroupsByCategory,
  deleteGroup,
  generateGroupStageMatchesFromGroups,
  lockGroupAssignment,
  randomizeGroups,
  unlockGroupAssignment,
  unassignTeam,
} from "@/app/groups/actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { GlobalFormPendingBridge } from "@/components/global-form-pending-bridge";
import { DismissibleMessageCard } from "@/components/dismissible-message-card";

export const dynamic = "force-dynamic";
export const metadata = { title: "Groups" };

type GroupsPageProps = {
  searchParams?: Promise<{
    category?: string;
    error?: string;
    notice?: string;
    noticeType?: "success" | "error";
  }>;
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

function renderTeamLabelWithPlusWrap(label: string) {
  const parts = label.split(" + ");
  if (parts.length <= 1) return label;
  return parts.map((part, index) => (
    <span key={`${part}-${index}`}>
      <span className="whitespace-nowrap">{part}</span>
      {index < parts.length - 1 ? (
        <>
          {" + "}
          <wbr />
        </>
      ) : null}
    </span>
  ));
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
  const noticeMessage = resolvedSearchParams?.notice
    ? decodeURIComponent(resolvedSearchParams.notice)
    : null;
  const noticeType =
    resolvedSearchParams?.noticeType === "error" ? "error" : "success";

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
                  flags: true,
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
          flags: true,
        },
      })
    : [];

  const assignedTeamIds = new Set(
    groups.flatMap((group) => group.teams.map((entry) => entry.teamId))
  );
  const assignedTeamsCount = assignedTeamIds.size;

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
            <GlobalFormPendingBridge />
            <input type="hidden" name="category" value={selectedCategory} />
            <Button size="sm" type="submit" disabled={isAssignmentLocked}>
              Lock group assignment
            </Button>
          </form>
          <form action={unlockGroupAssignment}>
            <GlobalFormPendingBridge />
            <input type="hidden" name="category" value={selectedCategory} />
            <Button size="sm" type="submit" variant="outline" disabled={!isAssignmentLocked}>
              Unlock
            </Button>
          </form>
          <form action={generateGroupStageMatchesFromGroups}>
            <GlobalFormPendingBridge />
            <input type="hidden" name="category" value={selectedCategory} />
            <Button size="sm" type="submit" disabled={!isAssignmentLocked}>
              Generate matches
            </Button>
          </form>
          <form action={clearGroupStageMatchesFromGroups}>
            <GlobalFormPendingBridge />
            <input type="hidden" name="category" value={selectedCategory} />
            <Button size="sm" type="submit" variant="destructive">
              Clear matches
            </Button>
          </form>
        </div>
      </div>

      {noticeMessage ? (
        <div className="mt-4">
          <DismissibleMessageCard
            key={selectedCategory}
            message={noticeMessage}
            variant={noticeType}
          />
        </div>
      ) : null}

      <div className="mt-6 space-y-6">
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-xl border border-border p-4">
            <h2 className="text-base font-semibold text-foreground">
              Create groups
            </h2>
            <form action={createGroupsManual} className="mt-3 flex flex-wrap items-end gap-3">
              <GlobalFormPendingBridge />
              <input type="hidden" name="category" value={selectedCategory} />
              <div>
                <label
                  htmlFor="groupCount"
                  className="text-xs font-medium text-muted-foreground"
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
                  className="mt-1 w-24 rounded-md border border-input px-2 py-1.5 text-sm focus:border-ring focus:outline-none"
                  required
                  disabled={isAssignmentLocked}
                />
              </div>
              <Button size="sm" type="submit" disabled={isAssignmentLocked}>
                Create groups
              </Button>
            </form>
          </div>

          <div className="rounded-xl border border-border p-4">
            <h2 className="text-base font-semibold text-foreground">
              Randomize groups
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Uses group seeds only for group placement. Knockout seeding is
              unaffected.
            </p>
            <form action={randomizeGroups} className="mt-3">
              <GlobalFormPendingBridge />
              <input type="hidden" name="category" value={selectedCategory} />
              <Button
                type="submit"
                size="sm"
                variant="outline"
                disabled={isAssignmentLocked}
              >
                Randomize groups
              </Button>
            </form>
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-xl border border-border p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-foreground">Groups</h2>
              <div className="flex items-center gap-3">
                <form action={deleteAllGroupsByCategory}>
                  <GlobalFormPendingBridge />
                  <input type="hidden" name="category" value={selectedCategory} />
                  <Button
                    variant="destructive"
                    size="sm"
                    type="submit"
                    disabled={isAssignmentLocked || groups.length === 0}
                  >
                    Delete all groups
                  </Button>
                </form>
                <span className="text-sm text-muted-foreground">
                  {groups.length} total
                </span>
              </div>
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
                      <GlobalFormPendingBridge />
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
                  Unassigned teams ({unassignedTeams.length})
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
                        className={`rounded-md border p-3 ${
                          team.flags?.isGroupSeed
                            ? "border-amber-300 bg-amber-50/40 dark:border-amber-500/40 dark:bg-amber-500/10"
                            : "border-border"
                        }`}
                      >
                        <GlobalFormPendingBridge />
                        <input type="hidden" name="teamId" value={team.id} />
                        <div className="min-w-0 flex flex-col items-start">
                          <p className="min-w-0 text-sm font-medium text-foreground">
                            {renderTeamLabelWithPlusWrap(teamLabel(team))}
                          </p>
                          {team.flags?.isGroupSeed ? (
                            <Badge
                              variant="outline"
                              className="mt-1 whitespace-nowrap border-amber-400 text-amber-700 dark:text-amber-300"
                            >
                              Group Seed
                            </Badge>
                          ) : null}
                        </div>
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
                  Assigned teams ({assignedTeamsCount})
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
                                className={`flex items-center justify-between rounded-md border px-3 py-2 ${
                                  entry.team.flags?.isGroupSeed
                                    ? "border-amber-300 bg-amber-50/40 dark:border-amber-500/40 dark:bg-amber-500/10"
                                    : "border-border"
                                }`}
                              >
                                <div className="min-w-0 flex flex-col items-start">
                                  <p className="text-sm text-foreground">
                                    {renderTeamLabelWithPlusWrap(
                                      teamLabel(entry.team)
                                    )}
                                  </p>
                                  {entry.team.flags?.isGroupSeed ? (
                                    <Badge
                                      variant="outline"
                                      className="mt-1 whitespace-nowrap border-amber-400 text-amber-700 dark:text-amber-300"
                                    >
                                      Group Seed
                                    </Badge>
                                  ) : null}
                                </div>
                                <form
                                  action={unassignTeam.bind(
                                    null,
                                    entry.teamId
                                  )}
                                >
                                  <GlobalFormPendingBridge />
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
      </div>
    </section>
  );
}
