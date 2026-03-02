import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";

const scrypt = promisify(scryptCallback);

const REFEREE_SESSION_COOKIE = "tg_ref_session";
const REFEREE_SESSION_TTL_SECONDS = 60 * 60 * 24;
const REFEREE_PASSWORD_MIN_LENGTH = 10;
const PASSWORD_HASH_ALGO = "scrypt";
const SCRYPT_KEY_LENGTH = 64;

type RefereeAuthIdentity = {
  id: string;
  username: string;
  displayName: string;
};

function safeEqual(a: string, b: string) {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("base64url");
}

export function normalizeRefereeUsername(username: string) {
  return username.trim().toLowerCase();
}

export async function hashPassword(password: string) {
  const normalized = String(password ?? "");
  if (normalized.length < REFEREE_PASSWORD_MIN_LENGTH) {
    throw new Error(`Password must be at least ${REFEREE_PASSWORD_MIN_LENGTH} characters.`);
  }

  const salt = randomBytes(16).toString("base64url");
  const derived = (await scrypt(normalized, salt, SCRYPT_KEY_LENGTH)) as Buffer;
  return `${PASSWORD_HASH_ALGO}$${salt}$${derived.toString("base64url")}`;
}

export async function verifyPassword(password: string, storedHash: string) {
  const [algo, salt, expectedHash] = storedHash.split("$");
  if (algo !== PASSWORD_HASH_ALGO || !salt || !expectedHash) return false;

  const derived = (await scrypt(String(password ?? ""), salt, SCRYPT_KEY_LENGTH)) as Buffer;
  return safeEqual(derived.toString("base64url"), expectedHash);
}

export async function createRefereeSession(refereeAccountId: string) {
  const token = randomBytes(32).toString("base64url");
  const sessionTokenHash = hashSessionToken(token);
  const expiresAt = new Date(Date.now() + REFEREE_SESSION_TTL_SECONDS * 1000);

  await prisma.refereeSession.create({
    data: {
      refereeAccountId,
      sessionTokenHash,
      expiresAt,
    },
  });

  return { token, expiresAt };
}

export async function setRefereeSessionCookie(token: string) {
  const store = await cookies();
  store.set(REFEREE_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: REFEREE_SESSION_TTL_SECONDS,
  });
}

export async function clearRefereeSessionCookie() {
  const store = await cookies();
  store.set(REFEREE_SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

export async function clearRefereeSession() {
  const store = await cookies();
  const token = store.get(REFEREE_SESSION_COOKIE)?.value ?? "";

  if (token) {
    await prisma.refereeSession.updateMany({
      where: {
        sessionTokenHash: hashSessionToken(token),
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });
  }

  await clearRefereeSessionCookie();
}

export async function getRefereeFromRequest(): Promise<RefereeAuthIdentity | null> {
  const store = await cookies();
  const token = store.get(REFEREE_SESSION_COOKIE)?.value ?? "";
  if (!token) return null;

  const now = new Date();
  const session = await prisma.refereeSession.findFirst({
    where: {
      sessionTokenHash: hashSessionToken(token),
      revokedAt: null,
      expiresAt: { gt: now },
      refereeAccount: { isActive: true },
    },
    select: {
      id: true,
      refereeAccountId: true,
      refereeAccount: {
        select: {
          username: true,
          displayName: true,
        },
      },
    },
  });

  if (!session) return null;

  await prisma.refereeSession.updateMany({
    where: { id: session.id },
    data: { lastSeenAt: now },
  });

  return {
    id: session.refereeAccountId,
    username: session.refereeAccount.username,
    displayName: session.refereeAccount.displayName,
  };
}

export async function requireReferee(options?: { onFail?: "return" | "redirect" }) {
  const referee = await getRefereeFromRequest();
  if (referee) return referee;

  if (options?.onFail === "redirect") {
    redirect("/referee");
  }

  return { error: "Referee access required." };
}

export async function revokeRefereeSessions(refereeAccountId: string) {
  const revokedAt = new Date();
  const result = await prisma.refereeSession.updateMany({
    where: {
      refereeAccountId,
      revokedAt: null,
    },
    data: { revokedAt },
  });
  return result.count;
}

export async function revokeAllRefereeSessions() {
  const revokedAt = new Date();
  const result = await prisma.refereeSession.updateMany({
    where: { revokedAt: null },
    data: { revokedAt },
  });
  return result.count;
}

export async function validateRefereeCredentials(username: string, password: string) {
  const usernameNormalized = normalizeRefereeUsername(username);
  if (!usernameNormalized) {
    return { error: "Username is required." };
  }
  if (!String(password ?? "")) {
    return { error: "Password is required." };
  }

  const account = await prisma.refereeAccount.findUnique({
    where: { usernameNormalized },
    select: {
      id: true,
      username: true,
      displayName: true,
      passwordHash: true,
      isActive: true,
    },
  });

  if (!account || !account.isActive) {
    return { error: "Invalid credentials." };
  }

  const valid = await verifyPassword(password, account.passwordHash);
  if (!valid) {
    return { error: "Invalid credentials." };
  }

  return {
    ok: true as const,
    referee: {
      id: account.id,
      username: account.username,
      displayName: account.displayName,
    },
  };
}

export { REFEREE_PASSWORD_MIN_LENGTH, REFEREE_SESSION_COOKIE, REFEREE_SESSION_TTL_SECONDS };
