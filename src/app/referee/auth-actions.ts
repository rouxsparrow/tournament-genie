"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import {
  clearRefereeSession,
  createRefereeSession,
  setRefereeSessionCookie,
  validateRefereeCredentials,
} from "@/lib/referee-auth";

export async function loginReferee(input: { username: string; password: string }) {
  const username = String(input?.username ?? "").trim();
  const password = String(input?.password ?? "");

  const auth = await validateRefereeCredentials(username, password);
  if ("error" in auth) {
    return auth;
  }

  const referee = auth.referee;
  const session = await createRefereeSession(referee.id);
  await setRefereeSessionCookie(session.token);

  await prisma.refereeAccount.update({
    where: { id: referee.id },
    data: { lastLoginAt: new Date() },
  });

  revalidatePath("/referee");

  return {
    ok: true as const,
    referee,
  };
}

export async function logoutReferee() {
  await clearRefereeSession();
  revalidatePath("/referee");
  return { ok: true as const };
}
