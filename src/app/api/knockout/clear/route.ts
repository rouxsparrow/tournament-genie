import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

const categorySchema = z.enum(["MD", "WD", "XD"]);
const seriesSchema = z.enum(["A", "B"]);

export async function DELETE(request: Request) {
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

  const seriesList: ("A" | "B")[] = seriesParsed?.success
    ? [seriesParsed.data]
    : category === "WD"
      ? ["A"]
      : ["A", "B"];

  await prisma.$transaction([
    prisma.knockoutMatch.deleteMany({
      where: { categoryCode: category, series: { in: seriesList } },
    }),
    prisma.knockoutSeed.deleteMany({
      where: { categoryCode: category, series: { in: seriesList } },
    }),
    prisma.knockoutRandomDraw.deleteMany({
      where: {
        categoryCode: category,
        series: { in: seriesList },
        NOT: { drawKey: { startsWith: "global:" } },
      },
    }),
  ]);

  return NextResponse.json({ ok: true });
}
