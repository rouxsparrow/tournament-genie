import { createClient } from "@supabase/supabase-js";
import { REALTIME_CHANNELS, REALTIME_EVENTS } from "@/lib/supabase/realtime-events";

type ScheduleStage = "GROUP" | "KNOCKOUT";

type PublishBroadcastRefreshEventParams = {
  stage: ScheduleStage;
  source: string;
  reason: "schedule-action" | "view-change";
  changeType?: "assignment" | "upcoming" | "both";
  triggeredAt?: string;
};

type PublishResult =
  | { ok: true }
  | {
      ok: false;
      error: string;
      response?: string;
    };

const CHANNEL_BY_STAGE = REALTIME_CHANNELS.broadcastRefresh;
const EVENT_NAME = REALTIME_EVENTS.BROADCAST_REFRESH_REQUIRED;

export async function publishBroadcastRefreshEvent(
  params: PublishBroadcastRefreshEventParams
): Promise<PublishResult> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return {
      ok: false,
      error: "Realtime is not configured. Missing NEXT_PUBLIC_SUPABASE_* env vars.",
    };
  }

  const channelName = CHANNEL_BY_STAGE[params.stage];
  const supabase = createClient(url, anonKey);
  const channel = supabase.channel(channelName, {
    config: { broadcast: { self: true } },
  });

  try {
    try {
      await supabase.realtime.setAuth(anonKey);
    } catch {
      // Keep fail-open behavior; subscribe/send may still work.
    }

    const subscribed = await new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => resolve(false), 2500);
      channel.subscribe((status: string) => {
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
      return {
        ok: false,
        error: "Realtime subscribe failed for publish channel.",
      };
    }

    const response = await channel.send({
      type: "broadcast",
      event: EVENT_NAME,
      payload: {
        stage: params.stage,
        source: params.source,
        reason: params.reason,
        changeType: params.changeType ?? null,
        triggeredAt: params.triggeredAt ?? new Date().toISOString(),
      },
    });

    if (response !== "ok") {
      return {
        ok: false,
        error: "Realtime broadcast send failed.",
        response,
      };
    }

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await supabase.removeChannel(channel);
  }
}
