# Building a Tracking-Ready Prototype for UX Tracker

**Give this file to your AI coding assistant before it writes or edits a prototype.** It is written to be read by an LLM (Claude, ChatGPT, Copilot, Cursor, etc.) as a hard specification. Everything below is derived from how UX Tracker actually resolves identity at runtime — following it is the difference between a report that says *"7 participants clicked **Continue to billing** on step 3"* and one that says *"7 participants clicked `div:nth-child(4)`"*.

> [!NOTE]
> **Scope**
> This document covers **how to code the prototype**. It does not cover creating a study, recording the ideal path, or reading the dashboard.

---

## 1. What UX Tracker needs from your prototype

UX Tracker is a single `<script>` tag. It records a researcher's ideal click path once, then replays that path against each participant's session. To do that it must answer two questions on every interaction:

| Question | How the tracker answers it | What you control |
|---|---|---|
| **Which screen is the user on?** | A normalised screen ID: `pathname + remaining query + hash`, lowercased, with `study`, `participant`, and `mode` params stripped. Optionally overridden by a JS detector map. | Your URLs and routing |
| **What did the user click?** | A CSS-style selector plus a human-readable label, resolved from the clicked element's attributes. | Your markup |

Everything the dashboard shows — funnels, misclick counts, step click maps, screen goals, survey triggers, staleness warnings — is built from those two values. **Both are only as stable as your HTML.**

The tracker records **clicks and screen changes**. It does *not* record keystrokes, hovers, scroll depth, or native `<select>` dropdown choices. Design measurable moments as clicks.

---

## 2. Non-negotiables (the short list)

If your AI reads nothing else, it must do these ten things.

1. Put the tracker `<script>` tag on **every** page, as the **last** element before `</body>`.
2. Give **every clickable control** a `data-track="snake_case_name"` **and** a unique `id`.
3. Give every **icon-only** control an `aria-label` describing the action.
4. Make any clickable non-`<button>`/`<a>` element a real control: `role="button" tabindex="0"` + `data-track`.
5. Make visible button labels **unique on their screen**, and never a substring of another label on the same screen.
6. **Change the URL whenever the visible screen changes** — even inside a single self-contained page (use a hash route).
7. Navigate **in the same tab, same origin, with relative URLs**. No `target="_blank"`, no `window.open`, no iframes.
8. Never call `sessionStorage.clear()` or `localStorage.clear()`, and never remove keys starting with `uxt_`.
9. Keep every prototype `z-index` **below 999999** and leave the bottom-right **360 × 260 px** of the viewport free.
10. Wrap live-updating regions (clocks, counters, prices, feeds) in `data-dynamic="true"`.

---

## 3. Element identity — the rules that matter most

### 3.1 How the tracker builds a selector

On every click the tracker walks up from the raw click target to the nearest element matching:

```
a, button, input, select, textarea, label,
[role="button"], [data-testid], [data-track], [aria-label], [onclick]
```

…so a click on an `<svg>` or `<span>` inside a button is correctly attributed to the button. It then builds a selector using the **first** rule that applies:

| Priority | Rule | Produces | Stability |
|---|---|---|---|
| 1 | `data-testid` present | `[data-testid="save_profile"]` | ★★★★★ |
| 2 | `data-track` present | `[data-track="save_profile"]` | ★★★★★ |
| 3 | `id` present **and unique in the document** | `#save-profile` | ★★★★ |
| 4 | `<button>`/`<a>`/`<input>` with `aria-label` | `button[aria-label="Save profile"]` | ★★★ |
| 5 | `<button>`/`<a>`/`<input>` with visible text | `button[text="Save profile"]` | ★★ |
| 6 | Fallback | `div:nth-child(4)` | ☆ |

**Design for rules 1–3.** Rule 5 is not valid CSS, which means the tracker cannot re-query the element later — the *"clicked inside the expected container"* forgiveness pass, element-click survey triggers, and click-goal ancestor matching all silently stop working for those elements. Rule 6 breaks the moment JavaScript inserts, removes, or reorders a sibling.

> [!IMPORTANT]
> **Pick one convention and stick to it**
> `data-testid` outranks `data-track`. If your codebase already uses `data-testid` for tests, keep using it and skip `data-track`. Otherwise use `data-track` everywhere. **Do not mix both on the same element with different values.**

