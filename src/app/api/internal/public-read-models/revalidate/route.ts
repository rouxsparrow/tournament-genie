import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  invalidatePublicReadModels,
  PUBLIC_REVALIDATE_SECRET_HEADER,
} from "@/lib/public-read-models/cache-tags";

const categorySchema = z.enum(["MD", "WD", "XD"]);
const seriesSchema = z.enum(["A", "B"]);
const stageSchema = z.enum(["GROUP", "KNOCKOUT"]);

const payloadSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("group-results"),
    categoryCodes: z.array(categorySchema).optional(),
    groupIds: z.array(z.string().min(1)).optional(),
  }),
  z.object({
    type: z.literal("knockout-results"),
    categoryCodes: z.array(categorySchema).optional(),
    series: z.array(seriesSchema).optional(),
  }),
  z.object({
    type: z.literal("presenting"),
    stages: z.array(stageSchema).optional(),
  }),
  z.object({
    type: z.literal("player-checkin"),
  }),
  z.object({
    type: z.literal("all"),
  }),
]);

function safeEqual(a: string, b: string) {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

export async function POST(request: Request) {
  const expectedSecret = process.env.PUBLIC_REVALIDATE_SECRET ?? "";
  const providedSecret = request.headers.get(PUBLIC_REVALIDATE_SECRET_HEADER) ?? "";

  if (!expectedSecret || !providedSecret || !safeEqual(expectedSecret, providedSecret)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = payloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  await invalidatePublicReadModels(parsed.data, { skipRemoteForward: true });
  return NextResponse.json({ ok: true });
}
