import { NextResponse } from "next/server";
import { getCachedStandingsSummary, parseStandingsCategory } from "@/lib/public-read-models/loaders";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const categoryCode = parseStandingsCategory(searchParams.get("category"));
  const summary = await getCachedStandingsSummary(categoryCode);
  return NextResponse.json(summary);
}