### 3.2 Where to put `data-track`

Put it on **the element that *is* the control** — not on a wrapper, not on the inner icon.

```html
<!-- GOOD: the button is the control -->
<button type="button" id="save-profile" data-track="profile_save">
  <svg aria-hidden="true">…</svg>
  Save profile
</button>

<!-- BAD: wrapper carries the marker; the icon steals the click -->
<div data-track="profile_save">
  <span>Save profile</span>
</div>
```

Never put `data-track` on a container that holds **several** controls — a click on any dead space inside it will be reported as the container.

### 3.3 Labels: what shows up in the report

The human-readable label is the element's visible text (whitespace-collapsed, 200 chars max). If the text contains no letters or digits — an emoji or icon-only button — the tracker falls back, in order, to:

`aria-label` → `title` → `<img alt>` → `placeholder` → `name`

```html
<!-- BAD: report reads "🔔" -->
<button data-track="notifications_open">🔔</button>

<!-- GOOD: report reads "Open notifications" -->
<button data-track="notifications_open" aria-label="Open notifications">🔔</button>
```

### 3.4 Label uniqueness — a real failure mode

When a selector doesn't match, the tracker falls back to **case-insensitive substring matching** on the label. That means a recorded step for **"Continue"** is also satisfied by a click on **"Continue with Google"**. Two consequences:

- Make labels on the same screen mutually non-substring: use *"Continue to billing"* and *"Sign in with Google"*, not *"Continue"* and *"Continue with Google"*.
- Keep labels **identical between recording and the participant session**. Text interpolated from state (*"Continue as Kerry"*) will not match another participant's session.

Rule: **any element whose label contains dynamic data must carry `data-track`** so matching never has to fall back to text.

### 3.5 Clickable non-native elements

Cards, tiles, list rows, and custom toggles must be promoted to real controls, or the tracker will attribute the click to whatever inner `<span>` was hit.

```html
<div class="role-card"
     id="role-designer"
     data-track="onboarding_role_designer"
     role="button"
     tabindex="0"
     aria-label="Select role: Designer">
  <span class="icon">🎨</span>
  <span class="title">Designer</span>
</div>
```

Also wire `keydown` for Enter/Space to `el.click()` — accessible *and* it produces a real click event the tracker can see.

### 3.6 Keyboard submits and native dropdowns

- **Enter-to-submit produces no click event.** If a recorded step is a click on a submit button, a participant who presses Enter will not advance. Route every path to advancing through one real click on the button.

  > [!WARNING]
  > **The button must be `type="button"`, not `type="submit"`**
  > Calling `.click()` on a `type="submit"` button re-submits the form, which re-enters the submit handler, which clicks again — infinite recursion. Switching the button to `type="button"` breaks the cycle, but it also disables the form's native *implicit submission*, so Enter must then be forwarded by hand.

  The complete, correct pattern:

  ```html
  <button type="button" id="step-continue" data-track="step_continue">Continue</button>
  ```
  ```js
  const form = document.getElementById('step-form');
  const btn  = document.getElementById('step-continue');

  // The ONE place the step advances. Validation lives here too.
  btn.addEventListener('click', () => {
    if (!validate()) return;
    advance();
  });

  // Keyboard paths forward to the same click.
  // Safe from recursion: a type="button" click never re-submits the form.
  form.addEventListener('submit', (e) => { e.preventDefault(); btn.click(); });

  form.querySelectorAll('input').forEach((input) => {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); btn.click(); }
    });
  });
  ```

  Synthetic clicks report coordinates of `0,0`, so keyboard users appear at the top-left of the click map. The step still matches on selector, which is what completion depends on. `isTrusted` is `false` on those events, but the tracker does not filter on it.
- **Native `<select>` options are rendered by the OS and are not trackable.** If which option a participant chose matters, build a custom listbox from `role="button"` / `role="option"` elements with `data-track`.

### 3.7 Do not churn the DOM around tracked elements

- Don't reorder, insert, or remove siblings of tracked elements at runtime (breaks `nth-child` fallbacks and DOM fingerprints).
- Prefer toggling `hidden` / a CSS class over destroying and re-creating markup.
- Keep `id` values **unique document-wide**; a duplicated `id` disqualifies rule 3 and drops the element to a weaker selector.

