-- Realtime signal table with stable lowercase identifier.
CREATE TABLE IF NOT EXISTS public.broadcast_signal (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source TEXT NOT NULL DEFAULT 'system'
);

ALTER TABLE public.broadcast_signal ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS anon_select_broadcast_signal ON public.broadcast_signal;
CREATE POLICY anon_select_broadcast_signal
  ON public.broadcast_signal
  FOR SELECT
  TO anon
  USING (true);

INSERT INTO public.broadcast_signal (id, updated_at, source)
VALUES (1, NOW(), 'bootstrap')
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.broadcast_touch_signal()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.broadcast_signal (id, updated_at, source)
  VALUES (1, NOW(), TG_TABLE_NAME)
  ON CONFLICT (id)
  DO UPDATE
    SET updated_at = EXCLUDED.updated_at,
        source = EXCLUDED.source;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_broadcast_touch_court_assignment ON public."CourtAssignment";
CREATE TRIGGER trg_broadcast_touch_court_assignment
AFTER INSERT OR UPDATE OR DELETE ON public."CourtAssignment"
FOR EACH STATEMENT
EXECUTE FUNCTION public.broadcast_touch_signal();

DROP TRIGGER IF EXISTS trg_broadcast_touch_blocked_match ON public."BlockedMatch";
CREATE TRIGGER trg_broadcast_touch_blocked_match
AFTER INSERT OR UPDATE OR DELETE ON public."BlockedMatch"
FOR EACH STATEMENT
EXECUTE FUNCTION public.broadcast_touch_signal();

DROP TRIGGER IF EXISTS trg_broadcast_touch_match ON public."Match";
CREATE TRIGGER trg_broadcast_touch_match
AFTER INSERT OR UPDATE OR DELETE ON public."Match"
FOR EACH STATEMENT
EXECUTE FUNCTION public.broadcast_touch_signal();

DROP TRIGGER IF EXISTS trg_broadcast_touch_knockout_match ON public."KnockoutMatch";
CREATE TRIGGER trg_broadcast_touch_knockout_match
AFTER INSERT OR UPDATE OR DELETE ON public."KnockoutMatch"
FOR EACH STATEMENT
EXECUTE FUNCTION public.broadcast_touch_signal();

DROP TRIGGER IF EXISTS trg_broadcast_touch_schedule_config ON public."ScheduleConfig";
CREATE TRIGGER trg_broadcast_touch_schedule_config
AFTER INSERT OR UPDATE OR DELETE ON public."ScheduleConfig"
FOR EACH STATEMENT
EXECUTE FUNCTION public.broadcast_touch_signal();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_publication
    WHERE pubname = 'supabase_realtime'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'broadcast_signal'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.broadcast_signal;
  END IF;
END
$$;
