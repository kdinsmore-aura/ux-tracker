/* UX Tracker — Researcher Dashboard
   Depends on window.supabase (Supabase JS v2), window.Chart (Chart.js v4),
   window.h337 (heatmap.js v2). Alpine.js loaded after this file. */

// Inlined from src/utils/coordinates.js
function projectToScreenshot(event, screenshotW, screenshotH, displayW, displayH) {
  const scaleX = screenshotW > 0 ? displayW / screenshotW : 1;
  const scaleY = screenshotH > 0 ? displayH / screenshotH : 1;
  return {
    x: Math.round((event.viewport_x || 0) * scaleX),
    y: Math.round((event.viewport_y || 0) * scaleY),
  };
}

function escSvg(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function dashboardApp() {
  return {

    // ── Nav config ─────────────────────────────────────────────────────────
    navSections: [
      {
        id: 'overview',
        label: 'Overview',
        icon: '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1.5" y="1.5" width="6" height="6" rx="1"/><rect x="10.5" y="1.5" width="6" height="6" rx="1"/><rect x="1.5" y="10.5" width="6" height="6" rx="1"/><rect x="10.5" y="10.5" width="6" height="6" rx="1"/></svg>',
      },
      {
        id: 'sessions',
        label: 'Sessions',
        icon: '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 4.5h14M2 9h14M2 13.5h8"/></svg>',
      },
      {
        id: 'heatmaps',
        label: 'Heatmaps',
        icon: '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="9" cy="9" r="2.5"/><circle cx="9" cy="9" r="5.5" opacity=".4"/><circle cx="9" cy="9" r="8" opacity=".15"/></svg>',
      },
      {
        id: 'paths',
        label: 'Path Analysis',
        icon: '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="2,14 6,6 10,10 16,4"/></svg>',
      },
      {
        id: 'participants',
        label: 'Participants',
        icon: '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="9" cy="6" r="3"/><path d="M2.5 16.5c0-3.6 2.9-6.5 6.5-6.5s6.5 2.9 6.5 6.5"/></svg>',
      },
    ],

    // ── Gate ───────────────────────────────────────────────────────────────
    appReady: false,
    gateChecking: true,   // true while init() determines if auto-load is possible
    hasSavedCreds: false,
    gateCreds: { url: '', key: '' },
    gateStudyId: '',
    gateError: '',
    gateLoading: false,

    // ── App ────────────────────────────────────────────────────────────────
    activeSection: 'overview',
    sidebarCollapsed: false,
    study: null,
    studyId: null,
    _db: null,

    // ── Overview ───────────────────────────────────────────────────────────
    overview: {
      loading: false,
      error: '',
      loaded: false,
      stats: {
        totalInvited: 0,
        completed: 0,
        notCompleted: 0,
        avgDuration: '—',
        completionRate: 0,
        avgSteps: '—',
      },
      taskRates: [],
      durationSeries: [],
    },

    // ── Sessions ───────────────────────────────────────────────────────────
    sessions: { loading: false, error: '', loaded: false, list: [] },
    sessionsFilter: { status: 'all', screenChanges: 'all', duration: 'all' },

    // ── Screens ────────────────────────────────────────────────────────────
    screens: { loading: false, error: '', loaded: false, list: [] },

    // ── Heatmap ────────────────────────────────────────────────────────────
    heatmap: {
      selectedScreenId: null,
      selectedScreen: null,
      clickFilter: 'all',
      sessionFilter: 'all',
      opacity: 0.6,
      radius: 25,
      rawEvents: [],
      eventsLoading: false,
    },
    _heatmapInstance: null,
    _completedSessionIds: null,

    // ── Paths ──────────────────────────────────────────────────────────────
    paths: { loading: false, error: '', loaded: false, steps: [] },

    // ── Participants ───────────────────────────────────────────────────────
    participants: { loading: false, error: '', loaded: false, list: [] },
    abandonTarget: null,
    copiedParticipantId: null,

    // ── Links modal ────────────────────────────────────────────────────────
    linksModal: {
      open: false,
      count: 5,
      baseUrl: '',
      labels: '',
      generating: false,
      error: '',
      generated: [],
      copiedAll: false,
    },
    copiedLinkId: null,

    // ── Drawer ─────────────────────────────────────────────────────────────
    drawerOpen: false,
    drawerLoading: false,
    drawerSession: null,
    drawerEvents: [],

    // ── Chart instances ────────────────────────────────────────────────────
    _taskChart: null,
    _durationChart: null,


    // ═══════════════════════════════════════════════════════════════════════
    // INIT
    // ═══════════════════════════════════════════════════════════════════════

    async init() {
      this.gateChecking = true;

      const params = new URLSearchParams(window.location.search);
      const urlStudyId = params.get('study');
      if (urlStudyId) this.gateStudyId = urlStudyId;

      // Credentials passed from setup tool via URL hash (#c=base64)
      // Read first so they override any stale localStorage values.
      try {
        const hash = window.location.hash;
        if (hash.startsWith('#c=')) {
          const decoded = JSON.parse(atob(hash.slice(3)));
          if (decoded.u && decoded.k) {
            this.gateCreds.url = decoded.u;
            this.gateCreds.key = decoded.k;
            this.hasSavedCreds = true;
            localStorage.setItem('uxt_researcher_config', JSON.stringify({
              url: decoded.u,
              key: decoded.k,
            }));
            // Remove hash from URL so credentials aren't visible in browser history
            history.replaceState(null, '', window.location.pathname + window.location.search);
          }
        }
      } catch {}

      // Fall back to saved credentials if hash wasn't present
      if (!this.hasSavedCreds) {
        try {
          const stored = localStorage.getItem('uxt_researcher_config');
          if (stored) {
            const cfg = JSON.parse(stored);
            if (cfg.url && cfg.key) {
              this.gateCreds.url = cfg.url;
              this.gateCreds.key = cfg.key;
              this.hasSavedCreds = true;
            }
          }
        } catch {}
      }

      if (this.hasSavedCreds && this.gateStudyId) {
        await this.gateLoad();
      }

      this.gateChecking = false;
    },

    clearSavedCreds() {
      this.hasSavedCreds = false;
      this.gateCreds = { url: '', key: '' };
    },

    async gateLoad() {
      this.gateError = '';
      const url = this.gateCreds.url.trim();
      const key = this.gateCreds.key.trim();
      const sid = this.gateStudyId.trim();

      if (!url || !key) {
        this.gateError = 'Please enter your Supabase project URL and anon key.';
        return;
      }
      if (!sid) {
        this.gateError = 'Please enter a study ID.';
        return;
      }

      this.gateLoading = true;
      try {
        this._db = window.supabase.createClient(url, key);

        const { data, error } = await this._db
          .from('studies')
          .select('*')
          .eq('id', sid)
          .maybeSingle();

        if (error) throw error;
        if (!data) {
          this.gateError = 'Study not found. Check the study ID and credentials.';
          this.gateLoading = false;
          return;
        }

        this.study = data;
        this.studyId = data.id;

        const urlObj = new URL(window.location.href);
        urlObj.searchParams.set('study', this.studyId);
        window.history.replaceState({}, '', urlObj.toString());

        this.appReady = true;

        // Load base data sequentially — participants needs sessions
        await this.loadSessions();
        await Promise.all([this.loadScreens(), this.loadParticipants()]);
        await this.loadOverview();

      } catch (e) {
        this.gateError = 'Failed to connect: ' + (e.message || String(e));
      } finally {
        this.gateLoading = false;
      }
    },


    // ═══════════════════════════════════════════════════════════════════════
    // NAVIGATION
    // ═══════════════════════════════════════════════════════════════════════

    goSection(id) {
      this.activeSection = id;
      if (id === 'overview' && !this.overview.loaded) this.loadOverview();
      if (id === 'heatmaps' && !this.screens.loaded) this.loadScreens();
      if (id === 'paths' && !this.paths.loaded) this.loadPaths();
      if (id === 'participants' && !this.participants.loaded) this.loadParticipants();
    },

    goSession(sessionId) {
      this.activeSection = 'sessions';
      this.$nextTick(() => {
        const s = this.sessions.list.find(x => x.id === sessionId);
        if (s) this.openSessionDrawer(s);
      });
    },


    // ═══════════════════════════════════════════════════════════════════════
    // SESSIONS
    // ═══════════════════════════════════════════════════════════════════════

    async loadSessions(force = false) {
      if (this.sessions.loaded && !force) return;
      this.sessions.loading = true;
      this.sessions.error = '';

      try {
        const [sessRes, partRes] = await Promise.all([
          this._db
            .from('sessions')
            .select('*')
            .eq('study_id', this.studyId)
            .order('started_at', { ascending: true }),
          this._db
            .from('participants')
            .select('id, label')
            .eq('study_id', this.studyId),
        ]);

        if (sessRes.error) throw sessRes.error;

        const labelMap = {};
        (partRes.data || []).forEach(p => { labelMap[p.id] = p.label; });

        const sessList = sessRes.data || [];
        const sessionIds = sessList.map(s => s.id);

        // Fetch mis-click counts in bulk
        let misClickCounts = {};
        if (sessionIds.length > 0) {
          const { data: mcData } = await this._db
            .from('events')
            .select('session_id')
            .in('session_id', sessionIds)
            .eq('is_mis_click', true)
            .eq('event_type', 'click');

          (mcData || []).forEach(row => {
            misClickCounts[row.session_id] = (misClickCounts[row.session_id] || 0) + 1;
          });
        }

        this.sessions.list = sessList.map(s => ({
          ...s,
          participant_label: labelMap[s.participant_id] || null,
          mis_click_count: misClickCounts[s.id] ?? 0,
        }));

        this._completedSessionIds = new Set(
          this.sessions.list.filter(s => s.status === 'completed').map(s => s.id)
        );

        this.sessions.loaded = true;
      } catch (e) {
        this.sessions.error = 'Failed to load sessions: ' + (e.message || String(e));
      } finally {
        this.sessions.loading = false;
      }
    },

    get filteredSessions() {
      return this.sessions.list.filter(s => {
        const { status, screenChanges, duration } = this.sessionsFilter;
        if (status !== 'all' && s.status !== status) return false;
        if (screenChanges === 'changed' && !s.has_screen_changes) return false;
        if (screenChanges === 'no_changes' && s.has_screen_changes) return false;
        if (duration !== 'all') {
          const ms = s.duration_ms || 0;
          if (duration === 'under2' && ms >= 120000) return false;
          if (duration === '2to5' && (ms < 120000 || ms >= 300000)) return false;
          if (duration === 'over5' && ms < 300000) return false;
        }
        return true;
      });
    },


    // ═══════════════════════════════════════════════════════════════════════
    // SCREENS
    // ═══════════════════════════════════════════════════════════════════════

    async loadScreens(force = false) {
      if (this.screens.loaded && !force) return;
      this.screens.loading = true;
      this.screens.error = '';
      try {
        const { data, error } = await this._db
          .from('screens')
          .select('*')
          .eq('study_id', this.studyId)
          .order('captured_at', { ascending: true });
        if (error) throw error;
        this.screens.list = data || [];
        this.screens.loaded = true;
      } catch (e) {
        this.screens.error = 'Failed to load screens: ' + (e.message || String(e));
      } finally {
        this.screens.loading = false;
      }
    },


    // ═══════════════════════════════════════════════════════════════════════
    // PARTICIPANTS
    // ═══════════════════════════════════════════════════════════════════════

    async loadParticipants(force = false) {
      if (this.participants.loaded && !force) return;
      this.participants.loading = true;
      this.participants.error = '';
      try {
        const { data, error } = await this._db
          .from('participants')
          .select('*')
          .eq('study_id', this.studyId)
          .order('created_at', { ascending: true });
        if (error) throw error;

        const sessMap = {};
        this.sessions.list.forEach(s => {
          if (s.participant_id) sessMap[s.participant_id] = s;
        });

        this.participants.list = (data || []).map(p => ({
          ...p,
          _session: sessMap[p.id] || null,
          _inviteUrl: `?study=${this.studyId}&participant=${p.id}`,
        }));
        this.participants.loaded = true;
      } catch (e) {
        this.participants.error = 'Failed to load participants: ' + (e.message || String(e));
      } finally {
        this.participants.loading = false;
      }
    },

    promptAbandon(p) {
      this.abandonTarget = p;
    },

    async confirmAbandon() {
      if (!this.abandonTarget) return;
      const p = this.abandonTarget;
      this.abandonTarget = null;
      try {
        await this._db.from('participants').update({ status: 'abandoned' }).eq('id', p.id);
        const idx = this.participants.list.findIndex(x => x.id === p.id);
        if (idx !== -1) this.participants.list[idx] = { ...this.participants.list[idx], status: 'abandoned' };
      } catch {}
    },

    copyUrl(id, url) {
      navigator.clipboard.writeText(url).then(() => {
        this.copiedParticipantId = id;
        setTimeout(() => { this.copiedParticipantId = null; }, 1500);
      });
    },


    // ═══════════════════════════════════════════════════════════════════════
    // OVERVIEW
    // ═══════════════════════════════════════════════════════════════════════

    async loadOverview(force = false) {
      if (this.overview.loaded && !force) return;
      this.overview.loading = true;
      this.overview.error = '';

      try {
        if (!this.sessions.loaded) await this.loadSessions();

        const all = this.sessions.list;
        const completed = all.filter(s => s.status === 'completed');
        const notCompleted = all.filter(s => s.status !== 'completed');

        const completedWithDuration = completed.filter(s => s.duration_ms > 0);
        const avgDurationMs = completedWithDuration.length
          ? completedWithDuration.reduce((a, s) => a + s.duration_ms, 0) / completedWithDuration.length
          : null;

        const avgSteps = completed.length
          ? (completed.reduce((a, s) => a + (s.completed_steps || 0), 0) / completed.length).toFixed(1)
          : '—';

        const totalInvited = all.length;

        this.overview.stats = {
          totalInvited,
          completed: completed.length,
          notCompleted: notCompleted.length,
          avgDuration: avgDurationMs != null ? this.fmtDuration(avgDurationMs) : '—',
          completionRate: totalInvited > 0 ? Math.round((completed.length / totalInvited) * 100) : 0,
          avgSteps,
        };

        // Duration series for line chart (completed sessions ordered by started_at)
        this.overview.durationSeries = completed
          .filter(s => s.duration_ms > 0)
          .map((s, i) => ({ x: i + 1, y: Math.round(s.duration_ms / 1000) }));

        // Task completion rates
        await this._loadTaskRates();

        this.overview.loaded = true;

        this.$nextTick(() => {
          this._renderTaskChart();
          this._renderDurationChart();
        });

      } catch (e) {
        this.overview.error = 'Failed to load overview: ' + (e.message || String(e));
      } finally {
        this.overview.loading = false;
      }
    },

    async _loadTaskRates() {
      const tasks = this.study?.tasks || [];
      const idealPath = this.study?.ideal_path || [];
      if (!tasks.length || !idealPath.length) { this.overview.taskRates = []; return; }

      const { data, error } = await this._db
        .from('events')
        .select('session_id, step_index')
        .eq('study_id', this.studyId)
        .eq('advances_step', true);

      if (error) return;

      const stepCompletions = {};
      (data || []).forEach(ev => {
        if (ev.step_index != null) {
          if (!stepCompletions[ev.step_index]) stepCompletions[ev.step_index] = new Set();
          stepCompletions[ev.step_index].add(ev.session_id);
        }
      });

      const M = idealPath.length;
      const N = tasks.length;
      const totalSessions = Math.max(this.sessions.list.length, 1);

      this.overview.taskRates = tasks.map((task, k) => {
        const firstStep = Math.floor(k * M / N);
        const lastStep = Math.floor((k + 1) * M / N) - 1;

        const completed = new Set();
        for (let si = firstStep; si <= lastStep; si++) {
          if (stepCompletions[si]) stepCompletions[si].forEach(id => completed.add(id));
        }

        return {
          label: String(task.prompt || `Task ${k + 1}`).slice(0, 30),
          pct: Math.round((completed.size / totalSessions) * 100),
        };
      });
    },

    _renderTaskChart() {
      const canvas = document.getElementById('taskChart');
      if (!canvas || !window.Chart) return;
      if (this._taskChart) { this._taskChart.destroy(); this._taskChart = null; }

      const rates = this.overview.taskRates;
      if (!rates.length) return;

      this._taskChart = new Chart(canvas, {
        type: 'bar',
        data: {
          labels: rates.map(r => r.label),
          datasets: [{
            data: rates.map(r => r.pct),
            backgroundColor: rates.map(r =>
              r.pct > 80 ? 'rgba(16,185,129,0.75)' :
              r.pct >= 50 ? 'rgba(245,158,11,0.75)' :
              'rgba(239,68,68,0.75)'
            ),
            borderRadius: 4,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            y: {
              beginAtZero: true, max: 100,
              ticks: { callback: v => v + '%', font: { size: 11 } },
              grid: { color: '#F3F4F6' },
            },
            x: {
              ticks: { font: { size: 11 }, maxRotation: 30 },
              grid: { display: false },
            },
          },
        },
      });
    },

    _renderDurationChart() {
      const canvas = document.getElementById('durationChart');
      if (!canvas || !window.Chart) return;
      if (this._durationChart) { this._durationChart.destroy(); this._durationChart = null; }

      const series = this.overview.durationSeries;
      if (!series.length) return;

      this._durationChart = new Chart(canvas, {
        type: 'line',
        data: {
          labels: series.map(p => p.x),
          datasets: [{
            label: 'Duration (s)',
            data: series.map(p => p.y),
            borderColor: '#5B6CF7',
            backgroundColor: 'rgba(91,108,247,0.08)',
            borderWidth: 2,
            pointRadius: 3,
            pointBackgroundColor: '#5B6CF7',
            fill: true,
            tension: 0.3,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            y: {
              beginAtZero: true,
              ticks: { callback: v => v + 's', font: { size: 11 } },
              grid: { color: '#F3F4F6' },
            },
            x: {
              title: { display: true, text: 'Session #', font: { size: 11 } },
              ticks: { font: { size: 11 } },
              grid: { display: false },
            },
          },
        },
      });
    },


    // ═══════════════════════════════════════════════════════════════════════
    // HEATMAP
    // ═══════════════════════════════════════════════════════════════════════

    async selectHeatmapScreen(screen) {
      this.heatmap.selectedScreenId = screen.screen_id;
      this.heatmap.selectedScreen = screen;
      this.heatmap.rawEvents = [];
      if (this._heatmapInstance) {
        try { this._heatmapInstance.setData({ max: 10, data: [] }); } catch {}
      }
      await this._loadHeatmapEvents(screen.screen_id);
    },

    async _loadHeatmapEvents(screenId) {
      this.heatmap.eventsLoading = true;
      try {
        const { data, error } = await this._db
          .from('events')
          .select('viewport_x, viewport_y, is_on_path, is_mis_click, session_id')
          .eq('study_id', this.studyId)
          .eq('screen_id', screenId)
          .eq('event_type', 'click');
        if (error) throw error;
        this.heatmap.rawEvents = data || [];
        this.$nextTick(() => this.renderHeatmap());
      } catch {}
      finally { this.heatmap.eventsLoading = false; }
    },

    setHeatmapFilter(key, val) {
      this.heatmap[key] = val;
      this.renderHeatmap();
    },

    applyHeatmapConfig() {
      if (this._heatmapInstance) {
        try {
          this._heatmapInstance.configure({
            maxOpacity: parseFloat(this.heatmap.opacity),
            radius: parseInt(this.heatmap.radius),
          });
        } catch {}
      }
      this.renderHeatmap();
    },

    onHeatmapImgLoad() {
      this.$nextTick(() => this.renderHeatmap());
    },

    renderHeatmap() {
      const wrap = document.getElementById('heatmapCanvasWrap');
      const img = document.getElementById('heatmapImg');
      if (!wrap || !img || !window.h337) return;

      const screen = this.heatmap.selectedScreen;
      const displayW = img.clientWidth || img.naturalWidth || 800;
      const displayH = img.clientHeight || img.naturalHeight || 600;
      const screenshotW = screen?.viewport_width || displayW;
      const screenshotH = screen?.viewport_height || displayH;

      // Recreate instance if container changed or not yet created
      let needsCreate = !this._heatmapInstance;
      if (!needsCreate) {
        try {
          if (this._heatmapInstance._renderer.canvas.parentElement !== wrap) needsCreate = true;
        } catch { needsCreate = true; }
      }

      if (needsCreate) {
        wrap.innerHTML = '';
        try {
          this._heatmapInstance = window.h337.create({
            container: wrap,
            maxOpacity: parseFloat(this.heatmap.opacity),
            radius: parseInt(this.heatmap.radius),
            blur: 0.85,
          });
        } catch { return; }
      }

      const completedIds = this._completedSessionIds || new Set();
      const filtered = this.heatmap.rawEvents.filter(ev => {
        if (this.heatmap.sessionFilter === 'completed' && !completedIds.has(ev.session_id)) return false;
        if (this.heatmap.clickFilter === 'on_path' && !ev.is_on_path) return false;
        if (this.heatmap.clickFilter === 'mis_click' && !ev.is_mis_click) return false;
        return true;
      });

      const points = filtered.map(ev => {
        const { x, y } = projectToScreenshot(ev, screenshotW, screenshotH, displayW, displayH);
        return { x, y, value: 1 };
      });

      try {
        this._heatmapInstance.setData({
          max: Math.max(5, Math.ceil(points.length / 10)),
          data: points,
        });
      } catch {}
    },


    // ═══════════════════════════════════════════════════════════════════════
    // PATH ANALYSIS
    // ═══════════════════════════════════════════════════════════════════════

    async loadPaths(force = false) {
      if (this.paths.loaded && !force) return;
      this.paths.loading = true;
      this.paths.error = '';

      try {
        if (!this.sessions.loaded) await this.loadSessions();

        const idealPath = this.study?.ideal_path || [];
        if (!idealPath.length) {
          this.paths.steps = [];
          this.paths.loaded = true;
          return;
        }

        const { data, error } = await this._db
          .from('events')
          .select('session_id, step_index, is_on_path, is_mis_click, advances_step, element_selector, ms_since_session_start')
          .eq('study_id', this.studyId)
          .eq('event_type', 'click')
          .not('step_index', 'is', null);

        if (error) throw error;
        const events = data || [];
        const totalSessions = Math.max(this.sessions.list.length, 1);

        this.paths.steps = idealPath.map(pathStep => {
          const si = pathStep.stepIndex;
          const stepEvs = events.filter(e => e.step_index === si);
          const sessionsAtStep = new Set(stepEvs.map(e => e.session_id));

          // First click per session at this step
          const firstBySession = {};
          stepEvs.forEach(ev => {
            if (!firstBySession[ev.session_id]) firstBySession[ev.session_id] = ev;
          });
          const firstClickCorrect = Object.values(firstBySession).filter(ev => ev.is_on_path).length;

          const eventuallySessions = new Set(stepEvs.filter(e => e.advances_step).map(e => e.session_id));

          const timings = stepEvs
            .filter(e => e.advances_step && e.ms_since_session_start > 0)
            .map(e => e.ms_since_session_start);
          const avgTimeMs = timings.length
            ? Math.round(timings.reduce((a, b) => a + b, 0) / timings.length)
            : 0;

          const clicksPerSession = {};
          stepEvs.forEach(ev => {
            clicksPerSession[ev.session_id] = (clicksPerSession[ev.session_id] || 0) + 1;
          });
          const clickCounts = Object.values(clicksPerSession);
          const avgClicks = clickCounts.length
            ? clickCounts.reduce((a, b) => a + b, 0) / clickCounts.length
            : 0;

          const misclickCounts = {};
          stepEvs.filter(e => e.is_mis_click && e.element_selector).forEach(e => {
            misclickCounts[e.element_selector] = (misclickCounts[e.element_selector] || 0) + 1;
          });
          const topMisclicks = Object.entries(misclickCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([sel]) => sel);

          return {
            stepIndex: si,
            elementSelector: pathStep.elementSelector,
            elementText: pathStep.elementText,
            firstClickPct: sessionsAtStep.size > 0
              ? Math.round((firstClickCorrect / sessionsAtStep.size) * 100)
              : 0,
            eventualPct: Math.round((eventuallySessions.size / totalSessions) * 100),
            avgTimeMs,
            avgClicks,
            topMisclicks,
            completionCount: eventuallySessions.size,
            totalSessions,
          };
        });

        this.paths.loaded = true;
        this.$nextTick(() => this._renderFlowDiagram());

      } catch (e) {
        this.paths.error = 'Failed to load path data: ' + (e.message || String(e));
      } finally {
        this.paths.loading = false;
      }
    },

    _renderFlowDiagram() {
      const wrap = document.getElementById('flowDiagramWrap');
      if (!wrap || !this.paths.steps.length) return;

      const steps = this.paths.steps;
      const svgW = Math.min((wrap.clientWidth || 640) - 8, 680);
      const rowH = 60;
      const svgH = steps.length * rowH + 24;
      const numCircleX = 18;
      const textX = 42;
      const barAreaX = svgW - 180;
      const barMaxW = 100;

      const lines = [`<svg class="flow-svg" viewBox="0 0 ${svgW} ${svgH}" width="${svgW}" height="${svgH}" xmlns="http://www.w3.org/2000/svg" style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">`];

      steps.forEach((step, i) => {
        const cy = i * rowH + 18;
        const pct = step.eventualPct;
        const fill = pct > 80 ? '#10B981' : pct >= 50 ? '#F59E0B' : '#EF4444';
        const dropPct = i < steps.length - 1
          ? Math.max(0, pct - steps[i + 1].eventualPct)
          : 0;

        // Connector down
        if (i < steps.length - 1) {
          lines.push(`<line x1="${numCircleX}" y1="${cy + 18}" x2="${numCircleX}" y2="${cy + rowH}" stroke="#E5E7EB" stroke-width="2"/>`);
        }

        // Circle
        lines.push(
          `<circle cx="${numCircleX}" cy="${cy}" r="14" fill="${fill}" opacity="0.15"/>`,
          `<text x="${numCircleX}" y="${cy + 4}" text-anchor="middle" font-size="11" font-weight="700" fill="${fill}">${step.stepIndex + 1}</text>`,
        );

        // Label + meta
        const label = escSvg((step.elementText || step.elementSelector || `Step ${step.stepIndex + 1}`).slice(0, 40));
        lines.push(
          `<text x="${textX}" y="${cy - 3}" font-size="12" font-weight="600" fill="#111827">${label}</text>`,
          `<text x="${textX}" y="${cy + 13}" font-size="10" fill="#9CA3AF">${step.completionCount}/${step.totalSessions} completed</text>`,
        );

        // Completion bar
        const barW = Math.round((pct / 100) * barMaxW);
        lines.push(
          `<rect x="${barAreaX}" y="${cy - 8}" width="${barMaxW}" height="14" rx="3" fill="#F3F4F6"/>`,
          `<rect x="${barAreaX}" y="${cy - 8}" width="${barW}" height="14" rx="3" fill="${fill}" opacity="0.8"/>`,
          `<text x="${barAreaX + barMaxW + 6}" y="${cy + 3}" font-size="11" fill="${fill}" font-weight="700">${pct}%</text>`,
        );

        // Dropout indicator
        if (dropPct > 0) {
          lines.push(
            `<text x="${barAreaX}" y="${cy + 24}" font-size="9" fill="#EF4444">↓ ${dropPct}% dropped here</text>`,
          );
        }
      });

      lines.push('</svg>');
      wrap.innerHTML = lines.join('\n');
    },


    // ═══════════════════════════════════════════════════════════════════════
    // SESSION DRAWER
    // ═══════════════════════════════════════════════════════════════════════

    async openSessionDrawer(session) {
      this.drawerSession = session;
      this.drawerOpen = true;
      this.drawerLoading = true;
      this.drawerEvents = [];

      try {
        const { data, error } = await this._db
          .from('events')
          .select('id, event_type, step_index, element_selector, element_text, viewport_x, viewport_y, is_on_path, is_mis_click, advances_step, ms_since_session_start, timestamp')
          .eq('session_id', session.id)
          .order('ms_since_session_start', { ascending: true });

        if (error) throw error;
        this.drawerEvents = data || [];
      } catch {}
      finally { this.drawerLoading = false; }
    },

    closeDrawer() {
      this.drawerOpen = false;
      setTimeout(() => {
        this.drawerSession = null;
        this.drawerEvents = [];
      }, 250);
    },

    get drawerStepBreakdown() {
      if (!this.drawerSession || !this.study?.ideal_path) return [];
      const idealPath = this.study.ideal_path;
      const events = this.drawerEvents;

      return idealPath.map(pathStep => {
        const si = pathStep.stepIndex;
        const stepEvs = events.filter(e => e.step_index === si && e.event_type === 'click');
        const advanced = stepEvs.find(e => e.advances_step);

        let timeMs = 0;
        if (advanced) {
          // Time from start of this step to advancement
          const prevAdvance = si > 0
            ? events.slice().reverse().find(e => e.step_index === si - 1 && e.advances_step)
            : events.find(e => e.event_type === 'session_start');
          if (prevAdvance) {
            timeMs = Math.max(0, advanced.ms_since_session_start - (prevAdvance.ms_since_session_start || 0));
          } else {
            timeMs = advanced.ms_since_session_start || 0;
          }
        }

        return {
          stepIndex: si,
          elementSelector: pathStep.elementSelector,
          elementText: pathStep.elementText,
          completed: !!advanced,
          attempts: stepEvs.length,
          timeMs,
        };
      });
    },

    timelineDotClass(ev) {
      if (ev.event_type !== 'click') return 'transition';
      if (ev.is_on_path) return 'on-path';
      if (ev.is_mis_click) return 'mis-click';
      return 'transition';
    },

    timelinePct(ev) {
      const dur = this.drawerSession?.duration_ms;
      if (!dur) return 0;
      return Math.min(99, Math.round(((ev.ms_since_session_start || 0) / dur) * 100));
    },

    showTooltip(mouseEvent, ev) {
      const tip = document.getElementById('timelineTooltip');
      if (!tip) return;
      const label = ev.element_selector
        ? `${ev.element_selector}  •  ${this.fmtMs(ev.ms_since_session_start)}`
        : `${ev.event_type}  •  ${this.fmtMs(ev.ms_since_session_start)}`;
      tip.textContent = label;
      tip.style.display = 'block';
      tip.style.left = mouseEvent.clientX + 'px';
      tip.style.top = (mouseEvent.clientY - 36) + 'px';
    },

    hideTooltip() {
      const tip = document.getElementById('timelineTooltip');
      if (tip) tip.style.display = 'none';
    },


    // ═══════════════════════════════════════════════════════════════════════
    // LINKS MODAL
    // ═══════════════════════════════════════════════════════════════════════

    openLinksModal() {
      this.linksModal = {
        ...this.linksModal,
        open: true,
        error: '',
        generated: [],
        copiedAll: false,
      };
    },

    async generateLinks() {
      this.linksModal.error = '';
      if (!this.linksModal.baseUrl.trim()) {
        this.linksModal.error = 'Please enter the prototype base URL.';
        return;
      }

      const count = Math.max(1, parseInt(this.linksModal.count) || 1);
      const labelLines = this.linksModal.labels.trim()
        ? this.linksModal.labels.trim().split('\n').map(l => l.trim()).filter(Boolean)
        : [];

      if (labelLines.length > 0 && labelLines.length !== count) {
        this.linksModal.error = `Label count (${labelLines.length}) must match link count (${count}).`;
        return;
      }

      this.linksModal.generating = true;
      try {
        const existingCount = this.participants.list.length;
        const rows = Array.from({ length: count }, (_, i) => ({
          study_id: this.studyId,
          label: labelLines[i] || `P${String(existingCount + i + 1).padStart(2, '0')}`,
          status: 'invited',
        }));

        const { data, error } = await this._db.from('participants').insert(rows).select();
        if (error) throw error;

        const base = this.linksModal.baseUrl.trim().replace(/\/$/, '');
        this.linksModal.generated = (data || []).map(p => ({
          id: p.id,
          label: p.label,
          url: `${base}?study=${this.studyId}&participant=${p.id}`,
        }));

        this.participants.loaded = false;
        await this.loadParticipants();

      } catch (e) {
        this.linksModal.error = 'Failed to generate links: ' + (e.message || String(e));
      } finally {
        this.linksModal.generating = false;
      }
    },

    copyAllLinks() {
      const text = this.linksModal.generated.map(l => l.url).join('\n');
      navigator.clipboard.writeText(text).then(() => {
        this.linksModal.copiedAll = true;
        setTimeout(() => { this.linksModal.copiedAll = false; }, 1500);
      });
    },

    copyLinkUrl(id, url) {
      navigator.clipboard.writeText(url).then(() => {
        this.copiedLinkId = id;
        setTimeout(() => { this.copiedLinkId = null; }, 1500);
      });
    },

    downloadLinksCSV() {
      const rows = [
        ['Label', 'URL'],
        ...this.linksModal.generated.map(l => [l.label, l.url]),
      ];
      const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(this.study?.name || 'study').replace(/[^a-z0-9]/gi, '-')}-participants.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },


    // ═══════════════════════════════════════════════════════════════════════
    // FORMATTERS
    // ═══════════════════════════════════════════════════════════════════════

    fmtDate(dateStr) {
      if (!dateStr) return '';
      return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    },

    topbarCompletionRate() {
      const total = this.sessions.list.length;
      if (!total) return 0;
      const done = this.sessions.list.filter(s => s.status === 'completed').length;
      return Math.round(done / total * 100);
    },

    fmtDuration(ms) {
      if (!ms || ms <= 0) return '—';
      const totalSec = Math.round(ms / 1000);
      const m = Math.floor(totalSec / 60);
      const s = totalSec % 60;
      return `${m}:${String(s).padStart(2, '0')}`;
    },

    fmtMs(ms) {
      if (ms == null || ms < 0) return '—';
      if (ms < 1000) return ms + 'ms';
      if (ms < 60000) return (ms / 1000).toFixed(1) + 's';
      return this.fmtDuration(ms);
    },

    fmtDate(dt) {
      if (!dt) return '—';
      return new Date(dt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    },

    fmtDateTime(dt) {
      if (!dt) return '—';
      return new Date(dt).toLocaleString('en-US', {
        month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });
    },

    completionRateClass(pct) {
      if (pct > 80) return 'ok';
      if (pct >= 50) return 'warn';
      return 'danger';
    },

    pctClass(pct) {
      if (pct > 80) return 'green';
      if (pct >= 50) return 'amber';
      return 'red';
    },

  };
}
