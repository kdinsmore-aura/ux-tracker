# UX Tracker

UX Tracker is a lightweight, script-tag framework for running moderated usability studies on web prototypes. It records participant click paths, captures screenshots, and streams all data to a Supabase backend — no server required.

## Prerequisites

- A [Supabase](https://supabase.com) project (free tier works)
- The repository served via [GitHub Pages](https://pages.github.com) (or any static host)

## One-time setup

1. Open the Supabase SQL editor and run [`supabase/schema.sql`](supabase/schema.sql).
2. In **Storage**, create a public bucket named `screenshots`.
3. Copy your project URL and `anon` key from **Project Settings → API**.

## Integration

Add the following snippet to every prototype page, replacing the placeholder values:

```html
<script
  src="https://<your-github-user>.github.io/<repo>/v1/tracker.js"
  data-supabase-url="https://xyz.supabase.co"
  data-supabase-key="your-anon-key"
  data-study="your-study-id"
></script>
```

The tracker starts in `idle` mode by default and activates only when the correct URL parameters are present (see Config reference below).

## Running a study

Open [`/setup`](setup/index.html) to create a study, record the ideal click path, and generate participant invitation links.

## Viewing results

Open [`/dashboard`](dashboard/index.html) to review session replays, click heatmaps, and task-completion metrics.

## Config reference

All fields can be set via `window.UXTracker = { ... }` (before the script tag) or as `data-*` attributes on the script element. `window.UXTracker` takes precedence.

| Field | Type | Default | data-attribute | Description |
|---|---|---|---|---|
| `supabaseUrl` | string | — | `data-supabase-url` | Supabase project URL. **Required** when not idle. |
| `supabaseKey` | string | — | `data-supabase-key` | Supabase anon key. **Required** when not idle. |
| `studyId` | string | — | `data-study` | Study ID from the `studies` table. **Required** when not idle. |
| `mode` | `'auto'`\|`'record'`\|`'participant'`\|`'idle'` | `'auto'` | `data-mode` | `'auto'` resolves from URL params: `?mode=record` → record; `?study=X&participant=Y` → participant; otherwise idle. |
| `screenshotDelay` | number | `600` | `data-screenshot-delay` | Milliseconds to wait after a step trigger before capturing a screenshot. |
| `screenshotFormat` | `'png'`\|`'jpeg'` | `'png'` | `data-screenshot-format` | Image format for captured screenshots. |
| `hashStalenessCheck` | boolean | `true` | `data-hash-staleness-check` | Fingerprints the DOM on participant load and warns if it has changed since recording. Pass `'false'` as the data-attribute value to disable. |
| `sessionStorageKey` | string | `'uxt_session'` | `data-session-storage-key` | Prefix for all `sessionStorage` keys written by the tracker. |
| `screens` | `Object.<string, () => boolean>` | — | (JS only) | SPA screen map: label → detector function. Each function returns `true` when that screen is active. |
| `onComplete` | `(session) => void` | — | (JS only) | Callback fired when a participant completes all tasks. |
| `onStepAdvance` | `({stepIndex, event}) => void` | — | (JS only) | Callback fired each time a participant advances a step. |
| `debug` | boolean | `false` | `data-debug` | Emits verbose console output. Presence of the attribute (any value) enables it. |

## Local development

```bash
npm install
npm run dev        # builds with watch mode and serves the repo root
```

The build output is `v1/tracker.js`. The `setup/` and `dashboard/` pages load Supabase and Alpine.js from CDN and do not need a build step.

To produce a minified production bundle:

```bash
NODE_ENV=production npm run build
```

## Known limitations

- **html2canvas cross-origin**: Screenshots will be blank or partial for pages that load images, fonts, or iframes from a different origin. Use `crossorigin="anonymous"` on assets where possible.
- **SPA routing**: For single-page apps that change state without URL navigation, you must supply a `screens` map in `window.UXTracker` so the tracker can detect screen transitions.
- **Hosted Figma prototypes**: Figma's hosted prototype player runs inside a cross-origin iframe and cannot be instrumented. Use [Framer](https://framer.com), [Webflow](https://webflow.com), or a hand-coded HTML prototype instead.
- **Anon key exposure**: The setup tool (`/setup`) uses the Supabase anon key for all operations. Keep the key private to your research team — do not share participant links with the raw key visible in the page source.
- **Table-level GRANTs**: If **Automatically expose new tables** is disabled in your Supabase project settings, you must run the `GRANT` statements in `schema.sql` manually in addition to the RLS policies, otherwise the anon role will receive permission-denied errors.
