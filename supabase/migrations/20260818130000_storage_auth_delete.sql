-- Let researchers delete screenshots, so deleting a study cleans up its objects.
--
-- Deleting a study cascades through every table (participants, sessions, events,
-- screens all declare ON DELETE CASCADE on studies.id) but never touched
-- Storage: the objects under '<studyId>/' simply stayed, invisible to the UI and
-- counting against the project's storage forever. As of 2026-08-18 there were 70
-- such orphans from eight deleted studies.
--
-- Why the authenticated role and not the ingest Edge Function: that function runs
-- with verify_jwt = false because participants call it from public prototype
-- pages. Exposing a destructive delete there would let anyone with the URL wipe
-- any study's screenshots with an unauthenticated POST. Deletion belongs on the
-- researcher path, which is behind signInWithPassword.
--
-- This grants no authority a researcher did not already have: the same session
-- can delete the study row itself, which destroys every participant, session and
-- event belonging to it. Being able to delete the screenshots too is strictly
-- less than that.
--
-- Note the bucket stays private and anon still has no policy of any kind — this
-- adds a second authenticated-only policy alongside screenshots_auth_select.

DROP POLICY IF EXISTS "screenshots_auth_delete" ON storage.objects;
CREATE POLICY "screenshots_auth_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'ux-tracker-screenshots');
