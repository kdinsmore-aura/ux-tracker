-- ============================================================
-- UX Tracker — Supabase Storage Bucket & Policies
-- ============================================================
--
-- IMPORTANT: The bucket name 'ux-tracker-screenshots' must match
-- the SCREENSHOT_BUCKET constant in src/utils/supabase-client.js.
-- Changing one without the other will break screenshot uploads.
--
-- Run this file once during project setup via the Supabase SQL
-- editor or the CLI:  supabase db reset  (if included in migrations)
-- ============================================================


-- ---- Bucket ------------------------------------------------
-- file_size_limit : 5 242 880 bytes = 5 MB
-- allowed_mime_types : restricts uploads to PNG and JPEG only;
--   rejects other image formats (webp, gif, avif) at the storage layer.
-- public : true — objects are readable without a signed URL.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'ux-tracker-screenshots',
  'ux-tracker-screenshots',
  true,
  5242880,
  ARRAY['image/png', 'image/jpeg']
)
ON CONFLICT (id) DO NOTHING;


-- ---- Policies ----------------------------------------------
-- storage.objects already has RLS enabled in every Supabase project;
-- these policies layer on top of that default.

-- NOTE: no SELECT policy on purpose. The bucket is public, so objects
-- are served at /object/public/* without any policy — the dashboard's
-- screenshot URLs keep working. A broad SELECT policy would additionally
-- let anyone LIST every file in the bucket via the API (advisor lint
-- 0025), which leaks the filenames of all captured screenshots.

-- Anon write: the UX Tracker recorder script uploads screenshots
-- immediately after capturing a DOM fingerprint. It runs in the
-- participant's browser without a researcher auth session, so INSERT
-- must be permitted for the anon role.
CREATE POLICY "screenshots_anon_insert"
  ON storage.objects FOR INSERT
  TO anon
  WITH CHECK (bucket_id = 'ux-tracker-screenshots');

-- Anon update: the recorder uploads with upsert:true, so re-capturing a screen
-- (e.g. recording the same study more than once) overwrites the existing object.
-- Supabase Storage treats an upsert over an existing object as an UPDATE, which
-- requires its own policy in addition to INSERT. Without this, every capture
-- after the first is denied, uploadScreenshot() throws, and the screen's
-- screenshot_url is overwritten with NULL — leaving "No screenshot" in the UI
-- even though a stale file remains in the bucket.
CREATE POLICY "screenshots_anon_update"
  ON storage.objects FOR UPDATE
  TO anon
  USING (bucket_id = 'ux-tracker-screenshots')
  WITH CHECK (bucket_id = 'ux-tracker-screenshots');
