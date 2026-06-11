/**
 * @module config
 * @description
 * Resolves, merges, validates, and freezes the UX Tracker framework configuration.
 *
 * Resolution order (earlier source wins):
 *   1. window.UXTracker  — set by the researcher before the <script> tag
 *   2. data-* attributes on the <script> tag that loaded tracker.js
 *   3. ?study= URL parameter (studyId only)
 *   4. Hard-coded defaults
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CONFIG FIELDS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * REQUIRED FIELDS (no default; must come from window.UXTracker or data-attribute)
 *
 * @property {string} ingestUrl
 *   URL of the Supabase Edge Function that handles all tracker DB operations.
 *   (e.g. "https://xyz.supabase.co/functions/v1/ux-tracker-ingest")
 *   Required when mode is 'participant' or 'record'. Replaces direct Supabase
 *   access on prototype pages — the anon key is no longer needed there.
 *   Sources: window.UXTracker, data-ingest-url
 *
 * @property {string} studyId
 *   The study identifier as stored in Supabase.
 *   Sources: window.UXTracker, data-study (optional), ?study= URL param
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OPTIONAL FIELDS (defaults shown)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @property {string} [supabaseUrl]
 *   The Supabase project URL (e.g. "https://xyz.supabase.co").
 *   No longer required on prototype pages when ingestUrl is set. Still used by
 *   the recorder for screenshot uploads (Storage access).
 *   Sources: window.UXTracker, data-supabase-url
 *
 * @property {string} [supabaseKey]
 *   The Supabase anon/public API key.
 *   No longer required on prototype pages when ingestUrl is set. Still used by
 *   the recorder for screenshot uploads (Storage access).
 *   Sources: window.UXTracker, data-supabase-key
 *
 * @property {'auto'|'record'|'participant'|'idle'} [mode='auto']
 *   Operating mode.
 *   - 'auto'        — resolved from URL params at runtime:
 *                       ?mode=record          → 'record'
 *                       ?study=X&participant=Y → 'participant'
 *                       otherwise             → 'idle'
 *   - 'record'      — researcher is building the study script
 *   - 'participant' — a participant is running a session
 *   - 'idle'        — tracker does nothing (safe no-op)
 *   Sources: window.UXTracker, data-mode
 *
 * @property {number} [screenshotDelay=600]
 *   Milliseconds to wait after a step trigger before capturing a screenshot.
 *   Must be a positive integer; falls back to 600 if invalid.
 *   Sources: window.UXTracker, data-screenshot-delay
 *
 * @property {'png'|'jpeg'} [screenshotFormat='png']
 *   Image format for captured screenshots.
 *   Falls back to 'png' if an unrecognised value is supplied.
 *   Sources: window.UXTracker, data-screenshot-format
 *
 * @property {boolean} [hashStalenessCheck=true]
 *   When true, the framework fingerprints the DOM on participant load and
 *   warns if it has changed since the study script was recorded.
 *   Pass the string 'false' via data-attribute to disable.
 *   Sources: window.UXTracker, data-hash-staleness-check
 *
 * @property {string} [sessionStorageKey='uxt_session']
 *   Prefix used for all sessionStorage keys written by the tracker.
 *   Sources: window.UXTracker, data-session-storage-key
 *
 * @property {Object.<string, function(): boolean>} [screens]
 *   Map of screen label → detector function. Used by SPAs that change state
 *   without triggering URL navigation. Each function should return true when
 *   the named screen is currently visible.
 *   Example: { 'dashboard': () => document.querySelector('[data-screen]')?.dataset.screen === 'dashboard' }
 *   Sources: window.UXTracker ONLY (functions cannot be serialised as data-attributes)
 *
 * @property {function(Object): void} [onComplete]
 *   Callback fired when a participant completes all tasks. Receives the
 *   completed session object as its sole argument.
 *   Sources: window.UXTracker ONLY
 *
 * @property {function({stepIndex: number, event: Event}): void} [onStepAdvance]
 *   Callback fired each time a participant advances a step. Receives an object
 *   with { stepIndex, event }.
 *   Sources: window.UXTracker ONLY
 *
 * @property {boolean} [debug=false]
 *   When true, the framework emits verbose console output.
 *   Presence of data-debug attribute (any value) sets this to true.
 *   Sources: window.UXTracker, data-debug
 */

