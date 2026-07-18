-- Client-generated event id for at-least-once delivery with server dedupe.
--
-- Participant events are delivered redundantly by design: the page-unload
-- beacon AND the next page's re-flush of the sessionStorage buffer may both
-- succeed, and the completion path races two flushes of the same buffer.
-- The ingest function upserts ON CONFLICT (client_event_id) DO NOTHING, so
-- every duplicate delivery is a no-op. Events from older tracker bundles have
-- NULL ids, which never conflict — they insert exactly as before.
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS client_event_id uuid;

ALTER TABLE events
  DROP CONSTRAINT IF EXISTS events_client_event_id_key;

ALTER TABLE events
  ADD CONSTRAINT events_client_event_id_key UNIQUE (client_event_id);
