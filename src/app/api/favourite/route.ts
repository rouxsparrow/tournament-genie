import { NextResponse } from "next/server";
import { setFavouritePlayerIdCookie } from "@/lib/favourite-player";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const playerId =
    typeof body?.playerId === "string" && body.playerId.trim().length > 0
      ? body.playerId.trim()
      : null;

  await setFavouritePlayerIdCookie(playerId);
  return NextResponse.json({ ok: true });
}
