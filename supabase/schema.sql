-- ============================================================
-- UX Tracker — Supabase Database Schema
-- ============================================================

-- gen_random_uuid() is available in PostgreSQL 13+ via pgcrypto,
-- which Supabase enables by default.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";


-- ============================================================
-- TABLE: studies
-- ============================================================
CREATE TABLE studies (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name               text        NOT NULL,
  description        text,
  tasks              jsonb       NOT NULL DEFAULT '[]',
  -- Array of: { id, prompt, instructions?, order,
  --   goal?: { type: 'screen', screenId } | { type: 'click', selector?, elementText? } }
  -- instructions: optional context shown to the participant under the prompt.
  -- When a task has a goal, completion is goal-based (any route counts);
  -- the recorded ideal_path is used for efficiency analytics only.
  ideal_path         jsonb       NOT NULL DEFAULT '[]',
  -- Array of: { stepIndex, screenId, elementSelector, elementText,
  --             expectedDuration, recordedAt }
  -- Completion-screen config: { thankYou, rating:{enabled,prompt},
  --   comment:{enabled,prompt}, required }
  completion         jsonb       NOT NULL DEFAULT '{}',
  -- Welcome-modal config: { title, message } — shown before a new session
  -- starts; generic copy fills any blanks. The participant clicks Begin to
  -- start the study (the session clock starts then).
  welcome            jsonb       NOT NULL DEFAULT '{}',
  -- Mid-study surveys: [{ id,
  --   trigger: { type:'after_task', taskId } | { type:'screen_enter', screenId }
  --          | { type:'element_click', selector?, elementText? },
  --   rating:{enabled,prompt}, comment:{enabled,prompt},
  --   required, presentation:'panel'|'overlay', stepIndex?,
  --   source?: 'recorder' — created via "Mark Survey Point" while recording;
  --     replaced wholesale on re-record (manual surveys are preserved) }]
  -- element_click fires right after a matching click — the precise trigger for
  -- in-page flows (wizards) where the screen id never changes.
  surveys            jsonb       NOT NULL DEFAULT '[]',
  status             text        NOT NULL DEFAULT 'draft',
  has_screen_changes boolean     NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT studies_status_check
    CHECK (status IN ('draft', 'active', 'closed'))
);


-- ============================================================
-- TABLE: participants
-- Defined before sessions to break the circular FK.
-- participants.session_id → sessions.id is added via ALTER TABLE below.
-- ============================================================
CREATE TABLE participants (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  study_id     uuid        NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
  label        text,
  status       text        NOT NULL DEFAULT 'invited',
  session_id   uuid,        -- FK to sessions.id wired below
  created_at   timestamptz NOT NULL DEFAULT now(),
  invited_at   timestamptz,
  started_at   timestamptz,
  completed_at timestamptz,

  CONSTRAINT participants_status_check
    CHECK (status IN ('invited', 'in_progress', 'completed', 'abandoned'))
);


-- ============================================================
-- TABLE: sessions
-- ============================================================
CREATE TABLE sessions (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  study_id              uuid        NOT NULL REFERENCES studies(id)       ON DELETE CASCADE,
  participant_id        uuid        NOT NULL REFERENCES participants(id)  ON DELETE CASCADE,
  status                text        NOT NULL DEFAULT 'in_progress',
  current_step_index    integer     NOT NULL DEFAULT 0,
  total_steps           integer,
  completed_steps       integer     NOT NULL DEFAULT 0,
  -- true if participant returned on a different device / cleared storage
  resumed_without_state boolean     NOT NULL DEFAULT false,
  -- Array of: { screenId, recordedHash, observedHash, detectedAt }
  screen_changes        jsonb       NOT NULL DEFAULT '[]',
  has_screen_changes    boolean     NOT NULL DEFAULT false,
  viewport_width        integer,
  viewport_height       integer,
  user_agent            text,
  started_at            timestamptz NOT NULL DEFAULT now(),
  completed_at          timestamptz,
  -- Total session duration in milliseconds, set on completion
  duration_ms           integer,
  -- Participant completion-screen feedback: { rating, comment, submittedAt }
  feedback              jsonb,
  -- Mid-study survey responses: [{ surveyId, rating, comment, skipped,
  --   screenId, taskIndex, msSinceSessionStart, submittedAt }]
  survey_responses      jsonb       NOT NULL DEFAULT '[]',
  -- Task-level progress (goal mode); step columns track the reference path
  current_task_index    integer     NOT NULL DEFAULT 0,
  completed_tasks       integer     NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT sessions_status_check
    CHECK (status IN ('in_progress', 'completed', 'abandoned'))
);

-- Resolve circular FK: participants.session_id → sessions.id
ALTER TABLE participants
  ADD CONSTRAINT participants_session_id_fkey
  FOREIGN KEY (session_id) REFERENCES sessions(id);


