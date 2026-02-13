import { NextResponse } from "next/server";
import { getRoleFromRequest } from "@/lib/auth";
import { publishBroadcastRefreshEvent } from "@/lib/supabase/broadcast-refresh-publisher";

type PublishPayload = {
  stage?: "GROUP" | "KNOCKOUT";
  source?: string;
};

export async function POST(request: Request) {
  const role = await getRoleFromRequest();
  if (role !== "admin") {
    return NextResponse.json({ error: "Admin access required." }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as PublishPayload;
  const stage = body.stage === "KNOCKOUT" ? "KNOCKOUT" : "GROUP";
  const source = body.source ?? "schedule-action";

  const result = await publishBroadcastRefreshEvent({
    stage,
    source,
    reason: "schedule-action",
  });
  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.error,
        ...(result.response ? { response: result.response } : {}),
      },
      { status: 503 }
    );
  }

  return NextResponse.json({ ok: true });
}
