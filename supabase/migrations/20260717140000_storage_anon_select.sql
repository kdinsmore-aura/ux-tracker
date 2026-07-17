-- Restore a bucket-scoped SELECT policy for anon on the screenshots bucket.
--
-- The RLS hardening (20260716120000) dropped "screenshots_public_select" to
-- prevent anonymous listing of the bucket. That inadvertently broke upsert
-- overwrites: Supabase Storage resolves an upsert by first looking up the
-- existing object row AS THE REQUESTING ROLE — with no SELECT policy the row
-- is invisible and every re-upload is denied ("new row violates row-level
-- security policy"). Re-recording a study reuses the same object keys, so
-- all screenshots broke from a study's second recording onward.
--
-- Trade-off (accepted): the anon key can list this one bucket's object
-- names (screen-id-derived filenames). The images themselves are public
-- regardless — the bucket is public.
DROP POLICY IF EXISTS "screenshots_anon_select" ON storage.objects;
CREATE POLICY "screenshots_anon_select"
  ON storage.objects FOR SELECT
  TO anon
  USING (bucket_id = 'ux-tracker-screenshots');
