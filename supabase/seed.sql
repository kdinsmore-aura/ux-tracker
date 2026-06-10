-- ============================================================
-- UX Tracker — Seed Data
-- ============================================================
-- All UUIDs are deterministic so this file is safely re-runnable.
-- Every INSERT uses ON CONFLICT DO NOTHING.
--
-- Seed IDs at a glance
--   Study      00000000-0000-0000-0000-000000000001
--   Screen     00000000-0000-0000-0000-000000000011  /pricing.html
--   Screen     00000000-0000-0000-0000-000000000012  /signup.html
--   P01        00000000-0000-0000-0000-000000000021  completed
--   P02        00000000-0000-0000-0000-000000000022  invited
--   Session    00000000-0000-0000-0000-000000000031  P01, completed, 138 700 ms
--   Events     00000000-0000-0000-0000-000000000041 – 48
--              5 clicks on /pricing.html · 3 clicks on /signup.html
--              3 on-path (one per step) · 5 mis-clicks
-- ============================================================


-- ============================================================
-- STUDY
-- ============================================================
INSERT INTO studies (
  id, name, description,
  tasks, ideal_path,
  status, has_screen_changes,
  created_at, updated_at
)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Seed Test Study',
  'Automated seed data for development and testing.',

  $$[
    {"id": "task-1", "prompt": "Find the pricing page", "order": 1},
    {"id": "task-2", "prompt": "Start a free trial",    "order": 2}
  ]$$::jsonb,

  $$[
    {
      "stepIndex":        0,
      "screenId":         "/pricing.html",
      "elementSelector":  ".nav-plans-link",
      "elementText":      "View Plans",
      "expectedDuration": 8000,
      "recordedAt":       "2024-01-15T09:50:12.000Z"
    },
    {
      "stepIndex":        1,
      "screenId":         "/pricing.html",
      "elementSelector":  ".plan-professional .cta-btn",
      "elementText":      "Start Free Trial",
      "expectedDuration": 25000,
      "recordedAt":       "2024-01-15T09:50:37.000Z"
    },
    {
      "stepIndex":        2,
      "screenId":         "/signup.html",
      "elementSelector":  ".signup-form button[type=\"submit\"]",
      "elementText":      "Create Account",
      "expectedDuration": 30000,
      "recordedAt":       "2024-01-15T09:51:08.000Z"
    }
  ]$$::jsonb,

  'active',
  false,
  '2024-01-15 09:45:00+00',
  '2024-01-15 09:50:50+00'
)
ON CONFLICT (id) DO NOTHING;


-- ============================================================
-- PARTICIPANTS
-- session_id is NULL here; P01 is linked to their session after
-- the session row exists (see UPDATE below).
-- ============================================================
INSERT INTO participants (
  id, study_id, label, status,
  session_id, created_at, invited_at
)
VALUES
  (
    '00000000-0000-0000-0000-000000000021',
    '00000000-0000-0000-0000-000000000001',
    'P01', 'completed',
    NULL,
    '2024-01-15 09:55:00+00',
    '2024-01-15 09:55:00+00'
  ),
  (
    '00000000-0000-0000-0000-000000000022',
    '00000000-0000-0000-0000-000000000001',
    'P02', 'invited',
    NULL,
    '2024-01-15 09:55:10+00',
    '2024-01-15 09:55:10+00'
  )
ON CONFLICT (id) DO NOTHING;


-- ============================================================
-- SESSION — P01
-- started_at + 138 700 ms = completed_at
-- ============================================================
INSERT INTO sessions (
  id, study_id, participant_id,
  status,
  current_step_index, total_steps, completed_steps,
  resumed_without_state,
  screen_changes, has_screen_changes,
  viewport_width, viewport_height,
  user_agent,
  started_at, completed_at, duration_ms,
  created_at
)
VALUES (
  '00000000-0000-0000-0000-000000000031',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000021',
  'completed',
  3, 3, 3,
  false,
  '[]'::jsonb, false,
  1440, 900,
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  '2024-01-15 10:00:00.000+00',
  '2024-01-15 10:02:18.700+00',
  138700,
  '2024-01-15 10:00:00.000+00'
)
ON CONFLICT (id) DO NOTHING;

