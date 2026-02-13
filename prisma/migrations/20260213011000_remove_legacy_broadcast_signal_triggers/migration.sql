-- Legacy signal-table realtime path is retired.
-- Broadcast updates now use explicit Supabase channel broadcasts from app actions.

DROP TRIGGER IF EXISTS trg_broadcast_touch_court_assignment ON public."CourtAssignment";
DROP TRIGGER IF EXISTS trg_broadcast_touch_blocked_match ON public."BlockedMatch";
DROP TRIGGER IF EXISTS trg_broadcast_touch_match ON public."Match";
DROP TRIGGER IF EXISTS trg_broadcast_touch_knockout_match ON public."KnockoutMatch";
DROP TRIGGER IF EXISTS trg_broadcast_touch_schedule_config ON public."ScheduleConfig";

DROP FUNCTION IF EXISTS public.broadcast_touch_signal();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'broadcast_signal'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.broadcast_signal;
  END IF;
END
$$;

DROP TABLE IF EXISTS public.broadcast_signal;
