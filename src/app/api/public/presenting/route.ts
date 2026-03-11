import { NextResponse } from "next/server";
import { getCachedPresentingState, parsePresentingStage } from "@/lib/public-read-models/loaders";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const stage = parsePresentingStage(searchParams.get("stage"));
  const state = await getCachedPresentingState(stage);
  return NextResponse.json(state);
}
