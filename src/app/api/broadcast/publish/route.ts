import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getRoleFromRequest } from "@/lib/auth";

type PublishPayload = {
  stage?: "GROUP" | "KNOCKOUT";
  source?: string;
};

const CHANNEL_BY_STAGE: Record<"GROUP" | "KNOCKOUT", string> = {
  GROUP: "broadcast-live-group",
  KNOCKOUT: "broadcast-live-knockout",
};

export async function POST(request: Request) {
  const role = await getRoleFromRequest();
  if (role !== "admin") {
    return NextResponse.json({ error: "Admin access required." }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as PublishPayload;
  const stage = body.stage === "KNOCKOUT" ? "KNOCKOUT" : "GROUP";
  const source = body.source ?? "schedule-action";

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return NextResponse.json(
      { error: "Realtime is not configured. Missing NEXT_PUBLIC_SUPABASE_* env vars." },
      { status: 500 }
    );
  }

  const supabase = createClient(url, anonKey);
  const channel = supabase.channel(CHANNEL_BY_STAGE[stage], {
    config: { broadcast: { self: true } },
  });

  try {
    const subscribed = await new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => resolve(false), 2500);
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          clearTimeout(timeout);
          resolve(true);
          return;
        }
        if (status === "TIMED_OUT" || status === "CHANNEL_ERROR" || status === "CLOSED") {
          clearTimeout(timeout);
          resolve(false);
        }
      });
    });

    if (!subscribed) {
      return NextResponse.json(
        { error: "Realtime subscribe failed for publish channel." },
        { status: 503 }
      );
    }

    const response = await channel.send({
      type: "broadcast",
      event: "schedule_update",
      payload: { stage, source, sentAt: new Date().toISOString() },
    });

    if (response !== "ok") {
      return NextResponse.json(
        { error: "Realtime broadcast send failed.", response },
        { status: 503 }
      );
    }

    return NextResponse.json({ ok: true });
  } finally {
    await supabase.removeChannel(channel);
  }
}