export const CONFIG_VERSION = '1';

// sessionStorage key used to persist recording mode across page navigations.
export const RECORDING_SESSION_KEY = 'uxt_rec_session';

const DEFAULTS = {
  mode: 'auto',
  screenshotDelay: 600,
  screenshotFormat: 'png',
  hashStalenessCheck: true,
  sessionStorageKey: 'uxt_session',
  screens: undefined,
  onComplete: undefined,
  onStepAdvance: undefined,
  debug: false,
};

const VALID_MODES = new Set(['auto', 'record', 'participant', 'idle']);
const VALID_FORMATS = new Set(['png', 'jpeg']);

/**
 * Locate the <script> element that loaded tracker.js so we can read its
 * data-* attributes.  document.currentScript is null when the script is
 * deferred or loaded asynchronously, so we fall back to a DOM query.
 *
 * @returns {HTMLScriptElement|null}
 */
function findScriptElement() {
  // Synchronous / inline execution — the fast path.
  if (document.currentScript) {
    return document.currentScript;
  }

  // Deferred / async — prefer the new ingest-url format, fall back to legacy
  // supabase-url. Use the last matching element in document order.
  const byIngest = document.querySelectorAll('script[data-ingest-url]');
  if (byIngest.length > 0) return byIngest[byIngest.length - 1];

  const bySupabase = document.querySelectorAll('script[data-supabase-url]');
  return bySupabase.length > 0 ? bySupabase[bySupabase.length - 1] : null;
}

/**
 * Extract whichever data-* attributes are present on the given element and
 * return them as a partial config object.
 *
 * @param {HTMLScriptElement} el
 * @returns {Object}
 */
function readDataAttributes(el) {
  const partial = {};
  const d = el.dataset;

  if (d.ingestUrl !== undefined) partial.ingestUrl = d.ingestUrl;
  if (d.supabaseUrl !== undefined) partial.supabaseUrl = d.supabaseUrl;
  if (d.supabaseKey !== undefined) partial.supabaseKey = d.supabaseKey;
  if (d.study !== undefined) partial.studyId = d.study;
  if (d.mode !== undefined) partial.mode = d.mode;

  if (d.screenshotDelay !== undefined) {
    const parsed = parseInt(d.screenshotDelay, 10);
    partial.screenshotDelay = parsed;
  }

  if (d.screenshotFormat !== undefined) partial.screenshotFormat = d.screenshotFormat;

  if (d.hashStalenessCheck !== undefined) {
    partial.hashStalenessCheck = d.hashStalenessCheck !== 'false';
  }

  // Presence of data-debug (any value including empty string) enables debug.
  if ('debug' in d) partial.debug = true;

  return partial;
}

/**
 * When mode is 'auto', inspect the current URL's query string to derive the
 * effective operating mode.
 *
 * @returns {'record'|'participant'|'idle'}
 */
function resolveAutoMode() {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('mode') === 'record') return 'record';
    if (params.has('study') && params.has('participant')) return 'participant';
  } catch (_) {
    // URLSearchParams unavailable (unlikely in a browser context, but be safe).
  }
  return 'idle';
}

/**
 * Validate the merged config object, logging errors for missing required fields
 * and coercing invalid optional values back to their defaults.
 *
 * The framework intentionally does not throw — prototype sites should never
 * break because of a misconfiguration; they should just do nothing.
 *
 * @param {Object} cfg  Mutable merged config (will be modified in place)
 */