-- Wire P01 → session. Safe to re-run: sets the same values each time.
UPDATE participants
SET
  session_id   = '00000000-0000-0000-0000-000000000031',
  started_at   = '2024-01-15 10:00:00.000+00',
  completed_at = '2024-01-15 10:02:18.700+00'
WHERE id = '00000000-0000-0000-0000-000000000021';


-- ============================================================
-- SCREENS
-- screenshot_hash is a 64-char hex string (SHA-256 of DOM fingerprint).
-- screenshot_url uses a placeholder hostname; replace with your
-- Supabase project URL before running against a real project.
-- ============================================================
INSERT INTO screens (
  id, study_id, screen_id, label,
  screenshot_url, screenshot_hash,
  viewport_width, viewport_height,
  scroll_x, scroll_y,
  is_stale, captured_at, created_at
)
VALUES
  (
    '00000000-0000-0000-0000-000000000011',
    '00000000-0000-0000-0000-000000000001',
    '/pricing.html',
    'Pricing',
    'https://placeholder.supabase.co/storage/v1/object/public/ux-tracker-screenshots/seed/pricing.png',
    'a3f8c2d1e4b976508f1a2b3c4d5e6f70a3f8c2d1e4b976508f1a2b3c4d5e6f70',
    1440, 900,
    0, 0,
    false,
    '2024-01-15 09:50:05+00',
    '2024-01-15 09:50:05+00'
  ),
  (
    '00000000-0000-0000-0000-000000000012',
    '00000000-0000-0000-0000-000000000001',
    '/signup.html',
    'Sign Up',
    'https://placeholder.supabase.co/storage/v1/object/public/ux-tracker-screenshots/seed/signup.png',
    'b4e9d3c2f5a087619e2b3c4d5e6f7081b4e9d3c2f5a087619e2b3c4d5e6f7081',
    1440, 900,
    0, 0,
    false,
    '2024-01-15 09:50:42+00',
    '2024-01-15 09:50:42+00'
  )
ON CONFLICT (study_id, screen_id) DO NOTHING;


-- ============================================================
-- EVENTS — 8 click events for P01's session
--
-- /pricing.html (5 clicks, scroll_y 0 → 820 mid-session)
--   #41  mis-click  billing toggle           step 0  t=  2 500 ms
--   #42  mis-click  "See all features" link  step 0  t=  8 200 ms
--   #43  ON-PATH    "View Plans" nav          step 0  t= 15 300 ms  → advances
--   #44  mis-click  Enterprise "Contact Sales" step 1 t= 28 900 ms
--   #45  ON-PATH    Professional "Start Free Trial" step 1 t= 67 400 ms → advances
--
-- /signup.html (3 clicks, no scroll)
--   #46  mis-click  "Sign in instead" link   step 2  t= 95 200 ms
--   #47  mis-click  "Learn about our plans"  step 2  t=102 100 ms
--   #48  ON-PATH    "Create Account" submit   step 2  t=138 700 ms  → advances
-- ============================================================
INSERT INTO events (
  id,
  session_id, study_id, participant_id,
  screen_id, event_type, step_index,
  element_selector, element_text, element_tag,
  viewport_x, viewport_y,
  normalized_x, normalized_y,
  page_x, page_y,
  scroll_x, scroll_y,
  is_on_path, is_mis_click, advances_step,
  ms_since_session_start, ms_since_last_event,
  timestamp
)
VALUES

