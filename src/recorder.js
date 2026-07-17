import html2canvas from 'html2canvas';
import { computePageFingerprint } from './utils/fingerprint.js';
import { computeScreenId } from './utils/screen-id.js';
import {
  upsertScreen,
  uploadScreenshot,
  updateStudyIdealPath,
} from './utils/supabase-client.js';
import { startClickCapture, stopClickCapture } from './tracker.js';
import { RECORDING_SESSION_KEY } from './utils/config.js';

// ─── sessionStorage helpers ───────────────────────────────────────────────────

const RECORDING_PATH_KEY     = 'uxt_rec_path';
const RECORDING_SURVEYS_KEY  = 'uxt_rec_surveys';
const RECORDING_TASKS_KEY    = 'uxt_rec_tasks';
const RECORDING_NEWTASKS_KEY = 'uxt_rec_newtasks';

function _loadSavedPath() {
  try {
    const raw = sessionStorage.getItem(RECORDING_PATH_KEY);
    const data = raw ? JSON.parse(raw) : null;
    return Array.isArray(data) ? data : [];
  } catch { return []; }
}

function _savePath(path) {
  try { sessionStorage.setItem(RECORDING_PATH_KEY, JSON.stringify(path)); } catch (_) {}
}

function _loadSavedSurveyPoints() {
  try {
    const data = JSON.parse(sessionStorage.getItem(RECORDING_SURVEYS_KEY) || 'null');
    return Array.isArray(data) ? data : [];
  } catch { return []; }
}

function _saveSurveyPoints(points) {
  try { sessionStorage.setItem(RECORDING_SURVEYS_KEY, JSON.stringify(points)); } catch (_) {}
}

function _loadSavedTaskBoundaries() {
  try {
    const data = JSON.parse(sessionStorage.getItem(RECORDING_TASKS_KEY) || 'null');
    return Array.isArray(data) ? data : [];
  } catch { return []; }
}

function _saveTaskBoundaries(boundaries) {
  try { sessionStorage.setItem(RECORDING_TASKS_KEY, JSON.stringify(boundaries)); } catch (_) {}
}

function _loadSavedNewTasks() {
  try {
    const data = JSON.parse(sessionStorage.getItem(RECORDING_NEWTASKS_KEY) || 'null');
    return Array.isArray(data) ? data : [];
  } catch { return []; }
}

function _saveNewTasks(tasks) {
  try { sessionStorage.setItem(RECORDING_NEWTASKS_KEY, JSON.stringify(tasks)); } catch (_) {}
}

function _clearRecordingSession() {
  try {
    sessionStorage.removeItem(RECORDING_SESSION_KEY);
    sessionStorage.removeItem(RECORDING_PATH_KEY);
    sessionStorage.removeItem(RECORDING_SURVEYS_KEY);
    sessionStorage.removeItem(RECORDING_TASKS_KEY);
    sessionStorage.removeItem(RECORDING_NEWTASKS_KEY);
  } catch (_) {}
}

// ─── Module state ─────────────────────────────────────────────────────────────

const _state = {
  studyId: '',
  idealPath: [],
  capturedScreens: new Map(),
  pendingShots: [],
  surveyPoints: [],    // { screenId, stepIndex, recordedAt, ...details } — survey markers
  taskBoundaries: [],  // { taskIndex, screenId, stepIndex, endedAt } — "End Task" markers
  taskPrompts: [],     // ordered task prompts (study tasks + tasks created in-recording)
  newTasks: [],        // { prompt } — tasks created during this recording, appended on save
  currentStepIndex: 0,
  isRecording: false,
  sessionStartTime: 0,
  lastStepTime: 0,
};

let _config = null;
let _panel = null;
let _frameworkBaseUrl = '';

// ─── Visual feedback helpers ──────────────────────────────────────────────────

function highlightElement(element) {
  if (!element || !element.isConnected) return;
  // Unique class avoids collisions between rapid clicks
  const cls = `_uxt_hl_${Date.now()}`;
  const style = document.createElement('style');
  style.textContent = `.${cls}{outline:2px solid #22c55e!important;outline-offset:2px!important;}`;
  document.head.appendChild(style);
  element.classList.add(cls);
  setTimeout(() => {
    element.classList.remove(cls);
    style.remove();
  }, 400);
}

