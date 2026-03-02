import { NextResponse } from "next/server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import {
  BracketError,
  generateKnockoutBracketInternal,
} from "@/app/knockout/bracket-service";
import { prisma } from "@/lib/prisma";
import { publishKnockoutMatchesForCategory } from "@/lib/match-management";
import { syncKnockoutPropagation } from "@/app/knockout/sync";
import { getRoleFromRequest } from "@/lib/auth";

const payloadSchema = z.object({
  category: z.enum(["MD", "WD", "XD"]),
});

export async function POST(request: Request) {
  const role = await getRoleFromRequest();
  if (role !== "admin") {
    return NextResponse.json({ error: "Admin access required." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = payloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid bracket request." }, { status: 400 });
  }

  const { category } = parsed.data;

  const lock = await prisma.groupStageLock.findUnique({
    where: { categoryCode: category },
    select: { locked: true },
  });

  if (!lock?.locked) {
    return NextResponse.json(
      {
        error: "GROUP_STAGE_UNLOCKED",
        message: "Group stage must be locked before generating series or brackets.",
      },
      { status: 400 }
    );
  }

  const requiredSeries: ("A" | "B")[] = category === "WD" ? ["A"] : ["A", "B"];
  const exists = await prisma.knockoutMatch.findFirst({
    where: { categoryCode: category, series: { in: requiredSeries } },
    select: { id: true },
  });

  if (exists) {
    return NextResponse.json(
      {
        error: "BRACKET_EXISTS",
        message: "Bracket already exists. Use Clear Bracket to regenerate.",
      },
      { status: 409 }
    );
  }

  const seriesACount = await prisma.seriesQualifier.count({
    where: { categoryCode: category, series: "A" },
  });
  if (seriesACount === 0) {
    return NextResponse.json(
      {
        error: "MISSING_SERIES_SPLIT",
        message: "Compute series split first.",
      },
      { status: 400 }
    );
  }
  if (category === "WD" && seriesACount !== 4 && seriesACount !== 8) {
    return NextResponse.json(
      {
        error: "SERIES_A_TEAM_COUNT",
        message: "Women's Doubles Series A requires 4 or 8 qualified teams.",
      },
      { status: 400 }
    );
  }
  if (category !== "WD" && seriesACount !== 8) {
    return NextResponse.json(
      {
        error: "SERIES_A_TEAM_COUNT",
        message: "Series A requires exactly 8 qualified teams.",
      },
      { status: 400 }
    );
  }

  if (category !== "WD") {
    const seriesBCount = await prisma.seriesQualifier.count({
      where: { categoryCode: category, series: "B" },
    });
    if (seriesBCount < 4) {
      return NextResponse.json(
        {
          error: "SERIES_B_MIN_TEAMS",
          message:
            "Series B requires at least 4 qualified teams before generating brackets.",
        },
        { status: 400 }
      );
    }
    if (seriesBCount > 8) {
      return NextResponse.json(
        {
          error: "SERIES_B_TEAM_COUNT",
          message:
            "Series B supports at most 8 qualified teams. Recompute series split.",
        },
        { status: 400 }
      );
    }
  }

  try {
    await generateKnockoutBracketInternal({ categoryCode: category, series: "A" });
    if (category !== "WD") {
      await generateKnockoutBracketInternal({ categoryCode: category, series: "B" });
    }
    await publishKnockoutMatchesForCategory(category);
    await syncKnockoutPropagation(category);
  } catch (error) {
    if (error instanceof BracketError) {
      const status = error.code === "BRACKET_EXISTS" ? 409 : error.status ?? 400;
      return NextResponse.json(
        { error: error.code, message: error.message },
        { status }
      );
    }

    return NextResponse.json(
      { error: "UNKNOWN_ERROR", message: "Unable to generate bracket." },
      { status: 500 }
    );
  }

  revalidatePath("/knockout");
  revalidatePath("/matches");
  revalidatePath("/schedule");

  return NextResponse.json({ ok: true, message: "Bracket generated." });
}
