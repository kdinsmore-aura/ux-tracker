import { PARTICIPANT_SESSION_KEY } from './utils/config.js';
import { computeScreenId } from './utils/screen-id.js';
import {
  fetchParticipant,
  updateParticipantStatus,
  createSession,
  updateSession,
  markScreenStale,
  updateStudyScreenChangesFlag,
  fetchScreensForStudy,
} from './utils/supabase-client.js';
import {
  getSessionState,
  saveSessionState,
  clearSessionState,
  isSessionExpired,
  bufferEvent,
  flushEventBuffer,
  setEventBuffer,
  startClickCapture,
  stopClickCapture,
  checkScreenForChanges,
} from './tracker.js';

// ─── Module state ─────────────────────────────────────────────────────────────

let _config        = null;
let _study         = null;
let _panel         = null;
let _cachedScreens = null;

let _sessionId        = '';
let _participantId    = '';
let _currentStepIndex = 0;
let _completedSteps   = 0;
let _sessionStartTime = 0;   // epoch ms
let _lastEventTime    = 0;   // epoch ms
let _currentScreenId  = '';
let _screenChanges    = [];
let _totalSteps       = 0;
let _sortedTasks      = [];  // study.tasks sorted by .order

// Goal mode: active when any task defines a completion goal. Completion is
// then task-driven (any route to the goal counts); the recorded ideal path
// is scored for analytics only.
let _goalMode            = false;
let _currentTaskIndex    = 0;
let _completedTasks      = 0;
let _surveys             = [];    // study.surveys (after_task triggers)
let _firedSurveys        = [];    // survey ids already shown this session
let _surveyResponses     = [];    // accumulated responses (mirrored to the session row)
let _surveyActive        = false; // a survey card/overlay is currently displayed
let _surveyQueue         = [];    // surveys waiting to be shown (one at a time)
let _pendingCompletionMs = null;  // completion screen deferred until surveys done

// ─── Session state helpers ────────────────────────────────────────────────────

function _getState() {
  return {
    sessionId:        _sessionId,
    participantId:    _participantId,
    studyId:          _config.studyId,
    currentStepIndex: _currentStepIndex,
    completedSteps:   _completedSteps,
    sessionStartTime: new Date(_sessionStartTime).toISOString(),
    lastEventTime:    new Date(_lastEventTime).toISOString(),
    screenChanges:    _screenChanges,
    minimized:        _panel ? _panel._minimized : false,
    currentTaskIndex: _currentTaskIndex,
    completedTasks:   _completedTasks,
    firedSurveys:     _firedSurveys,
    surveyResponses:  _surveyResponses,
  };
}

function _saveState() {
  saveSessionState(_participantId, _getState());
}

// ─── Guard message ────────────────────────────────────────────────────────────

