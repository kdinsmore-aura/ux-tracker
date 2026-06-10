/**
 * @module screen-id
 * @description
 * Computes stable, normalised screen identifier strings from the current
 * browser URL and optional custom screen detectors.
 *
 * Normalisation rules applied to every URL:
 *   1. Retain pathname, query string (minus stripped params), and hash fragment.
 *   2. Remove the query params: study, participant, mode.
 *   3. Strip trailing slashes from the pathname (root '/' is kept as-is).
 *   4. Lowercase the entire result.
 *   5. Fall back to '/' if the result would be empty.
 */

/** Query params that are internal to the tracker and must not affect the ID. */
const STRIP_PARAMS = new Set(['study', 'participant', 'mode']);

/**
 * Core normalisation — shared by computeScreenId and normalizeUrl.
 *
 * @param {string} pathname  e.g. '/checkout/'
 * @param {string} search    e.g. '?step=2&study=abc'  (leading '?' included or '')
 * @param {string} hash      e.g. '#confirm'           (leading '#' included or '')
 * @returns {string}
 */
function applyNormalization(pathname, search, hash) {
  const cleanPath = pathname.replace(/\/+$/, '') || '/';

  const params = new URLSearchParams(search);
  for (const key of STRIP_PARAMS) {
    params.delete(key);
  }

  const remaining = params.toString();
  const normalized = (cleanPath + (remaining ? '?' + remaining : '') + hash).toLowerCase();

  return normalized || '/';
}

/**
 * Compute a stable screen identifier for the current page.
 *
 * Custom detectors are checked first — if any returns true its key is used as
 * the ID (useful for SPAs that mutate state without changing the URL).
 * Otherwise the ID is derived from window.location by normalising the URL.
 *
 * @param {Object.<string, function(): boolean>} [customDetectors={}]
 *   Map of screen-label → predicate. Evaluated in insertion order.
 * @returns {string}  Never an empty string; at minimum '/'.
 */
export function computeScreenId(customDetectors = {}) {
  for (const [key, fn] of Object.entries(customDetectors)) {
    if (typeof fn === 'function' && fn()) {
      return key;
    }
  }

  const { pathname, search, hash } = window.location;
  return applyNormalization(pathname, search, hash);
}

/**
 * Apply the same normalisation as computeScreenId to an arbitrary full URL string.
 * Used by the recorder when saving screen records.
 *
 * @param {string} urlString  A fully-qualified URL, e.g. 'https://example.com/checkout?step=2'.
 * @returns {string}  The normalised pathname+search+hash, e.g. '/checkout?step=2'.
 */
export function normalizeUrl(urlString) {
  const url = new URL(urlString);
  return applyNormalization(url.pathname, url.search, url.hash);
}

/**
 * Returns true if two screen IDs refer to the same route, ignoring hash fragments.
 *
 * @example
 * areScreenIdsSameRoute('/pricing', '/pricing#plans') // true
 * areScreenIdsSameRoute('/pricing', '/checkout')      // false
 *
 * @param {string|null|undefined} screenIdA
 * @param {string|null|undefined} screenIdB
 * @returns {boolean}
 */
export function areScreenIdsSameRoute(screenIdA, screenIdB) {
  if (screenIdA == null || screenIdB == null) return false;
  return screenIdA.split('#')[0] === screenIdB.split('#')[0];
}
