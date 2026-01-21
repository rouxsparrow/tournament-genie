"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";

const playerSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(80, "Name is too long."),
  gender: z.enum(["MALE", "FEMALE"]),
});

function parsePlayer(formData: FormData) {
  return playerSchema.safeParse({
    name: formData.get("name"),
    gender: formData.get("gender"),
  });
}

export async function createPlayer(formData: FormData) {
  const result = parsePlayer(formData);

  if (!result.success) {
    const message = result.error.issues[0]?.message ?? "Invalid player data.";
    redirect(`/players/new?error=${encodeURIComponent(message)}`);
  }

  await prisma.player.create({
    data: result.data,
  });

  revalidatePath("/players");
  redirect(`/players/new?success=${encodeURIComponent("Player created.")}`);
}

export async function updatePlayer(id: string, formData: FormData) {
  const result = parsePlayer(formData);

  if (!result.success) {
    const message = result.error.issues[0]?.message ?? "Invalid player data.";
    redirect(`/players/${id}/edit?error=${encodeURIComponent(message)}`);
  }

  await prisma.player.update({
    where: { id },
    data: result.data,
  });

  revalidatePath("/players");
  redirect("/players");
}

export async function deletePlayer(id: string) {
  await prisma.player.delete({
    where: { id },
  });

  revalidatePath("/players");
}