function validate(cfg) {
  const effectiveMode = cfg.mode === 'auto' ? resolveAutoMode() : cfg.mode;

  if (!VALID_MODES.has(cfg.mode)) {
    console.error(
      `[UXTracker] Invalid mode "${cfg.mode}". ` +
      `Accepted values: ${[...VALID_MODES].join(', ')}. Falling back to "auto".`
    );
    cfg.mode = 'auto';
  }

  if (effectiveMode !== 'idle') {
    if (!cfg.ingestUrl) {
      console.error('UXTracker: ingestUrl is required');
    }
    if (!cfg.studyId) {
      console.error('[UXTracker] Missing required config field: studyId');
    }
  }

  if (!VALID_FORMATS.has(cfg.screenshotFormat)) {
    console.error(
      `[UXTracker] Invalid screenshotFormat "${cfg.screenshotFormat}". ` +
      `Accepted values: png, jpeg. Falling back to "png".`
    );
    cfg.screenshotFormat = 'png';
  }

  if (!Number.isInteger(cfg.screenshotDelay) || cfg.screenshotDelay <= 0) {
    console.error(
      `[UXTracker] Invalid screenshotDelay "${cfg.screenshotDelay}". ` +
      `Must be a positive integer. Falling back to 600.`
    );
    cfg.screenshotDelay = 600;
  }
}

/**
 * Resolve, merge, validate, and freeze the framework configuration.
 *
 * Resolution order (earlier source wins):
 *   1. window.UXTracker
 *   2. data-* attributes on the tracker <script> element
 *   3. ?study= URL parameter (studyId only)
 *   4. Hard-coded defaults
 *
 * @returns {Readonly<Object>} Frozen configuration object
 */
export default function resolveConfig() {
  // Layer 3 — defaults (lowest priority, used as the base)
  const merged = { ...DEFAULTS };

  // Layer 2 — data-* attributes on the <script> element
  const scriptEl = findScriptElement();
  if (scriptEl) {
    Object.assign(merged, readDataAttributes(scriptEl));
  }

  // Layer 2.5 — URL param fallback for studyId (lower priority than data-study)
  if (!merged.studyId) {
    try {
      const paramStudyId = new URLSearchParams(window.location.search).get('study');
      if (paramStudyId) {
        merged.studyId = paramStudyId;
        console.debug('[UXTracker] studyId resolved from URL param');
      }
    } catch (_) {
      // URLSearchParams unavailable.
    }
  }

  // Layer 1 — window.UXTracker (highest priority, wins over everything)
  // Only copy own, non-undefined properties so researchers can omit fields
  // they don't want to override.
  const windowConfig =
    typeof window !== 'undefined' && window.UXTracker != null
      ? window.UXTracker
      : {};

  for (const key of Object.keys(windowConfig)) {
    if (windowConfig[key] !== undefined) {
      merged[key] = windowConfig[key];
    }
  }

  validate(merged);

  // Resolve 'auto' mode now so consumers always see a concrete mode value.
  if (merged.mode === 'auto') {
    merged.mode = resolveAutoMode();
  }

  // ── Recording session persistence ──────────────────────────────────────────
  // When ?mode=record is detected, save to sessionStorage so subsequent pages
  // in the same tab continue in record mode without needing URL params.
  // When mode resolves to idle, check for a saved recording session.
  try {
    if (merged.mode === 'record') {
      sessionStorage.setItem(RECORDING_SESSION_KEY, JSON.stringify({
        mode: 'record', studyId: merged.studyId || null,
      }));
    } else if (merged.mode === 'idle') {
      const saved = JSON.parse(sessionStorage.getItem(RECORDING_SESSION_KEY) || 'null');
      if (saved?.mode === 'record') {
        merged.mode = 'record';
        if (!merged.studyId && saved.studyId) merged.studyId = saved.studyId;
      }
    }
  } catch (_) {
    // sessionStorage unavailable (private-browsing quota, cross-origin) — skip.
  }

  return Object.freeze(merged);
}
