-- ============================================================
-- Task goals + mid-study surveys
--
-- Task goals: each study task may define a completion goal
-- (reach a key screen, or click a key element). Participants who
-- take ANY route to the goal complete the task — the recorded
-- ideal path remains as the efficiency/deviation baseline only.
-- Goals live inside the existing studies.tasks JSONB:
--   { id, prompt, order,
--     goal?: { type: 'screen', screenId }
--          | { type: 'click', selector?, elementText? } }
--
-- Surveys: researcher-configured rating/comment prompts that fire
-- mid-study when a chosen task completes.
-- ============================================================

-- Survey definitions per study:
-- [{ id, trigger: { type: 'after_task', taskId },
--    rating:  { enabled, prompt },
--    comment: { enabled, prompt },
--    required, presentation: 'panel' | 'overlay' }]
ALTER TABLE studies
  ADD COLUMN IF NOT EXISTS surveys jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Participant responses, appended as surveys are answered:
-- [{ surveyId, rating, comment, skipped, screenId, taskIndex,
--    msSinceSessionStart, submittedAt }]
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS survey_responses jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Task-level progress (goal mode). current_step_index/completed_steps
-- continue tracking the reference-path cursor for analytics.
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS current_task_index integer NOT NULL DEFAULT 0;
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS completed_tasks integer NOT NULL DEFAULT 0;
