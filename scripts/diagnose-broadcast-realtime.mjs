import crypto from "crypto";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: ".env.local" });
dotenv.config();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const AUTH_SECRET = process.env.AUTH_SECRET ?? "";
const BASE_URL = process.env.BROADCAST_DIAG_BASE_URL ?? process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000";

function logStep(name, ok, detail) {
  const status = ok ? "PASS" : "FAIL";
  console.log(`[broadcast-realtime][${status}] ${name}${detail ? ` - ${detail}` : ""}`);
}

function signSession(secret) {
  const payload = `admin.${Date.now()}`;
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

async function testBroadcastTransport() {
  const receiver = createClient(SUPABASE_URL, ANON_KEY);
  const sender = createClient(SUPABASE_URL, ANON_KEY);
  const channelName = `broadcast-live-group`;
  const timeoutMs = 8000;
  let receiverSubscribed = false;
  let senderSubscribed = false;
  let received = false;

  const receiverDone = new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(false), timeoutMs);
    const recvChannel = receiver
      .channel(channelName)
      .on("broadcast", { event: "schedule_update" }, () => {
        received = true;
        clearTimeout(timeout);
        resolve(true);
      });

    recvChannel.subscribe((status) => {
      if (status === "SUBSCRIBED") receiverSubscribed = true;
    });
  });

  const senderDone = new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(false), timeoutMs);
    const sendChannel = sender.channel(channelName, { config: { broadcast: { self: true } } });
    sendChannel.subscribe(async (status) => {
      if (status !== "SUBSCRIBED") return;
      senderSubscribed = true;
      const res = await sendChannel.send({
        type: "broadcast",
        event: "schedule_update",
        payload: { stage: "GROUP", source: "diagnose-script", sentAt: new Date().toISOString() },
      });
      clearTimeout(timeout);
      resolve(res === "ok");
    });
  });

  const [sendOk, recvOk] = await Promise.all([senderDone, receiverDone]);
  return {
    ok: Boolean(sendOk && recvOk && receiverSubscribed && senderSubscribed && received),
    detail: `senderSubscribed=${senderSubscribed} receiverSubscribed=${receiverSubscribed} sent=${Boolean(sendOk)} received=${received}`,
  };
}

async function testPublishEndpoint() {
  if (!AUTH_SECRET) {
    return { ok: false, detail: "AUTH_SECRET missing (cannot test /api/broadcast/publish)" };
  }
  const token = signSession(AUTH_SECRET);
  try {
    const res = await fetch(`${BASE_URL}/api/broadcast/publish`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: `tg_session=${token}`,
      },
      body: JSON.stringify({ stage: "GROUP", source: "diagnose-script" }),
    });
    const text = await res.text();
    return {
      ok: res.ok,
      detail: `status=${res.status} body=${text.slice(0, 120)}`,
    };
  } catch (error) {
    return {
      ok: false,
      detail: `request failed (${error instanceof Error ? error.message : String(error)})`,
    };
  }
}

async function main() {
  let failed = false;

  const hasUrl = SUPABASE_URL.length > 0;
  const hasAnon = ANON_KEY.length > 0;
  logStep("env NEXT_PUBLIC_SUPABASE_URL", hasUrl, hasUrl ? new URL(SUPABASE_URL).host : "missing");
  logStep("env NEXT_PUBLIC_SUPABASE_ANON_KEY", hasAnon, hasAnon ? "present" : "missing");
  if (!hasUrl || !hasAnon) {
    process.exitCode = 1;
    return;
  }

  const transport = await testBroadcastTransport();
  logStep("supabase broadcast transport", transport.ok, transport.detail);
  if (!transport.ok) failed = true;

  const publish = await testPublishEndpoint();
  logStep("app publish endpoint (/api/broadcast/publish)", publish.ok, publish.detail);
  if (!publish.ok) failed = true;

  if (failed) {
    console.log("[broadcast-realtime] Result: FAILED");
    process.exitCode = 1;
    return;
  }
  console.log("[broadcast-realtime] Result: OK");
}

await main();
