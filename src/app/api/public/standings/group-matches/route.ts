import { NextResponse } from "next/server";
import { getCachedStandingsGroupMatches } from "@/lib/public-read-models/loaders";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const groupId = searchParams.get("groupId")?.trim() ?? "";
  if (!groupId) {
    return NextResponse.json({ error: "groupId is required." }, { status: 400 });
  }

  const payload = await getCachedStandingsGroupMatches(groupId);
  return NextResponse.json(payload);
}
