import { createClient } from '@supabase/supabase-js';

// ─── Table name constants ────────────────────────────────────────────────────

export const STUDIES      = 'studies';
export const SCREENS      = 'screens';
export const PARTICIPANTS = 'participants';
export const SESSIONS     = 'sessions';
export const EVENTS       = 'events';

export const SCREENSHOT_BUCKET = 'ux-tracker-screenshots';

// ─── Client lifecycle ────────────────────────────────────────────────────────

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

// ─── Study operations ────────────────────────────────────────────────────────

export async function fetchStudy(studyId) {
  const { data, error } = await getClient()
    .from(STUDIES)
    .select('*')
    .eq('id', studyId)
    .maybeSingle();
  if (error) _wrap('fetchStudy', error);
  return data;
}

export async function updateStudyScreenChangesFlag(studyId) {
  const { error } = await getClient()
    .from(STUDIES)
    .update({ has_screen_changes: true, updated_at: new Date().toISOString() })
    .eq('id', studyId);
  if (error) _wrap('updateStudyScreenChangesFlag', error);
}

// ─── Screen operations ───────────────────────────────────────────────────────

export async function fetchScreensForStudy(studyId) {
  const { data, error } = await getClient()
    .from(SCREENS)
    .select('*')
    .eq('study_id', studyId);
  if (error) _wrap('fetchScreensForStudy', error);
  return data;
}

export async function upsertScreen(screenData) {
  const { data, error } = await getClient()
    .from(SCREENS)
    .upsert(screenData, { onConflict: 'study_id,screen_id' })
    .select()
    .single();
  if (error) _wrap('upsertScreen', error);
  return data;
}

export async function markScreenStale(screenId, sessionId) {
  const { error } = await getClient()
    .from(SCREENS)
    .update({
      is_stale:               true,
      change_detected_at:     new Date().toISOString(),
      first_stale_session_id: sessionId,
    })
    .eq('id', screenId)
    .eq('is_stale', false);
  if (error) _wrap('markScreenStale', error);
}

// ─── Participant operations ──────────────────────────────────────────────────

export async function fetchParticipant(participantId, studyId) {
  const { data, error } = await getClient()
    .from(PARTICIPANTS)
    .select('*')
    .eq('id', participantId)
    .eq('study_id', studyId)
    .maybeSingle();
  if (error) _wrap('fetchParticipant', error);
  return data;
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
  const { error } = await getClient()
    .from(PARTICIPANTS)
    .update({ status, ...extra })
    .eq('id', participantId);
  if (error) _wrap('updateParticipantStatus', error);
}

// ─── Session operations ──────────────────────────────────────────────────────

export async function createSession(sessionData) {
  const { data, error } = await getClient()
    .from(SESSIONS)
    .insert(sessionData)
    .select()
    .single();
  if (error) _wrap('createSession', error);
  return data;
}

export async function updateSession(sessionId, updates) {
  const { error } = await getClient()
    .from(SESSIONS)
    .update(updates)
    .eq('id', sessionId);
  if (error) _wrap('updateSession', error);
}

export async function fetchSessionsForStudy(studyId) {
  const { data, error } = await getClient()
    .from(SESSIONS)
    .select('*, participants!inner(label)')
    .eq('study_id', studyId)
    .order('started_at', { ascending: false });
  if (error) _wrap('fetchSessionsForStudy', error);
  // Flatten participant_label to match the expected shape
  return data.map(({ participants, ...row }) => ({
    ...row,
    participant_label: participants?.label ?? null,
  }));
}

// ─── Event operations ────────────────────────────────────────────────────────

export async function insertEvent(eventData) {
  const { data, error } = await getClient()
    .from(EVENTS)
    .insert(eventData)
    .select()
    .single();
  if (error) _wrap('insertEvent', error);
  return data;
}

export async function batchInsertEvents(eventRows) {
  const { data, error } = await getClient()
    .from(EVENTS)
    .insert(eventRows)
    .select();
  if (error) _wrap('batchInsertEvents', error);
  return data;
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

// ─── Storage operations ──────────────────────────────────────────────────────

export async function uploadScreenshot(studyId, screenId, blob) {
  const path = `${studyId}/${screenId}.png`;
  const { error } = await getClient()
    .storage
    .from(SCREENSHOT_BUCKET)
    .upload(path, blob, { contentType: blob.type || 'image/png', upsert: true });
  if (error) _wrap('uploadScreenshot', error);
  const { data } = getClient().storage.from(SCREENSHOT_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

export async function getScreenshotUrl(studyId, screenId) {
  const path = `${studyId}/${screenId}.png`;
  const { data } = getClient().storage.from(SCREENSHOT_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}
