"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { buildRandomizedGroups } from "@/lib/group-randomizer";
import { requireAdmin } from "@/lib/auth";
import {
  clearGroupStageMatchesForCategory,
  generateGroupStageMatchesForCategory,
} from "@/lib/match-management";

const categorySchema = z.enum(["MD", "WD", "XD"]);

const createGroupsSchema = z.object({
  category: categorySchema,
  groupCount: z
    .string()
    .transform((value) => Number.parseInt(value, 10))
    .refine((value) => Number.isFinite(value) && value >= 1 && value <= 32, {
      message: "Group count must be between 1 and 32.",
    }),
});

const assignSchema = z.object({
  teamId: z.string().min(1, "Team is required."),
  groupId: z.string().min(1, "Group is required."),
});

async function assertAssignmentUnlocked(category: "MD" | "WD" | "XD") {
  const lock = await prisma.groupAssignmentLock.findUnique({
    where: { categoryCode: category },
  });
  if (lock?.locked) {
    redirect(
      `/groups?category=${category}&error=${encodeURIComponent(
        "Group assignment is locked for this category."
      )}`
    );
  }
}

function categoryName(code: "MD" | "WD" | "XD") {
  if (code === "MD") return "Men's Doubles";
  if (code === "WD") return "Women's Doubles";
  return "Mixed Doubles";
}

function buildGroupsRedirect(
  category: "MD" | "WD" | "XD",
  options?: { notice?: string; noticeType?: "success" | "error"; error?: string }
) {
  const params = new URLSearchParams();
  params.set("category", category);
  if (options?.notice) params.set("notice", options.notice);
  if (options?.noticeType) params.set("noticeType", options.noticeType);
  if (options?.error) params.set("error", options.error);
  return `/groups?${params.toString()}`;
}

export async function createGroupsManual(formData: FormData) {
  await requireAdmin({ onFail: "redirect" });
  const parsed = createGroupsSchema.safeParse({
    category: formData.get("category"),
    groupCount: formData.get("groupCount"),
  });

  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid group data.";
    redirect(`/groups?error=${encodeURIComponent(message)}`);
  }

  await assertAssignmentUnlocked(parsed.data.category);

  const category = await prisma.category.upsert({
    where: { code: parsed.data.category },
    update: {},
    create: {
      code: parsed.data.category,
      name: categoryName(parsed.data.category),
    },
  });

  const existingGroups = await prisma.group.count({
    where: { categoryId: category.id },
  });

  if (existingGroups > 0) {
    redirect(
      `/groups?category=${parsed.data.category}&error=${encodeURIComponent(
        "Groups already exist for this category."
      )}`
    );
  }

  const names =
    parsed.data.groupCount <= 26
      ? Array.from({ length: parsed.data.groupCount }, (_, index) =>
          String.fromCharCode(65 + index)
        )
      : Array.from({ length: parsed.data.groupCount }, (_, index) => `Group ${index + 1}`);

  await prisma.group.createMany({
    data: names.map((name) => ({ name, categoryId: category.id })),
  });

  revalidatePath("/groups");
  redirect(`/groups?category=${parsed.data.category}`);
}

export async function deleteGroup(groupId: string) {
  await requireAdmin({ onFail: "redirect" });
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    include: { category: true },
  });
  if (!group) {
    redirect(`/groups?error=${encodeURIComponent("Group not found.")}`);
  }

  await assertAssignmentUnlocked(group.category.code);

  await prisma.group.delete({
    where: { id: groupId },
  });

  revalidatePath("/groups");
}

export async function assignTeamToGroup(formData: FormData) {
  await requireAdmin({ onFail: "redirect" });
  const parsed = assignSchema.safeParse({
    teamId: formData.get("teamId"),
    groupId: formData.get("groupId"),
  });

  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid assignment.";
    redirect(`/groups?error=${encodeURIComponent(message)}`);
  }

  const team = await prisma.team.findUnique({
    where: { id: parsed.data.teamId },
    include: { category: true },
  });
  const group = await prisma.group.findUnique({
    where: { id: parsed.data.groupId },
    include: { category: true },
  });

  if (!team || !group) {
    redirect(`/groups?error=${encodeURIComponent("Team or group not found.")}`);
  }

  if (team.categoryId !== group.categoryId) {
    redirect(
      `/groups?category=${group.category.code}&error=${encodeURIComponent(
        "Team category does not match the group."
      )}`
    );
  }

  await assertAssignmentUnlocked(group.category.code);

  const existing = await prisma.groupTeam.findUnique({
    where: { teamId: team.id },
  });

  if (existing) {
    redirect(
      `/groups?category=${group.category.code}&error=${encodeURIComponent(
        "Team is already assigned to a group."
      )}`
    );
  }

  await prisma.groupTeam.create({
    data: {
      teamId: team.id,
      groupId: group.id,
    },
  });

  revalidatePath("/groups");
  redirect(`/groups?category=${group.category.code}`);
}

export async function unassignTeam(teamId: string) {
  await requireAdmin({ onFail: "redirect" });
  const groupTeam = await prisma.groupTeam.findUnique({
    where: { teamId },
    include: { group: { include: { category: true } } },
  });

  if (!groupTeam) {
    redirect(`/groups?error=${encodeURIComponent("Assignment not found.")}`);
  }

  await assertAssignmentUnlocked(groupTeam.group.category.code);

  await prisma.groupTeam.delete({
    where: { teamId },
  });

  revalidatePath("/groups");
}

