/**
 * @module fingerprint
 * @description
 * Structural DOM fingerprinting for change detection.
 *
 * The fingerprint is built from the interactive elements present on a page
 * (links, buttons, inputs, etc.) — the things a participant actually interacts
 * with — rather than from the full DOM tree.  This makes the hash stable
 * against cosmetic layout changes while still catching meaningful structural
 * mutations such as a button being removed or relabelled.
 *
 * Dynamic sections (marked with [data-dynamic="true"], the class .dynamic, or
 * the id #dynamic) are excluded so that live-updating counters, prices, and
 * timestamps do not produce false positives.
 *
 * All hashing uses the browser's native SubtleCrypto API (SHA-256).
 * Callers must await computePageFingerprint().
 */

const INTERACTIVE_SELECTOR = [
  'a',
  'button',
  'input',
  'select',
  'textarea',
  '[role="button"]',
  '[role="link"]',
  '[role="tab"]',
  '[role="menuitem"]',
].join(', ');

const DYNAMIC_SELECTOR = '[data-dynamic="true"], .dynamic, #dynamic';

/**
 * Compute a structural DOM fingerprint for the current page.
 *
 * Traverses the live DOM, extracts a stable signature from all interactive
 * elements (excluding dynamic regions), serialises it to JSON, and returns a
 * SHA-256 hex hash of that JSON.
 *
 * @returns {Promise<string>}  Resolves to a 64-character lowercase hex string.
 */
export async function computePageFingerprint() {
  const all = Array.from(document.querySelectorAll(INTERACTIVE_SELECTOR));

  // Exclude elements that live inside a dynamic container.
  const elements = all.filter(el => el.closest(DYNAMIC_SELECTOR) === null);

  const tagCounts = {};
  const elementData = elements.map(el => {
    const tag = el.tagName.toLowerCase();
    tagCounts[tag] = (tagCounts[tag] || 0) + 1;

    const entry = {
      tag,
      text: el.textContent.trim().slice(0, 80),
    };

    if (el.id) entry.id = el.id;
    if (el.dataset.testid) entry.testid = el.dataset.testid;

    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) entry.ariaLabel = ariaLabel;

    // href only for anchor elements (and role="link" elements that carry one).
    const href = el.getAttribute('href');
    if (href) entry.href = href;

    // type only for form controls where it carries semantic meaning.
    if (tag === 'input' || tag === 'button') {
      const type = el.getAttribute('type');
      if (type) entry.type = type;
    }

    return entry;
  });

  const signature = {
    title: document.title,
    tagCounts,
    elements: elementData,
  };

  return hashString(JSON.stringify(signature));
}

/**
 * Return the SHA-256 hex hash of an arbitrary string.
 *
 * Uses the SubtleCrypto API — callers must await this function.
 *
 * @param {string} str
 * @returns {Promise<string>}  64-character lowercase hex string.
 */
export async function hashString(str) {
  const data = new TextEncoder().encode(str);
  const buffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Compare two fingerprint hashes for equality.
 *
 * Returns false if either argument is null or undefined rather than throwing,
 * so callers can safely compare even when one fingerprint has not yet been
 * computed.
 *
 * @param {string|null|undefined} hashA
 * @param {string|null|undefined} hashB
 * @returns {boolean}
 */
export function doFingerprintsMatch(hashA, hashB) {
  if (hashA == null || hashB == null) return false;
  return hashA === hashB;
}
