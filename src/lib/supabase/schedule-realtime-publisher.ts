import { createClient } from "@supabase/supabase-js";
import { REALTIME_CHANNELS, REALTIME_EVENTS } from "@/lib/supabase/realtime-events";

type ScheduleStage = "GROUP" | "KNOCKOUT";
type MatchType = "GROUP" | "KNOCKOUT";

type PublishScheduleCompletionEventParams = {
  stage: ScheduleStage;
  source: string;
  matchType: MatchType;
  matchId: string;
  completedAt?: string;
};

const CHANNEL_BY_STAGE: Record<ScheduleStage, string> = REALTIME_CHANNELS.schedule;
const EVENT_NAME = REALTIME_EVENTS.SCHEDULE_MATCH_COMPLETED;
const SCHEDULE_DEBUG = process.env.SCHEDULE_DEBUG === "1";

function logScheduleRealtime(message: string, extra?: Record<string, unknown>) {
  if (!SCHEDULE_DEBUG) return;
  console.log("[schedule][realtime][publish]", { message, ...(extra ?? {}) });
}

export async function publishScheduleCompletionEvent(
  params: PublishScheduleCompletionEventParams
) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    logScheduleRealtime("supabase env missing", {
      hasUrl: Boolean(url),
      hasAnonKey: Boolean(anonKey),
      stage: params.stage,
    });
    return;
  }

  const channelName = CHANNEL_BY_STAGE[params.stage];
  const supabase = createClient(url, anonKey);
  const channel = supabase.channel(channelName, {
    config: { broadcast: { self: true } },
  });

  try {
    try {
      await supabase.realtime.setAuth(anonKey);
    } catch (error) {
      logScheduleRealtime("setAuth failed", {
        stage: params.stage,
        error: error instanceof Error ? error.message : String(error),
      });
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
      logScheduleRealtime("subscribe failed", {
        stage: params.stage,
        channel: channelName,
      });
      return;
    }

    const response = await channel.send({
      type: "broadcast",
      event: EVENT_NAME,
      payload: {
        stage: params.stage,
        source: params.source,
        matchType: params.matchType,
        matchId: params.matchId,
        completedAt: params.completedAt ?? new Date().toISOString(),
      },
    });

    if (response !== "ok") {
      logScheduleRealtime("send failed", {
        stage: params.stage,
        channel: channelName,
        response,
      });
      return;
    }

    logScheduleRealtime("sent", {
      stage: params.stage,
      channel: channelName,
      event: EVENT_NAME,
      matchType: params.matchType,
      matchId: params.matchId,
      source: params.source,
    });
  } catch (error) {
    logScheduleRealtime("publish failed", {
      stage: params.stage,
      channel: channelName,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    await supabase.removeChannel(channel);
  }
}
