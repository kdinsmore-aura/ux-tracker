-- Welcome/instructions modal shown to participants before the session starts.
-- Config shape: { title, message } — both optional; generic copy fills blanks.
-- The participant clicks Begin to start the study (the session clock starts then).
ALTER TABLE studies
  ADD COLUMN IF NOT EXISTS welcome jsonb NOT NULL DEFAULT '{}';
