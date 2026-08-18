-- ============================================================
-- UX Tracker — Supabase Storage Bucket & Policies
-- ============================================================
--
-- IMPORTANT: The bucket name 'ux-tracker-screenshots' must match
-- the SCREENSHOT_BUCKET constant in src/utils/supabase-client.js,
-- the same constant in supabase/functions/ux-tracker-ingest, and
-- BUCKET in shared/screenshot-urls.js. Changing one without the
-- others will break screenshot uploads or rendering.
--
-- Run this file once during project setup via the Supabase SQL
-- editor or the CLI:  supabase db reset  (if included in migrations)
-- ============================================================


-- ---- Bucket ------------------------------------------------
-- file_size_limit : 5 242 880 bytes = 5 MB
-- allowed_mime_types : restricts uploads to PNG and JPEG only;
--   rejects other image formats (webp, gif, avif) at the storage layer.
-- public : FALSE — screenshots are not publicly readable. Reads on a
--   public bucket bypass RLS entirely, so a public bucket cannot be
--   protected by policies no matter how they are written. Researcher
--   surfaces render screenshots through short-lived signed URLs.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'ux-tracker-screenshots',
  'ux-tracker-screenshots',
  false,
  5242880,
  ARRAY['image/png', 'image/jpeg']
)
ON CONFLICT (id) DO NOTHING;


-- ---- Policies ----------------------------------------------
-- storage.objects already has RLS enabled in every Supabase project;
-- this policy layers on top of that default.
--
-- There is exactly ONE policy, and no anon policy at all.
--
-- Uploads do not need one: the recorder posts screenshots to the
-- ux-tracker-ingest Edge Function, which writes them with the service
-- role. The service role bypasses RLS.
--
-- This is deliberate rather than incidental. Uploading directly from the
-- participant's browser requires anon INSERT, anon UPDATE (the recorder
-- upserts, since re-recording a study reuses object keys) and anon SELECT
-- — Supabase Storage resolves an upsert by first reading the existing row
-- as the requesting role. That SELECT is the same one that backs storage
-- list(), so it let anyone holding the publishable key enumerate every
-- screenshot path in the bucket (advisor lint 0025). Brokering the upload
-- through the Edge Function removes all three.

-- Authenticated read: REQUIRED for rendering, not convenience. The bucket
-- is private, so the dashboard and setup pages mint signed URLs with
-- createSignedUrl() — and signing reads storage.objects. Both pages sign
-- in with Supabase Auth (signInWithPassword) before loading data, so this
-- sits behind researcher login. The participant runtime never renders
-- screenshots and so never needs to sign.
--
-- Still bucket-scoped rather than per-study: a signed-in researcher can
-- sign any screenshot in the project. That matches the table policies,
-- which are all `authenticated USING (true)` as of 20260716120000. If
-- researchers ever gain per-study scoping, this should follow the same
-- model rather than inventing its own.
CREATE POLICY "screenshots_auth_select"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'ux-tracker-screenshots');

-- Authenticated delete: deleting a study removes its screenshots. Every table
-- cascades from studies.id, but Storage does not participate in FK cascades, so
-- the setup page walks the study's '<studyId>/' prefix and removes the objects
-- before deleting the row.
--
-- Deliberately NOT an ingest Edge Function action: that function runs with
-- verify_jwt = false for public prototype pages, so a destructive action there
-- would be callable by anyone. This grants a researcher nothing new either —
-- the same session can already delete the study and cascade away every
-- participant, session and event under it.
CREATE POLICY "screenshots_auth_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'ux-tracker-screenshots');
