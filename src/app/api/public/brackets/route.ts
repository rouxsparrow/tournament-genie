import { NextResponse } from "next/server";
import {
  getCachedBracketsState,
  parseBracketsCategory,
  parseBracketsSeries,
} from "@/lib/public-read-models/loaders";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const categoryCode = parseBracketsCategory(searchParams.get("category"));
  const series = parseBracketsSeries(searchParams.get("series"));
  const state = await getCachedBracketsState(categoryCode, series);
  return NextResponse.json(state);
}