function _showGuardMessage(message) {
  const host   = document.createElement('div');
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      #msg {
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        display: flex; align-items: center; justify-content: center;
        font-family: system-ui, -apple-system, sans-serif;
        font-size: 18px; font-weight: 500; color: #374151;
        background: rgba(255,255,255,.9); z-index: 999999;
        text-align: center; padding: 24px; box-sizing: border-box;
        line-height: 1.5;
      }
    </style>
    <div id="msg">${message}</div>
  `;
  document.body.appendChild(host);
}

// ─── On-path matching ─────────────────────────────────────────────────────────

function _isOnPath(clickData, expectedStep) {
  if (!expectedStep) return false;

  // 1. Exact selector match
  if (expectedStep.elementSelector &&
      clickData.elementSelector === expectedStep.elementSelector) {
    return true;
  }

  // 2. Text containment match
  if (expectedStep.elementText && clickData.elementText &&
      clickData.elementText.includes(expectedStep.elementText)) {
    return true;
  }

  // 3. Clicked element is within the expected element's parent container
  try {
    if (expectedStep.elementSelector) {
      const expectedEl = document.querySelector(expectedStep.elementSelector);
      if (expectedEl?.parentElement) {
        const clickedEl = document.elementFromPoint(clickData.viewportX, clickData.viewportY);
        if (clickedEl && expectedEl.parentElement.contains(clickedEl)) return true;
      }
    }
  } catch {
    // Invalid selector — fall through
  }

  return false;
}

// ─── Event factory ────────────────────────────────────────────────────────────

function _makeEvent(eventType, screenId, extra = {}) {
  const now                = Date.now();
  const msSinceSessionStart = now - _sessionStartTime;
  const msSinceLastEvent    = now - _lastEventTime;
  _lastEventTime = now;

  return {
    session_id:             _sessionId,
    study_id:               _config.studyId,
    participant_id:         _participantId,
    screen_id:              screenId,
    event_type:             eventType,
    step_index:             _currentStepIndex,
    ms_since_session_start: msSinceSessionStart,
    ms_since_last_event:    msSinceLastEvent,
    timestamp:              new Date(now).toISOString(),
    ...extra,
  };
}

// ─── Screen change detection ──────────────────────────────────────────────────

async function _runScreenChangeDetection(sessionId, screenIdOverride) {
  if (!_config.hashStalenessCheck) return;

  const screenId = screenIdOverride ?? computeScreenId(_config.screens);

  if (!_cachedScreens) {
    try {
      _cachedScreens = await fetchScreensForStudy(_config.studyId);
    } catch {
      return;
    }
  }

  const screenRecord = (_cachedScreens ?? []).find(s => s.screen_id === screenId);
  if (!screenRecord) return;

  let result;
  try {
    result = await checkScreenForChanges(screenRecord, _config);
  } catch {
    return;
  }

  if (!result.changed) return;

  const entry = {
    screenId,
    recordedHash: result.recordedHash,
    observedHash: result.observedHash,
    detectedAt:   new Date().toISOString(),
  };

  _screenChanges = [..._screenChanges, entry];
  _saveState();

  updateSession(sessionId, _participantId, {
    screen_changes:    _screenChanges,
    has_screen_changes: true,
  }).catch(() => {});

  markScreenStale(screenRecord.id, sessionId, result.observedHash, _config.studyId).catch(() => {});
  updateStudyScreenChangesFlag(_config.studyId).catch(() => {});

  if (_panel) _panel.flashStaleChange();
}

// ─── Panel update ─────────────────────────────────────────────────────────────

function _updatePanel() {
  if (!_panel) return;
  if (_surveyActive) return;   // don't repaint while a survey card is up

  if (_goalMode) {
    const idx  = Math.min(_currentTaskIndex, _sortedTasks.length - 1);
    const task = _sortedTasks[idx];
    _panel.updateTask(task?.prompt ?? '', idx, _completedTasks, _sortedTasks.length);
    return;
  }

  const taskIndex = Math.min(_currentStepIndex, _sortedTasks.length - 1);
  const task      = _sortedTasks[taskIndex];
  _panel.updateTask(
    task?.prompt ?? '',
    _currentStepIndex,
    _completedSteps,
    _totalSteps,
  );
}

// ─── Task goals (goal mode) ───────────────────────────────────────────────────

function _activeTask() {
  return _sortedTasks[_currentTaskIndex] ?? null;
}

// A task's goal, or null when absent/malformed.
function _taskGoal(task) {
  const g = task?.goal;
  if (!g) return null;
  if (g.type === 'screen' && g.screenId) return g;
  if (g.type === 'click' && (g.selector || g.elementText)) return g;
  return null;
}

function _screenMatchesGoal(screenId, goalScreenId) {
  const a = String(screenId || '').toLowerCase().trim();
  const b = String(goalScreenId || '').toLowerCase().trim();
  if (!b) return false;
  if (a === b) return true;
  // A goal that pins a query/hash must match exactly; a plain path goal
  // matches any variant of that route ('/checkout?step=2' reaches '/checkout').
  if (b.includes('?') || b.includes('#')) return false;
  const norm = (s) => (s.split('#')[0].split('?')[0].replace(/\/+$/, '') || '/');
  return norm(a) === norm(b);
}

function _clickMatchesGoal(clickData, goal) {
  if (goal.selector && clickData.elementSelector === goal.selector) return true;
  if (goal.elementText && clickData.elementText &&
      clickData.elementText.toLowerCase().includes(goal.elementText.toLowerCase())) {
    return true;
  }
  // The goal selector may name an ancestor of the actual click target.
  try {
    if (goal.selector) {
      const clicked = document.elementFromPoint(clickData.viewportX, clickData.viewportY);
      const target  = document.querySelector(goal.selector);
      if (clicked && target && (target === clicked || target.contains(clicked))) return true;
    }
  } catch {
    // Invalid selector — fall through
  }
  return false;
}

// Evaluate the active task's goal against the current screen (and click, when
// one triggered the evaluation). Tasks without a goal auto-complete in goal
// mode, cascading to the next task.
function _evaluateActiveGoal(screenId, clickData) {
  if (!_goalMode) return;
  const task = _activeTask();
  if (!task) return;
  const goal = _taskGoal(task);
  if (!goal) { _completeTask(screenId); return; }
  if (goal.type === 'screen' && _screenMatchesGoal(screenId, goal.screenId)) {
    _completeTask(screenId);
    return;
  }
  if (goal.type === 'click' && clickData && _clickMatchesGoal(clickData, goal)) {
    _completeTask(screenId);
  }
}

function _completeTask(screenId) {
  const task = _activeTask();
  if (!task) return;

  bufferEvent(
    _makeEvent('task_complete', screenId, { step_index: _currentTaskIndex }),
    _getState(),
    _participantId,
  );

  _currentTaskIndex += 1;
  _completedTasks   += 1;
  _saveState();

  updateSession(_sessionId, _participantId, {
    current_task_index: _currentTaskIndex,
    completed_tasks:    _completedTasks,
  }).catch(() => {});

  _updatePanel();
  _maybeFireSurvey(task, screenId);

  if (_currentTaskIndex >= _sortedTasks.length) {
    _completeSession().catch((err) => {
      console.error('[UXTracker Participant] Session completion error:', err);
    });
    return;
  }

  bufferEvent(
    _makeEvent('task_start', screenId, { step_index: _currentTaskIndex }),
    _getState(),
    _participantId,
  );

  // The next task's goal may already be satisfied on this screen (or the
  // task may have no goal) — cascade immediately.
  _evaluateActiveGoal(screenId, null);
}

// ─── Mid-study surveys ────────────────────────────────────────────────────────

// Surveys show one at a time; anything that fires while one is on screen
// (cascading task completions, a screen trigger landing mid-survey) queues
// behind it. A survey id is marked fired at enqueue time — once per session.
function _enqueueSurvey(survey, screenId) {
  if (_firedSurveys.includes(survey.id)) return;
  _firedSurveys.push(survey.id);
  _saveState();
  _surveyQueue.push({ survey, screenId });
  _showNextSurvey();
}

function _maybeFireSurvey(completedTask, screenId) {
  const survey = _surveys.find((s) =>
    s?.trigger?.type === 'after_task' &&
    s.trigger.taskId === completedTask.id &&
    !_firedSurveys.includes(s.id));
  if (survey) _enqueueSurvey(survey, screenId);
}

// Screen-triggered surveys (e.g. points marked during recording) fire the
// first time the participant reaches the trigger screen, by any route.
function _maybeFireScreenSurveys(screenId) {
  for (const s of _surveys) {
    if (s?.trigger?.type === 'screen_enter' &&
        !_firedSurveys.includes(s.id) &&
        _screenMatchesGoal(screenId, s.trigger.screenId)) {
      _enqueueSurvey(s, screenId);
    }
  }
}

function _showNextSurvey() {
  if (_surveyActive || !_panel || _surveyQueue.length === 0) return;
  const { survey, screenId } = _surveyQueue.shift();
  _surveyActive = true;

  _panel.showSurvey(survey, (result) => {
    _surveyActive = false;
    _surveyResponses.push({
      surveyId:            survey.id,
      trigger:             survey.trigger,
      rating:              result.rating ?? null,
      comment:             result.comment ?? null,
      skipped:             !!result.skipped,
      screenId,
      taskIndex:           _currentTaskIndex,
      msSinceSessionStart: Date.now() - _sessionStartTime,
      submittedAt:         new Date().toISOString(),
    });
    _saveState();
    updateSession(_sessionId, _participantId, { survey_responses: _surveyResponses })
      .catch((err) => console.error('[UXTracker Participant] survey save error:', err));

    if (_surveyQueue.length > 0) {
      _showNextSurvey();
      return;
    }
    if (_pendingCompletionMs != null) {
      const ms = _pendingCompletionMs;
      _pendingCompletionMs = null;
      if (_panel) _panel.showComplete(ms);
    } else {
      _updatePanel();
    }
  });
}

// ─── Click handler ────────────────────────────────────────────────────────────

function _handleClick(clickData) {
  const screenId    = computeScreenId(_config.screens);
  const idealPath   = Array.isArray(_study.ideal_path) ? _study.ideal_path : [];
  const expected    = idealPath[_currentStepIndex] ?? null;
  const isOnPath    = _isOnPath(clickData, expected);
  const advancesStep = isOnPath && _totalSteps > 0 && _currentStepIndex < _totalSteps;
  const isMisClick  = !isOnPath;

  const event = _makeEvent('click', screenId, {
    element_selector:  clickData.elementSelector,
    element_text:      clickData.elementText,
    element_tag:       clickData.elementTagName,
    viewport_x:        clickData.viewportX,
    viewport_y:        clickData.viewportY,
    normalized_x:      clickData.normalizedX,
    normalized_y:      clickData.normalizedY,
    page_x:            clickData.pageX,
    page_y:            clickData.pageY,
    scroll_x:          clickData.scrollX,
    scroll_y:          clickData.scrollY,
    is_on_path:        isOnPath,
    is_mis_click:      isMisClick,
    advances_step:     advancesStep,
  });

  bufferEvent(event, _getState(), _participantId);

  if (_goalMode) {
    // Reference-path cursor still advances for analytics, but completion is
    // task-goal driven — reaching the end of the recording completes nothing.
    if (advancesStep) {
      _currentStepIndex++;
      _completedSteps++;
      _saveState();
      updateSession(_sessionId, _participantId, {
        current_step_index: _currentStepIndex,
        completed_steps:    _completedSteps,
      }).catch(() => {});
    }
    _evaluateActiveGoal(screenId, clickData);
    return;
  }

  if (!advancesStep) return;

  _currentStepIndex++;
  _completedSteps++;
  _saveState();

  updateSession(_sessionId, _participantId, {
    current_step_index: _currentStepIndex,
    completed_steps:    _completedSteps,
  }).catch(() => {});

  if (typeof _config.onStepAdvance === 'function') {
    try {
      _config.onStepAdvance({ stepIndex: _currentStepIndex - 1 });
    } catch {
      // User callback errors must not crash the tracker
    }
  }

  _updatePanel();

  if (_currentStepIndex >= _totalSteps) {
    _completeSession().catch((err) => {
      console.error('[UXTracker Participant] Session completion error:', err);
    });
  }
}

// ─── Navigation handler ───────────────────────────────────────────────────────

let _navPending = false;

async function _handleNavigation() {
  // Brief settle delay so SPA can update custom screen detectors
  await new Promise(r => setTimeout(r, 50));

  const newScreenId = computeScreenId(_config.screens);
  if (newScreenId === _currentScreenId) return;

  const prevScreenId = _currentScreenId;
  _currentScreenId   = newScreenId;

  // Flush before inserting transition events
  await flushEventBuffer(_getState(), _participantId).catch(() => {});

  bufferEvent(_makeEvent('screen_exit', prevScreenId, {}), _getState(), _participantId);
  bufferEvent(_makeEvent('screen_enter', newScreenId, {}), _getState(), _participantId);

  _runScreenChangeDetection(_sessionId, newScreenId).catch(() => {});
  _evaluateActiveGoal(newScreenId, null);
  _maybeFireScreenSurveys(newScreenId);
  _updatePanel();
}

// ─── History patching ─────────────────────────────────────────────────────────

function _patchHistory() {
  const wrap = (orig) => function (...args) {
    const result = orig.apply(this, args);
    window.dispatchEvent(new Event('uxt:participant-nav'));
    return result;
  };

  if (!history.pushState._uxtPParticipant) {
    const orig = history.pushState;
    history.pushState = wrap(orig);
    history.pushState._uxtPParticipant = true;
  }
  if (!history.replaceState._uxtPParticipant) {
    const orig = history.replaceState;
    history.replaceState = wrap(orig);
    history.replaceState._uxtPParticipant = true;
  }
}

// ─── Session completion ───────────────────────────────────────────────────────

async function _completeSession() {
  stopClickCapture();

  const completedAt = new Date().toISOString();
  const durationMs  = Date.now() - _sessionStartTime;

  // session_complete triggers an immediate flush inside bufferEvent
  bufferEvent(
    _makeEvent('session_complete', computeScreenId(_config.screens), {}),
    _getState(),
    _participantId,
  );

  // Ensure all events are flushed
  await flushEventBuffer(_getState(), _participantId).catch(() => {});

  await updateParticipantStatus(_participantId, 'completed', { completed_at: completedAt })
    .catch((err) => console.error('[UXTracker Participant] updateParticipantStatus error:', err));

  await updateSession(_sessionId, _participantId, {
    status:          'completed',
    completed_at:    completedAt,
    completed_steps: _completedSteps,
    duration_ms:     durationMs,
  }).catch((err) => console.error('[UXTracker Participant] updateSession (complete) error:', err));

  clearSessionState(_participantId);
  try { sessionStorage.removeItem(PARTICIPANT_SESSION_KEY); } catch {}

  if (typeof _config.onComplete === 'function') {
    try {
      _config.onComplete({
        sessionId:      _sessionId,
        participantId:  _participantId,
        studyId:        _config.studyId,
        completedSteps: _completedSteps,
        totalSteps:     _totalSteps,
        durationMs,
        completedAt,
      });
    } catch {
      // User callback errors must not crash the tracker
    }
  }

  if (_surveyActive) {
    // A mid-study survey is still on screen (fired by the final task) —
    // the completion screen appears once it's answered. All completion
    // data above is already persisted either way.
    _pendingCompletionMs = durationMs;
  } else if (_panel) {
    _panel.showComplete(durationMs);
  }
}

// ─── Panel render ─────────────────────────────────────────────────────────────

function _renderPanel() {
  if (!customElements.get('uxt-task-panel')) {
    customElements.define('uxt-task-panel', UxtTaskPanel);
  }

  const panelEl = document.createElement('uxt-task-panel');
  document.body.appendChild(panelEl);
  _panel = panelEl;

  // Restore minimized state from sessionStorage
  const saved = getSessionState(_participantId);
  if (saved?.minimized) _panel.setMinimized(true);

  _panel.setStudyName(_study.name ?? 'Study');
  _updatePanel();
}

// ─── Task panel — Shadow DOM Web Component ────────────────────────────────────

const _PANEL_CSS = `
  :host { all: initial; }
  #panel {
    position: fixed; bottom: 24px; right: 24px; width: 300px;
    background: #ffffff; color: #1a1a2e;
    font-family: system-ui, -apple-system, sans-serif;
    border-radius: 12px;
    box-shadow: 0 4px 24px rgba(0,0,0,.15), 0 1px 4px rgba(0,0,0,.08);
    z-index: 999999; overflow: hidden; user-select: none;
  }
  #panel.stale-flash {
    animation: amber-pulse 2s ease forwards;
  }
  @keyframes amber-pulse {
    0%   { box-shadow: 0 4px 24px rgba(0,0,0,.15), 0 0 0 2px #f59e0b; }
    85%  { box-shadow: 0 4px 24px rgba(0,0,0,.15), 0 0 0 2px #f59e0b; }
    100% { box-shadow: 0 4px 24px rgba(0,0,0,.15), 0 1px 4px rgba(0,0,0,.08); }
  }
  #header {
    display: flex; align-items: center; gap: 8px;
    padding: 10px 14px; background: #f8f9fa;
    border-bottom: 1px solid #e9ecef; cursor: pointer;
  }
  #header:hover { background: #f1f3f5; }
  #study-name {
    flex: 1; font-size: 11px; color: #6c757d; font-weight: 500;
    letter-spacing: .03em; overflow: hidden;
    white-space: nowrap; text-overflow: ellipsis;
  }
  #toggle-arrow { font-size: 10px; color: #adb5bd; flex-shrink: 0; line-height: 1; }
  #body { padding: 16px; display: flex; flex-direction: column; gap: 12px; }
  #panel.minimized #body { display: none; }
  #panel.minimized #complete-body { display: none !important; }
  #task-prompt {
    font-size: 15px; font-weight: 500; color: #1a1a2e; line-height: 1.5;
  }
  #progress-label { font-size: 12px; color: #6c757d; }
  #progress-track {
    height: 4px; background: #e9ecef; border-radius: 2px; overflow: hidden;
  }
  #progress-fill {
    height: 100%; background: #4f46e5; border-radius: 2px;
    transition: width .3s ease; width: 0%;
  }
  #complete-body {
    padding: 16px; display: none; flex-direction: column; gap: 8px;
    border-top: 1px solid #e9ecef;
  }
  #complete-body.open { display: flex; }
  #complete-msg { font-size: 14px; font-weight: 500; color: #15803d; line-height: 1.5; }
  #complete-time { font-size: 12px; color: #6c757d; }
  #feedback { display: none; flex-direction: column; gap: 10px; margin-top: 4px; }
  #feedback.show { display: flex; }
  .fb-prompt { font-size: 13px; font-weight: 500; color: #1a1a2e; line-height: 1.4; }
  .fb-stars { display: flex; gap: 4px; }
  .fb-star {
    background: none; border: none; padding: 0; cursor: pointer;
    font-size: 26px; line-height: 1; color: #d1d5db; transition: color .1s;
  }
  .fb-star.filled { color: #f59e0b; }
  #fb-comment {
    width: 100%; box-sizing: border-box; resize: vertical; min-height: 56px;
    border: 1px solid #d1d5db; border-radius: 6px; padding: 8px;
    font-family: inherit; font-size: 13px; color: #1a1a2e;
  }
  #fb-comment:focus { outline: none; border-color: #4f46e5; }
  #fb-submit {
    align-self: flex-start; padding: 7px 14px; border: none; border-radius: 6px;
    background: #4f46e5; color: #fff; font-size: 13px; font-weight: 500;
    cursor: pointer; transition: opacity .15s;
  }
  #fb-submit:hover { opacity: .9; }
  #fb-hint { font-size: 12px; color: #dc2626; display: none; }
  #fb-hint.show { display: block; }
  #fb-thanks { font-size: 13px; font-weight: 500; color: #15803d; display: none; }
  #survey-body {
    padding: 16px; display: none; border-top: 1px solid #e9ecef;
  }
  #survey-body.open { display: block; }
  #panel.minimized #survey-body { display: none !important; }
  #survey-overlay {
    position: fixed; inset: 0; background: rgba(17,24,39,.5);
    display: none; align-items: center; justify-content: center;
    z-index: 2147483647;
    font-family: system-ui, -apple-system, sans-serif;
  }
  #survey-overlay.open { display: flex; }
  .sv-inline { display: flex; flex-direction: column; gap: 10px; }
  .sv-dialog {
    background: #ffffff; border-radius: 12px;
    box-shadow: 0 20px 60px rgba(0,0,0,.3);
    padding: 20px; width: 340px; max-width: 90vw;
    display: flex; flex-direction: column; gap: 10px;
  }
  .sv-prompt { font-size: 13px; font-weight: 500; color: #1a1a2e; line-height: 1.4; }
  .sv-stars { display: flex; gap: 4px; }
  .sv-star {
    background: none; border: none; padding: 0; cursor: pointer;
    font-size: 26px; line-height: 1; color: #d1d5db; transition: color .1s;
  }
  .sv-star.filled { color: #f59e0b; }
  .sv-comment {
    width: 100%; box-sizing: border-box; resize: vertical; min-height: 56px;
    border: 1px solid #d1d5db; border-radius: 6px; padding: 8px;
    font-family: inherit; font-size: 13px; color: #1a1a2e;
  }
  .sv-comment:focus { outline: none; border-color: #4f46e5; }
  .sv-btn-row { display: flex; gap: 8px; }
  .sv-submit {
    padding: 7px 14px; border: none; border-radius: 6px;
    background: #4f46e5; color: #fff; font-size: 13px; font-weight: 500;
    cursor: pointer; transition: opacity .15s;
  }
  .sv-submit:hover { opacity: .9; }
  .sv-skip {
    padding: 7px 14px; border: none; border-radius: 6px;
    background: #e9ecef; color: #374151; font-size: 13px; font-weight: 500;
    cursor: pointer;
  }
  .sv-hint { font-size: 12px; color: #dc2626; display: none; }
  .sv-hint.show { display: block; }
`;

class UxtTaskPanel extends HTMLElement {
  constructor() {
    super();
    this._shadow    = this.attachShadow({ mode: 'closed' });
    this._minimized = false;
    this._completed = false;
  }

  connectedCallback() {
    this._shadow.innerHTML = `
      <style>${_PANEL_CSS}</style>
      <div id="panel">
        <div id="header">
          <span id="study-name"></span>
          <span id="toggle-arrow">▲</span>
        </div>
        <div id="body">
          <div id="task-prompt"></div>
          <div id="progress-label">Task 1 of 1</div>
          <div id="progress-track"><div id="progress-fill"></div></div>
        </div>
        <div id="complete-body">
          <div id="complete-msg">You've completed all tasks. Thank you!</div>
          <div id="complete-time"></div>
          <div id="feedback">
            <div id="fb-rating-wrap" style="display:none;">
              <div id="fb-rating-prompt" class="fb-prompt"></div>
              <div id="fb-stars" class="fb-stars" role="radiogroup" aria-label="Rating">
                <button type="button" class="fb-star" data-value="1" aria-label="1 star">★</button>
                <button type="button" class="fb-star" data-value="2" aria-label="2 stars">★</button>
                <button type="button" class="fb-star" data-value="3" aria-label="3 stars">★</button>
                <button type="button" class="fb-star" data-value="4" aria-label="4 stars">★</button>
                <button type="button" class="fb-star" data-value="5" aria-label="5 stars">★</button>
              </div>
            </div>
            <div id="fb-comment-wrap" style="display:none;">
              <div id="fb-comment-prompt" class="fb-prompt"></div>
              <textarea id="fb-comment" placeholder="Optional"></textarea>
            </div>
            <div id="fb-hint">Please add a rating before submitting.</div>
            <button id="fb-submit" type="button">Submit feedback</button>
            <div id="fb-thanks">Thanks for your feedback!</div>
          </div>
        </div>
        <div id="survey-body"></div>
      </div>
      <div id="survey-overlay"></div>
    `;
    this._q('header').addEventListener('click', () => this._toggleMinimize());
  }

  _q(id) {
    return this._shadow.getElementById(id);
  }

  setMinimized(val) {
    this._minimized = val;
    this._q('panel').classList.toggle('minimized', val);
    this._q('toggle-arrow').textContent = val ? '▼' : '▲';
  }

  _toggleMinimize() {
    if (this._completed) return;
    this.setMinimized(!this._minimized);
    const saved = getSessionState(_participantId);
    if (saved) saveSessionState(_participantId, { ...saved, minimized: this._minimized });
  }

  setStudyName(name) {
    this._q('study-name').textContent = name;
  }

  updateTask(prompt, currentStepIndex, completedSteps, total) {
    this._q('task-prompt').textContent  = prompt;
    this._q('progress-label').textContent = `Task ${currentStepIndex + 1} of ${total}`;
    const pct = total > 0 ? (completedSteps / total) * 100 : 0;
    this._q('progress-fill').style.width = `${pct}%`;
  }

  flashStaleChange() {
    const panel = this._q('panel');
    panel.classList.remove('stale-flash');
    void panel.offsetWidth; // restart animation
    panel.classList.add('stale-flash');
    setTimeout(() => panel.classList.remove('stale-flash'), 2000);
  }

  showComplete(durationMs) {
    this._completed = true;
    this._q('body').style.display = 'none';

    // Custom thank-you message, with a generic fallback.
    const cfg = (_study && _study.completion) || {};
    const custom = cfg.thankYou && String(cfg.thankYou).trim();
    this._q('complete-msg').textContent = custom || "You've completed all tasks. Thank you!";

    const totalSecs  = Math.round(durationMs / 1000);
    const mins       = Math.floor(totalSecs / 60);
    const secs       = totalSecs % 60;
    let timeStr;
    if (mins > 0 && secs > 0) {
      timeStr = `${mins} minute${mins !== 1 ? 's' : ''} ${secs} second${secs !== 1 ? 's' : ''}`;
    } else if (mins > 0) {
      timeStr = `${mins} minute${mins !== 1 ? 's' : ''}`;
    } else {
      timeStr = `${secs} second${secs !== 1 ? 's' : ''}`;
    }
    this._q('complete-time').textContent = `Completed in ${timeStr}`;

    this._setupFeedback(cfg);
    this._q('complete-body').classList.add('open');
  }

  // Wire up the optional rating/comment fields based on the study's config.
  // The session is already marked complete by now, so this is purely additive.
  _setupFeedback(cfg) {
    const ratingOn  = !!(cfg.rating && cfg.rating.enabled);
    const commentOn = !!(cfg.comment && cfg.comment.enabled);
    if (!ratingOn && !commentOn) return;

    this._rating   = 0;
    this._required = !!cfg.required;

    if (ratingOn) {
      this._q('fb-rating-prompt').textContent =
        (cfg.rating.prompt && cfg.rating.prompt.trim()) || 'How would you rate your experience?';
      this._q('fb-rating-wrap').style.display = '';
      this._shadow.querySelectorAll('.fb-star').forEach((star) => {
        const val = Number(star.dataset.value);
        star.addEventListener('click', () => {
          this._rating = val;
          this._paintStars(val);
          this._q('fb-hint').classList.remove('show');
        });
        star.addEventListener('mouseenter', () => this._paintStars(val));
        star.addEventListener('mouseleave', () => this._paintStars(this._rating));
      });
    }

    if (commentOn) {
      this._q('fb-comment-prompt').textContent =
        (cfg.comment.prompt && cfg.comment.prompt.trim()) || "Anything else you'd like to share?";
      this._q('fb-comment-wrap').style.display = '';
    }

    this._q('fb-submit').addEventListener('click', () => this._submitFeedback(ratingOn, commentOn));
    this._q('feedback').classList.add('show');
  }

  _paintStars(upto) {
    this._shadow.querySelectorAll('.fb-star').forEach((s) => {
      s.classList.toggle('filled', Number(s.dataset.value) <= upto);
    });
  }

  _submitFeedback(ratingOn, commentOn) {
    const rating  = ratingOn ? (this._rating || null) : null;
    const comment = commentOn ? (this._q('fb-comment').value.trim() || null) : null;

    if (this._required) {
      if (ratingOn && !rating) {
        this._q('fb-hint').textContent = 'Please add a rating before submitting.';
        this._q('fb-hint').classList.add('show');
        return;
      }
      if (!ratingOn && commentOn && !comment) {
        this._q('fb-hint').textContent = 'Please add a comment before submitting.';
        this._q('fb-hint').classList.add('show');
        return;
      }
    }

    updateSession(_sessionId, _participantId, {
      feedback: { rating, comment, submittedAt: new Date().toISOString() },
    }).catch((err) => console.error('[UXTracker Participant] feedback save error:', err));

    this._q('fb-rating-wrap').style.display = 'none';
    this._q('fb-comment-wrap').style.display = 'none';
    this._q('fb-hint').classList.remove('show');
    this._q('fb-submit').style.display = 'none';
    this._q('fb-thanks').style.display = 'block';
  }

  // Present a mid-study survey — inline in the panel body or as a blocking
  // overlay, per the survey's presentation setting. onDone receives
  // { rating, comment, skipped }. Prompts are set via textContent, so
  // researcher-authored text is never parsed as HTML.
  showSurvey(survey, onDone) {
    const overlayMode = survey.presentation === 'overlay';
    const ratingOn    = !!(survey.rating && survey.rating.enabled);
    const commentOn   = !!(survey.comment && survey.comment.enabled);
    const required    = !!survey.required;

    this.setMinimized(false);

    const host = overlayMode ? this._q('survey-overlay') : this._q('survey-body');
    const card = document.createElement('div');
    card.className = overlayMode ? 'sv-dialog' : 'sv-inline';

    let rating = 0;
    const stars = [];
    const hint = document.createElement('div');
    hint.className = 'sv-hint';

    if (ratingOn) {
      const prompt = document.createElement('div');
      prompt.className = 'sv-prompt';
      prompt.textContent = (survey.rating.prompt || '').trim() || 'How was that?';
      card.appendChild(prompt);

      const starRow = document.createElement('div');
      starRow.className = 'sv-stars';
      starRow.setAttribute('role', 'radiogroup');
      starRow.setAttribute('aria-label', 'Rating');
      const paint = (upto) => stars.forEach((s, i) => s.classList.toggle('filled', i < upto));
      for (let v = 1; v <= 5; v++) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'sv-star';
        b.textContent = '★';
        b.setAttribute('aria-label', `${v} star${v > 1 ? 's' : ''}`);
        b.addEventListener('click', () => { rating = v; paint(v); hint.classList.remove('show'); });
        b.addEventListener('mouseenter', () => paint(v));
        b.addEventListener('mouseleave', () => paint(rating));
        stars.push(b);
        starRow.appendChild(b);
      }
      card.appendChild(starRow);
    }

    let commentEl = null;
    if (commentOn) {
      const prompt = document.createElement('div');
      prompt.className = 'sv-prompt';
      prompt.textContent = (survey.comment.prompt || '').trim() || "Anything you'd like to share?";
      card.appendChild(prompt);
      commentEl = document.createElement('textarea');
      commentEl.className = 'sv-comment';
      commentEl.placeholder = (required && !ratingOn) ? '' : 'Optional';
      card.appendChild(commentEl);
    }

    card.appendChild(hint);

    const finish = (result) => {
      host.innerHTML = '';
      host.classList.remove('open');
      if (!overlayMode) this._q('body').style.display = '';
      onDone(result);
    };

    const btnRow = document.createElement('div');
    btnRow.className = 'sv-btn-row';

    const submit = document.createElement('button');
    submit.type = 'button';
    submit.className = 'sv-submit';
    submit.textContent = 'Submit';
    submit.addEventListener('click', () => {
      const comment = commentEl ? commentEl.value.trim() : '';
      if (required) {
        if (ratingOn && !rating) {
          hint.textContent = 'Please add a rating.';
          hint.classList.add('show');
          return;
        }
        if (!ratingOn && commentOn && !comment) {
          hint.textContent = 'Please add a comment.';
          hint.classList.add('show');
          return;
        }
      }
      finish({
        rating:  ratingOn ? (rating || null) : null,
        comment: commentOn ? (comment || null) : null,
        skipped: false,
      });
    });
    btnRow.appendChild(submit);

    if (!required) {
      const skip = document.createElement('button');
      skip.type = 'button';
      skip.className = 'sv-skip';
      skip.textContent = 'Skip';
      skip.addEventListener('click', () => finish({ rating: null, comment: null, skipped: true }));
      btnRow.appendChild(skip);
    }
    card.appendChild(btnRow);

    host.innerHTML = '';
    host.appendChild(card);
    if (!overlayMode) this._q('body').style.display = 'none';
    host.classList.add('open');
  }
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

export default async function initParticipant(config, study) {
  _config = config;
  _study  = study;

  // 1. Extract participantId from URL params; fall back to sessionStorage on page 2+
  const params = new URLSearchParams(window.location.search);
  let participantId = params.get('participant');
  const studyId = params.get('study') ?? config.studyId;

  if (!participantId) {
    try {
      const saved = JSON.parse(sessionStorage.getItem(PARTICIPANT_SESSION_KEY) || 'null');
      participantId = saved?.participantId ?? null;
    } catch {}
  }

  // 2. Validate participant
  let participant;
  try {
    participant = await fetchParticipant(participantId, studyId);
  } catch {
    _showGuardMessage('This study link is not valid.');
    return;
  }

  // 3. Guard states
  if (!participant) {
    _showGuardMessage('This study link is not valid.');
    return;
  }
  if (participant.status === 'completed') {
    _showGuardMessage("You've already completed this study. Thank you!");
    return;
  }
  if (study.status === 'closed') {
    _showGuardMessage('This study is no longer accepting responses.');
    return;
  }
  const tasks = Array.isArray(study.tasks) ? study.tasks : [];
  if (tasks.length === 0) {
    _showGuardMessage('This study has no tasks configured yet.');
    return;
  }

  _participantId = participantId;
  _totalSteps    = Array.isArray(study.ideal_path) ? study.ideal_path.length : 0;
  _sortedTasks   = [...tasks].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  _surveys       = Array.isArray(study.surveys) ? study.surveys : [];
  _goalMode      = _sortedTasks.some((t) => _taskGoal(t) !== null);

  // 4. Check for existing session state
  const existingState   = getSessionState(participantId);
  const hasExisting     = existingState !== null;
  const expired         = hasExisting && isSessionExpired(existingState);

  if (hasExisting && !expired) {
    // 5. Resume session
    _sessionId        = existingState.sessionId;
    _currentStepIndex = existingState.currentStepIndex ?? 0;
    _completedSteps   = existingState.completedSteps ?? 0;
    _sessionStartTime = new Date(existingState.sessionStartTime).getTime();
    _lastEventTime    = Date.now();
    _screenChanges    = existingState.screenChanges ?? [];
    _currentTaskIndex = existingState.currentTaskIndex ?? 0;
    _completedTasks   = existingState.completedTasks ?? 0;
    _firedSurveys     = existingState.firedSurveys ?? [];
    _surveyResponses  = existingState.surveyResponses ?? [];

    setEventBuffer(existingState.eventBuffer ?? []);

    updateSession(_sessionId, _participantId, {
      current_step_index: _currentStepIndex,
      completed_steps:    _completedSteps,
    }).catch((err) => console.error('[UXTracker Participant] updateSession (resume) error:', err));

  } else {
    // 6. New session (or expired)
    if (expired && existingState?.sessionId) {
      updateSession(existingState.sessionId, _participantId, { status: 'abandoned' })
        .catch(() => {});
    }

    const now = new Date().toISOString();
    let newSession;
    try {
      newSession = await createSession({
        study_id:         studyId,
        participant_id:   participantId,
        status:           'in_progress',
        current_step_index: 0,
        total_steps:      _totalSteps,
        completed_steps:  0,
        viewport_width:   window.innerWidth,
        viewport_height:  window.innerHeight,
        user_agent:       navigator.userAgent,
        started_at:       now,
      });
    } catch (err) {
      console.error('[UXTracker Participant] createSession error:', err);
      return;
    }

    _sessionId        = newSession.id;
    _currentStepIndex = 0;
    _completedSteps   = 0;
    _sessionStartTime = Date.now();
    _lastEventTime    = Date.now();
    _screenChanges    = [];
    _currentTaskIndex = 0;
    _completedTasks   = 0;
    _firedSurveys     = [];
    _surveyResponses  = [];

    updateParticipantStatus(participantId, 'in_progress', {
      started_at: now,
      session_id: _sessionId,
    }).catch((err) => console.error('[UXTracker Participant] updateParticipantStatus error:', err));

    _saveState();

    bufferEvent(
      _makeEvent('session_start', computeScreenId(_config.screens), {}),
      _getState(),
      _participantId,
    );

    if (_goalMode) {
      bufferEvent(
        _makeEvent('task_start', computeScreenId(_config.screens), { step_index: 0 }),
        _getState(),
        _participantId,
      );
    }
  }

  // 7. Start click capture
  startClickCapture(_handleClick);

  // 8. Navigation listeners
  _patchHistory();
  window.addEventListener('popstate', _handleNavigation);
  window.addEventListener('hashchange', _handleNavigation);
  window.addEventListener('uxt:participant-nav', _handleNavigation);

  // Screen change detection starts before the panel renders (non-blocking).
  // Detection is async (network + fingerprint), so _panel is always set by
  // the time flashStaleChange() is called inside _runScreenChangeDetection.
  _runScreenChangeDetection(_sessionId).catch(() => {});

  // 9. Render task panel
  _renderPanel();
  _currentScreenId = computeScreenId(_config.screens);

  // 10. Full-page prototypes re-boot the tracker on every page load, so
  // evaluate the landing screen: the active task's goal (this is how screen
  // goals complete across real navigations) and any screen-triggered surveys.
  _evaluateActiveGoal(_currentScreenId, null);
  _maybeFireScreenSurveys(_currentScreenId);
}
