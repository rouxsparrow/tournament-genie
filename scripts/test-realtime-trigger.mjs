import crypto from "crypto";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: ".env.local" });
dotenv.config();

const baseUrl = process.env.BROADCAST_DIAG_BASE_URL ?? process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const authSecret = process.env.AUTH_SECRET ?? "";
const stage = (process.env.REALTIME_TEST_STAGE ?? "GROUP").toUpperCase() === "KNOCKOUT" ? "KNOCKOUT" : "GROUP";
const channel = stage === "GROUP" ? "broadcast-live-group" : "broadcast-live-knockout";
const timeoutMs = Number.parseInt(process.env.REALTIME_TEST_TIMEOUT_MS ?? "8000", 10);

function signAdminSession(secret) {
  const payload = `admin.${Date.now()}`;
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

async function main() {
  if (!supabaseUrl || !anonKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  }
  if (!authSecret) {
    throw new Error("Missing AUTH_SECRET (required to call admin publish endpoint).");
  }

  const token = signAdminSession(authSecret);
  const supabase = createClient(supabaseUrl, anonKey);
  let received = false;

  const result = await new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve({ ok: false, reason: `Timed out after ${timeoutMs}ms waiting for realtime event.` });
    }, timeoutMs);

    const realtimeChannel = supabase
      .channel(channel)
      .on("broadcast", { event: "schedule_update" }, (payload) => {
        received = true;
        clearTimeout(timer);
        resolve({ ok: true, payload });
      });

    realtimeChannel.subscribe(async (status) => {
      if (status !== "SUBSCRIBED") return;
      try {
        const res = await fetch(`${baseUrl}/api/broadcast/publish`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            cookie: `tg_session=${token}`,
          },
          body: JSON.stringify({ stage, source: "realtime-trigger-test" }),
        });
        if (!res.ok) {
          clearTimeout(timer);
          const text = await res.text();
          resolve({ ok: false, reason: `Publish endpoint failed: ${res.status} ${text}` });
        }
      } catch (error) {
        clearTimeout(timer);
        resolve({
          ok: false,
          reason: `Publish request failed: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    });
  });

  await supabase.removeAllChannels();

  if (!result.ok) {
    console.error("[realtime-trigger-test] FAIL", result.reason);
    process.exit(1);
  }

  console.log("[realtime-trigger-test] PASS", {
    stage,
    channel,
    received,
    payload: result.payload,
  });
}

await main();
