-- Restore the anon UPDATE policy on the screenshots bucket.
--
-- The recorder uploads with upsert:true. Re-recording a study reuses the
-- same object keys (screen ids / step indexes), which Supabase Storage
-- treats as an UPDATE — without this policy every capture after a study's
-- first recording is denied ("new row violates row-level security policy"),
-- uploadScreenshot() throws, and screenshots go missing across the review
-- path and dashboard. Diagnosed live on 2026-07-17: anon INSERT succeeded,
-- anon upsert-over-existing returned 403.
DROP POLICY IF EXISTS "screenshots_anon_update" ON storage.objects;
CREATE POLICY "screenshots_anon_update"
  ON storage.objects FOR UPDATE
  TO anon
  USING (bucket_id = 'ux-tracker-screenshots')
  WITH CHECK (bucket_id = 'ux-tracker-screenshots');