-- ============================================================
-- TABLE: screens
-- ============================================================
CREATE TABLE screens (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  study_id               uuid        NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
  -- Normalized URL string: pathname + hash, query params stripped
  screen_id              text        NOT NULL,
  -- Optional researcher-assigned label
  label                  text,
  -- Supabase Storage public URL
  screenshot_url         text,
  -- SHA-256 of DOM structural fingerprint at record time
  screenshot_hash        text,
  viewport_width         integer,
  viewport_height        integer,
  scroll_x               integer     DEFAULT 0,
  scroll_y               integer     DEFAULT 0,
  is_stale               boolean     NOT NULL DEFAULT false,
  change_detected_at     timestamptz,
  -- Set when staleness is first detected; nullable
  first_stale_session_id uuid        REFERENCES sessions(id),
  captured_at            timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT screens_study_screen_unique UNIQUE (study_id, screen_id)
);


-- ============================================================
-- TABLE: events
-- ============================================================
CREATE TABLE events (
  id                     uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id             uuid          NOT NULL REFERENCES sessions(id)     ON DELETE CASCADE,
  study_id               uuid          NOT NULL REFERENCES studies(id)      ON DELETE CASCADE,
  participant_id         uuid          NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  -- Normalized URL string matching screens.screen_id
  screen_id              text          NOT NULL,
  event_type             text          NOT NULL,
  -- Which ideal-path step was active when this event fired
  step_index             integer,
  -- CSS selector of the clicked element
  element_selector       text,
  -- Trimmed text content of the clicked element (max 200 chars)
  element_text           text,
  -- tagName of clicked element
  element_tag            text,
  -- Click coordinates relative to viewport
  viewport_x             integer,
  viewport_y             integer,
  -- Click position as fraction of element bounding box (0.0–1.0)
  normalized_x           numeric(6,4),
  normalized_y           numeric(6,4),
  -- Click coordinates relative to full page (accounts for scroll)
  page_x                 integer,
  page_y                 integer,
  -- window.scroll{X,Y} at time of event
  scroll_x               integer,
  scroll_y               integer,
  -- true if this click matched the expected step in the ideal path
  is_on_path             boolean,
  -- true if this click was off-path and did not advance the task
  is_mis_click           boolean,
  -- true if this click moved the participant to the next step
  advances_step          boolean,
  -- Milliseconds elapsed since session started
  ms_since_session_start integer,
  -- Milliseconds since previous event in this session
  ms_since_last_event    integer,
  timestamp              timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT events_event_type_check
    CHECK (event_type IN (
      'click',
      'screen_enter',
      'screen_exit',
      'task_start',
      'task_complete',
      'session_start',
      'session_complete',
      'session_abandon'
    ))
);


-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX idx_events_session_id       ON events(session_id);
CREATE INDEX idx_events_study_id         ON events(study_id);
-- Composite index used by heatmap queries
CREATE INDEX idx_events_screen_study     ON events(screen_id, study_id);
CREATE INDEX idx_events_participant_id   ON events(participant_id);

CREATE INDEX idx_sessions_study_id       ON sessions(study_id);
CREATE INDEX idx_sessions_participant_id ON sessions(participant_id);

CREATE INDEX idx_participants_study_id   ON participants(study_id);

CREATE INDEX idx_screens_study_id        ON screens(study_id);


-- ============================================================
-- TRIGGER: keep studies.updated_at current
-- ============================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER studies_updated_at
  BEFORE UPDATE ON studies
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE studies       ENABLE ROW LEVEL SECURITY;
ALTER TABLE screens       ENABLE ROW LEVEL SECURITY;
ALTER TABLE participants  ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE events        ENABLE ROW LEVEL SECURITY;


-- Security model: the anon key is public (it ships in the prototype's
-- <script> tag), so NO table policy is granted to anon. Participant and
-- recorder database traffic goes through the ux-tracker-ingest Edge
-- Function (service role — bypasses RLS, does its own validation).
-- Researcher tools (setup + dashboard) sign in with Supabase Auth and
-- operate as `authenticated`. Disable public signups in Auth settings,
-- otherwise anyone could self-register as a "researcher".

-- ---- studies (researcher CRUD) ------------------------------

CREATE POLICY "studies_select"
  ON studies FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "studies_insert"
  ON studies FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "studies_update"
  ON studies FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "studies_delete"
  ON studies FOR DELETE
  TO authenticated
  USING (true);


-- ---- screens -----------------------------------------------
-- Recorder/participant writes go through the Edge Function; researchers read.

CREATE POLICY "screens_select"
  ON screens FOR SELECT
  TO authenticated
  USING (true);


-- ---- participants ------------------------------------------
-- Tracker status updates go through the Edge Function; researchers manage rows.

CREATE POLICY "participants_select"
  ON participants FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "participants_insert"
  ON participants FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "participants_update"
  ON participants FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "participants_delete"
  ON participants FOR DELETE
  TO authenticated
  USING (true);


-- ---- sessions ----------------------------------------------
-- Created/updated via the Edge Function; researchers read and reset-delete.

CREATE POLICY "sessions_select"
  ON sessions FOR SELECT
  TO authenticated
  USING (true);

-- Researcher "reset participant" deletes a participant's prior run from the
-- dashboard (events cascade-delete via FK).
CREATE POLICY "sessions_delete"
  ON sessions FOR DELETE
  TO authenticated
  USING (true);


-- ---- events ------------------------------------------------
-- Inserted via the Edge Function; researchers read.

CREATE POLICY "events_select"
  ON events FOR SELECT
  TO authenticated
  USING (true);
