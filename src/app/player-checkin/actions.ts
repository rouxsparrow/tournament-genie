"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { publishBroadcastRefreshEvent } from "@/lib/supabase/broadcast-refresh-publisher";

async function refreshCheckInConsumers() {
  revalidatePath("/player-checkin");
  revalidatePath("/schedule");
  revalidatePath("/presenting");
  revalidatePath("/broadcast");
  revalidatePath("/utilities");

  await Promise.all([
    publishBroadcastRefreshEvent({
      stage: "GROUP",
      source: "player-checkin",
      reason: "view-change",
      changeType: "upcoming",
    }),
    publishBroadcastRefreshEvent({
      stage: "KNOCKOUT",
      source: "player-checkin",
      reason: "view-change",
      changeType: "upcoming",
    }),
  ]);
}

export async function setPlayerCheckIn(playerId: string, checkedIn: boolean) {
  const guard = await requireAdmin({ onFail: "return" });
  if (guard) return guard;

  const player = await prisma.player.findUnique({
    where: { id: playerId },
    select: { id: true },
  });
  if (!player) return { error: "Player not found." };

  await prisma.player.update({
    where: { id: playerId },
    data: { checkedIn },
  });

  await refreshCheckInConsumers();
  return { ok: true as const, playerId, checkedIn };
}

export async function checkInAllPlayers() {
  const guard = await requireAdmin({ onFail: "return" });
  if (guard) return guard;

  const updated = await prisma.player.updateMany({
    data: { checkedIn: true },
  });

  await refreshCheckInConsumers();
  return { ok: true as const, updatedCount: updated.count };
}

export async function uncheckInAllPlayers() {
  const guard = await requireAdmin({ onFail: "return" });
  if (guard) return guard;

  const updated = await prisma.player.updateMany({
    data: { checkedIn: false },
  });

  await refreshCheckInConsumers();
  return { ok: true as const, updatedCount: updated.count };
}
