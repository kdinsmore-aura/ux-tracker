-- Mirror the screenshots-bucket policies for the authenticated role.
--
-- Root cause (diagnosed live 2026-07-18): supabase-js shares its persisted
-- auth session across every client on an origin. When a prototype page shares
-- an origin with the researcher tools (the GitHub Pages sample does), a
-- signed-in researcher's JWT silently replaces the anon role on the tracker's
-- storage uploads — and the anon-only policies rejected every screenshot with
-- "new row violates row-level security policy".
--
-- The tracker client now opts out of session persistence entirely
-- (persistSession: false), so new bundles always upload as anon. These
-- policies are defense in depth: recordings keep working even from a stale
-- cached bundle, and a signed-in researcher is a legitimate uploader anyway.
DROP POLICY IF EXISTS "screenshots_auth_select" ON storage.objects;
CREATE POLICY "screenshots_auth_select"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'ux-tracker-screenshots');

DROP POLICY IF EXISTS "screenshots_auth_insert" ON storage.objects;
CREATE POLICY "screenshots_auth_insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'ux-tracker-screenshots');

DROP POLICY IF EXISTS "screenshots_auth_update" ON storage.objects;
CREATE POLICY "screenshots_auth_update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'ux-tracker-screenshots')
  WITH CHECK (bucket_id = 'ux-tracker-screenshots');