---

## 4. Screen identity

### 4.1 How the screen ID is computed

```
/checkout/?step=2#review   →   /checkout?step=2#review
```

- `pathname` + remaining query + `hash`, **lowercased**
- Trailing slashes stripped (bare `/` preserved)
- The params `study`, `participant`, and `mode` are removed (they're the tracker's own)
- **All other query params are part of the screen ID**

**Therefore: never put volatile data in the query string.** `?email=kerry@x.com` or `?t=1755412` mints a brand-new screen ID per participant — no matching screenshot, no staleness check, and screen-based goals never fire. Carry prototype state in `sessionStorage` instead (see §6).

### 4.2 When the tracker notices a screen change

Screen transitions are detected from exactly four signals:

- `popstate`
- `hashchange`
- `history.pushState` (the tracker patches it)
- `history.replaceState` (the tracker patches it)

**If your view change produces none of these, the tracker won't notice until the participant's next click** — and even then it reads the screen as of that click, so screen-based task goals and `screen_enter`/`screen_exit` events lag a full interaction behind.

This is the single most common way a self-contained prototype produces bad data.

### 4.3 Case A — Multi-page prototype (separate HTML files)

This is the best-supported shape. Requirements:

- All pages on the **same origin**.
- The tracker `<script>` on **every** page, including dead-ends and error pages.
- Navigate with **relative URLs in the same tab**: `window.location.href = 'dashboard.html'` or a plain `<a href="dashboard.html">`.
- **No `target="_blank"`, no `window.open`, no iframes.** The session lives in `sessionStorage`, which is per-tab; a new tab forks the session and produces divergent, duplicated data.
- You **do not** need to forward `?study=` / `?participant=` between pages — the tracker persists that context to `sessionStorage` on the entry page and picks it up automatically. (Preserving them is harmless; they're stripped from the screen ID either way.)
- Give each page a distinct, stable path. Don't rename files between recording and testing.

```js
// Prototype navigation helper — safe for tracking
const go = (path) => { window.location.href = path; };   // same tab, relative
```

### 4.4 Case B — One self-contained page driven by JavaScript

Fully supported, with one mandatory addition: **change the URL hash whenever the visible view changes.**

```js
const views = ['profile', 'role', 'preferences'];

function showView(name) {
  views.forEach(v => {
    document.getElementById('view-' + v).hidden = (v !== name);
  });
  // ↓ THE CRITICAL LINE — gives this view its own screen ID and fires
  //   a navigation event the tracker listens for.
  if (location.hash !== '#/' + name) location.hash = '#/' + name;
}

// Make the back button work, and keep state in sync on load/history moves.
window.addEventListener('hashchange', () => render());
```

Screen IDs become `/index.html#/profile`, `/index.html#/role`, `/index.html#/preferences` — each with its own screenshot, its own click map, and usable as a screen-based task goal.

Notes:

- **Prefix hashes with `/`** (`#/role`, not `#role`) so the hash can never collide with an element `id` and cause a scroll jump.
- `history.pushState({}, '', '#/role')` works equally well — the tracker patches it. Use `location.hash` if you want the back button to move between views for free.
#### What you keep and lose if you skip the URL change

This is the most common way a self-contained prototype produces bad data, so it's worth being precise. If every view shares one screen ID:

**Still works** (the core matching is element-based, not screen-based):

- Every click, with selector, label, tag, coordinates, and timing.
- Step matching and completion — the ideal-path cursor compares selector then label text and never consults the screen ID.
- Per-step screenshots and the step-based click maps built from them (the recorder captures one image per step precisely for this case).
- Click-type task goals, and element-click survey triggers — both designed for in-page wizards.
- Journey maps, which label steps by element text.

**Silently breaks:**

1. **Screen-type task goals** — one shared ID means a screen goal fires immediately or never.
2. **No `screen_enter` / `screen_exit` events** — no per-view dwell time.
3. **`screen_enter` survey triggers** can't target a view.
4. **Staleness detection collapses to page level** — one screen record for the whole page. Accurate *if* every view lives in the DOM (hidden elements are fingerprinted too); if you render views on demand, expect a false "prototype changed" warning on every view change.
5. **Every deviation safety net switches off.** The tracker only arms its recovery paths once a participant has been on a screen other than the recording's end screen — impossible when there's only one screen ID. That disables end-screen fallback completion, end-screen completion of a final task with no goal, and the partial-completion prompt. Click matching becomes the *only* route to completion, so a participant who deviates has **no way to finish** and times out as abandoned.

Point 5 is the reason this rule is non-negotiable rather than a nice-to-have. Changing the hash costs one line and restores all five.

### 4.5 Optional — the `screens` detector map

For frameworks where the URL genuinely cannot change, or when you want friendly screen names, declare a detector map. It **must be assigned before the tracker script tag runs.**

```html
<script>
  window.UXTracker = {
    screens: {
      // Most specific first — the FIRST detector returning true wins.
      'checkout-review':  () => document.body.dataset.view === 'review',
      'checkout-payment': () => document.body.dataset.view === 'payment',
      'cart':             () => document.body.dataset.view === 'cart',
    },
  };
</script>
<script src="…/v1/tracker.js" data-ingest-url="…"></script>
```

Rules:

- Detectors must be **mutually exclusive** and ordered **most-specific first**.
- A detector key **replaces** the URL-derived screen ID entirely. Any state where no detector returns `true` falls back to the URL — so either cover every screen or accept a mix.
- Detectors are pure predicates: cheap, synchronous, no side effects, and safe to call at any time.
- **A detector map is not a substitute for §4.2** — the tracker still needs a navigation event to know *when* to re-evaluate. Change the URL as well.

#### Escape hatch: when the URL truly cannot change

If routing is out of your control and you can't touch the URL at all, dispatch the navigation events yourself after switching views. Recording mode and participant mode listen on different event names, so fire both — the unused one is harmless:

```js
function announceViewChange() {
  window.dispatchEvent(new Event('uxt:navigation'));        // recorder listens for this
  window.dispatchEvent(new Event('uxt:participant-nav'));   // participant listens for this
}
```

Call it *after* the DOM reflects the new view, so the detector map reads the right state. This is a last resort — a hash route is one line and more robust.

---

## 5. Installing the script tag

Last thing before `</body>`, on every page:

```html
  <!-- prototype scripts first -->
  <script src="app.js"></script>

  <!-- UX Tracker LAST -->
  <script
    src="https://<your-user>.github.io/<repo>/v1/tracker.js"
    data-ingest-url="https://<project-ref>.supabase.co/functions/v1/ux-tracker-ingest"
    data-supabase-url="https://<project-ref>.supabase.co"
    data-supabase-key="<anon-key>"
  ></script>
</body>
```

- `data-ingest-url` is **required**. `data-supabase-url` / `data-supabase-key` are only used to upload screenshots during recording — include them if you'll record from this page.
- Any `window.UXTracker = { … }` config block must appear **before** this tag.
- The tracker is inert (`idle`) unless the URL carries `?mode=record` or `?study=…&participant=…`, or a tracked session is already active in the tab. It is safe to leave the tag in place while you develop.
- Do not `defer`, `async`, lazy-load, or inject the tag from JavaScript.

---

## 6. JavaScript rules that keep the session alive

The participant's session, buffered events, and study context live in `sessionStorage` under keys prefixed `uxt_`.

**Never do any of these:**

```js
sessionStorage.clear();                 // ✗ destroys the session mid-study
localStorage.clear();                   // ✗ same risk
Object.keys(sessionStorage).forEach(…)  // ✗ don't bulk-delete
```

Remove only your own keys by exact name:

```js
sessionStorage.removeItem('myproto_user');   // ✓
```

**Also avoid:**

- **A document-level capture-phase click listener that calls `stopPropagation()`** — it can swallow clicks before the tracker sees them. Bubble-phase `stopPropagation` is fine; the tracker listens in the capture phase.
- **Re-patching `history.pushState` / `history.replaceState` after page load.** If your router wraps them, do it during initial script execution, and always call through to the original.
- **Hard reloads to change view** (`location.reload()`) — they cost a full page load and blank the panel; use a hash route.
- **Blocking dialogs** (`alert`, `confirm`, `prompt`) — they freeze the page during screenshot capture. Use in-page modals.
- **Auto-redirects on load** based on state; they can bounce a participant off the screen the study is measuring.

---

## 7. Screenshot and click-map fidelity

Screenshots are rendered client-side from the live DOM at **viewport size, scale 1**. Click coordinates are stored viewport-relative and projected onto the recorded screenshot.

- **Fit each screen inside the viewport.** Screenshots taken on navigation are captured scrolled to the top; a participant who scrolls before clicking will land at a shifted position on the click map. Element identity is unaffected — only the dot's position drifts.
- **Keep the layout stable across viewport widths.** The click map rescales the *image*, not your reflow. A centred, fixed-max-width card layout maps almost perfectly; a fluid multi-column grid does not. Where possible, record and test at the same window size.
- **Self-host images and fonts, or add `crossorigin="anonymous"`.** Cross-origin assets render blank or partial in screenshots.
- **No iframes.** Cross-origin iframes (including hosted Figma prototype players) cannot be screenshotted or instrumented at all.
- **Avoid `<canvas>`, WebGL, and CSS `filter: blur()`** in critical screens — they rasterise unreliably.
- Modern CSS is fine, but very new features (container queries, `:has()`, subgrid) may render approximately in the screenshot. Verify a recording before running participants.

---

## 8. Layout constraints imposed by the tracker UI

The tracker injects its own overlays (shadow DOM, so your CSS can't leak into them, and theirs can't leak out).

| Element | Position | z-index |
|---|---|---|
| Participant task panel | fixed, bottom-right, ~320 px wide | 999999 |
| Task briefings, surveys, completion modal | full-screen | 2147483647 |
| Recorder panel (recording only) | fixed, bottom-right, 320 px wide | 999999 |

Therefore:

- **Keep every prototype `z-index` below 999999.** A sticky header at `z-index: 9999999` will cover the participant's task instructions.
- **Leave the bottom-right ~360 × 260 px free** of essential controls. The panel is draggable/minimisable, but a floating action button or cookie banner parked there is a real obstruction.
- Don't use `position: fixed; inset: 0` overlays that swallow pointer events globally.
- Don't define custom elements named `uxt-task-panel` or `uxt-recorder-panel`.

---

## 9. Keeping the DOM fingerprint stable

The tracker hashes the structure of the page's interactive elements at record time and compares it on each participant session, flagging screens as **stale** when the prototype changed underneath a recording. The hash covers, for every `a / button / input / select / textarea / [role=button|link|tab|menuitem]`: tag, first 80 chars of text, `id`, `data-testid`, `aria-label`, `href`, and `type` — plus the page `<title>` and tag counts.

To avoid false "the prototype changed" warnings on data that is *supposed* to move:

```html
<!-- Excluded from the fingerprint: data-dynamic="true", class="dynamic", id="dynamic" -->
<section data-dynamic="true">
  <button id="cart-total">Checkout — $148.20</button>
  <span>Updated 3 minutes ago</span>
</section>
```

> [!CAUTION]
> **The trap that catches everyone: personalised text inside a control**
> The fingerprint stores each interactive element's **text content**, and `textContent` includes every descendant. So a control whose *markup* never changes still hashes differently per participant if any text inside it is derived from what they typed.
>
> The classic case is an avatar button showing the user's initials:
>
> ```html
> <!-- BREAKS: every participant hashes differently -->
> <div role="button" id="avatar-btn" aria-label="Upload profile photo">
>   <span id="avatar-initials">KD</span>   <!-- ← written live from the name field -->
> </div>
> ```
>
> The researcher records with *their* name, so the stored hash embeds their initials. Every participant who types a different name trips the staleness check, and **every session gets flagged "page changed" even though nothing changed.** Screens captured before any typing (usually the first one) escape it, which makes the pattern look random — some screens flagged, others not.
>
> Fix by putting `data-dynamic="true"` on **the interactive element itself**, not on the inner span. Exclusion works by walking up from the interactive element with `closest()`, so marking a non-interactive child does nothing — the control's `textContent` still includes it.
>
> ```html
> <div role="button" id="avatar-btn" aria-label="Upload profile photo"
>      data-track="avatar_upload" data-dynamic="true">
>   <span id="avatar-initials">KD</span>
> </div>
> ```
>
> This affects staleness detection only. The click is still captured and labelled normally.
>
> Watch for: initials and avatars, "Welcome back, {name}" inside a nav control, cart counts on a basket button, "Resend in 45s" inside the resend button, masked emails inside a confirm button, any `{n} selected` badge on a control.

Guidance:

- Wrap timestamps, counters, prices, randomised content, and live feeds in `data-dynamic="true"`.
- Audit every interactive element for text written by JavaScript. Non-interactive siblings are fine — a countdown in a `<span>` *next to* the resend button is invisible to the fingerprint; the same countdown *inside* the button is not.
- Prefer keeping all views of a wizard **present in the DOM** and toggling visibility (hidden elements are still fingerprinted, so the hash stays constant across steps). If you render views on demand instead, either mark the container `data-dynamic="true"` or expect one screen record per step.
- Don't change the `<title>` dynamically on a tracked screen.
- Real intentional changes *should* trip the warning — that's the feature. Re-record the study after editing the prototype.

---

## 10. Reference skeletons

### 10.1 Multi-page page template

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sign in — Acme</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <main class="auth-card">
    <h1>Sign in</h1>

    <form id="signin-form">
      <label for="email">Email</label>
      <input type="email" id="email" name="email"
             data-track="signin_email_field">

      <label for="password">Password</label>
      <input type="password" id="password" name="password"
             data-track="signin_password_field">

      <button type="button" id="toggle-password"
              data-track="signin_password_toggle"
              aria-label="Show password">👁</button>

      <!-- type="button": see the handler below — a submit button would
           recurse when clicked programmatically. -->
      <button type="button" id="signin-submit"
              data-track="signin_submit">Sign in to Acme</button>
    </form>

    <button type="button" id="signin-google"
            data-track="signin_google">Continue with Google</button>

    <a href="forgot-password.html" id="signin-forgot"
       data-track="signin_forgot_password">Forgot your password?</a>
  </main>

  <script src="app.js"></script>
  <script>
    const form = document.getElementById('signin-form');
    const btn  = document.getElementById('signin-submit');

    // The ONE place this step advances.
    btn.addEventListener('click', () => {
      window.location.href = 'dashboard.html';   // same tab, relative
    });

    // Enter must produce a real click, or the step won't advance for keyboard
    // users. Safe from recursion because btn is type="button".
    form.addEventListener('submit', (e) => { e.preventDefault(); btn.click(); });

    form.querySelectorAll('input').forEach((input) => {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); btn.click(); }
      });
    });
  </script>

  <script
    src="https://<user>.github.io/<repo>/v1/tracker.js"
    data-ingest-url="https://<ref>.supabase.co/functions/v1/ux-tracker-ingest"
    data-supabase-url="https://<ref>.supabase.co"
    data-supabase-key="<anon-key>"
  ></script>
