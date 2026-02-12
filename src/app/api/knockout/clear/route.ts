import { NextResponse } from "next/server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { clearKnockoutBracketArtifacts } from "@/lib/match-management";
import { getRoleFromRequest } from "@/lib/auth";

const categorySchema = z.enum(["MD", "WD", "XD"]);
const seriesSchema = z.enum(["A", "B"]);

export async function DELETE(request: Request) {
  const role = await getRoleFromRequest();
  if (role !== "admin") {
    return NextResponse.json({ error: "Admin access required." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const categoryParam = searchParams.get("category");
  const seriesParam = searchParams.get("series");

  const categoryParsed = categorySchema.safeParse(categoryParam);
  if (!categoryParsed.success) {
    return NextResponse.json({ error: "Invalid category." }, { status: 400 });
  }

  const category = categoryParsed.data;
  const seriesParsed = seriesParam ? seriesSchema.safeParse(seriesParam) : null;
  if (seriesParam && !seriesParsed?.success) {
    return NextResponse.json({ error: "Invalid series." }, { status: 400 });
  }

  if (category === "WD" && seriesParsed?.data === "B") {
    return NextResponse.json(
      { error: "Series B is not available for Women's Doubles." },
      { status: 400 }
    );
  }

  if (seriesParsed?.success) {
    await clearKnockoutBracketArtifacts(category, [seriesParsed.data]);
  } else {
    await clearKnockoutBracketArtifacts(category);
  }

  revalidatePath("/knockout");
  revalidatePath("/matches");
  revalidatePath("/schedule");

  return NextResponse.json({ ok: true });
}
