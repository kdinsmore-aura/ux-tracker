import { createClient } from '@supabase/supabase-js';

// ─── Table name constants ────────────────────────────────────────────────────

export const STUDIES      = 'studies';
export const SCREENS      = 'screens';
export const PARTICIPANTS = 'participants';
export const SESSIONS     = 'sessions';
export const EVENTS       = 'events';

export const SCREENSHOT_BUCKET = 'ux-tracker-screenshots';

// ─── Direct Supabase client (dashboard, setup, screenshot uploads) ────────────

let _client = null;
let _debug  = false;

function _wrap(op, err) {
  if (_debug) console.error(`UXTracker [${op}]:`, err);
  throw new Error(`UXTracker [${op}]: ${err?.message ?? String(err)}`);
}

export function initSupabaseClient(config) {
  if (!config?.supabaseUrl) {
    throw new Error('UXTracker [initSupabaseClient]: supabaseUrl is required');
  }
  if (!config?.supabaseKey) {
    throw new Error('UXTracker [initSupabaseClient]: supabaseKey is required');
  }
  if (_client) return _client;
  _debug  = Boolean(config.debug);
  _client = createClient(config.supabaseUrl, config.supabaseKey);
  return _client;
}

export function getClient() {
  if (!_client) {
    throw new Error(
      'UXTracker [getClient]: Supabase client not initialised — call initSupabaseClient first'
    );
  }
  return _client;
}

// ─── Ingest transport (prototype pages: participant + recorder DB ops) ────────

let _ingestUrl = null;

/**
 * Initialise the ingest transport. Must be called before any ingest-based
 * function. Throws if ingestUrl is not a valid URL string.
 */
export function initIngestTransport(ingestUrl) {
  try {
    new URL(ingestUrl);
  } catch {
    throw new Error('UXTracker [initIngestTransport]: ingestUrl must be a valid URL string');
  }
  _ingestUrl = ingestUrl;
}

/**
 * POST an action + payload to the ingest Edge Function.
 * Returns response.data on success; throws on network error or success: false.
 */
export async function ingest(action, payload) {
  if (!_ingestUrl) {
    throw new Error(
      'UXTracker [ingest]: transport not initialized — call initIngestTransport first'
    );
  }
  let response;
  try {
    const res = await fetch(_ingestUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, payload }),
    });
    response = await res.json();
  } catch (err) {
    throw new Error(`UXTracker ingest [${action}]: ${err?.message ?? String(err)}`);
  }
  if (!response.success) {
    throw new Error(`UXTracker ingest [${action}]: ${response.error ?? 'unknown error'}`);
  }
  return response.data;
}

// ─── Study operations (ingest) ───────────────────────────────────────────────

export async function fetchStudy(studyId) {
  return ingest('fetchStudy', { studyId });
}

export async function updateStudyScreenChangesFlag(studyId) {
  return ingest('updateStudyScreenChangesFlag', { studyId });
}

/**
 * Save the recorded ideal path (and optionally the survey points marked
 * during recording — the server converts them into screen-triggered surveys,
 * replacing previous recorder-sourced ones and keeping manual ones).
 */
export async function updateStudyIdealPath(studyId, idealPath, status, recordedSurveys = null) {
  return ingest('updateStudyIdealPath', { studyId, idealPath, status, recordedSurveys });
}

// ─── Screen operations (ingest) ──────────────────────────────────────────────

export async function fetchScreensForStudy(studyId) {
  return ingest('fetchScreensForStudy', { studyId });
}

export async function upsertScreen(screenData) {
  return ingest('upsertScreen', { screenData });
}

export async function markScreenStale(screenId, sessionId, observedHash, studyId) {
  return ingest('markScreenStale', { screenId, sessionId, observedHash, studyId });
}

// ─── Participant operations ──────────────────────────────────────────────────

export async function fetchParticipant(participantId, studyId) {
  return ingest('fetchParticipant', { participantId, studyId });
}