</body>
</html>
```

Note the labels: *"Sign in to Acme"* and *"Continue with Google"* — neither is a substring of the other.

### 10.2 Single self-contained page with a hash router

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Get started — Acme</title>
</head>
<body>
  <!-- Optional: friendly screen names. MUST come before the tracker tag. -->
  <script>
    window.UXTracker = {
      screens: {
        'onboarding-preferences': () => location.hash === '#/preferences',
        'onboarding-role':        () => location.hash === '#/role',
        'onboarding-profile':     () => location.hash === '#/profile' || !location.hash,
      },
    };
  </script>

  <main class="wizard">
    <section id="view-profile">
      <h1>Your profile</h1>
      <input type="text" id="display-name" data-track="onboarding_display_name">
      <button type="button" id="profile-continue"
              data-track="onboarding_profile_continue">Continue to your role</button>
    </section>

    <section id="view-role" hidden>
      <h1>What do you do?</h1>
      <div class="role-grid">
        <div class="role-card" id="role-designer"
             data-track="onboarding_role_designer"
             role="button" tabindex="0"
             aria-label="Select role: Designer">🎨 Designer</div>
        <div class="role-card" id="role-developer"
             data-track="onboarding_role_developer"
             role="button" tabindex="0"
             aria-label="Select role: Developer">💻 Developer</div>
      </div>
      <button type="button" id="role-continue"
              data-track="onboarding_role_continue">Continue to preferences</button>
      <button type="button" id="role-skip"
              data-track="onboarding_role_skip">Skip role selection</button>
    </section>

    <section id="view-preferences" hidden>
      <h1>Preferences</h1>
      <button type="button" id="prefs-finish"
              data-track="onboarding_finish">Finish setup</button>
    </section>
  </main>

  <script>
    const VIEWS = ['profile', 'role', 'preferences'];

    function render() {
      const name = (location.hash.replace('#/', '') || 'profile');
      VIEWS.forEach(v => {
        document.getElementById('view-' + v).hidden = (v !== name);
      });
      window.scrollTo(0, 0);   // keep click maps aligned
    }

    function goToView(name) {
      // Changing the hash is what tells the tracker the screen changed.
      if (location.hash !== '#/' + name) location.hash = '#/' + name;
      else render();
    }

    window.addEventListener('hashchange', render);
    render();

    // Keyboard parity for the non-native role cards.
    document.querySelectorAll('.role-card').forEach(card => {
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); card.click(); }
      });
    });

    document.getElementById('profile-continue')
      .addEventListener('click', () => goToView('role'));
    document.getElementById('role-continue')
      .addEventListener('click', () => goToView('preferences'));
    document.getElementById('role-skip')
      .addEventListener('click', () => goToView('preferences'));
    document.getElementById('prefs-finish')
      .addEventListener('click', () => { window.location.href = 'dashboard.html'; });
  </script>

  <script
    src="https://<user>.github.io/<repo>/v1/tracker.js"
    data-ingest-url="https://<ref>.supabase.co/functions/v1/ux-tracker-ingest"
    data-supabase-url="https://<ref>.supabase.co"
    data-supabase-key="<anon-key>"
  ></script>
</body>
</html>
```