export async function randomizeGroups(formData: FormData) {
  await requireAdmin({ onFail: "redirect" });
  const parsed = categorySchema.safeParse(formData.get("category"));

  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid category.";
    redirect(`/groups?error=${encodeURIComponent(message)}`);
  }

  await assertAssignmentUnlocked(parsed.data);

  const category = await prisma.category.findUnique({
    where: { code: parsed.data },
  });

  if (!category) {
    redirect(`/groups?category=${parsed.data}&error=${encodeURIComponent("No groups found.")}`);
  }

  const groups = await prisma.group.findMany({
    where: { categoryId: category.id },
    orderBy: { name: "asc" },
  });

  if (groups.length === 0) {
    redirect(`/groups?category=${parsed.data}&error=${encodeURIComponent("Create groups first.")}`);
  }

  const teams = await prisma.team.findMany({
    where: { categoryId: category.id },
    include: { flags: true },
  });

  if (teams.length === 0) {
    redirect(`/groups?category=${parsed.data}&error=${encodeURIComponent("No teams found.")}`);
  }

  await prisma.groupTeam.deleteMany({
    where: {
      groupId: { in: groups.map((group) => group.id) },
    },
  });

  const seedTeamIds = teams
    .filter((team) => team.flags?.isGroupSeed)
    .map((team) => team.id);
  const nonSeedTeamIds = teams
    .filter((team) => !team.flags?.isGroupSeed)
    .map((team) => team.id);

  const buckets = buildRandomizedGroups({
    groupIds: groups.map((group) => group.id),
    seedTeamIds,
    nonSeedTeamIds,
  });

  await prisma.groupTeam.createMany({
    data: buckets.flatMap((bucket) =>
      bucket.teamIds.map((teamId) => ({ groupId: bucket.id, teamId }))
    ),
  });

  revalidatePath("/groups");
  redirect(`/groups?category=${parsed.data}`);
}

export async function lockGroupAssignment(formData: FormData) {
  await requireAdmin({ onFail: "redirect" });
  const parsed = categorySchema.safeParse(formData.get("category"));
  if (!parsed.success) {
    redirect(`/groups?error=${encodeURIComponent("Invalid category.")}`);
  }

  await prisma.groupAssignmentLock.upsert({
    where: { categoryCode: parsed.data },
    update: { locked: true, lockedAt: new Date() },
    create: { categoryCode: parsed.data, locked: true, lockedAt: new Date() },
  });

  revalidatePath("/groups");
  redirect(`/groups?category=${parsed.data}`);
}

export async function unlockGroupAssignment(formData: FormData) {
  await requireAdmin({ onFail: "redirect" });
  const parsed = categorySchema.safeParse(formData.get("category"));
  if (!parsed.success) {
    redirect(`/groups?error=${encodeURIComponent("Invalid category.")}`);
  }

  await prisma.groupAssignmentLock.upsert({
    where: { categoryCode: parsed.data },
    update: { locked: false, lockedAt: null },
    create: { categoryCode: parsed.data, locked: false, lockedAt: null },
  });

  revalidatePath("/groups");
  redirect(`/groups?category=${parsed.data}`);
}

export async function generateGroupStageMatchesFromGroups(formData: FormData) {
  await requireAdmin({ onFail: "redirect" });
  const parsed = categorySchema.safeParse(formData.get("category"));
  if (!parsed.success) {
    redirect(`/groups?error=${encodeURIComponent("Invalid category.")}`);
  }

  const categoryCode = parsed.data;

  const lock = await prisma.groupAssignmentLock.findUnique({
    where: { categoryCode },
    select: { locked: true },
  });
  if (!lock?.locked) {
    redirect(
      buildGroupsRedirect(categoryCode, {
        notice: "Lock group assignment before generating matches.",
        noticeType: "error",
      })
    );
  }

  let result: { createdCount: number };
  try {
    result = await generateGroupStageMatchesForCategory(categoryCode);
  } catch (error) {
    redirect(
      buildGroupsRedirect(categoryCode, {
        notice: (error as Error).message || "Unable to generate matches.",
        noticeType: "error",
      })
    );
  }

  revalidatePath("/groups");
  revalidatePath("/matches");
  revalidatePath("/standings");
  revalidatePath("/schedule-overview");
  redirect(
    buildGroupsRedirect(categoryCode, {
      notice: `Generated ${result.createdCount} group-stage matches.`,
      noticeType: "success",
    })
  );
}

export async function clearGroupStageMatchesFromGroups(formData: FormData) {
  await requireAdmin({ onFail: "redirect" });
  const parsed = categorySchema.safeParse(formData.get("category"));
  if (!parsed.success) {
    redirect(`/groups?error=${encodeURIComponent("Invalid category.")}`);
  }

  const categoryCode = parsed.data;

  let result: { deletedCount: number };
  try {
    result = await clearGroupStageMatchesForCategory(categoryCode);
  } catch (error) {
    redirect(
      buildGroupsRedirect(categoryCode, {
        notice: (error as Error).message || "Unable to clear matches.",
        noticeType: "error",
      })
    );
  }

  revalidatePath("/groups");
  revalidatePath("/matches");
  revalidatePath("/standings");
  revalidatePath("/schedule-overview");
  redirect(
    buildGroupsRedirect(categoryCode, {
      notice: `Cleared ${result.deletedCount} group-stage matches.`,
      noticeType: "success",
    })
  );
}
