-- Make the screenshots bucket private and remove every anon storage policy.
--
-- Why (advisor lint 0025, "Clients can list all files in this bucket"):
-- the recorder used to upload directly from the participant's browser with the
-- publishable key. That needs anon INSERT and — because the recorder uploads
-- with upsert:true, and Supabase Storage resolves an upsert by first reading
-- the existing row AS THE REQUESTING ROLE — anon UPDATE and anon SELECT too.
-- The SELECT it needs is indistinguishable from the one backing storage
-- list(), so anyone holding the publishable key could enumerate every
-- screenshot path in the bucket. Because the bucket was also public, an
-- enumerated path was immediately fetchable: "you must know the URL" became
-- "you can discover every URL".
--
-- The trade-off recorded in 20260717140000 was accepted at the time because
-- there was no other way to keep upserts working from the browser. There is
-- now: the ingest Edge Function already brokers every other participant-side
-- write with the service role, and it has gained an 'uploadScreenshot' action.
-- The service role bypasses RLS, so the bucket needs NO policies for uploads
-- and can be private.
--
-- PREREQUISITES — apply this only after BOTH have shipped, or screenshot
-- capture breaks for every participant:
--   1. supabase functions deploy ux-tracker-ingest   (adds 'uploadScreenshot')
--   2. the rebuilt v1/tracker.js is published        (uploads via ingest)
-- A cached older bundle still tries to upload as anon and will now fail; that
-- is the intended end state, but it is why the bundle must roll out first.


-- ---- Drop every anon policy --------------------------------------------------
-- Nothing anonymous touches storage any more: participants upload through the
-- Edge Function, and the participant runtime never renders screenshots.

DROP POLICY IF EXISTS "screenshots_anon_select" ON storage.objects;
DROP POLICY IF EXISTS "screenshots_anon_insert" ON storage.objects;
DROP POLICY IF EXISTS "screenshots_anon_update" ON storage.objects;

-- Created by hand during early setup, before the named policies existed; it is
-- an exact duplicate of screenshots_anon_insert. Dropped here so the bucket's
-- policy list matches storage-policy.sql exactly.
DROP POLICY IF EXISTS "Allow recorder uploads" ON storage.objects;


-- ---- Drop the authenticated write policies ----------------------------------
-- These were defence in depth for a browser-side upload that could pick up a
-- researcher's JWT (see 20260718090000). Uploads no longer happen in the
-- browser at all, so a write path for researchers is dead weight.

DROP POLICY IF EXISTS "screenshots_auth_insert" ON storage.objects;
DROP POLICY IF EXISTS "screenshots_auth_update" ON storage.objects;


-- ---- Keep exactly one policy: authenticated read ----------------------------
-- Required, not convenience: with a private bucket the dashboard and setup
-- pages render screenshots via createSignedUrl(), and signing reads
-- storage.objects. Both pages hold a real Supabase Auth session
-- (signInWithPassword), so this is gated behind researcher login.
--
-- This policy is still bucket-scoped rather than per-study. A signed-in
-- researcher can therefore list and sign every screenshot in the project —
-- acceptable while every researcher is a trusted operator of the same
-- instance, and the same posture the table policies already take (all
-- authenticated-true since 20260716120000). Tightening it means giving
-- researchers per-study scoping on the tables first; the storage policy should
-- follow that model rather than invent its own.

DROP POLICY IF EXISTS "screenshots_auth_select" ON storage.objects;
CREATE POLICY "screenshots_auth_select"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'ux-tracker-screenshots');


-- ---- Make the bucket private ------------------------------------------------
-- Reads on a public bucket bypass RLS entirely, so trimming policies alone
-- would leave every already-known URL fetchable by anyone. Flipping this is
-- what actually makes the screenshots non-public.
--
-- Every absolute public URL persisted in screens.screenshot_url,
-- studies.ideal_path[].screenshotUrl and event payloads stops resolving at
-- this point. Those values are NOT rewritten: the object keys are unchanged,
-- and the readers extract the key from either form (see
-- screenshotPathFromStored / UXTrackerShots.pathFromStored) and sign it. That
-- keeps historical recordings rendering without a data migration.

UPDATE storage.buckets
   SET public = false
 WHERE id = 'ux-tracker-screenshots';
