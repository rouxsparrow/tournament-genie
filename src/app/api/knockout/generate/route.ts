import { NextResponse } from "next/server";
import { z } from "zod";
import {
  BracketError,
  generateKnockoutBracketInternal,
} from "@/app/knockout/bracket-service";
import { getRoleFromRequest } from "@/lib/auth";

const payloadSchema = z.object({
  category: z.enum(["MD", "WD", "XD"]),
  series: z.enum(["A", "B"]),
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

  const { category, series } = parsed.data;

  try {
    await generateKnockoutBracketInternal({
      categoryCode: category,
      series,
    });
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

  return NextResponse.json({ ok: true });
}