---

## 11. Naming convention for `data-track`

`{screen}_{object}_{action}`, lower snake_case, stable forever:

```
signin_submit                  onboarding_role_designer
signin_google                  onboarding_profile_continue
signin_forgot_password         checkout_payment_card_add
dashboard_nav_settings         checkout_review_place_order
```

Rules: unique per document; renaming one invalidates every recording that referenced it (re-record after renaming); never interpolate dynamic values into the name (`item_42_delete` ✗ → `cart_item_delete` ✓).

---

## 12. Verification before you invite participants

1. **Console check.** Open the prototype with `?mode=record` appended. The console must log `[UXTracker] initialized in record mode` and a recorder panel must appear bottom-right. No red error badge.
2. **Screen ID check.** Walk the whole flow. In the console, run this on each distinct view — every view a task will reference must produce a different value:
   ```js
   (location.pathname.replace(/\/+$/,'') || '/') + location.hash
   ```
3. **Selector check.** Confirm every clickable control resolves to a strong selector:
   ```js
   // Lists any clickable element missing data-track / data-testid / id
   document.querySelectorAll('a, button, [role="button"], input, select, textarea')
     .forEach(el => {
       if (!el.dataset.track && !el.dataset.testid && !el.id) console.warn('UNTRACKED:', el);
     });
   ```
