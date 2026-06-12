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
  const taskIndex = Math.min(_currentStepIndex, _sortedTasks.length - 1);
  const task      = _sortedTasks[taskIndex];
  _panel.updateTask(
    task?.prompt ?? '',
    _currentStepIndex,
    _completedSteps,
    _totalSteps,
  );
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

  if (_panel) _panel.showComplete(durationMs);
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
        </div>
      </div>
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
    this._q('complete-body').classList.add('open');
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
}
