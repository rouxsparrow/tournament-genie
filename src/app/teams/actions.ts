"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";

const teamSchema = z.object({
  category: z.enum(["MD", "WD", "XD"]),
  player1Id: z.string().min(1, "Player 1 is required."),
  player2Id: z.string().min(1, "Player 2 is required."),
  isGroupSeed: z.preprocess((value) => value === "on", z.boolean()),
});

function parseTeam(formData: FormData) {
  return teamSchema.safeParse({
    category: formData.get("category"),
    player1Id: formData.get("player1Id"),
    player2Id: formData.get("player2Id"),
    isGroupSeed: formData.get("isGroupSeed"),
  });
}

function categoryName(code: "MD" | "WD" | "XD") {
  if (code === "MD") return "Men's Doubles";
  if (code === "WD") return "Women's Doubles";
  return "Mixed Doubles";
}

async function validateTeamInputs(params: {
  categoryCode: "MD" | "WD" | "XD";
  player1Id: string;
  player2Id: string;
  excludeTeamId?: string;
}) {
  if (params.player1Id === params.player2Id) {
    return "Players must be different.";
  }

  const players = await prisma.player.findMany({
    where: { id: { in: [params.player1Id, params.player2Id] } },
  });

  if (players.length !== 2) {
    return "Both players must exist.";
  }

  const player1 = players.find((player) => player.id === params.player1Id);
  const player2 = players.find((player) => player.id === params.player2Id);

  if (!player1 || !player2) {
    return "Both players must exist.";
  }

  if (params.categoryCode === "MD") {
    if (player1.gender !== "MALE" || player2.gender !== "MALE") {
      return "Men's Doubles requires two male players.";
    }
  }

  if (params.categoryCode === "WD") {
    if (player1.gender !== "FEMALE" || player2.gender !== "FEMALE") {
      return "Women's Doubles requires two female players.";
    }
  }

  if (params.categoryCode === "XD") {
    const genders = [player1.gender, player2.gender];
    if (!(genders.includes("MALE") && genders.includes("FEMALE"))) {
      return "Mixed Doubles requires one male and one female player.";
    }
  }

  const category = await prisma.category.upsert({
    where: { code: params.categoryCode },
    update: {},
    create: {
      code: params.categoryCode,
      name: categoryName(params.categoryCode),
    },
  });

  const conflict = await prisma.teamMember.findFirst({
    where: {
      playerId: { in: [params.player1Id, params.player2Id] },
      team: {
        categoryId: category.id,
        ...(params.excludeTeamId ? { id: { not: params.excludeTeamId } } : {}),
      },
    },
    include: {
      team: true,
    },
  });

  if (conflict) {
    return "A player is already on another team in this category.";
  }

  return { categoryId: category.id, player1, player2 };
}

export async function createTeam(formData: FormData) {
  await requireAdmin({ onFail: "redirect" });
  const result = parseTeam(formData);

  if (!result.success) {
    const message = result.error.issues[0]?.message ?? "Invalid team data.";
    redirect(`/teams/new?error=${encodeURIComponent(message)}`);
  }

  const validation = await validateTeamInputs({
    categoryCode: result.data.category,
    player1Id: result.data.player1Id,
    player2Id: result.data.player2Id,
  });

  if (typeof validation === "string") {
    redirect(`/teams/new?error=${encodeURIComponent(validation)}`);
  }

  const teamName = `${validation.player1.name} + ${validation.player2.name}`;

  await prisma.$transaction(async (tx) => {
    const team = await tx.team.create({
      data: {
        name: teamName,
        categoryId: validation.categoryId,
      },
    });

    await tx.teamMember.createMany({
      data: [
        { teamId: team.id, playerId: result.data.player1Id },
        { teamId: team.id, playerId: result.data.player2Id },
      ],
    });

    if (result.data.isGroupSeed) {
      await tx.teamFlags.create({
        data: {
          teamId: team.id,
          isGroupSeed: true,
        },
      });
    }
  });

  revalidatePath("/teams");
  redirect(`/teams/new?success=${encodeURIComponent("Team created.")}`);
}

export async function updateTeam(teamId: string, formData: FormData) {
  await requireAdmin({ onFail: "redirect" });
  const result = parseTeam(formData);

  if (!result.success) {
    const message = result.error.issues[0]?.message ?? "Invalid team data.";
    redirect(`/teams/${teamId}/edit?error=${encodeURIComponent(message)}`);
  }

  const validation = await validateTeamInputs({
    categoryCode: result.data.category,
    player1Id: result.data.player1Id,
    player2Id: result.data.player2Id,
    excludeTeamId: teamId,
  });

  if (typeof validation === "string") {
    redirect(`/teams/${teamId}/edit?error=${encodeURIComponent(validation)}`);
  }

  const teamName = `${validation.player1.name} + ${validation.player2.name}`;

  await prisma.$transaction(async (tx) => {
    await tx.team.update({
      where: { id: teamId },
      data: {
        name: teamName,
        categoryId: validation.categoryId,
      },
    });

    await tx.teamMember.deleteMany({
      where: { teamId },
    });

    await tx.teamMember.createMany({
      data: [
        { teamId, playerId: result.data.player1Id },
        { teamId, playerId: result.data.player2Id },
      ],
    });

    await tx.teamFlags.upsert({
      where: { teamId },
      create: {
        teamId,
        isGroupSeed: result.data.isGroupSeed,
      },
      update: {
        isGroupSeed: result.data.isGroupSeed,
      },
    });
  });

  revalidatePath("/teams");
  redirect("/teams");
}

export async function deleteTeam(teamId: string) {
  await requireAdmin({ onFail: "redirect" });
  await prisma.team.delete({
    where: { id: teamId },
  });

  revalidatePath("/teams");
}

export async function toggleKnockOutSeed(teamId: string, formData: FormData) {
  await requireAdmin({ onFail: "redirect" });
  const isKnockOutSeed = formData.get("isKnockOutSeed") === "on";

  await prisma.teamFlags.upsert({
    where: { teamId },
    create: {
      teamId,
      isKnockOutSeed,
    },
    update: {
      isKnockOutSeed,
    },
  });

  revalidatePath("/teams");
}
