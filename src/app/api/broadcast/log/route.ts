import { NextResponse } from "next/server";
import { getRoleFromRequest } from "@/lib/auth";

type BroadcastLogPayload = {
  stage?: "GROUP" | "KNOCKOUT";
  mode?: "realtime" | "polling";
  message?: string;
  extra?: Record<string, unknown>;
};

export async function POST(request: Request) {
  const role = await getRoleFromRequest();
  if (role !== "admin") {
    return NextResponse.json({ error: "Admin access required." }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as BroadcastLogPayload;
  const stage = body.stage ?? "GROUP";
  const mode = body.mode ?? "realtime";
  const message = body.message ?? "event";

  // Dev-only style debug telemetry for Broadcast realtime/polling visibility.
  console.log("[broadcast][updates][server]", {
    stage,
    mode,
    message,
    ...(body.extra ?? {}),
  });

  return NextResponse.json({ ok: true });
}
