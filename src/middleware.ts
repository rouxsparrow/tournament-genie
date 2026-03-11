import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "tg_session";
const PUBLIC_PATHS = new Set([
  "/",
  "/favourite-player",
  "/standings",
  "/brackets",
  "/schedule",
  "/presenting",
  "/referee",
  "/referee-guideline",
  "/tournament-format",
  "/login",
]);
const PUBLIC_PREFIXES = ["/_next", "/favicon.ico", "/assets", "/images"];
const PUBLIC_API = new Set([
  "/api/favourite",
  "/api/public/standings/summary",
  "/api/public/standings/group-matches",
  "/api/public/presenting",
  "/api/public/brackets",
]);

function normalizePath(pathname: string) {
  return pathname !== "/" && pathname.endsWith("/")
    ? pathname.slice(0, -1)
    : pathname;
}

function isPublicPath(pathname: string) {
  if (PUBLIC_PATHS.has(pathname)) return true;
  if (PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return true;
  if (pathname.startsWith("/api")) {
    return PUBLIC_API.has(pathname);
  }
  return false;
}

function base64UrlEncode(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function verifyAdminSession(token: string, secret: string) {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [role, issuedAt, signature] = parts;
  if (role !== "admin" || !issuedAt || !signature) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signed = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${role}.${issuedAt}`)
  );
  const expected = base64UrlEncode(new Uint8Array(signed));
  return expected === signature;
}

async function isAdminRequest(request: NextRequest) {
  const secret = process.env.AUTH_SECRET ?? "";
  const token = request.cookies.get(SESSION_COOKIE)?.value ?? "";
  return secret ? verifyAdminSession(token, secret) : false;
}

export async function middleware(request: NextRequest) {
  const normalizedPath = normalizePath(request.nextUrl.pathname);

  if (normalizedPath === "/schedule") {
    const isAdmin = await isAdminRequest(request);
    if (!isAdmin) {
      const redirectUrl = new URL("/presenting", request.url);
      redirectUrl.search = request.nextUrl.search;
      return NextResponse.redirect(redirectUrl);
    }
    return NextResponse.next();
  }

  if (isPublicPath(normalizedPath)) return NextResponse.next();

  const isAdmin = await isAdminRequest(request);
  if (isAdmin) return NextResponse.next();

  return NextResponse.redirect(new URL("/", request.url));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
