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

-- Public read: anyone with a valid object URL can view a screenshot.
-- The dashboard fetches screenshot_url values from the screens table
-- and displays them directly — no auth token required.
CREATE POLICY "screenshots_public_select"
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'ux-tracker-screenshots');

-- Anon write: the UX Tracker recorder script uploads screenshots
-- immediately after capturing a DOM fingerprint. It runs in the
-- participant's browser without a researcher auth session, so INSERT
-- must be permitted for the anon role.
CREATE POLICY "screenshots_anon_insert"
  ON storage.objects FOR INSERT
  TO anon
  WITH CHECK (bucket_id = 'ux-tracker-screenshots');
