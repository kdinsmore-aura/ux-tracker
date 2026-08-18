/**
 * Screenshot URL resolution for the researcher surfaces (dashboard + setup).
 *
 * The ux-tracker-screenshots bucket is PRIVATE, so a screenshot has no durable
 * URL — every <img src> has to be a short-lived signed URL minted at render
 * time. Signing reads storage.objects, which is granted to the `authenticated`
 * role only; both pages sign in before loading data, and the participant
 * runtime never renders screenshots, so nothing anonymous needs this.
 *
 * Loaded as a classic script (window.UXTrackerShots) because dashboard.js and
 * setup.js are plain scripts sharing the supabase-js UMD build — they cannot
 * import the ES helpers in src/utils/supabase-client.js. The path-extraction
 * rule here must stay in step with screenshotPathFromStored() there.
 */
(function () {
  'use strict';

  var BUCKET = 'ux-tracker-screenshots';

  // Long enough that a dashboard left open through a review session keeps
  // rendering; short enough that a copied URL is not a durable public link.
  // Surfaces re-sign whenever they reload their data.
  var TTL_SECONDS = 3600;

  /**
   * Normalise a persisted screenshot value to a bucket-relative object path.
   *
   * Rows written before the bucket went private hold absolute public URLs;
   * rows written since hold the bare path. Both must render, so accept either
   * rather than rewriting historical values — the object keys never changed,
   * only the way they are addressed. Returns null for empty input or a URL
   * pointing somewhere other than this bucket.
   */
  function pathFromStored(value) {
    if (!value || typeof value !== 'string') return null;
    var trimmed = value.trim();
    if (!trimmed) return null;
    // Anything carrying a scheme is treated as a URL and must point at this
    // bucket. Without this, a malformed value ('bogus://x') would fall through
    // as a path and get signed, yielding a URL that 404s at <img> load time
    // instead of the clean "No screenshot" state a null produces.
    if (!/:\/\//.test(trimmed)) {
      return trimmed.replace(/^\/+/, '').replace(new RegExp('^' + BUCKET + '/'), '');
    }
    if (!/^https?:\/\//i.test(trimmed)) return null;
    var marker = '/' + BUCKET + '/';
    var at = trimmed.indexOf(marker);
    if (at === -1) return null;
    var raw = trimmed.slice(at + marker.length).split(/[?#]/)[0];
    if (!raw) return null;
    // getPublicUrl() wrapped the key in encodeURI(); undo that so the path
    // matches the stored object key exactly.
    try { return decodeURIComponent(raw); } catch (e) { return raw; }
  }

  /**
   * Batch-sign stored screenshot values.
   *
   * Resolves to a plain object keyed by the ORIGINAL stored value, so callers
   * can look up what they already hold without tracking path conversion.
   * Unresolvable values, and objects Storage declines to sign (e.g. a capture
   * that failed to upload), map to null rather than failing the batch.
   */
  function signMany(db, values, expiresIn) {
    var out = {};
    var seen = {};
    var list = [];
    (values || []).forEach(function (v) {
      if (!v || seen[v]) return;
      seen[v] = true;
      list.push(v);
    });
    if (!list.length) return Promise.resolve(out);

    var pathFor = {};
    var uniquePaths = [];
    list.forEach(function (v) {
      var p = pathFromStored(v);
      if (!p) { out[v] = null; return; }
      pathFor[v] = p;
      if (uniquePaths.indexOf(p) === -1) uniquePaths.push(p);
    });
    if (!uniquePaths.length) return Promise.resolve(out);

    return db.storage
      .from(BUCKET)
      .createSignedUrls(uniquePaths, expiresIn || TTL_SECONDS)
      .then(function (res) {
        if (res.error) throw res.error;
        var signedFor = {};
        (res.data || []).forEach(function (entry) {
          if (entry && entry.path) signedFor[entry.path] = entry.signedUrl || null;
        });
        Object.keys(pathFor).forEach(function (orig) {
          var s = signedFor[pathFor[orig]];
          out[orig] = s === undefined ? null : s;
        });
        return out;
      });
  }

  window.UXTrackerShots = {
    BUCKET: BUCKET,
    TTL_SECONDS: TTL_SECONDS,
    pathFromStored: pathFromStored,
    signMany: signMany,
  };
})();
