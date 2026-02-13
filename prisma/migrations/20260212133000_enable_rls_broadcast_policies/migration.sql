-- Enable RLS across exposed public tables.
ALTER TABLE IF EXISTS public."Player" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public."Category" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public."Team" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public."TeamMember" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public."Group" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public."GroupTeam" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public."Match" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public."GameScore" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public."TournamentSettings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public."TeamFlags" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public."SeriesQualifier" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public."KnockoutMatch" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public."KnockoutGameScore" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public."KnockoutSeed" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public."KnockoutRandomDraw" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public."CategoryConfig" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public."GroupAssignmentLock" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public."GroupStageLock" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public."GroupRandomDraw" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public."ScheduleConfig" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public."Court" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public."CourtStageLock" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public."CourtAssignment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public."BlockedMatch" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public."ScheduleActionLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public."ForcedMatchPriority" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public."RefereeSubmission" ENABLE ROW LEVEL SECURITY;

-- Remove existing anon-read policies from non-broadcast tables.
DO $$
DECLARE pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname, tablename
    FROM pg_policies
    WHERE schemaname = 'public'
      AND roles @> ARRAY['anon']::name[]
      AND tablename NOT IN (
        'CourtAssignment',
        'BlockedMatch',
        'Match',
        'KnockoutMatch',
        'ScheduleConfig'
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, pol.tablename);
  END LOOP;
END $$;

-- Broadcast realtime allowlist (anon SELECT only).
DROP POLICY IF EXISTS "anon_select_court_assignment" ON public."CourtAssignment";
CREATE POLICY "anon_select_court_assignment"
  ON public."CourtAssignment"
  FOR SELECT
  TO anon
  USING (true);

DROP POLICY IF EXISTS "anon_select_blocked_match" ON public."BlockedMatch";
CREATE POLICY "anon_select_blocked_match"
  ON public."BlockedMatch"
  FOR SELECT
  TO anon
  USING (true);

DROP POLICY IF EXISTS "anon_select_match" ON public."Match";
CREATE POLICY "anon_select_match"
  ON public."Match"
  FOR SELECT
  TO anon
  USING (true);

DROP POLICY IF EXISTS "anon_select_knockout_match" ON public."KnockoutMatch";
CREATE POLICY "anon_select_knockout_match"
  ON public."KnockoutMatch"
  FOR SELECT
  TO anon
  USING (true);

DROP POLICY IF EXISTS "anon_select_schedule_config" ON public."ScheduleConfig";
CREATE POLICY "anon_select_schedule_config"
  ON public."ScheduleConfig"
  FOR SELECT
  TO anon
  USING (true);
