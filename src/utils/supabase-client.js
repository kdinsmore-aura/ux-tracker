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
  // The tracker is an embedded, anonymous script — it must NEVER adopt a
  // Supabase Auth session persisted by another app on the same origin.
  // supabase-js shares its localStorage session (sb-<ref>-auth-token) across
  // every client on an origin, so when a prototype page shares an origin with
  // the researcher tools (e.g. the GitHub Pages sample), a signed-in
  // researcher's JWT would silently replace the anon role on every storage
  // upload — and the bucket's anon-scoped RLS policies would reject them.
  _client = createClient(config.supabaseUrl, config.supabaseKey, {
    auth: {
      persistSession:   false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
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
 * Save the recorded ideal path, plus optionally:
 * - recordedSurveys: survey points marked during recording (the server
 *   converts them into screen-triggered surveys, replacing previous
 *   recorder-sourced ones and keeping manual ones)
 * - taskGoals: [{ taskIndex, goal }] derived from "End Task" boundaries;
 *   applied onto the study's tasks so completion is goal-based.
 * - newTasks: [{ prompt }] created in-recording; appended to the study's
 *   tasks (before goals are applied, so boundary indices line up).
 */
export async function updateStudyIdealPath(studyId, idealPath, status, recordedSurveys = null, taskGoals = null, newTasks = null) {
  return ingest('updateStudyIdealPath', { studyId, idealPath, status, recordedSurveys, taskGoals, newTasks });
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

// ─── Storage operations ───────────────────────────────────────────────────────
//
// The screenshots bucket is PRIVATE. Two consequences shape everything below:
//
//   1. Uploads go through the ingest Edge Function (service role), never
//      directly from the participant's browser. A direct anon upload with
//      upsert:true requires anon INSERT + UPDATE + SELECT on storage.objects,
//      and that SELECT is the same one that backs storage list() — it let
//      anyone with the publishable key enumerate every screenshot path.
//   2. There is no durable public URL. Uploads return an object PATH, and
//      researcher surfaces mint short-lived signed URLs at render time.

/**
 * Build a flat, storage-safe object key for a screen's screenshot.
 *
 * Screen IDs are normalised URLs and routinely contain characters that are
 * unsafe in a Supabase Storage path: '/' (creates nested folders + a leading
 * '//'), and — critically — '?', '&', '=', '#' from query strings. Collapsing
 * every unsafe character to '_' produces a stable, round-trippable key
 * (e.g. '_page.html_x_y'). The Edge Function applies the identical collapse;
 * both must agree or a re-record writes a second object instead of
 * overwriting the first.
 */
function _screenshotKey(studyId, screenId) {
  const safe = String(screenId).replace(/[^a-zA-Z0-9._-]/g, '_');
  return `${studyId}/${safe}.png`;
}

/**
 * Upload a screenshot via the ingest Edge Function and return its object path.
 *
 * Returns a PATH ('<studyId>/<screenId>.png'), not a URL — the bucket is
 * private. Callers persist this value; renderers pass it through
 * signScreenshotUrls() to get something an <img src> can load.
 */
export async function uploadScreenshot(studyId, screenId, blob) {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  // Chunked so a multi-hundred-KB screenshot cannot blow the argument limit
  // that String.fromCharCode(...spread) hits on large arrays.
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  const data = await ingest('uploadScreenshot', {
    studyId,
    screenId,
    contentType: blob.type || 'image/png',
    data: btoa(binary),
  });
  return data?.path ?? _screenshotKey(studyId, screenId);
}

/**
 * Normalise a persisted screenshot value to a bucket-relative object path.
 *
 * Rows written before the bucket went private hold absolute public URLs
 * ('https://<ref>.supabase.co/storage/v1/object/public/<bucket>/<path>').
 * Rows written since hold the bare path. Both must render, so accept either
 * rather than migrating historical values — the object keys never changed,
 * only the way they are addressed.
 *
 * Returns null for empty input or a URL that does not point at this bucket.
 */
export function screenshotPathFromStored(value) {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  // Anything carrying a scheme is treated as a URL and must point at this
  // bucket. Without this, a malformed value ('bogus://x') would fall through as
  // a path and get signed, yielding a URL that 404s at <img> load time instead
  // of the clean "No screenshot" state a null produces.
  if (!/:\/\//.test(trimmed)) {
    // Already a path. Tolerate a leading slash and a legacy bucket prefix.
    return trimmed.replace(/^\/+/, '').replace(new RegExp(`^${SCREENSHOT_BUCKET}/`), '');
  }
  if (!/^https?:\/\//i.test(trimmed)) return null;
  const marker = `/${SCREENSHOT_BUCKET}/`;
  const at = trimmed.indexOf(marker);
  if (at === -1) return null;
  const raw = trimmed.slice(at + marker.length).split(/[?#]/)[0];
  if (!raw) return null;
  // getPublicUrl() wrapped the key in encodeURI(); undo that so the path
  // matches the stored object key exactly.
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** Default signed-URL lifetime. Long enough that a dashboard left open through
 *  a review session keeps rendering; short enough that a copied URL is not a
 *  durable public link. Surfaces re-sign whenever they reload their data. */
export const SIGNED_URL_TTL_SECONDS = 3600;

/**
 * Batch-sign stored screenshot values for display.
 *
 * Takes the values as persisted (public URL or path) and returns a Map from
 * the ORIGINAL value to a signed URL, so callers can swap in place without
 * tracking the path conversion themselves. Values that cannot be resolved, or
 * that Storage declines to sign (a missing object), map to null.
 *
 * Requires an authenticated session: signing reads storage.objects, which is
 * granted to the authenticated role only. Researcher surfaces (dashboard,
 * setup) are signed in; the participant runtime never renders screenshots.
 */
export async function signScreenshotUrls(values, expiresIn = SIGNED_URL_TTL_SECONDS) {
  const out = new Map();
  const list = Array.from(new Set((values || []).filter(Boolean)));
  if (!list.length) return out;

  // Original value → path, deduped by path so one object is signed once even
  // when both a public URL and a bare path for it appear in the same payload.
  const pathFor = new Map();
  const uniquePaths = new Set();
  for (const v of list) {
    const p = screenshotPathFromStored(v);
    if (!p) { out.set(v, null); continue; }
    pathFor.set(v, p);
    uniquePaths.add(p);
  }
  if (!uniquePaths.size) return out;

  const paths = Array.from(uniquePaths);
  const { data, error } = await getClient()
    .storage
    .from(SCREENSHOT_BUCKET)
    .createSignedUrls(paths, expiresIn);
  if (error) _wrap('signScreenshotUrls', error);

  // createSignedUrls resolves per item: a missing object yields an entry with
  // error set and signedUrl null rather than failing the whole batch.
  const signedFor = new Map();
  for (const entry of data || []) {
    const key = entry?.path ?? null;
    if (key) signedFor.set(key, entry?.signedUrl ?? null);
  }
  for (const [orig, p] of pathFor) {
    out.set(orig, signedFor.get(p) ?? null);
  }
  return out;
}

/** Sign a single stored screenshot value. Returns null if it cannot be signed. */
export async function signScreenshotUrl(value, expiresIn = SIGNED_URL_TTL_SECONDS) {
  const map = await signScreenshotUrls([value], expiresIn);
  return map.get(value) ?? null;
}
