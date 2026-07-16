import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const ALLOWED_EVENT_TYPES = new Set([
  'click',
  'screen_enter',
  'screen_exit',
  'task_start',
  'task_complete',
  'session_start',
  'session_complete',
  'session_abandon',
]);

const ALLOWED_SESSION_UPDATE_FIELDS = new Set([
  'status',
  'current_step_index',
  'completed_steps',
  'completed_at',
  'duration_ms',
  'screen_changes',
  'has_screen_changes',
  'resumed_without_state',
  'feedback',
  'survey_responses',
  'current_task_index',
  'completed_tasks',
]);

const ALLOWED_PARTICIPANT_EXTRA_FIELDS = new Set([
  'started_at',
  'completed_at',
  'session_id',
]);

const ALLOWED_PARTICIPANT_STATUSES = new Set([
  'invited',
  'in_progress',
  'completed',
  'abandoned',
]);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function ok(data: unknown = null): Response {
  return jsonResponse({ success: true, data, error: null });
}

function fail(error: string): Response {
  return jsonResponse({ success: false, data: null, error });
}

function bad(error: string): Response {
  return jsonResponse({ success: false, data: null, error }, 400);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return bad('Method not allowed');
  }

  let body: { action: string; payload: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return bad('Invalid JSON body');
  }

  const { action, payload } = body;

  if (!action || typeof action !== 'string') {
    return bad('action is required');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return bad('payload must be an object');
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !serviceKey) {
    console.error('Missing required environment variables');
    return jsonResponse({ success: false, data: null, error: 'Server configuration error' }, 500);
  }

  const db = createClient(supabaseUrl, serviceKey);

  try {
    switch (action) {

      // ─── READ ACTIONS ─────────────────────────────────────────────────────────

      case 'fetchStudy': {
        const { studyId } = payload;
        if (!studyId) return bad('studyId is required');
        const { data, error } = await db
          .from('studies')
          .select('*')
          .eq('id', studyId)
          .maybeSingle();
        if (error) {
          console.error('fetchStudy:', error);
          return fail('Failed to fetch study');
        }
        return ok(data);
      }

      case 'fetchParticipant': {
        const { participantId, studyId } = payload;
        if (!participantId) return bad('participantId is required');
        if (!studyId) return bad('studyId is required');
        const { data, error } = await db
          .from('participants')
          .select('*')
          .eq('id', participantId)
          .maybeSingle();
        if (error) {
          console.error('fetchParticipant:', error);
          return fail('Failed to fetch participant');
        }
        if (data && (data as Record<string, unknown>).study_id !== studyId) {
          return ok(null);
        }
        return ok(data);
      }

      case 'fetchScreensForStudy': {
        const { studyId } = payload;
        if (!studyId) return bad('studyId is required');
        const { data, error } = await db
          .from('screens')
          .select('*')
          .eq('study_id', studyId);
        if (error) {
          console.error('fetchScreensForStudy:', error);
          return fail('Failed to fetch screens');
        }
        return ok(data);
      }

      // ─── WRITE ACTIONS ────────────────────────────────────────────────────────

      case 'createSession': {
        const sessionData = payload.sessionData as Record<string, unknown> | null;
        if (!sessionData?.study_id) return bad('sessionData.study_id is required');
        if (!sessionData?.participant_id) return bad('sessionData.participant_id is required');

        const { data: participant, error: pErr } = await db
          .from('participants')
          .select('id, study_id, status')
          .eq('id', sessionData.participant_id)
          .maybeSingle();
        if (pErr) {
          console.error('createSession participant lookup:', pErr);
          return fail('Failed to validate participant');
        }
        if (!participant) return fail('Participant not found');
        const p = participant as Record<string, unknown>;
        if (p.study_id !== sessionData.study_id) return fail('Participant does not belong to this study');
        if (!['invited', 'in_progress'].includes(p.status as string)) {
          return fail('Participant is not eligible to start a session');
        }

        const { data, error } = await db
          .from('sessions')
          .insert(sessionData)
          .select()
          .single();
        if (error) {
          console.error('createSession insert:', error);
          return fail('Failed to create session');
        }
        return ok(data);
      }

      case 'updateSession': {
        const { sessionId, participantId, updates } = payload;
        if (!sessionId) return bad('sessionId is required');
        if (!participantId) return bad('participantId is required');
        if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
          return bad('updates must be an object');
        }

        const { data: session, error: sErr } = await db
          .from('sessions')
          .select('id, participant_id')
          .eq('id', sessionId)
          .maybeSingle();
        if (sErr) {
          console.error('updateSession lookup:', sErr);
          return fail('Failed to validate session');
        }
        if (!session) return fail('Session not found');
        if ((session as Record<string, unknown>).participant_id !== participantId) {
          return fail('Session participant mismatch');
        }

        const filtered: Record<string, unknown> = {};
        for (const key of Object.keys(updates as Record<string, unknown>)) {
          if (ALLOWED_SESSION_UPDATE_FIELDS.has(key)) {
            filtered[key] = (updates as Record<string, unknown>)[key];
          }
        }

        const { error } = await db.from('sessions').update(filtered).eq('id', sessionId);
        if (error) {
          console.error('updateSession update:', error);
          return fail('Failed to update session');
        }
        return ok(null);
      }

      case 'batchInsertEvents': {
        const { events } = payload;
        if (!Array.isArray(events) || events.length === 0) {
          return bad('events must be a non-empty array');
        }
        if (events.length > 100) return bad('Maximum 100 events per batch');

        const firstSessionId = events[0].session_id;
        const firstParticipantId = events[0].participant_id;
        if (!firstSessionId || !firstParticipantId) {
          return bad('All events must have session_id and participant_id');
        }

        for (const ev of events) {
          if (ev.session_id !== firstSessionId || ev.participant_id !== firstParticipantId) {
            return bad('All events must share the same session_id and participant_id');
          }
          if (!ev.study_id || !ev.screen_id || !ev.event_type || !ev.timestamp) {
            return bad('Each event must have study_id, screen_id, event_type, and timestamp');
          }
          if (!ALLOWED_EVENT_TYPES.has(ev.event_type)) {
            return bad(`Invalid event_type: ${ev.event_type}`);
          }
        }

        const { data: session, error: sErr } = await db
          .from('sessions')
          .select('id, participant_id')
          .eq('id', firstSessionId)
          .maybeSingle();
        if (sErr) {
          console.error('batchInsertEvents session lookup:', sErr);
          return fail('Failed to validate session');
        }
        if (!session) return fail('Session not found');
        if ((session as Record<string, unknown>).participant_id !== firstParticipantId) {
          return fail('Session participant mismatch');
        }

        const { data, error } = await db.from('events').insert(events).select();
        if (error) {
          console.error('batchInsertEvents insert:', error);
          return fail('Failed to insert events');
        }
        return ok({ count: (data as unknown[])?.length ?? events.length });
      }

      case 'updateParticipantStatus': {
        const { participantId, status } = payload;
        const extra = (payload.extra && typeof payload.extra === 'object' && !Array.isArray(payload.extra))
          ? payload.extra as Record<string, unknown>
          : {};
        if (!participantId) return bad('participantId is required');
        if (!status) return bad('status is required');
        if (!ALLOWED_PARTICIPANT_STATUSES.has(status as string)) {
          return bad(`Invalid status: ${status}`);
        }

        const filteredExtra: Record<string, unknown> = {};
        for (const key of Object.keys(extra)) {
          if (ALLOWED_PARTICIPANT_EXTRA_FIELDS.has(key)) {
            filteredExtra[key] = extra[key];
          }
        }

        const { error } = await db
          .from('participants')
          .update({ status, ...filteredExtra })
          .eq('id', participantId);
        if (error) {
          console.error('updateParticipantStatus:', error);
          return fail('Failed to update participant status');
        }
        return ok(null);
      }

      case 'upsertScreen': {
        const screenData = payload.screenData as Record<string, unknown> | null;
        if (!screenData?.study_id) return bad('screenData.study_id is required');
        if (!screenData?.screen_id) return bad('screenData.screen_id is required');
        const { data, error } = await db
          .from('screens')
          .upsert(screenData, { onConflict: 'study_id,screen_id' })
          .select()
          .single();
        if (error) {
          console.error('upsertScreen:', error);
          return fail('Failed to upsert screen');
        }
        return ok(data);
      }

      case 'markScreenStale': {
        const { screenId, sessionId } = payload;
        if (!screenId) return bad('screenId is required');
        if (!sessionId) return bad('sessionId is required');
        const { error } = await db
          .from('screens')
          .update({
            is_stale: true,
            change_detected_at: new Date().toISOString(),
            first_stale_session_id: sessionId,
          })
          .eq('id', screenId)
          .eq('is_stale', false);
        if (error) {
          console.error('markScreenStale:', error);
          return fail('Failed to mark screen stale');
        }
        return ok(null);
      }

      case 'updateStudyScreenChangesFlag': {
        const { studyId } = payload;
        if (!studyId) return bad('studyId is required');
        const { error } = await db
          .from('studies')
          .update({ has_screen_changes: true, updated_at: new Date().toISOString() })
          .eq('id', studyId);
        if (error) {
          console.error('updateStudyScreenChangesFlag:', error);
          return fail('Failed to update study');
        }
        return ok(null);
      }

      case 'updateStudyIdealPath': {
        const { studyId, idealPath, status, recordedSurveys } = payload;
        if (!studyId) return bad('studyId is required');
        if (!idealPath) return bad('idealPath is required');
        if (status !== 'active') return bad('status must be active');

        const update: Record<string, unknown> = {
          ideal_path: idealPath,
          status: 'active',
          updated_at: new Date().toISOString(),
        };

        // Survey points marked during recording become screen-triggered
        // surveys with default config (refined later in setup). Recorder-
        // sourced surveys from a previous recording are replaced; manually
        // authored surveys are preserved. The server builds the survey
        // objects itself — the client only supplies screen ids.
        if (Array.isArray(recordedSurveys)) {
          const { data: studyRow, error: sErr } = await db
            .from('studies')
            .select('surveys')
            .eq('id', studyId)
            .maybeSingle();
          if (sErr) {
            console.error('updateStudyIdealPath surveys lookup:', sErr);
            return fail('Failed to load existing surveys');
          }
          const existing = Array.isArray(studyRow?.surveys) ? studyRow.surveys as Record<string, unknown>[] : [];
          const manual = existing.filter((s) => s?.source !== 'recorder');
          let nextId = manual.reduce((m, s) => Math.max(m, Number(s?.id) || 0), 0);
          const capText = (v: unknown) => String(v ?? '').trim().slice(0, 200);
          const recorded = recordedSurveys
            .slice(0, 20)
            .map((p: Record<string, unknown>) => {
              const sid = String(p?.screenId || '').trim().toLowerCase();
              if (!sid) return null;
              // ratingEnabled defaults to true (absent on points from older
              // recorder builds); a survey with neither field is coerced to
              // rating-only so it's never an empty card.
              const commentOn = !!p?.commentEnabled;
              const ratingOn  = p?.ratingEnabled !== false || !commentOn;
              return {
                id: ++nextId,
                trigger: { type: 'screen_enter', screenId: sid },
                rating:  { enabled: ratingOn, prompt: capText(p?.ratingPrompt) },
                comment: { enabled: commentOn, prompt: capText(p?.commentPrompt) },
                required: !!p?.required,
                presentation: p?.presentation === 'overlay' ? 'overlay' : 'panel',
                source: 'recorder',
              };
            })
            .filter((s) => s !== null);
          update.surveys = [...manual, ...recorded];
        }

        const { error } = await db
          .from('studies')
          .update(update)
          .eq('id', studyId);
        if (error) {
          console.error('updateStudyIdealPath:', error);
          return fail('Failed to update study ideal path');
        }
        return ok(null);
      }

      default:
        return bad(`Unknown action: ${action}`);
    }
  } catch (err) {
    console.error('Unhandled error in ux-tracker-ingest:', err);
    return jsonResponse({ success: false, data: null, error: 'Internal server error' }, 500);
  }
});
