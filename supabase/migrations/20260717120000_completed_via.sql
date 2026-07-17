-- How a session completed: 'path' (every recorded click matched in order),
-- 'goals' (all task goals met, any route), or 'end_screen' (participant
-- deviated from the recorded path but reached the screen the recording
-- stopped on). NULL for sessions completed before this feature or not
-- yet completed.
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS completed_via text;

ALTER TABLE sessions
  DROP CONSTRAINT IF EXISTS sessions_completed_via_check;

ALTER TABLE sessions
  ADD CONSTRAINT sessions_completed_via_check
  CHECK (completed_via IS NULL OR completed_via IN ('path', 'goals', 'end_screen'));