export async function bulkCreateParticipants(participantRows) {
  const { data, error } = await getClient()
    .from(PARTICIPANTS)
    .insert(participantRows)
    .select();
  if (error) _wrap('bulkCreateParticipants', error);
  return data;
}

export async function updateParticipantStatus(participantId, status, extra = {}) {
  return ingest('updateParticipantStatus', { participantId, status, extra });
}

// ─── Session operations ──────────────────────────────────────────────────────

export async function createSession(sessionData) {
  return ingest('createSession', { sessionData });
}

/**
 * Update a session record via the ingest Edge Function.
 * participantId is required for server-side ownership validation.
 */
export async function updateSession(sessionId, participantId, updates) {
  return ingest('updateSession', { sessionId, participantId, updates });
}

export async function fetchSessionsForStudy(studyId) {
  const { data, error } = await getClient()
    .from(SESSIONS)
    .select('*, participants!inner(label)')
    .eq('study_id', studyId)
    .order('started_at', { ascending: false });
  if (error) _wrap('fetchSessionsForStudy', error);
  return data.map(({ participants, ...row }) => ({
    ...row,
    participant_label: participants?.label ?? null,
  }));
}

// ─── Event operations ────────────────────────────────────────────────────────

export async function insertEvent(eventData) {
  return ingest('batchInsertEvents', { events: [eventData] });
}

export async function batchInsertEvents(eventRows) {
  return ingest('batchInsertEvents', { events: eventRows });
}

export async function fetchEventsForSession(sessionId) {
  const { data, error } = await getClient()
    .from(EVENTS)
    .select('*')
    .eq('session_id', sessionId)
    .order('timestamp', { ascending: true });
  if (error) _wrap('fetchEventsForSession', error);
  return data;
}

export async function fetchEventsForStudy(studyId) {
  const { data, error } = await getClient()
    .from(EVENTS)
    .select('*')
    .eq('study_id', studyId)
    .order('timestamp', { ascending: true });
  if (error) _wrap('fetchEventsForStudy', error);
  return data;
}

export async function fetchEventsForScreen(studyId, screenId) {
  const { data, error } = await getClient()
    .from(EVENTS)
    .select(
      'viewport_x, viewport_y, normalized_x, normalized_y, is_on_path, is_mis_click, session_id, participant_id'
    )
    .eq('study_id', studyId)
    .eq('screen_id', screenId)
    .eq('event_type', 'click');
  if (error) _wrap('fetchEventsForScreen', error);
  return data;
}

// ─── Storage operations (direct — recorder runs on a trusted machine) ─────────

/**
 * Build a flat, storage-safe object key for a screen's screenshot.
 *
 * Screen IDs are normalised URLs and routinely contain characters that are
 * unsafe in a Supabase Storage path: '/' (creates nested folders + a leading
 * '//'), and — critically — '?', '&', '=', '#' from query strings. Supabase's
 * getPublicUrl() wraps the path in encodeURI(), which does NOT escape '?'/'='/'&',
 * so a screen ID like '/page.html?x=y' yields a URL ending '…/page.html?x=y.png'
 * where '?x=y.png' is parsed as the query string — the object is uploaded under
 * a truncated key and the public URL 404s. Collapsing every unsafe character to
 * '_' produces a stable, round-trippable key (e.g. '_page.html_x_y').
 */
function _screenshotKey(studyId, screenId) {
  const safe = String(screenId).replace(/[^a-zA-Z0-9._-]/g, '_');
  return `${studyId}/${safe}.png`;
}

export async function uploadScreenshot(studyId, screenId, blob) {
  const path = _screenshotKey(studyId, screenId);
  const { error } = await getClient()
    .storage
    .from(SCREENSHOT_BUCKET)
    .upload(path, blob, { contentType: blob.type || 'image/png', upsert: true });
  if (error) _wrap('uploadScreenshot', error);
  const { data } = getClient().storage.from(SCREENSHOT_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

export async function getScreenshotUrl(studyId, screenId) {
  const path = _screenshotKey(studyId, screenId);
  const { data } = getClient().storage.from(SCREENSHOT_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}
