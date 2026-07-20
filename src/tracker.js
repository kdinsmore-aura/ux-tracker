import resolveConfig, { CONFIG_VERSION } from './utils/config.js';
import {
  initSupabaseClient,
  initIngestTransport,
  fetchStudy,
  batchInsertEvents,
} from './utils/supabase-client.js';
import { captureClickCoordinates } from './utils/coordinates.js';
import { computeScreenId } from './utils/screen-id.js';
import { computePageFingerprint } from './utils/fingerprint.js';

// ─── Module state ─────────────────────────────────────────────────────────────

let _config = null;
let _eventBuffer = [];
let _clickListener = null;

// ─── Session storage ──────────────────────────────────────────────────────────

function _storageKey(participantId) {
  return `${_config.sessionStorageKey}_${participantId}`;
}

/**
 * Read and parse the persisted session state for a participant.
 * Returns null if nothing is stored or the stored value cannot be parsed.
 */
export function getSessionState(participantId) {
  try {
    const raw = sessionStorage.getItem(_storageKey(participantId));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Serialize and persist the session state.
 * Always stamps lastActivityAt with the current time before writing.
 *
 * The live event buffer is always carried along unless the caller passes an
 * explicit eventBuffer (bufferEvent's snapshot, flushEventBuffer's []). This
 * module owns the buffer, and callers persisting unrelated state (step
 * advance, task complete, minimize) used to overwrite the stored copy with
 * nothing — losing every un-flushed event on the next page navigation.
 */
export function saveSessionState(participantId, stateObject) {
  try {
    sessionStorage.setItem(
      _storageKey(participantId),
      JSON.stringify({
        ...stateObject,
        eventBuffer: stateObject.eventBuffer ?? [..._eventBuffer],
        lastActivityAt: new Date().toISOString(),
      }),
    );
  } catch {
    // Quota exceeded or private-browsing restrictions — silently skip.
  }
}

/** Remove the persisted session entry for a participant. */
export function clearSessionState(participantId) {
  try {
    sessionStorage.removeItem(_storageKey(participantId));
  } catch {
    // Ignore — nothing critical depends on this succeeding.
  }
}

/**
 * Return true if the session has been inactive longer than timeoutMinutes.
 * Used to auto-abandon sessions after a long absence (e.g. closed tab, lunch).
 */
export function isSessionExpired(stateObject, timeoutMinutes = 30) {
  if (!stateObject?.lastActivityAt) return true;
  return Date.now() - new Date(stateObject.lastActivityAt).getTime() > timeoutMinutes * 60_000;
}

// ─── Event buffering ──────────────────────────────────────────────────────────

// These event types signal end-of-session and should trigger an immediate flush.
const FLUSH_TRIGGER_TYPES = new Set(['session_complete', 'session_abandon']);

// Client-generated id stamped on every event so the server can deduplicate.
// Events are delivered at-least-once by design: the unload beacon AND the
// next page's re-flush of the persisted buffer may both succeed, and the
// completion path double-flushes by racing design. The unique id makes every
// duplicate delivery a no-op instead of a duplicate row.
function _clientEventId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/**
 * Add an event to the in-memory buffer and persist it to sessionStorage.
 * Triggers an async flush when the buffer reaches 20 events or the event
 * type demands it (session_complete, session_abandon).
 */
export function bufferEvent(eventData, sessionState, participantId) {
  if (!eventData.client_event_id) eventData.client_event_id = _clientEventId();
  _eventBuffer.push(eventData);
  saveSessionState(participantId, { ...sessionState, eventBuffer: [..._eventBuffer] });

  if (_eventBuffer.length >= 20 || FLUSH_TRIGGER_TYPES.has(eventData.event_type)) {
    // Fire-and-forget — callers that need to await completion call flushEventBuffer directly.
    flushEventBuffer(sessionState, participantId);
  }
}

/**
 * Send all buffered events to Supabase.
 * On failure, events are kept in the buffer so they can be retried next flush.
 */
export async function flushEventBuffer(sessionState, participantId) {
  if (_eventBuffer.length === 0) return;

  const snapshot = [..._eventBuffer];

  try {
    await batchInsertEvents(snapshot);
    _eventBuffer = [];
    const current = getSessionState(participantId);
    if (current) {
      saveSessionState(participantId, { ...current, eventBuffer: [] });
    }
  } catch (err) {
    console.error('[UXTracker] Failed to flush event buffer:', err);
    // Do not clear the buffer — keep events for the next flush attempt.
  }
}

/**
 * Restore the in-memory event buffer from a previously persisted session.
 * Call this when resuming a session from sessionStorage before new events arrive.
 */
export function setEventBuffer(events) {
  _eventBuffer = Array.isArray(events) ? [...events] : [];
}

// ─── Click capture ────────────────────────────────────────────────────────────

/**
 * Compute a stable CSS-like selector for an element, using the most specific
 * and durable attribute available.
 *
 * Priority:
 *   1. [data-testid="value"]
 *   2. #unique-id  (only when the id is unique in the document)
 *   3. tag[aria-label="..."] or tag[text="abbreviated..."] for interactive elements
 *   4. tag:nth-child(n) relative to parent
 */
export function getElementSelector(element) {
  const MAX = 200;
  const clip = (s) => (s.length > MAX ? s.slice(0, MAX) : s);

  // 1. data-testid — most stable across refactors.
  const testId = element.dataset?.testid;
  if (testId) return clip(`[data-testid="${testId}"]`);

  // 1.5. data-track — analytics hooks make equally stable, readable selectors.
  const track = element.dataset?.track;
  if (track) return clip(`[data-track="${track}"]`);

  // 2. Unique id.
  if (element.id) {
    try {
      const escaped = typeof CSS !== 'undefined' && CSS.escape
        ? CSS.escape(element.id)
        : element.id.replace(/[^\w-]/g, (c) => `\\${c}`);
      if (document.querySelectorAll(`#${escaped}`).length === 1) {
        return clip(`#${element.id}`);
      }
    } catch {
      // querySelectorAll throws on some malformed ids — fall through.
    }
  }

  const tag = element.tagName.toLowerCase();

  // 3. Interactive elements: prefer aria-label, fall back to text content.
  if (tag === 'button' || tag === 'a' || tag === 'input') {
    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel) return clip(`${tag}[aria-label="${ariaLabel}"]`);

    const text = element.textContent?.trim();
    if (text) {
      const abbrev = text.slice(0, 50).replace(/"/g, '\\"');
      return clip(`${tag}[text="${abbrev}"]`);
    }
  }

  // 4. nth-child fallback — fragile but always produces a result.
  const parent = element.parentElement;
  if (parent) {
    const index = Array.from(parent.children).indexOf(element) + 1;
    return `${tag}:nth-child(${index})`;
  }

  return clip(tag);
}

// Clicks on tracker UI components must never appear in the recorded path or event stream.
// Closed shadow DOM retargets clicks inside the panel to the host element, so tagName is enough.
const _UXT_COMPONENTS = new Set(['uxt-recorder-panel', 'uxt-task-panel']);

// Human-readable label for a clicked element. Visible text first (whitespace
// collapsed); when there is none — or it carries no letters/digits, like an
// emoji-only icon — fall back to the accessibility metadata a well-labeled
// control provides: aria-label, title, image alt, then input placeholder/name.
function _clickLabel(el) {
  const clip = (s) => s.replace(/\s+/g, ' ').trim().slice(0, 200);
  const text = el.textContent ? clip(el.textContent) : '';
  const meaningful = /[\p{L}\p{N}]/u.test(text);
  if (meaningful) return text;

  const attr = (n) => {
    const v = typeof el.getAttribute === 'function' ? el.getAttribute(n) : null;
    return v ? clip(v) : '';
  };
  const fallback =
    attr('aria-label') ||
    attr('title') ||
    (el.tagName === 'IMG' ? attr('alt') : clip(el.querySelector?.('img[alt]')?.getAttribute('alt') ?? '')) ||
    attr('placeholder') ||
    attr('name');
  return fallback || text;   // emoji-only text still beats nothing
}

// The raw click target is often decoration — an icon, an svg path, a span
// inside the real control. Resolve to the nearest interactive ancestor so
// reporting names the button, not its ornament.
const _INTERACTIVE = 'a, button, input, select, textarea, label, [role="button"], [data-testid], [data-track], [aria-label], [onclick]';

/**
 * Attach a single capturing click listener on document.
 * Fires onClickCallback with enriched coordinate and element metadata.
 * Does not call preventDefault or stopPropagation.
 */
export function startClickCapture(onClickCallback) {
  _clickListener = (event) => {
    const raw = event.target;
    if (_UXT_COMPONENTS.has(raw.tagName?.toLowerCase())) return;
    const el = (typeof raw.closest === 'function' && raw.closest(_INTERACTIVE)) || raw;
    onClickCallback({
      ...captureClickCoordinates(event),
      elementSelector: getElementSelector(el),
      elementText: _clickLabel(el),
      elementTagName: el.tagName.toLowerCase(),
    });
  };

  document.addEventListener('click', _clickListener, { capture: true });
}

/** Remove the delegated click listener installed by startClickCapture. */
export function stopClickCapture() {
  if (_clickListener) {
    document.removeEventListener('click', _clickListener, { capture: true });
    _clickListener = null;
  }
}

// ─── Screen change detection ──────────────────────────────────────────────────

/**
 * Fingerprint the current DOM and compare it against the hash stored on a screen.
 * Returns { changed: false } immediately when hashStalenessCheck is disabled.
 */
export async function checkScreenForChanges(screen, config) {
  if (!config.hashStalenessCheck) return { changed: false };

  const observedHash = await computePageFingerprint();
  if (observedHash !== screen.screenshot_hash) {
    return { changed: true, recordedHash: screen.screenshot_hash, observedHash };
  }

  return { changed: false };
}

// ─── Unload flush ─────────────────────────────────────────────────────────────

// Synchronous XHR used as the fallback when sendBeacon is unavailable.
// Synchronous XHR is deprecated in the main thread but still the only way
// to make a guaranteed-delivery network call inside a beforeunload handler.
function _syncXhrPost(url, body) {
  try {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url, false); // false = synchronous
    // text/plain skips the CORS preflight (see _handleUnload) — a preflight
    // cannot complete during page teardown.
    xhr.setRequestHeader('Content-Type', 'text/plain');
    xhr.send(body);
  } catch {
    // Nothing we can do during page teardown.
  }
}

function _handleUnload() {
  if (!_config || _eventBuffer.length === 0) return;
  if (!_config.ingestUrl) return;

  const body = JSON.stringify({
    action: 'batchInsertEvents',
    payload: { events: _eventBuffer },
  });
  const url = _config.ingestUrl;

  // text/plain, NOT application/json: a beacon with a non-safelisted content
  // type requires a CORS preflight, which cannot happen during page teardown —
  // the beacon silently never arrives and every event from the page is lost.
  // The Edge Function parses the body regardless of content type.
  if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
    const blob = new Blob([body], { type: 'text/plain' });
    const queued = navigator.sendBeacon(url, blob);
    if (!queued) _syncXhrPost(url, body);
  } else {
    _syncXhrPost(url, body);
  }

  // In-memory buffer dies with the page; the persisted copy in sessionStorage
  // is deliberately left intact so the next page re-flushes it in case the
  // beacon was dropped. Server-side dedupe (client_event_id) makes the
  // double-delivery harmless.
  _eventBuffer = [];
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

// Show a visible error badge in record mode so misconfiguration is obvious.
function _recordError(msg) {
  console.error('[UXTracker]', msg);
  const show = () => {
    const el = document.createElement('div');
    el.style.cssText = [
      'position:fixed', 'bottom:24px', 'right:24px', 'z-index:999999',
      'background:#f38ba8', 'color:#1e1e2e',
      'font:600 12px/1.5 system-ui,sans-serif',
      'padding:10px 16px', 'border-radius:10px',
      'box-shadow:0 4px 20px rgba(0,0,0,.45)',
      'max-width:300px', 'white-space:pre-wrap',
    ].join(';');
    el.textContent = `UX Tracker — Recording Error\n${msg}`;
    document.body.appendChild(el);
  };
  if (document.body) show();
  else window.addEventListener('DOMContentLoaded', show);
}

async function _boot() {
  _config = resolveConfig();

  // Step 2: idle mode — exit without touching Supabase or the DOM.
  if (_config.mode === 'idle') return;

  const inRecordMode = _config.mode === 'record';

  // Step 3: initialize transports.
  // ingestUrl — required for all DB operations on prototype pages.
  // supabaseUrl + supabaseKey — optional; only needed for screenshot uploads (record mode).
  if (_config.ingestUrl) {
    initIngestTransport(_config.ingestUrl);
  }
  if (_config.supabaseUrl && _config.supabaseKey) {
    initSupabaseClient(_config);
  }
  if (!_config.ingestUrl && !(_config.supabaseUrl && _config.supabaseKey)) {
    if (inRecordMode) _recordError('No ingest URL configured.\nAdd data-ingest-url to your script tag.');
    else console.error('[UXTracker] Neither ingestUrl nor supabase credentials are configured.');
    return;
  }

  // Step 4: load the study record.
  let study;
  try {
    study = await fetchStudy(_config.studyId);
  } catch (err) {
    if (inRecordMode) _recordError(`Could not reach the Edge Function.\n${err.message}\n\nCheck that SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set in your Supabase Edge Function environment.`);
    else console.error('[UXTracker] Failed to load study:', err);
    return;
  }

  // Step 5: study must exist.
  if (!study) {
    if (inRecordMode) _recordError(`Study not found (id: ${_config.studyId}).\nVerify the study ID and that the study has been saved.`);
    else console.error('[UXTracker] Study not found:', _config.studyId);
    return;
  }

  // Step 6: closed studies accept no new sessions.
  if (study.status === 'closed') {
    console.warn('[UXTracker] Study is closed — no new sessions will be started.');
    return;
  }

  // Step 7: resolveConfig() already consumed URL params when mode was 'auto'
  // and returned a concrete mode. Explicit config ('record' or 'participant'
  // set via window.UXTracker or a data-attribute) must not be overridden here
  // by URL params — the researcher's explicit setting wins.
  // Step 2 already exited for 'idle', so _config.mode is 'record' or 'participant'.
  const resolvedMode = _config.mode;

  // Register unload handlers now that we know we'll be capturing events.
  window.addEventListener('pagehide', _handleUnload);
  window.addEventListener('beforeunload', _handleUnload);

  // Step 8: delegate to the correct sub-module.
  console.info(`[UXTracker] initialized in ${resolvedMode} mode`);

  if (resolvedMode === 'record') {
    const { default: initRecorder } = await import('./recorder.js');
    await initRecorder(_config, study);
  } else {
    const { default: initParticipant } = await import('./participant.js');
    await initParticipant(_config, study);
  }
}

_boot().catch((err) => {
  console.error('[UXTracker] Boot error:', err);
});
