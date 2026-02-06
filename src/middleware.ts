import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "tg_session";
const PUBLIC_PATHS = new Set([
  "/",
  "/standings",
  "/brackets",
  "/schedule",
  "/presenting",
  "/referee",
  "/login",
]);
const PUBLIC_PREFIXES = ["/_next", "/favicon.ico", "/assets", "/images"];
const PUBLIC_API = new Set(["/api/favourite"]);

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

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();

  const secret = process.env.AUTH_SECRET ?? "";
  const token = request.cookies.get(SESSION_COOKIE)?.value ?? "";
  const isAdmin = secret ? await verifyAdminSession(token, secret) : false;

  if (isAdmin) return NextResponse.next();
  return NextResponse.redirect(new URL("/", request.url));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
