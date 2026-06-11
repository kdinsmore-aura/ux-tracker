# UX Tracker

UX Tracker is a lightweight, script-tag framework for running moderated usability studies on web prototypes. It records participant click paths, captures screenshots, and streams all data to a Supabase backend — no server required.

## Prerequisites

- A [Supabase](https://supabase.com) project (free tier works)
- The repository served via [GitHub Pages](https://pages.github.com) (or any static host)

## One-time setup

1. Open the Supabase SQL editor and run [`supabase/schema.sql`](supabase/schema.sql).
2. In **Storage**, create a public bucket named `screenshots`.
3. Copy your project URL and `anon` key from **Project Settings → API**.
4. Deploy the Edge Function — see [supabase/functions/README.md](supabase/functions/README.md).

## Integration

Add one of the following snippets to every prototype page.
**The Supabase anon key is not needed** — all database operations go through the
Edge Function using a server-side service-role key.

**MINIMAL** (recommended for most prototypes):

```html
<script
  src="https://<your-github-user>.github.io/<repo>/v1/tracker.js"
  data-ingest-url="https://<project-ref>.supabase.co/functions/v1/ux-tracker-ingest"
></script>
```

The minimal version works because the Setup Tool and invite links pass the study ID as a `?study=` URL parameter automatically — no `data-study` attribute needed.

**WITH HARDCODED STUDY** (optional, for single-study prototypes):

```html
<script
  src="https://<your-github-user>.github.io/<repo>/v1/tracker.js"
  data-ingest-url="https://<project-ref>.supabase.co/functions/v1/ux-tracker-ingest"
  data-study="your-study-id"
></script>
```

Use the hardcoded version only if you want the same study active on every page load regardless of URL params.

The tracker starts in `idle` mode by default and activates only when the correct URL parameters are present (see Config reference below).

## Deploying the Edge Function

All participant and recorder database operations are proxied through a Supabase
Edge Function so the anon key never appears in prototype page HTML. See
[supabase/functions/README.md](supabase/functions/README.md) for deployment
instructions.

## Running a study

Open [`/setup`](setup/index.html) to create a study, record the ideal click path, and generate participant invitation links.

## Viewing results

Open [`/dashboard`](dashboard/index.html) to review session replays, click heatmaps, and task-completion metrics.

## Config reference

All fields can be set via `window.UXTracker = { ... }` (before the script tag) or as `data-*` attributes on the script element. `window.UXTracker` takes precedence.

| Field | Type | Default | data-attribute | Description |
|---|---|---|---|---|
| `ingestUrl` | string | — | `data-ingest-url` | Edge Function URL for all DB operations. **Required** when not idle. |
| `studyId` | string | — | `data-study` (optional) | Study ID from the `studies` table. Resolved from `window.UXTracker`, `data-study`, or `?study=` URL param. **Required** when not idle. |
| `supabaseUrl` | string | — | `data-supabase-url` | Supabase project URL. Only needed by the recorder for screenshot uploads. |
| `supabaseKey` | string | — | `data-supabase-key` | Supabase anon key. Only needed by the recorder for screenshot uploads. Not required on prototype pages. |
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
- **Anon key exposure**: The setup tool (`/setup`) and dashboard use the Supabase anon key for direct database access. Keep this key private to your research team. Participant-facing prototype pages no longer include the anon key — all their database operations go through the Edge Function.
- **Table-level GRANTs**: If **Automatically expose new tables** is disabled in your Supabase project settings, you must run the `GRANT` statements in `schema.sql` manually in addition to the RLS policies, otherwise the anon role will receive permission-denied errors.