function scrollToTopAndWait(ms) {
  window.scrollTo(0, 0);
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Screen capture pipeline ──────────────────────────────────────────────────

// Rasterise the current viewport to an image Blob. html2canvas clones the DOM
// synchronously at call time, so the Blob reflects the screen exactly as it
// looked when this was invoked — even if the page navigates a moment later.
async function _renderViewportBlob() {
  let canvas;
  try {
    canvas = await html2canvas(document.body, {
      useCORS: true,
      allowTaint: false,
      scale: 1,
      width: window.innerWidth,
      height: window.innerHeight,
      windowWidth: window.innerWidth,
      windowHeight: window.innerHeight,
    });
  } catch (err) {
    console.error('[UXTracker Recorder] html2canvas failed:', err);
    return null;
  }
  if (!canvas) return null;
  const mimeType = _config.screenshotFormat === 'jpeg' ? 'image/jpeg' : 'image/png';
  return await new Promise(resolve => canvas.toBlob(resolve, mimeType));
}

// Capture a per-step screenshot of the screen as it looks at click time and
// attach its URL to the step. Each step gets its own file (keyed by step index)
// so in-page view changes that never alter the URL — e.g. a multi-step wizard
// toggling CSS classes — still produce a distinct screenshot per step. Runs
// fire-and-forget; the promise is tracked so _saveAndFinish can await it.
function _captureForStep(step) {
  const screenId = computeScreenId(_config.screens);
  const p = (async () => {
    const blob = await _renderViewportBlob();
    if (!blob) return;
    try {
      step.screenshotUrl = await uploadScreenshot(
        _state.studyId, `step-${step.stepIndex}-${screenId}`, blob,
      );
      _savePath(_state.idealPath);
    } catch (err) {
      console.error('[UXTracker Recorder] Step screenshot upload failed:', err);
    }
  })();
  _state.pendingShots.push(p);
  return p;
}

async function captureCurrentScreen() {
  const screenId = computeScreenId(_config.screens);

  // Run html2canvas and DOM fingerprint in parallel
  const [blob, hash] = await Promise.all([
    _renderViewportBlob(),
    computePageFingerprint(),
  ]);

  let screenshotUrl = null;

  if (blob) {
    try {
      screenshotUrl = await uploadScreenshot(_state.studyId, screenId, blob);
    } catch (err) {
      console.error('[UXTracker Recorder] Screenshot upload failed:', err);
    }
  }

  try {
    await upsertScreen({
      study_id: _state.studyId,
      screen_id: screenId,
      screenshot_url: screenshotUrl,
      screenshot_hash: hash,
      viewport_width: window.innerWidth,
      viewport_height: window.innerHeight,
      scroll_x: window.scrollX,
      scroll_y: window.scrollY,
      captured_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[UXTracker Recorder] upsertScreen failed:', err);
  }

  _state.capturedScreens.set(screenId, {
    screenshotUrl,
    hash,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
  });

  if (_panel) _panel.updateScreenCount(_state.capturedScreens.size);

  return (screenshotUrl || hash) ? { screenshotUrl, hash } : null;
}

// ─── Navigation detection ─────────────────────────────────────────────────────

function _patchHistory() {
  const wrap = (original) => function (...args) {
    const result = original.apply(this, args);
    window.dispatchEvent(new Event('uxt:navigation'));
    return result;
  };
  history.pushState = wrap(history.pushState);
  history.replaceState = wrap(history.replaceState);
}

async function _onNavigation() {
  try {
    await new Promise(resolve => setTimeout(resolve, _config.screenshotDelay));
    await scrollToTopAndWait(100);
    await captureCurrentScreen();
  } catch (err) {
    console.error('[UXTracker Recorder] Navigation capture error:', err);
  }
}

// ─── Floating panel — Shadow DOM Web Component ────────────────────────────────

const _PANEL_CSS = `
  :host { all: initial; }
  #panel {
    position: fixed; bottom: 24px; right: 24px; width: 320px;
    background: #1e1e2e; color: #cdd6f4;
    font-family: system-ui, -apple-system, sans-serif; font-size: 13px;
    border-radius: 12px; box-shadow: 0 8px 32px rgba(0,0,0,.5);
    z-index: 999999; overflow: hidden; user-select: none;
  }
  #header {
    display: flex; align-items: center; gap: 8px;
    padding: 12px 16px; background: #181825;
    font-weight: 600; font-size: 11px; letter-spacing: .06em;
    text-transform: uppercase; color: #a6adc8;
  }
  #dot {
    width: 8px; height: 8px; border-radius: 50%;
    background: #f38ba8; flex-shrink: 0;
    animation: pulse 1.4s ease-in-out infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50%       { opacity: .35; transform: scale(.7); }
  }
  #body {
    padding: 14px 16px; display: flex; flex-direction: column; gap: 10px;
  }
  #task-desc { font-size: 13px; color: #cdd6f4; line-height: 1.45; min-height: 18px; white-space: pre-line; }
  .meta { font-size: 11px; color: #6c7086; }
  .btn-row { display: flex; gap: 8px; }
  button {
    padding: 7px 10px; border: none; border-radius: 6px;
    font-size: 12px; font-weight: 500; cursor: pointer; transition: opacity .15s;
  }
  button:hover { opacity: .82; }
  #btn-capture { background: #313244; color: #cdd6f4; flex: 1; }
  #btn-mark    { background: #40a02b; color: #fff; flex: 1; }
  #btn-endtask { background: #f9e2af; color: #1e1e2e; width: 100%; }
  #btn-endtask:disabled { opacity: .5; cursor: default; }
  #task-form {
    display: none; flex-direction: column; gap: 8px;
    background: #181825; border: 1px solid #313244; border-radius: 6px; padding: 10px;
  }
  #task-form.open { display: flex; }
  #task-form input[type="text"] {
    width: 100%; box-sizing: border-box;
    background: #313244; border: 1px solid #45475a; border-radius: 6px;
    color: #cdd6f4; padding: 7px 8px; font-size: 12px; font-family: inherit;
  }
  #task-form input[type="text"]:focus { outline: none; border-color: #f9e2af; }
  #task-form textarea {
    width: 100%; box-sizing: border-box; resize: vertical; min-height: 48px;
    background: #313244; border: 1px solid #45475a; border-radius: 6px;
    color: #cdd6f4; padding: 7px 8px; font-size: 12px; font-family: inherit;
  }
  #task-form textarea:focus { outline: none; border-color: #f9e2af; }
  #tf-hint { font-size: 11px; color: #f38ba8; display: none; }
  #tf-hint.show { display: block; }
  #tf-start  { background: #40a02b; color: #fff; flex: 1; }
  #tf-cancel { background: #313244; color: #cdd6f4; flex: 1; }
  #btn-survey  { background: #89b4fa; color: #1e1e2e; width: 100%; }
  #btn-finish  { background: #f38ba8; color: #1e1e2e; width: 100%; }
  #task-tracker { color: #f9e2af; }
  #survey-form {
    display: none; flex-direction: column; gap: 8px;
    background: #181825; border: 1px solid #313244; border-radius: 6px; padding: 10px;
  }
  #survey-form.open { display: flex; }
  #survey-form input[type="text"] {
    width: 100%; box-sizing: border-box;
    background: #313244; border: 1px solid #45475a; border-radius: 6px;
    color: #cdd6f4; padding: 7px 8px; font-size: 12px; font-family: inherit;
  }
  #survey-form input[type="text"]:focus { outline: none; border-color: #89b4fa; }
  #survey-form label {
    font-size: 11px; color: #a6adc8; display: flex; align-items: center; gap: 6px;
    cursor: pointer; user-select: none;
  }
  #survey-form select {
    background: #313244; border: 1px solid #45475a; border-radius: 6px;
    color: #cdd6f4; padding: 5px 6px; font-size: 11px; font-family: inherit;
  }
  .sf-row { display: flex; gap: 10px; align-items: center; justify-content: space-between; }
  #sf-save   { background: #40a02b; color: #fff; flex: 1; }
  #sf-cancel { background: #313244; color: #cdd6f4; flex: 1; }
  #sf-hint { font-size: 11px; color: #f38ba8; display: none; }
  #sf-hint.show { display: block; }
  #log-toggle {
    font-size: 11px; color: #585b70; cursor: pointer;
    background: none; border: none; padding: 0; text-align: left;
  }
  #log-toggle:hover { color: #a6adc8; }
  #log {
    max-height: 140px; overflow-y: auto; background: #181825;
    border-radius: 6px; padding: 8px; display: none;
    font-size: 11px; color: #a6adc8; line-height: 1.5;
    font-family: ui-monospace, 'Cascadia Code', monospace;
  }
  #log.open { display: block; }
  .log-entry { padding: 2px 0; border-bottom: 1px solid #2a2a3e; }
  .log-entry:last-child { border-bottom: none; }
  #confirm-box, #success-box {
    padding: 14px 16px; background: #181825; border-top: 1px solid #313244;
    flex-direction: column; gap: 10px; display: none;
  }
  #confirm-box.open, #success-box.open { display: flex; }
  #confirm-msg { font-size: 13px; color: #cdd6f4; line-height: 1.45; }
  #success-msg { font-size: 13px; color: #a6e3a1; line-height: 1.45; }
  .confirm-row { display: flex; gap: 8px; }
  #btn-yes   { background: #40a02b; color: #fff; flex: 1; }
  #btn-no    { background: #313244; color: #cdd6f4; flex: 1; }
  #btn-setup { background: #89b4fa; color: #1e1e2e; width: 100%; margin-top: 2px; }
`;

class UxtRecorderPanel extends HTMLElement {
  constructor() {
    super();
    this._shadow = this.attachShadow({ mode: 'closed' });
    this._logOpen = false;
    this._keyHandler = null;
  }

  connectedCallback() {
    this._shadow.innerHTML = `
      <style>${_PANEL_CSS}</style>
      <div id="panel">
        <div id="header"><div id="dot"></div>UX Tracker — Recording</div>
        <div id="body">
          <div id="task-desc">Walk through the ideal path for this study.</div>
          <div class="meta" id="task-tracker" style="display:none"></div>
          <div class="meta" id="step-counter">0 steps recorded</div>
          <div class="meta" id="screen-counter">0 screens captured</div>
          <div class="meta" id="survey-counter">0 survey points</div>
          <div class="btn-row">
            <button id="btn-capture" title="Alt+Shift+C">Capture Screen</button>
            <button id="btn-mark" title="Alt+Shift+M">Mark Step</button>
          </div>
          <button id="btn-endtask" title="Alt+Shift+T" style="display:none">✓ End Task</button>
          <div id="task-form">
            <input type="text" id="tf-prompt" maxlength="300"
                   placeholder="Next task prompt (e.g. Change your notification settings)">
            <textarea id="tf-instructions" maxlength="1000"
                      placeholder="Instructions for the participant (optional — context, test credentials, hints…)"></textarea>
            <div id="tf-hint">Enter a task prompt.</div>
            <div class="btn-row">
              <button id="tf-start">▶ Start Task</button>
              <button id="tf-cancel">Not Now</button>
            </div>
          </div>
          <button id="btn-survey" title="Alt+Shift+S">📋 Mark Survey Point</button>
          <div id="survey-form">
            <label><input type="checkbox" id="sf-rating" checked> Star rating (1–5)</label>
            <input type="text" id="sf-question" maxlength="200"
                   placeholder="Rating prompt (e.g. How easy was that?)">
            <label><input type="checkbox" id="sf-comment"> Comment box</label>
            <input type="text" id="sf-comment-prompt" maxlength="200"
                   placeholder="Comment prompt (optional)" style="display:none">
            <div class="sf-row">
              <label><input type="checkbox" id="sf-required"> Required</label>
              <select id="sf-presentation">
                <option value="panel">panel card</option>
                <option value="overlay">blocking overlay</option>
              </select>
            </div>
            <div id="sf-hint">Enable a rating or a comment box.</div>
            <div class="btn-row">
              <button id="sf-save">Save Point</button>
              <button id="sf-cancel">Cancel</button>
            </div>
          </div>
          <button id="btn-finish">Finish Recording</button>
          <button id="log-toggle">▶ Show step log</button>
          <div id="log"></div>
        </div>
        <div id="confirm-box">
          <div id="confirm-msg"></div>
          <div class="confirm-row">
            <button id="btn-yes">Save &amp; Finish</button>
            <button id="btn-no">Cancel</button>
          </div>
        </div>
        <div id="success-box">
          <div id="success-msg"></div>
          <button id="btn-setup">Go to Setup →</button>
        </div>
      </div>
    `;

    this._q('btn-capture').addEventListener('click', () => captureCurrentScreen());
    this._q('btn-mark').addEventListener('click', () => this._markStep());
    this._q('btn-endtask').addEventListener('click', () => this._onTaskButton());
    this._q('tf-start').addEventListener('click', () => this._startNewTask());
    this._q('tf-cancel').addEventListener('click', () => this._closeTaskForm());
    this._q('tf-prompt').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this._startNewTask(); }
    });
    this._q('btn-survey').addEventListener('click', () => this._toggleSurveyForm());
    this._q('btn-finish').addEventListener('click', () => this._showConfirm());
    this._q('btn-yes').addEventListener('click', () => this._saveAndFinish());
    this._q('btn-no').addEventListener('click', () => this._cancelConfirm());
    this._q('log-toggle').addEventListener('click', () => this._toggleLog());
    this._q('btn-setup').addEventListener('click', () => this._openSetup());

    this._q('sf-save').addEventListener('click', () => this._saveSurveyPoint());
    this._q('sf-cancel').addEventListener('click', () => this._closeSurveyForm());
    this._q('sf-rating').addEventListener('change', (e) => {
      this._q('sf-question').style.display = e.target.checked ? '' : 'none';
      this._q('sf-hint').classList.remove('show');
    });
    this._q('sf-comment').addEventListener('change', (e) => {
      this._q('sf-comment-prompt').style.display = e.target.checked ? '' : 'none';
      this._q('sf-hint').classList.remove('show');
    });
    this._q('sf-question').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this._saveSurveyPoint(); }
    });

    this._keyHandler = (e) => {
      if (e.altKey && e.shiftKey && e.key === 'C') { e.preventDefault(); captureCurrentScreen(); }
      if (e.altKey && e.shiftKey && e.key === 'M') { e.preventDefault(); this._markStep(); }
      if (e.altKey && e.shiftKey && e.key === 'S') { e.preventDefault(); this._toggleSurveyForm(); }
      if (e.altKey && e.shiftKey && e.key === 'T') { e.preventDefault(); this._onTaskButton(); }
    };
    document.addEventListener('keydown', this._keyHandler);
  }

  disconnectedCallback() {
    if (this._keyHandler) document.removeEventListener('keydown', this._keyHandler);
  }

  _q(id) {
    return this._shadow.getElementById(id);
  }

  setTaskDescription(text) {
    if (text) this._q('task-desc').textContent = text;
  }

  updateStepCount(n) {
    this._q('step-counter').textContent = `${n} step${n !== 1 ? 's' : ''} recorded`;
  }

  updateScreenCount(n) {
    this._q('screen-counter').textContent = `${n} screen${n !== 1 ? 's' : ''} captured`;
  }

  updateSurveyCount(n) {
    this._q('survey-counter').textContent = `${n} survey point${n !== 1 ? 's' : ''}`;
  }

  // Render the task list with progress markers (✓ done, → current) and keep
  // the tracker line + task button in sync. The button is dual-mode: "End
  // Task N" while a task is in progress, "+ New Task" when between tasks.
  renderTaskList() {
    const total = _state.taskPrompts.length;
    const done  = _state.taskBoundaries.length;

    if (total > 0) {
      const lines = _state.taskPrompts.map((p, i) => {
        const marker = i < done ? '✓' : (i === done ? '→' : `${i + 1}.`);
        return `${marker} ${p}`;
      });
      this._q('task-desc').textContent = lines.join('\n');
    }

    const tracker = this._q('task-tracker');
    const btn     = this._q('btn-endtask');
    tracker.style.display = '';
    btn.style.display = '';
    if (done >= total) {
      tracker.textContent = total === 0
        ? 'No tasks yet — create one to begin'
        : `All ${total} task${total !== 1 ? 's' : ''} ended`;
      btn.textContent = '+ New Task';
      this._taskBtnMode = 'new';
    } else {
      tracker.textContent = `Recording task ${done + 1} of ${total}`;
      btn.textContent = `✓ End Task ${done + 1}`;
      this._taskBtnMode = 'end';
    }
  }

  _onTaskButton() {
    if (!_state.isRecording) return;
    if (this._taskBtnMode === 'new') {
      this._toggleTaskForm();
    } else {
      this._endTask();
    }
  }

  _toggleTaskForm() {
    const form = this._q('task-form');
    const open = form.classList.toggle('open');
    if (open) this._q('tf-prompt').focus();
    else this._closeTaskForm();
  }

  _closeTaskForm() {
    this._q('tf-prompt').value = '';
    this._q('tf-instructions').value = '';
    this._q('tf-hint').classList.remove('show');
    this._q('task-form').classList.remove('open');
  }

  // Create a task on the fly: it becomes the current task immediately and is
  // appended to the study's tasks when the recording is saved.
  _startNewTask() {
    if (!_state.isRecording) return;
    const prompt = this._q('tf-prompt').value.trim();
    if (!prompt) {
      this._q('tf-hint').classList.add('show');
      return;
    }
    const instructions = this._q('tf-instructions').value.trim();
    _state.taskPrompts.push(prompt);
    _state.newTasks.push({ prompt, instructions: instructions || null });
    _saveNewTasks(_state.newTasks);
    this._closeTaskForm();
    this.renderTaskList();

    const log = this._q('log');
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.textContent = `▶  [task ${_state.taskPrompts.length} started]  ${prompt.slice(0, 40)}`;
    log.appendChild(entry);
    log.scrollTop = log.scrollHeight;
  }

  // Mark the current task as finished at the current screen. On save, each
  // boundary becomes the task's completion goal (screen reached, or last
  // click for same-screen tasks). When the task list is exhausted, prompt
  // for the next task right away.
  _endTask() {
    if (!_state.isRecording) return;
    if (_state.taskBoundaries.length >= _state.taskPrompts.length) return;
    const boundary = {
      taskIndex: _state.taskBoundaries.length,
      screenId:  computeScreenId(_config.screens),
      stepIndex: _state.idealPath.length,
      endedAt:   new Date().toISOString(),
    };
    _state.taskBoundaries.push(boundary);
    _saveTaskBoundaries(_state.taskBoundaries);
    this.renderTaskList();

    const log = this._q('log');
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.textContent = `✓  ${boundary.screenId}  [task ${boundary.taskIndex + 1} ended]`;
    log.appendChild(entry);
    log.scrollTop = log.scrollHeight;

    if (_state.taskBoundaries.length >= _state.taskPrompts.length) {
      this._q('task-form').classList.add('open');
      this._q('tf-prompt').focus();
    }
  }

  // Toggle the inline survey-details form. The point is only recorded when
  // the researcher hits "Save Point" (or Enter in the question field).
  _toggleSurveyForm() {
    if (!_state.isRecording) return;
    const form = this._q('survey-form');
    const open = form.classList.toggle('open');
    if (open) this._q('sf-question').focus();
  }

  _closeSurveyForm() {
    this._q('sf-rating').checked = true;
    this._q('sf-question').value = '';
    this._q('sf-question').style.display = '';
    this._q('sf-comment').checked = false;
    this._q('sf-comment-prompt').value = '';
    this._q('sf-comment-prompt').style.display = 'none';
    this._q('sf-required').checked = false;
    this._q('sf-presentation').value = 'panel';
    this._q('sf-hint').classList.remove('show');
    this._q('survey-form').classList.remove('open');
  }

  // Record the current screen as a mid-study survey point, carrying the
  // details entered in the form. Saved with the path on finish as a
  // screen-triggered survey (still refinable on the review page).
  _saveSurveyPoint() {
    if (!_state.isRecording) return;
    const ratingEnabled  = this._q('sf-rating').checked;
    const commentEnabled = this._q('sf-comment').checked;
    if (!ratingEnabled && !commentEnabled) {
      this._q('sf-hint').classList.add('show');
      return;
    }
    const point = {
      screenId:       computeScreenId(_config.screens),
      stepIndex:      _state.currentStepIndex,
      recordedAt:     new Date().toISOString(),
      ratingEnabled,
      ratingPrompt:   this._q('sf-question').value.trim(),
      commentEnabled,
      commentPrompt:  this._q('sf-comment-prompt').value.trim(),
      required:       this._q('sf-required').checked,
      presentation:   this._q('sf-presentation').value === 'overlay' ? 'overlay' : 'panel',
    };
    _state.surveyPoints.push(point);
    _saveSurveyPoints(_state.surveyPoints);
    this.updateSurveyCount(_state.surveyPoints.length);

    const log = this._q('log');
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    const label = point.ratingPrompt ? `"${point.ratingPrompt.slice(0, 40)}"` : '[survey point]';
    entry.textContent = `📋  ${point.screenId}  ${label}`;
    log.appendChild(entry);
    log.scrollTop = log.scrollHeight;

    this._closeSurveyForm();
  }

  addStepToLog(step) {
    const log = this._q('log');
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    const label = step.elementSelector ?? '[waypoint]';
    entry.textContent = `#${step.stepIndex + 1}  ${step.screenId}  ${label}`;
    log.appendChild(entry);
    log.scrollTop = log.scrollHeight;
  }

  // Record the current screen position as an explicit waypoint step
  _markStep() {
    if (!_state.isRecording) return;
    const now = Date.now();
    const step = {
      stepIndex: _state.currentStepIndex,
      screenId: computeScreenId(_config.screens),
      elementSelector: null,
      elementText: null,
      elementTag: null,
      viewportX: null,
      viewportY: null,
      expectedDuration: now - _state.lastStepTime,
      recordedAt: new Date().toISOString(),
    };
    _state.idealPath.push(step);
    _state.currentStepIndex += 1;
    _state.lastStepTime = now;
    _savePath(_state.idealPath);
    _captureForStep(step);
    this.updateStepCount(_state.idealPath.length);
    this.addStepToLog(step);
  }

  _toggleLog() {
    this._logOpen = !this._logOpen;
    this._q('log').classList.toggle('open', this._logOpen);
    this._q('log-toggle').textContent = this._logOpen ? '▼ Hide step log' : '▶ Show step log';
  }

  _showConfirm() {
    const steps   = _state.idealPath.length;
    const screens = _state.capturedScreens.size;
    const points  = _state.surveyPoints.length;
    const ended   = _state.taskBoundaries.length;
    const total   = _state.taskPrompts.length;
    const created = _state.newTasks.length;
    this._q('confirm-msg').textContent =
      `Save ideal path with ${steps} step${steps !== 1 ? 's' : ''} across ${screens} screen${screens !== 1 ? 's' : ''}` +
      (points ? `, ${points} survey point${points !== 1 ? 's' : ''}` : '') +
      (created ? `, ${created} new task${created !== 1 ? 's' : ''}` : '') +
      (ended ? `, ${ended} of ${total} task${total !== 1 ? 's' : ''} ended (their goals will be set from the recording)` : '') +
      '?';
    this._q('body').style.display = 'none';
    this._q('confirm-box').classList.add('open');
  }

  _cancelConfirm() {
    this._q('confirm-box').classList.remove('open');
    this._q('body').style.display = '';
  }

  async _saveAndFinish() {
    stopClickCapture();
    _state.isRecording = false;
    _clearRecordingSession();

    // Capture the final screen the researcher ended on and attach it to the
    // last step as a review-only "end" card. Deliberately NOT a new ideal_path
    // step: participant completion is measured by ideal_path length, so an extra
    // non-clickable step would make sessions impossible to finish.
    try {
      const blob = await _renderViewportBlob();
      const last = _state.idealPath[_state.idealPath.length - 1];
      if (blob && last) {
        const screenId = computeScreenId(_config.screens);
        last.endScreenshotUrl = await uploadScreenshot(_state.studyId, `end-${screenId}`, blob);
        last.endScreenId = screenId;
      }
    } catch (err) {
      console.error('[UXTracker Recorder] End screen capture failed:', err);
    }

    // Wait for any in-flight per-step screenshots before persisting the path.
    await Promise.allSettled(_state.pendingShots);

    // Stamp each recorded step with the task it belongs to (exact — from the
    // End Task boundaries) so the review page can group steps under tasks.
    if (_state.taskBoundaries.length > 0) {
      _state.idealPath.forEach((step, i) => {
        let ti = _state.taskBoundaries.findIndex((b) => i < b.stepIndex);
        if (ti === -1) {
          ti = Math.min(_state.taskBoundaries.length, Math.max(0, _state.taskPrompts.length - 1));
        }
        step.taskIndex = ti;
      });
    }

    // Task boundaries become completion goals: the screen the task ended on,
    // or — when the task ended on the screen it started on — the last click
    // recorded before the boundary.
    let taskGoals = null;
    if (_state.taskBoundaries.length > 0) {
      taskGoals = _state.taskBoundaries.map((b, i) => {
        const prevScreen = i > 0
          ? _state.taskBoundaries[i - 1].screenId
          : (_state.idealPath[0]?.screenId ?? null);
        let goal = null;
        if (b.screenId && b.screenId !== prevScreen) {
          goal = { type: 'screen', screenId: b.screenId };
        } else {
          const lastStep = _state.idealPath[b.stepIndex - 1];
          if (lastStep && (lastStep.elementSelector || lastStep.elementText)) {
            goal = {
              type: 'click',
              selector:    lastStep.elementSelector || null,
              elementText: lastStep.elementText || null,
            };
          } else if (b.screenId) {
            goal = { type: 'screen', screenId: b.screenId };
          }
        }
        return goal ? { taskIndex: b.taskIndex, goal } : null;
      }).filter(Boolean);
    }

    const newTasks = _state.newTasks.length > 0 ? _state.newTasks : null;

    try {
      await updateStudyIdealPath(
        _state.studyId, _state.idealPath, 'active',
        _state.surveyPoints, taskGoals, newTasks,
      );
    } catch (err) {
      console.error('[UXTracker Recorder] Failed to save ideal path:', err);
    }

    this._q('confirm-box').classList.remove('open');

    const steps = _state.idealPath.length;
    const screens = _state.capturedScreens.size;
    this._q('success-msg').textContent =
      `Saved ${steps} step${steps !== 1 ? 's' : ''} across ` +
      `${screens} screen${screens !== 1 ? 's' : ''}. Study is now active.`;
    this._q('success-box').classList.add('open');
  }

  _openSetup() {
    window.open(
      `${_frameworkBaseUrl}/setup/index.html?study=${encodeURIComponent(_state.studyId)}`,
      '_blank',
    );
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────

export default async function initRecorder(config, study) {
  _config = config;
  _state.studyId = config.studyId;
  _state.sessionStartTime = Date.now();
  _state.lastStepTime = Date.now();
  _state.isRecording = true;

  // Restore any steps recorded on earlier pages in this recording session
  const savedPath = _loadSavedPath();
  if (savedPath.length > 0) {
    _state.idealPath = savedPath;
    _state.currentStepIndex = savedPath.length;
  }
  _state.surveyPoints   = _loadSavedSurveyPoints();
  _state.taskBoundaries = _loadSavedTaskBoundaries();
  _state.newTasks       = _loadSavedNewTasks();

  // Derive the framework base URL from whichever script attribute is present
  const scriptEl = document.querySelector('script[data-study]')
                || document.querySelector('script[data-ingest-url]');
  const scriptSrc = scriptEl?.src ?? '';
  const slashIdx = scriptSrc.lastIndexOf('/v1/');
  _frameworkBaseUrl = slashIdx !== -1 ? scriptSrc.slice(0, slashIdx) : scriptSrc.slice(0, scriptSrc.lastIndexOf('/'));

  if (!customElements.get('uxt-recorder-panel')) {
    customElements.define('uxt-recorder-panel', UxtRecorderPanel);
  }

  const panelEl = document.createElement('uxt-recorder-panel');
  document.body.appendChild(panelEl);
  _panel = panelEl;

  // Task list = the study's tasks plus any created during this recording
  // (restored across page navigations). The tracker/button render even with
  // zero tasks so a study can be authored entirely from the recorder.
  _state.taskPrompts = (Array.isArray(study.tasks) ? [...study.tasks] : [])
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((t) => (typeof t === 'string' ? t : (t.prompt || '')).trim())
    .filter((p) => p.length > 0)
    .concat(_state.newTasks.map((t) => t.prompt));
  if (_state.taskPrompts.length === 0) {
    const fallback = study.description || study.name || null;
    if (fallback) _panel.setTaskDescription(fallback);
  }
  _panel.renderTaskList();

  // Sync counters if restoring a prior session
  if (_state.idealPath.length > 0) {
    _panel.updateStepCount(_state.idealPath.length);
  }
  if (_state.surveyPoints.length > 0) {
    _panel.updateSurveyCount(_state.surveyPoints.length);
  }

  // Intercept SPA navigation
  _patchHistory();
  window.addEventListener('popstate', _onNavigation);
  window.addEventListener('hashchange', _onNavigation);
  window.addEventListener('uxt:navigation', _onNavigation);

  // Capture every click as a path step while recording is active
  startClickCapture((clickData) => {
    if (!_state.isRecording) return;

    const now = Date.now();
    const elapsed = now - _state.lastStepTime;
    _state.lastStepTime = now;

    const step = {
      stepIndex: _state.currentStepIndex,
      screenId: computeScreenId(_config.screens),
      elementSelector: clickData.elementSelector,
      elementText: clickData.elementText,
      elementTag: clickData.elementTagName,
      viewportX: clickData.viewportX,
      viewportY: clickData.viewportY,
      expectedDuration: elapsed,
      recordedAt: new Date().toISOString(),
    };

    _state.idealPath.push(step);
    _state.currentStepIndex += 1;
    _savePath(_state.idealPath);

    _panel.updateStepCount(_state.idealPath.length);
    _panel.addStepToLog(step);

    _captureForStep(step);

    const el = document.elementFromPoint(clickData.viewportX, clickData.viewportY);
    if (el) highlightElement(el);
  });

  // Capture the starting screen immediately
  await scrollToTopAndWait(100);
  await captureCurrentScreen();
}