4. **Label check.** Confirm no icon-only control is missing `aria-label`:
   ```js
   document.querySelectorAll('a, button, [role="button"]').forEach(el => {
     const t = el.textContent.trim();
     if (!/[\p{L}\p{N}]/u.test(t) && !el.getAttribute('aria-label')) console.warn('NO LABEL:', el);
   });
   ```
5. **Fingerprint-drift check** — catches the personalised-text trap in §9 before it flags all your sessions. Paste this on each screen, then interact with the page as a participant would (type into every field, make every selection) and read the result:
   ```js
   // Reports any interactive element whose fingerprint entry changes as you use the page.
   (() => {
     const SEL = 'a, button, input, select, textarea, [role="button"], [role="link"], [role="tab"], [role="menuitem"]';
     const snap = () => Array.from(document.querySelectorAll(SEL))
       .filter(el => el.closest('[data-dynamic="true"], .dynamic, #dynamic') === null)
       .map(el => ({ id: el.id || el.dataset.track || el.tagName.toLowerCase(),
                     text: el.textContent.trim().slice(0, 80) }));
     const before = snap();
     window.__fpCheck = () => {
       const after = snap();
       const drift = before.filter((b, i) => JSON.stringify(b) !== JSON.stringify(after[i]));
       console.log(drift.length ? '⚠ FINGERPRINT DRIFT — add data-dynamic="true" to these:' : '✅ stable', drift);
     };
     console.log('Baseline captured. Interact with the page, then run __fpCheck()');
   })();
   ```
   Anything it lists needs `data-dynamic="true"` on the interactive element itself.
