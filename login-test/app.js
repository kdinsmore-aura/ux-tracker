/**
 * Orbit Auth Prototype — App Utilities
 * =======================================
 * Navigation helpers + tracking shim.
 * This is prototype code — not for production.
 */

// ─── Navigation ──────────────────────────────────────────────────────────────
const Proto = {
  /** Navigate to a page, optionally with query params */
  go(path, params) {
    if (params && Object.keys(params).length) {
      path += '?' + new URLSearchParams(params).toString();
    }
    window.location.href = path;
  },

  /** Get a query param from the current URL */
  param(key) {
    return new URLSearchParams(window.location.search).get(key);
  },

  /** Lightweight prototype session state (not secure — prototype only) */
  setUser(data)  { try { sessionStorage.setItem('orbit_user', JSON.stringify(data)); } catch(_) {} },
  getUser()      { try { return JSON.parse(sessionStorage.getItem('orbit_user')); } catch(_) { return null; } },
  clearUser()    { try { sessionStorage.removeItem('orbit_user'); } catch(_) {} },
};


// ─── Tracking Shim ───────────────────────────────────────────────────────────
/**
 * Drop-in tracking shim. Replace each console.log with your analytics SDK:
 *
 *   Mixpanel:    mixpanel.track(name, props)
 *   Amplitude:   amplitude.track(name, props)
 *   PostHog:     posthog.capture(name, props)
 *   Segment:     analytics.track(name, props)
 *   FullStory:   FS.event(name, props)
 *
 * The Track.page() call fires automatically on each page load (see bottom of
 * each HTML file). Track.event() is wired to every meaningful interaction.
 * Track.identify() fires after successful signup or login.
 */
const Track = {
  event(name, props = {}) {
    console.log('%c[TRACK event]', 'color:#6366f1;font-weight:600', name, props);
    // ↓ Replace with your SDK:
    // analytics.track(name, props);
  },

  page(name, props = {}) {
    console.log('%c[TRACK page]', 'color:#0ea5e9;font-weight:600', name, props);
    // ↓ Replace with your SDK:
    // analytics.page(name, props);
  },

  identify(userId, traits = {}) {
    console.log('%c[TRACK identify]', 'color:#10b981;font-weight:600', userId, traits);
    // ↓ Replace with your SDK:
    // analytics.identify(userId, traits);
  },
};


// ─── UI Helpers ──────────────────────────────────────────────────────────────

/** Show a spinner on a button and disable it */
function btnLoading(btn, loading) {
  if (loading) {
    btn.dataset.origHtml = btn.innerHTML;
    btn.innerHTML = `<span class="spinner${btn.classList.contains('btn-outline') ? ' spinner-dark' : ''}"></span>`;
    btn.disabled = true;
  } else {
    if (btn.dataset.origHtml) btn.innerHTML = btn.dataset.origHtml;
    btn.disabled = false;
  }
}

/** Show a field-level error message */
function showFieldError(inputEl, errorEl, msg) {
  inputEl.classList.add('is-error');
  errorEl.textContent = msg;
  errorEl.style.display = 'block';
}

/** Clear all field errors in a form */
function clearFieldErrors(formEl) {
  formEl.querySelectorAll('input').forEach(el => el.classList.remove('is-error'));
  formEl.querySelectorAll('.field-error').forEach(el => {
    el.textContent = '';
    el.style.display = 'none';
  });
}

/** Basic email validation */
function isEmail(val) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val.trim());
}

/** Mask an email address for display (e.g. ke***@example.com) */
function maskEmail(email) {
  const [local, domain] = email.split('@');
  if (!domain) return email;
  const visible = local.slice(0, 2);
  return `${visible}${'*'.repeat(Math.max(3, local.length - 2))}@${domain}`;
}

/** Mask a phone number (e.g. +1 •••• •••• 1234) */
function maskPhone(phone) {
  const digits = phone.replace(/\D/g, '');
  return `•••• •••• ${digits.slice(-4)}`;
}

/** Password strength scorer (returns 0–4) */
function passwordStrength(pw) {
  let score = 0;
  if (pw.length >= 8)  score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw))   score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  return Math.min(4, score);
}

const strengthLabels = ['', 'Weak', 'Fair', 'Good', 'Strong'];
const strengthColors = ['', '#EF4444', '#F59E0B', '#3B82F6', '#22C55E'];
