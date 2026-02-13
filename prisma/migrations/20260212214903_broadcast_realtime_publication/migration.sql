DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication
    WHERE pubname = 'supabase_realtime'
  ) THEN
    RAISE NOTICE 'Publication supabase_realtime does not exist; skipping broadcast publication registration.';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'CourtAssignment'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public."CourtAssignment";
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'BlockedMatch'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public."BlockedMatch";
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'Match'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public."Match";
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'KnockoutMatch'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public."KnockoutMatch";
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'ScheduleConfig'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public."ScheduleConfig";
  END IF;
END
$$;