6. **Screenshot check.** Record the flow, then open the study in the dashboard. Every step must have a screenshot that actually shows the screen — blank or partial images mean a cross-origin asset or an iframe.
7. **Participant dry run.** Invite yourself as a participant and complete the flow. Every step must advance, and the dashboard must name what you clicked in words, not `nth-child`.

---

## 13. Copy-paste brief for your AI

> Build/modify this prototype so it is fully trackable by UX Tracker. Apply these rules without exception:
>
> 1. Every clickable element gets a unique `id` **and** `data-track="screen_object_action"` in lower snake_case. Put the attribute on the control itself, never on a wrapper or an inner icon.
> 2. Every icon-only or emoji-only control gets an `aria-label` describing the action.
> 3. Any clickable element that isn't `<button>` / `<a>` / `<input>` gets `role="button" tabindex="0"` plus a `keydown` handler mapping Enter and Space to `el.click()`.
> 4. Visible button labels are unique within a screen and never a substring of another label on the same screen. Any label containing dynamic data must have `data-track`.
> 5. Forms that can be submitted with Enter must route every advance through one real click on the continue button. That button is `type="button"` (never `type="submit"`, which recurses when clicked programmatically); the submit handler and an Enter `keydown` on each input both forward to `button.click()`.
> 6. The URL changes whenever the visible screen changes. Multi-page: separate same-origin HTML files, relative links, same tab. Single page: a hash router using `#/view-name` paths, with a `hashchange` listener.
> 7. Never `target="_blank"`, `window.open`, iframes, `location.reload()` for view changes, `alert`/`confirm`/`prompt`, or volatile values in the query string (use `sessionStorage` with your own prefixed keys).
> 8. Never call `sessionStorage.clear()` or `localStorage.clear()`; never touch keys starting with `uxt_`. Remove only your own keys by exact name.
> 9. No document-level capture-phase click listener that calls `stopPropagation()`. Don't re-patch `history.pushState`/`replaceState` after load.
> 10. All prototype `z-index` values stay below 999999, and the bottom-right 360 × 260 px of the viewport stays free of essential controls.
> 11. Wrap live-updating regions (clocks, counters, prices, feeds) in `data-dynamic="true"`. Critically, this includes any **interactive element containing text derived from user input** — an avatar button showing the participant's initials, a basket button with a live count, a resend button with a countdown inside it. Put the attribute on the interactive element itself, never on an inner span. Keep all wizard views in the DOM and toggle `hidden` rather than re-rendering markup.
> 12. Design each screen to fit the viewport without scrolling, with a centred fixed-max-width layout. Self-host images and fonts, or add `crossorigin="anonymous"`.
> 13. The UX Tracker `<script>` tag is the last element before `</body>` on **every** page, after all prototype scripts, with `data-ingest-url` set. Any `window.UXTracker = {…}` block goes before it. Never `defer`, `async`, or inject it.
>
> Then output a checklist mapping each rule to where you applied it, and flag anything you couldn't satisfy.

---

## 14. Known hard limits

These cannot be worked around in prototype code:

| Limit | Consequence |
|---|---|
| Hosted Figma prototype players run in a cross-origin iframe | Cannot be instrumented at all. Hand-code, or use Framer/Webflow with an editable page. |
| Cross-origin images, fonts, and iframes | Blank or partial screenshots. |
| Native `<select>` dropdown options | Option choices are not recorded. |
| Keystrokes, hovers, scroll depth | Not recorded — clicks and navigations only. |
| `sessionStorage` is per-tab, per-origin | A prototype spanning multiple origins, or opened in a new tab, forks the session. |
| Click coordinates are viewport-relative | Participants at very different window sizes produce drifted click-map dots (element identity still correct). |
