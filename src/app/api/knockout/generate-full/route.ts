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
