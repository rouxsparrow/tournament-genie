import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export type Role = "admin" | "viewer";

const COOKIE_NAME = "tg_session";
const ADMIN_USERNAME = "admin";
const DEFAULT_ADMIN_PASSWORD = "Starhub";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

function getAuthSecret() {
  return process.env.AUTH_SECRET ?? "";
}

function sign(value: string, secret: string) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function safeEqual(a: string, b: string) {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

function encodeSession(role: Role, issuedAt: number, secret: string) {
  const payload = `${role}.${issuedAt}`;
  const signature = sign(payload, secret);
  return `${payload}.${signature}`;
}

function decodeSession(token: string, secret: string): Role | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [role, issuedAt, signature] = parts;
  if (role !== "admin") return null;
  if (!issuedAt) return null;
  const expected = sign(`${role}.${issuedAt}`, secret);
  if (!safeEqual(expected, signature)) return null;
  return "admin";
}

export async function getRoleFromRequest(): Promise<Role> {
  const secret = getAuthSecret();
  if (!secret) return "viewer";
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return "viewer";
  const role = decodeSession(token, secret);
  return role ?? "viewer";
}

export function validateAdminCredentials(username: string, password: string) {
  const expectedPassword = process.env.ADMIN_PASSWORD ?? DEFAULT_ADMIN_PASSWORD;
  if (username !== ADMIN_USERNAME) return false;
  return safeEqual(password, expectedPassword);
}

export async function setAdminSession() {
  const secret = getAuthSecret();
  if (!secret) return false;
  const issuedAt = Date.now();
  const value = encodeSession("admin", issuedAt, secret);
  const store = await cookies();
  store.set(COOKIE_NAME, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  return true;
}

export async function clearSession() {
  const store = await cookies();
  store.set(COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

export async function requireAdmin(options?: { onFail?: "return" | "redirect" }) {
  const role = await getRoleFromRequest();
  if (role === "admin") return null;
  if (options?.onFail === "redirect") {
    redirect("/login");
  }
  return { error: "Admin access required." };
}
