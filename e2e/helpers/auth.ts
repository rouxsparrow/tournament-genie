import { createHmac, timingSafeEqual } from "crypto";
import { expect, Page } from "@playwright/test";

function sign(value: string, secret: string) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function safeEqual(a: string, b: string) {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

export async function loginAsAdmin(page: Page) {
  const username = process.env.E2E_ADMIN_USERNAME ?? "admin";
  const password = process.env.E2E_ADMIN_PASSWORD ?? process.env.ADMIN_PASSWORD ?? "Starhub";
  const expectedPassword = process.env.ADMIN_PASSWORD ?? "Starhub";
  const secret = process.env.AUTH_SECRET ?? "";
  const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:4173";

  if (username !== "admin" || !safeEqual(password, expectedPassword)) {
    throw new Error("Invalid E2E admin credentials.");
  }
  if (!secret) {
    throw new Error("AUTH_SECRET is required for E2E admin session cookie.");
  }

  const issuedAt = Date.now();
  const payload = `admin.${issuedAt}`;
  const token = `${payload}.${sign(payload, secret)}`;

  await page.context().addCookies([
    {
      name: "tg_session",
      value: token,
      url: baseURL,
      httpOnly: true,
      sameSite: "Lax",
      secure: false,
    },
  ]);

  await page.goto("/schedule");
  await expect(page).toHaveURL(/\/schedule/);
}
