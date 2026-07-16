-- ============================================================
-- Harden RLS: researcher operations require a signed-in
-- (authenticated) Supabase Auth user.
--
-- Rationale: the anon key ships in the <script> tag of every
-- prototype page, so any policy granted to `anon` is effectively
-- world-open. Participant and recorder database traffic already
-- flows through the ux-tracker-ingest Edge Function (service
-- role, with its own ownership validation), so the permissive
-- anon policies existed only for the researcher tools (setup +
-- dashboard). Those tools now sign in with Supabase Auth.
--
-- After this migration the public anon key can no longer read or
-- write ANY table directly. The only anon grant that remains is
-- screenshot upload to the ux-tracker-screenshots bucket, needed
-- while recording a path from a prototype page.
--
-- IMPORTANT — apply order:
--   1. Deploy the updated setup/dashboard (they add researcher login)
--   2. Create your researcher user (Supabase Dashboard -> Auth -> Users
--      -> Add user, tick "Auto Confirm User")
--   3. DISABLE public signups (Auth -> Sign In / Up -> turn off
--      "Allow new users to sign up")  <- critical: with these
--      policies, any signed-up user has full researcher access
--   4. Run this migration
-- ============================================================


-- ---- studies (researcher CRUD; Edge Function writes bypass RLS) ----

DROP POLICY IF EXISTS "studies_select" ON studies;
DROP POLICY IF EXISTS "studies_insert" ON studies;
DROP POLICY IF EXISTS "studies_update" ON studies;
DROP POLICY IF EXISTS "studies_delete" ON studies;

CREATE POLICY "studies_select" ON studies
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "studies_insert" ON studies
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "studies_update" ON studies
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "studies_delete" ON studies
  FOR DELETE TO authenticated USING (true);


-- ---- screens (recorder/participant writes go through the Edge Function) ----

DROP POLICY IF EXISTS "screens_select" ON screens;
DROP POLICY IF EXISTS "screens_insert" ON screens;
DROP POLICY IF EXISTS "screens_update" ON screens;

CREATE POLICY "screens_select" ON screens
  FOR SELECT TO authenticated USING (true);


-- ---- participants (researcher creates/edits; tracker status updates
--      go through the Edge Function) ----

DROP POLICY IF EXISTS "participants_select" ON participants;
DROP POLICY IF EXISTS "participants_insert" ON participants;
DROP POLICY IF EXISTS "participants_update" ON participants;
DROP POLICY IF EXISTS "participants_delete" ON participants;

CREATE POLICY "participants_select" ON participants
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "participants_insert" ON participants
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "participants_update" ON participants
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "participants_delete" ON participants
  FOR DELETE TO authenticated USING (true);


-- ---- sessions (created/updated via Edge Function; dashboard reads
--      and reset-deletes) ----

DROP POLICY IF EXISTS "sessions_select" ON sessions;
DROP POLICY IF EXISTS "sessions_insert" ON sessions;
DROP POLICY IF EXISTS "sessions_update" ON sessions;
DROP POLICY IF EXISTS "sessions_delete" ON sessions;

CREATE POLICY "sessions_select" ON sessions
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "sessions_delete" ON sessions
  FOR DELETE TO authenticated USING (true);


-- ---- events (inserted via Edge Function; dashboard reads) ----

DROP POLICY IF EXISTS "events_select" ON events;
DROP POLICY IF EXISTS "events_insert" ON events;

CREATE POLICY "events_select" ON events
  FOR SELECT TO authenticated USING (true);


-- ---- storage ----
-- Public buckets serve objects at /object/public/* without a SELECT
-- policy; the broad SELECT policy only enabled LISTING the bucket
-- contents via the API, which leaks filenames of every screenshot.
DROP POLICY IF EXISTS "screenshots_public_select" ON storage.objects;
-- screenshots_anon_insert / screenshots_anon_update stay: the recorder
-- uploads screenshots from the prototype page, which runs with the
-- embedded anon key. Both are scoped to this single bucket.


-- ---- function hardening (advisor lints 0011 / 0028 / 0029) ----

ALTER FUNCTION public.set_updated_at() SET search_path = '';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'rls_auto_enable' AND n.nspname = 'public'
  ) THEN
    REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
  END IF;
END $$;


-- ---- performance: cover FKs flagged by the advisor (lint 0001) ----

CREATE INDEX IF NOT EXISTS idx_participants_session_id
  ON participants(session_id);
CREATE INDEX IF NOT EXISTS idx_screens_first_stale_session_id
  ON screens(first_stale_session_id);
