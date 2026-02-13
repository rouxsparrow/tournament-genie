"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cachedClient: SupabaseClient | null | undefined;

export function getRealtimeBrowserClient() {
  if (cachedClient !== undefined) return cachedClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    cachedClient = null;
    return cachedClient;
  }

  cachedClient = createClient(url, anonKey, {
    realtime: {
      params: { eventsPerSecond: 10 },
    },
  });
  // With RLS-enabled Postgres changes, Realtime needs an explicit JWT on the socket.
  // We use anon key because this app has no Supabase-authenticated user session.
  void cachedClient.realtime.setAuth(anonKey);
  return cachedClient;
}
