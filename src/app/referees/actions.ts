"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import {
  hashPassword,
  normalizeRefereeUsername,
  REFEREE_PASSWORD_MIN_LENGTH,
  revokeAllRefereeSessions,
  revokeRefereeSessions,
} from "@/lib/referee-auth";

function validatePassword(password: string) {
  if (password.length < REFEREE_PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${REFEREE_PASSWORD_MIN_LENGTH} characters.`;
  }
  return null;
}

function revalidateRefereePages() {
  revalidatePath("/referees");
  revalidatePath("/referee");
}

export async function createRefereeAccount(input: {
  username: string;
  displayName: string;
  password: string;
}) {
  const guard = await requireAdmin({ onFail: "return" });
  if (guard) return guard;

  const username = String(input.username ?? "").trim();
  const displayName = String(input.displayName ?? "").trim();
  const password = String(input.password ?? "");

  if (!username) {
    return { error: "Username is required." };
  }
  if (!displayName) {
    return { error: "Display name is required." };
  }
  const passwordError = validatePassword(password);
  if (passwordError) {
    return { error: passwordError };
  }

  const usernameNormalized = normalizeRefereeUsername(username);
  if (!usernameNormalized) {
    return { error: "Username is required." };
  }

  const passwordHash = await hashPassword(password);

  try {
    const created = await prisma.refereeAccount.create({
      data: {
        username,
        usernameNormalized,
        displayName,
        passwordHash,
      },
      select: {
        id: true,
      },
    });

    revalidateRefereePages();
    return { ok: true as const, id: created.id };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return { error: "Username already exists." };
    }

    return { error: "Failed to create referee account." };
  }
}

export async function resetRefereePassword(input: {
  refereeAccountId: string;
  newPassword: string;
}) {
  const guard = await requireAdmin({ onFail: "return" });
  if (guard) return guard;

  const refereeAccountId = String(input.refereeAccountId ?? "").trim();
  const newPassword = String(input.newPassword ?? "");

  if (!refereeAccountId) {
    return { error: "Referee account is required." };
  }

  const passwordError = validatePassword(newPassword);
  if (passwordError) {
    return { error: passwordError };
  }

  const existing = await prisma.refereeAccount.findUnique({
    where: { id: refereeAccountId },
    select: { id: true },
  });
  if (!existing) {
    return { error: "Referee account not found." };
  }

  const passwordHash = await hashPassword(newPassword);
  await prisma.refereeAccount.update({
    where: { id: refereeAccountId },
    data: { passwordHash },
  });

  const revokedSessions = await revokeRefereeSessions(refereeAccountId);
  revalidateRefereePages();
  return { ok: true as const, revokedSessions };
}

export async function setRefereeActive(input: {
  refereeAccountId: string;
  isActive: boolean;
}) {
  const guard = await requireAdmin({ onFail: "return" });
  if (guard) return guard;

  const refereeAccountId = String(input.refereeAccountId ?? "").trim();
  const isActive = Boolean(input.isActive);

  if (!refereeAccountId) {
    return { error: "Referee account is required." };
  }

  const existing = await prisma.refereeAccount.findUnique({
    where: { id: refereeAccountId },
    select: { id: true },
  });
  if (!existing) {
    return { error: "Referee account not found." };
  }

  await prisma.refereeAccount.update({
    where: { id: refereeAccountId },
    data: { isActive },
  });

  let revokedSessions = 0;
  if (!isActive) {
    revokedSessions = await revokeRefereeSessions(refereeAccountId);
  }

  revalidateRefereePages();
  return { ok: true as const, revokedSessions };
}

export async function revokeRefereeAccountSessions(refereeAccountId: string) {
  const guard = await requireAdmin({ onFail: "return" });
  if (guard) return guard;

  const id = String(refereeAccountId ?? "").trim();
  if (!id) {
    return { error: "Referee account is required." };
  }

  const revokedSessions = await revokeRefereeSessions(id);
  revalidateRefereePages();
  return { ok: true as const, revokedSessions };
}

export async function revokeAllRefereeSessionsAction() {
  const guard = await requireAdmin({ onFail: "return" });
  if (guard) return guard;

  const revokedSessions = await revokeAllRefereeSessions();
  revalidateRefereePages();
  return { ok: true as const, revokedSessions };
}
