import html2canvas from 'html2canvas';
import { computePageFingerprint } from './utils/fingerprint.js';
import { computeScreenId } from './utils/screen-id.js';
import {
  getClient,
  upsertScreen,
  uploadScreenshot,
  STUDIES,
} from './utils/supabase-client.js';
import { startClickCapture, stopClickCapture } from './tracker.js';

// ─── Module state ─────────────────────────────────────────────────────────────

const _state = {
  studyId: '',
  idealPath: [],
  capturedScreens: new Map(),
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

async function captureCurrentScreen() {
  const screenId = computeScreenId(_config.screens);

  // Run html2canvas and DOM fingerprint in parallel
  const [canvas, hash] = await Promise.all([
    (async () => {
      try {
        return await html2canvas(document.body, {
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
    })(),
    computePageFingerprint(),
  ]);

  let screenshotUrl = null;

  if (canvas) {
    const mimeType = _config.screenshotFormat === 'jpeg' ? 'image/jpeg' : 'image/png';
    const blob = await new Promise(resolve => canvas.toBlob(resolve, mimeType));
    if (blob) {
      try {
        screenshotUrl = await uploadScreenshot(_state.studyId, screenId, blob);
      } catch (err) {
        console.error('[UXTracker Recorder] Screenshot upload failed:', err);
      }
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
  #task-desc { font-size: 13px; color: #cdd6f4; line-height: 1.45; min-height: 18px; }
  .meta { font-size: 11px; color: #6c7086; }
  .btn-row { display: flex; gap: 8px; }
  button {
    padding: 7px 10px; border: none; border-radius: 6px;
    font-size: 12px; font-weight: 500; cursor: pointer; transition: opacity .15s;
  }
  button:hover { opacity: .82; }
  #btn-capture { background: #313244; color: #cdd6f4; flex: 1; }
  #btn-mark    { background: #40a02b; color: #fff; flex: 1; }
  #btn-finish  { background: #f38ba8; color: #1e1e2e; width: 100%; }
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
          <div class="meta" id="step-counter">0 steps recorded</div>
          <div class="meta" id="screen-counter">0 screens captured</div>
          <div class="btn-row">
            <button id="btn-capture" title="Alt+Shift+C">Capture Screen</button>
            <button id="btn-mark" title="Alt+Shift+M">Mark Step</button>
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
    this._q('btn-finish').addEventListener('click', () => this._showConfirm());
    this._q('btn-yes').addEventListener('click', () => this._saveAndFinish());
    this._q('btn-no').addEventListener('click', () => this._cancelConfirm());
    this._q('log-toggle').addEventListener('click', () => this._toggleLog());
    this._q('btn-setup').addEventListener('click', () => this._openSetup());

    this._keyHandler = (e) => {
      if (e.altKey && e.shiftKey && e.key === 'C') { e.preventDefault(); captureCurrentScreen(); }
      if (e.altKey && e.shiftKey && e.key === 'M') { e.preventDefault(); this._markStep(); }
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
    this.updateStepCount(_state.idealPath.length);
    this.addStepToLog(step);
  }

  _toggleLog() {
    this._logOpen = !this._logOpen;
    this._q('log').classList.toggle('open', this._logOpen);
    this._q('log-toggle').textContent = this._logOpen ? '▼ Hide step log' : '▶ Show step log';
  }

  _showConfirm() {
    const steps = _state.idealPath.length;
    const screens = _state.capturedScreens.size;
    this._q('confirm-msg').textContent =
      `Save ideal path with ${steps} step${steps !== 1 ? 's' : ''} across ${screens} screen${screens !== 1 ? 's' : ''}?`;
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

    try {
      const { error } = await getClient()
        .from(STUDIES)
        .update({
          ideal_path: _state.idealPath,
          status: 'active',
          updated_at: new Date().toISOString(),
        })
        .eq('id', _state.studyId);
      if (error) throw error;
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

  const scriptSrc = document.querySelector('script[data-study]')?.src ?? '';
  const slashIdx = scriptSrc.lastIndexOf('/v1/');
  _frameworkBaseUrl = slashIdx !== -1 ? scriptSrc.slice(0, slashIdx) : scriptSrc.slice(0, scriptSrc.lastIndexOf('/'));

  if (!customElements.get('uxt-recorder-panel')) {
    customElements.define('uxt-recorder-panel', UxtRecorderPanel);
  }

  const panelEl = document.createElement('uxt-recorder-panel');
  document.body.appendChild(panelEl);
  _panel = panelEl;

  // Show study name / description in the panel header area
  const taskDesc = study.description || study.name || null;
  if (taskDesc) _panel.setTaskDescription(taskDesc);

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

    _panel.updateStepCount(_state.idealPath.length);
    _panel.addStepToLog(step);

    const el = document.elementFromPoint(clickData.viewportX, clickData.viewportY);
    if (el) highlightElement(el);
  });

  // Capture the starting screen immediately
  await scrollToTopAndWait(100);
  await captureCurrentScreen();
}