-- #41 — mis-click: billing toggle (monthly ↔ annual switch)
(
  '00000000-0000-0000-0000-000000000041',
  '00000000-0000-0000-0000-000000000031',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000021',
  '/pricing.html', 'click', 0,
  '.billing-toggle', '', 'INPUT',
  712, 285,
  0.5000, 0.5000,
  712, 285,
  0, 0,
  false, true, false,
  2500, 2500,
  '2024-01-15 10:00:02.500+00'
),

-- #42 — mis-click: "See all features" link below the plan cards
(
  '00000000-0000-0000-0000-000000000042',
  '00000000-0000-0000-0000-000000000031',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000021',
  '/pricing.html', 'click', 0,
  '.features-link', 'See all features', 'A',
  524, 680,
  0.2500, 0.7500,
  524, 680,
  0, 0,
  false, true, false,
  8200, 5700,
  '2024-01-15 10:00:08.200+00'
),

-- #43 — ON-PATH step 0: "View Plans" in the sticky nav → advances to step 1
(
  '00000000-0000-0000-0000-000000000043',
  '00000000-0000-0000-0000-000000000031',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000021',
  '/pricing.html', 'click', 0,
  '.nav-plans-link', 'View Plans', 'A',
  398, 68,
  0.4375, 0.5000,
  398, 68,
  0, 0,
  true, false, true,
  15300, 7100,
  '2024-01-15 10:00:15.300+00'
),

-- #44 — mis-click: Enterprise "Contact Sales" CTA (wrong plan, page scrolled)
(
  '00000000-0000-0000-0000-000000000044',
  '00000000-0000-0000-0000-000000000031',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000021',
  '/pricing.html', 'click', 1,
  '.plan-enterprise .cta-btn', 'Contact Sales', 'BUTTON',
  1152, 541,
  0.6875, 0.5000,
  1152, 1361,
  0, 820,
  false, true, false,
  28900, 13600,
  '2024-01-15 10:00:28.900+00'
),

-- #45 — ON-PATH step 1: Professional "Start Free Trial" → advances to step 2
(
  '00000000-0000-0000-0000-000000000045',
  '00000000-0000-0000-0000-000000000031',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000021',
  '/pricing.html', 'click', 1,
  '.plan-professional .cta-btn', 'Start Free Trial', 'BUTTON',
  720, 541,
  0.5000, 0.5000,
  720, 1361,
  0, 820,
  true, false, true,
  67400, 38500,
  '2024-01-15 10:01:07.400+00'
),

-- #46 — mis-click: "Sign in instead" link at the bottom of the signup form
(
  '00000000-0000-0000-0000-000000000046',
  '00000000-0000-0000-0000-000000000031',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000021',
  '/signup.html', 'click', 2,
  '.signin-link', 'Sign in instead', 'A',
  720, 742,
  0.5000, 0.8750,
  720, 742,
  0, 0,
  false, true, false,
  95200, 27800,
  '2024-01-15 10:01:35.200+00'
),

-- #47 — mis-click: "Learn about our plans" link below the form
(
  '00000000-0000-0000-0000-000000000047',
  '00000000-0000-0000-0000-000000000031',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000021',
  '/signup.html', 'click', 2,
  '.learn-more-link', 'Learn about our plans', 'A',
  720, 812,
  0.5000, 0.9000,
  720, 812,
  0, 0,
  false, true, false,
  102100, 6900,
  '2024-01-15 10:01:42.100+00'
),

-- #48 — ON-PATH step 2: "Create Account" submit → completes the session
(
  '00000000-0000-0000-0000-000000000048',
  '00000000-0000-0000-0000-000000000031',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000021',
  '/signup.html', 'click', 2,
  '.signup-form button[type="submit"]', 'Create Account', 'BUTTON',
  720, 652,
  0.5000, 0.5000,
  720, 652,
  0, 0,
  true, false, true,
  138700, 36600,
  '2024-01-15 10:02:18.700+00'
)

ON CONFLICT (id) DO NOTHING;
