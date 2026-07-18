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
    gateCreds: { url: '', key: '', email: '', password: '' },
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
    resetTarget: null,
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
    journeyPopout: null,   // detail card for the clicked journey node
    journeyVert: false,    // subway map orientation (persisted)
    drawerW: null,         // researcher-dragged drawer width in px (persisted)

    // ── Aggregate journeys (Path Analysis) ────────────────────────────────
    flow: { loading: false, loaded: false, error: '', bySession: {} },
    flowSel: [],           // selected session ids
    flowPopout: null,      // detail card for the clicked aggregate node
    pathsTab: 'flow',      // 'flow' (funnel) | 'journeys' — persisted

    // ── Chart instances ────────────────────────────────────────────────────
    _taskChart: null,
    _durationChart: null,


    // ═══════════════════════════════════════════════════════════════════════
    // INIT
    // ═══════════════════════════════════════════════════════════════════════

    async init() {
      this.gateChecking = true;

      // Researcher display preferences
      try {
        const w = parseInt(localStorage.getItem('uxt_dash_drawer_w'), 10);
        if (Number.isFinite(w) && w >= 420) this.drawerW = w;
        this.journeyVert = localStorage.getItem('uxt_dash_journey_vert') === '1';
        if (localStorage.getItem('uxt_dash_paths_tab') === 'journeys') this.pathsTab = 'journeys';
      } catch {}

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
      try { this._db?.auth.signOut(); } catch {}
      this.hasSavedCreds = false;
      this.gateCreds = { url: '', key: '', email: '', password: '' };
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

        // Researcher auth: reuse an active session (shared with the setup
        // tool on the same origin), otherwise sign in with email + password.
        // The password is never persisted.
        const { data: { session } } = await this._db.auth.getSession();
        if (!session) {
          const email = this.gateCreds.email.trim();
          const password = this.gateCreds.password;
          if (!email || !password) {
            this.gateError = 'Researcher sign-in required — enter your email and password.';
            this.gateLoading = false;
            return;
          }
          const { error: authErr } = await this._db.auth.signInWithPassword({ email, password });
          if (authErr) {
            this.gateError = `Sign-in failed: ${authErr.message}`;
            this.gateLoading = false;
            return;
          }
          this.gateCreds.password = '';
        }

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
      if (id === 'paths' && this.pathsTab === 'journeys' && !this.flow.loaded) this.loadFlowJourneys();
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

    promptReset(p) {
      this.resetTarget = p;
    },

    // Reopen a participant's link and wipe their prior run (session + events +
    // feedback) so the same link can be re-used — mainly for testing.
    async confirmReset() {
      if (!this.resetTarget) return;
      const p = this.resetTarget;
      this.resetTarget = null;
      try {
        // Remove the prior run's session(s); events cascade-delete via FK.
        const { error: delErr } = await this._db
          .from('sessions').delete().eq('participant_id', p.id);
        if (delErr) throw delErr;
        // Reopen the participant so the invite link passes the "already
        // completed" guard again.
        const { error: updErr } = await this._db
          .from('participants')
          .update({ status: 'invited', session_id: null, started_at: null, completed_at: null })
          .eq('id', p.id);
        if (updErr) throw updErr;
        // Refresh — sessions first, since participants derive _session from it.
        await this.loadSessions(true);
        await this.loadParticipants(true);
      } catch (e) {
        this.participants.error = 'Reset failed: ' + (e.message || String(e));
      }
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
      this.journeyPopout = null;

      // Screen-level screenshots back the journey popouts when a step has no
      // per-step capture — load them lazily (no-op once loaded).
      this.loadScreens().catch(() => {});

      try {
        const { data, error } = await this._db
          .from('events')
          .select('id, event_type, step_index, screen_id, element_selector, element_text, element_tag, viewport_x, viewport_y, is_on_path, is_mis_click, advances_step, ms_since_session_start, timestamp')
          .eq('session_id', session.id)
          .order('ms_since_session_start', { ascending: true });

        if (error) throw error;
        this.drawerEvents = data || [];
      } catch {}
      finally { this.drawerLoading = false; }
    },

    closeDrawer() {
      this.drawerOpen = false;
      this.journeyPopout = null;
      setTimeout(() => {
        this.drawerSession = null;
        this.drawerEvents = [];
      }, 250);
    },

    // ── Session journey (subway map) ─────────────────────────────────────────
    // The recorded path is the printed line: Start → numbered step stations →
    // 🏁 end screen. The participant's ride overlays it: green along the main
    // line while on path, dipping to an amber branch lane for off-path clicks
    // and off-route pages, then either curving back up (rejoined) or ending
    // in a terminal marker (dropped / completed elsewhere).

    completedViaLabel(v) {
      return {
        path:       'Followed the recorded path',
        goals:      'Completed all task goals',
        end_screen: 'Reached the end screen off-path',
      }[v] || '—';
    },

    _normScreen(s) {
      const x = String(s || '').toLowerCase().trim();
      return x.length > 1 ? x.replace(/\/+$/, '') : x;
    },

    _shortScreen(s) {
      const x = String(s || '');
      const tail = x.split('/').filter(Boolean).pop() || x || '/';
      return tail.length > 16 ? tail.slice(0, 15) + '…' : tail;
    },

    _escXml(s) {
      return String(s ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
      }[c]));
    },

    // Build the journey model: stations (Start + recorded steps + end screen),
    // deviations grouped after the station the participant was at, and the
    // session outcome. Slots give every node a sequential x position so long
    // journeys spread out instead of clumping (the container scrolls).
    get journey() {
      return this._journeyModel(this.drawerSession, this.drawerEvents);
    },

    _journeyModel(s, evs) {
      const empty = { slots: [], stations: [], outcome: null, summary: '', devCount: 0 };
      const path = this.study?.ideal_path || [];
      if (!s || path.length === 0) return empty;

      // Screen-level screenshot fallback (per-step captures can die when the
      // click navigates; the screen capture of the same page fills in).
      const screensMap = {};
      (this.screens.list || []).forEach((sc) => {
        screensMap[this._normScreen(sc.screen_id)] = sc.screenshot_url;
      });

      const idealScreens = new Set(path.map((p) => this._normScreen(p.screenId)));
      const lastStep   = path[path.length - 1];
      const endScreen  = this._normScreen(lastStep?.endScreenId || '');
      if (endScreen) idealScreens.add(endScreen);

      // Stations
      const startScreen = this._normScreen(
        evs.find((e) => e.event_type === 'session_start')?.screen_id || path[0]?.screenId);
      const stations = [{
        kind: 'start', label: 'Start', screenId: startScreen,
        shot: screensMap[startScreen] || null, reached: true, ms: 0,
      }];
      path.forEach((p, i) => {
        const sid = this._normScreen(p.screenId);
        stations.push({
          kind: 'step', idx: i, label: String(i + 1), screenId: sid,
          elementText: p.elementText || '', selector: p.elementSelector || '',
          shot: p.screenshotUrl || screensMap[sid] || null,
          reached: false, ms: null,
        });
      });
      if (endScreen) {
        stations.push({
          kind: 'end', label: 'End', screenId: endScreen,
          shot: lastStep.endScreenshotUrl || screensMap[endScreen] || null,
          reached: false, ms: null,
        });
      }

      // Walk events: mark reached step stations, hang deviations off the
      // station the participant was at when they veered.
      let pos = 0;                                   // index into stations
      const devAfter = stations.map(() => []);
      for (const e of evs) {
        if (e.event_type === 'click') {
          const st = stations[1 + (e.step_index ?? -99)];
          if (e.advances_step && st && st.kind === 'step') {
            st.reached   = true;
            st.ms        = e.ms_since_session_start;
            st.clickText = e.element_text || '';
            pos = 1 + e.step_index;
          } else if (e.is_mis_click) {
            devAfter[pos].push({
              kind: 'click', ms: e.ms_since_session_start,
              text: e.element_text || '', selector: e.element_selector || '',
              tag: e.element_tag || '', screenId: this._normScreen(e.screen_id),
              afterStation: pos,
            });
          }
        } else if (e.event_type === 'screen_enter') {
          const sid = this._normScreen(e.screen_id);
          if (sid && !idealScreens.has(sid)) {
            const list = devAfter[pos];
            const prev = list[list.length - 1];
            if (!(prev && prev.kind === 'screen' && prev.screenId === sid)) {
              list.push({
                kind: 'screen', ms: e.ms_since_session_start,
                screenId: sid, afterStation: pos,
              });
            }
          }
        }
      }

      // End station: reached when the session completed and the participant
      // actually got there (any event on it, or end-screen completion).
      const endStation = endScreen ? stations[stations.length - 1] : null;
      if (endStation && s.status === 'completed') {
        const visitedEnd = evs.some((e) => this._normScreen(e.screen_id) === endScreen);
        if (visitedEnd || s.completed_via === 'end_screen' || s.completed_via === 'path') {
          endStation.reached = true;
          endStation.ms = s.duration_ms ?? null;
        }
      }

      // Outcome
      let outcome;
      if (s.status === 'completed') {
        outcome = { kind: s.completed_via || 'path', label: this.completedViaLabel(s.completed_via) };
      } else if (s.status === 'abandoned') {
        outcome = { kind: 'dropped', label: 'Dropped off' };
      } else {
        outcome = { kind: 'in_progress', label: 'Still in progress' };
      }

      // Slots: station, then its trailing deviations. When a deviation run
      // bypasses recorded stations (the participant never rejoined before
      // them), those hollow stations are distributed evenly BETWEEN the
      // off-path points instead of stacked after them — the printed line and
      // the participant's branch progress in parallel, with no dead gap
      // before the re-entry point.
      const slots = [];
      let i = 0;
      while (i < stations.length) {
        slots.push({ type: 'station', station: stations[i], si: i });
        const devs = devAfter[i].map((d) => ({ type: 'dev', dev: d, si: i }));
        if (devs.length === 0) { i++; continue; }

        const bypassed = [];
        let j = i + 1;
        while (j < stations.length && !stations[j].reached) {
          bypassed.push({ type: 'station', station: stations[j], si: j });
          j++;
        }
        slots.push(...this._interleaveRun(devs, bypassed));
        i = j;
      }

      const journeyEndsAtEnd = endStation && endStation.reached;
      if (!journeyEndsAtEnd) {
        let at = slots.length - 1;
        for (let i = slots.length - 1; i >= 0; i--) {
          if (slots[i].si === pos) { at = i; break; }
        }
        slots.splice(at + 1, 0, { type: 'terminal', outcome, si: pos });
      }

      const devCount = devAfter.reduce((n, l) => n + l.length, 0);
      const reachedSteps = stations.filter((st) => st.kind === 'step' && st.reached).length;
      const parts = [outcome.label];
      if (s.duration_ms != null) parts.push(this.fmtDuration(s.duration_ms));
      parts.push(`${reachedSteps}/${path.length} recorded steps matched`);
      parts.push(devCount === 0 ? 'no off-path points' :
        `${devCount} off-path point${devCount !== 1 ? 's' : ''}`);

      return { slots, stations, outcome, devCount, summary: parts.join(' · ') };
    },

    // Proportional merge: spread B bypassed stations evenly among D off-path
    // points so neither list clumps at one end of the shared span.
    _interleaveRun(devs, bypassed) {
      const out = [];
      let di = 0, si = 0;
      const D = devs.length, B = bypassed.length;
      while (di < D || si < B) {
        if (di < D && (si >= B || (di + 1) / (D + 1) <= (si + 1) / (B + 1))) {
          out.push(devs[di++]);
        } else {
          out.push(bypassed[si++]);
        }
      }
      return out;
    },

    // SVG renderer, orientation-aware. Positions are computed along the line
    // axis (A) and a cross-lane offset (main line vs branch lane), then mapped
    // to x/y for the chosen orientation. Every interactive node carries
    // data-node="<slot index>"; clicks and hovers are delegated.
    get journeySvg() {
      const J = this.journey;
      if (!J.slots.length) return '';
      const vert = this.journeyVert;
      const SP = vert ? 64 : 88;
      const M  = vert ? 46 : 70;
      const mainL = vert ? 200 : 58;    // cross offset of the printed line
      const devL  = vert ? 264 : 122;   // cross offset of the branch lane
      const A = (i) => M + i * SP;
      const P = (a, l) => (vert ? { x: l, y: a } : { x: a, y: l });
      const span = M * 2 + (J.slots.length - 1) * SP;
      const W = vert ? 430 : span;
      const H = vert ? span : 168;
      const sel = this.journeyPopout?.nodeId;
      const esc = (v) => this._escXml(v);
      const out = [];

      // Printed line: straight through every station slot.
      const stationAs = J.slots
        .map((sl, i) => (sl.type === 'station' ? A(i) : null))
        .filter((a) => a !== null);
      if (stationAs.length > 1) {
        const p1 = P(stationAs[0], mainL);
        const p2 = P(stationAs[stationAs.length - 1], mainL);
        out.push(`<line x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}" class="jy-main"/>`);
      }

      // Participant line: reached stations on the main line, deviations and
      // terminals in the branch lane. Long main-line jumps (skipped stations)
      // dip through the branch lane so hollow stations aren't implied.
      const pts = [];
      J.slots.forEach((sl, i) => {
        if (sl.type === 'station' && sl.station.reached) pts.push({ a: A(i), lane: mainL });
        else if (sl.type === 'dev' || sl.type === 'terminal') pts.push({ a: A(i), lane: devL });
      });
      if (pts.length > 1) {
        const m0 = P(pts[0].a, pts[0].lane);
        let d = `M ${m0.x} ${m0.y}`;
        for (let i = 1; i < pts.length; i++) {
          const a = pts[i - 1], b = pts[i];
          const B = P(b.a, b.lane);
          if (a.lane === b.lane && a.lane === mainL && b.a - a.a > SP * 1.5) {
            const c1 = P(a.a + 40, devL), c2 = P(b.a - 40, devL);
            d += ` C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${B.x} ${B.y}`;
          } else if (a.lane === b.lane) {
            d += ` L ${B.x} ${B.y}`;
          } else {
            const mid = (a.a + b.a) / 2;
            const c1 = P(mid, a.lane), c2 = P(mid, b.lane);
            d += ` C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${B.x} ${B.y}`;
          }
        }
        out.push(`<path d="${d}" class="jy-journey"/>`);
      }

      // Nodes + labels
      J.slots.forEach((sl, i) => {
        const a = A(i);
        const selCls = sel === i ? ' selected' : '';
        if (sl.type === 'station') {
          const st = sl.station;
          const c = P(a, mainL);
          out.push(`<circle data-node="${i}" cx="${c.x}" cy="${c.y}" r="11" class="jy-station ${st.kind}${st.reached ? ' reached' : ''}${selCls}"/>`);
          if (st.kind === 'step') {
            out.push(`<text x="${c.x}" y="${c.y + 4}" class="jy-num" text-anchor="middle">${st.label}</text>`);
          } else {
            const cap = st.kind === 'start' ? 'START' : '🏁 END';
            out.push(vert
              ? `<text x="${mainL - 20}" y="${a - 4}" class="jy-cap" text-anchor="end">${cap}</text>`
              : `<text x="${c.x}" y="${mainL - 20}" class="jy-cap" text-anchor="middle">${cap}</text>`);
          }
          const scr = esc(this._shortScreen(st.screenId));
          out.push(vert
            ? `<text x="${mainL - 20}" y="${a + (st.kind === 'step' ? 4 : 12)}" class="jy-screen" text-anchor="end">${scr}</text>`
            : `<text x="${c.x}" y="${mainL + (i % 2 === 0 ? 32 : 46)}" class="jy-screen" text-anchor="middle">${scr}</text>`);
        } else if (sl.type === 'dev') {
          const c = P(a, devL);
          out.push(`<circle data-node="${i}" cx="${c.x}" cy="${c.y}" r="7" class="jy-dev ${sl.dev.kind}${selCls}"/>`);
          if (sl.dev.kind === 'screen') {
            const scr = esc(this._shortScreen(sl.dev.screenId));
            out.push(vert
              ? `<text x="${devL + 14}" y="${a + 4}" class="jy-screen" text-anchor="start">${scr}</text>`
              : `<text x="${c.x}" y="${devL + 22}" class="jy-screen" text-anchor="middle">${scr}</text>`);
          }
        } else {
          const k = sl.outcome.kind;
          const cls = k === 'dropped' ? 'drop' : (k === 'in_progress' ? 'progress' : 'done');
          const c = P(a, devL);
          out.push(`<circle data-node="${i}" cx="${c.x}" cy="${c.y}" r="10" class="jy-terminal ${cls}${selCls}"/>`);
          const glyph = k === 'dropped' ? '✕' : (k === 'in_progress' ? '…' : '✓');
          out.push(`<text x="${c.x}" y="${c.y + 4}" class="jy-term-glyph" text-anchor="middle">${glyph}</text>`);
          const lbl = k === 'dropped' ? 'dropped' : (k === 'in_progress' ? 'in progress' : 'completed');
          out.push(vert
            ? `<text x="${devL + 16}" y="${a + 4}" class="jy-screen" text-anchor="start">${lbl}</text>`
            : `<text x="${c.x}" y="${devL + 26}" class="jy-screen" text-anchor="middle">${lbl}</text>`);
        }
      });

      return `<svg class="jy-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">${out.join('')}</svg>`;
    },

    toggleJourneyVert() {
      this.journeyVert = !this.journeyVert;
      try { localStorage.setItem('uxt_dash_journey_vert', this.journeyVert ? '1' : '0'); } catch {}
    },

    // ── Aggregate participant journeys (Path Analysis section) ──────────────
    // Overlays every selected participant's ride on the recorded line. Off-path
    // points that multiple participants share collapse into one dot sized by
    // how many took it — common deviations stand out at a glance.

    _FLOW_COLORS: ['#2563EB', '#DB2777', '#059669', '#D97706', '#7C3AED',
                   '#DC2626', '#0891B2', '#65A30D', '#C026D3', '#EA580C'],

    flowColor(i) { return this._FLOW_COLORS[i % this._FLOW_COLORS.length]; },

    setPathsTab(tab) {
      this.pathsTab = tab;
      try { localStorage.setItem('uxt_dash_paths_tab', tab); } catch {}
      if (tab === 'journeys' && !this.flow.loaded) this.loadFlowJourneys();
    },

    get flowSessions() { return this.sessions.list || []; },

    async loadFlowJourneys() {
      if (this.flow.loaded || this.flow.loading) return;
      this.flow.loading = true;
      this.flow.error = '';
      try {
        await this.loadSessions();
        this.loadScreens().catch(() => {});
        const ids = (this.sessions.list || []).map((s) => s.id);
        if (ids.length > 0) {
          const { data, error } = await this._db
            .from('events')
            .select('session_id, event_type, step_index, screen_id, element_selector, element_text, element_tag, is_mis_click, advances_step, ms_since_session_start')
            .in('session_id', ids)
            .order('ms_since_session_start', { ascending: true });
          if (error) throw error;
          const by = {};
          (data || []).forEach((e) => { (by[e.session_id] ??= []).push(e); });
          this.flow.bySession = by;
        }
        this.flowSel = ids;
        this.flow.loaded = true;
      } catch (e) {
        this.flow.error = `Failed to load journeys: ${e.message}`;
      } finally {
        this.flow.loading = false;
      }
    },

    flowToggle(id) {
      this.flowSel = this.flowSel.includes(id)
        ? this.flowSel.filter((x) => x !== id)
        : [...this.flowSel, id];
      this.flowPopout = null;
    },

    flowSelAll()  { this.flowSel = (this.sessions.list || []).map((s) => s.id); this.flowPopout = null; },
    flowSelNone() { this.flowSel = []; this.flowPopout = null; },
    flowSelOnly(id) { this.flowSel = [id]; this.flowPopout = null; },

    // Aggregate model: shared stations, deviation clusters (same element or
    // same off-route screen, after the same station), terminal clusters, and
    // one ride (node sequence) per selected session.
    get flowAgg() {
      const empty = { slots: [], rides: [], total: 0 };
      if (!this.flow.loaded) return empty;
      const sessions = (this.sessions.list || []).filter((s) => this.flowSel.includes(s.id));
      if (sessions.length === 0) return empty;

      const models = sessions.map((s, i) => ({
        session: s,
        color: this.flowColor((this.sessions.list || []).findIndex((x) => x.id === s.id)),
        model: this._journeyModel(s, this.flow.bySession[s.id] || []),
      })).filter((m) => m.model.slots.length > 0);
      if (models.length === 0) return empty;

      // Shared stations from the first model (same recorded path for all);
      // collect who reached each.
      const base = models[0].model.stations;
      const stations = base.map((st) => ({ ...st, reachedBy: [] }));
      models.forEach(({ session, color, model }) => {
        model.stations.forEach((st, i) => {
          if (st.reached && stations[i]) {
            stations[i].reachedBy.push({
              label: session.participant_label || session.id.slice(0, 6),
              ms: st.ms, color,
            });
          }
        });
      });

      // Deviation clusters + terminal clusters
      const clusters = new Map();
      const terms = new Map();
      models.forEach(({ session, color, model }) => {
        const label = session.participant_label || session.id.slice(0, 6);
        model.slots.forEach((sl) => {
          if (sl.type === 'dev') {
            const d = sl.dev;
            const key = `${d.afterStation}|${d.kind}|${d.kind === 'click' ? (d.selector || d.text) : d.screenId}`;
            if (!clusters.has(key)) {
              clusters.set(key, { key, si: d.afterStation, kind: d.kind,
                text: d.text, selector: d.selector, tag: d.tag,
                screenId: d.screenId, hits: [], minMs: d.ms ?? 0 });
            }
            const c = clusters.get(key);
            c.hits.push({ label, ms: d.ms, color, sessionId: session.id });
            c.minMs = Math.min(c.minMs, d.ms ?? 0);
          } else if (sl.type === 'terminal') {
            const key = `${sl.si}|${sl.outcome.kind}`;
            if (!terms.has(key)) {
              terms.set(key, { key, si: sl.si, outcome: sl.outcome, hits: [] });
            }
            terms.get(key).hits.push({ label, color, sessionId: session.id });
          }
        });
      });

      // Slots: station, then its clusters (by first occurrence), then its
      // terminal clusters.
      const slots = [];
      const slotOfStation = {};
      const slotOfKey = {};
      stations.forEach((st, i) => {
        slotOfStation[i] = slots.length;
        slots.push({ type: 'station', station: st, si: i });
        [...clusters.values()].filter((c) => c.si === i)
          .sort((a, b) => a.minMs - b.minMs)
          .forEach((c) => { slotOfKey[c.key] = slots.length; slots.push({ type: 'cluster', cluster: c, si: i }); });
        [...terms.values()].filter((t) => t.si === i)
          .forEach((t) => { slotOfKey[t.key] = slots.length; slots.push({ type: 'term', term: t, si: i }); });
      });

      // Rides: each session's node sequence mapped to aggregate slots.
      const rides = models.map(({ session, color, model }) => {
        const pts = [];
        model.slots.forEach((sl) => {
          if (sl.type === 'station' && sl.station.reached) {
            const idx = model.stations.indexOf(sl.station);
            pts.push({ slot: slotOfStation[idx], lane: 'main' });
          } else if (sl.type === 'dev') {
            const d = sl.dev;
            const key = `${d.afterStation}|${d.kind}|${d.kind === 'click' ? (d.selector || d.text) : d.screenId}`;
            if (slotOfKey[key] != null) pts.push({ slot: slotOfKey[key], lane: 'branch' });
          } else if (sl.type === 'terminal') {
            const key = `${sl.si}|${sl.outcome.kind}`;
            if (slotOfKey[key] != null) pts.push({ slot: slotOfKey[key], lane: 'branch' });
          }
        });
        return { color, pts, id: session.id };
      });

      return { slots, rides, total: models.length };
    },

    get flowSvg() {
      const F = this.flowAgg;
      if (!F.slots.length) return '';
      const SP = 92, M = 70, yMain = 64, yDev = 138, H = 196;
      const X = (i) => M + i * SP;
      const W = M * 2 + (F.slots.length - 1) * SP;
      const sel = this.flowPopout?.nodeId;
      const esc = (v) => this._escXml(v);
      const out = [];

      const stationSlots = F.slots.map((sl, i) => (sl.type === 'station' ? i : null)).filter((v) => v !== null);
      if (stationSlots.length > 1) {
        out.push(`<line x1="${X(stationSlots[0])}" y1="${yMain}" x2="${X(stationSlots[stationSlots.length - 1])}" y2="${yMain}" class="jy-main"/>`);
      }

      // Rides (behind nodes). Straight main-line segments dip through the
      // branch lane only when they skip an intermediate STATION slot.
      F.rides.forEach((ride, ri) => {
        if (ride.pts.length < 2) return;
        const jitter = ((ri % 5) - 2) * 2.4;
        const yOf = (p) => (p.lane === 'main' ? yMain + jitter : yDev);
        let d = `M ${X(ride.pts[0].slot)} ${yOf(ride.pts[0])}`;
        for (let i = 1; i < ride.pts.length; i++) {
          const a = ride.pts[i - 1], b = ride.pts[i];
          const ax = X(a.slot), bx = X(b.slot);
          const ay = yOf(a), by = yOf(b);
          const skipsStation = a.lane === 'main' && b.lane === 'main' &&
            F.slots.some((sl, si) => sl.type === 'station' &&
              si > Math.min(a.slot, b.slot) && si < Math.max(a.slot, b.slot));
          if (skipsStation) {
            d += ` C ${ax + 40} ${yDev} ${bx - 40} ${yDev} ${bx} ${by}`;
          } else if (ay === by) {
            d += ` L ${bx} ${by}`;
          } else {
            const mx = (ax + bx) / 2;
            d += ` C ${mx} ${ay} ${mx} ${by} ${bx} ${by}`;
          }
        }
        out.push(`<path d="${d}" class="jy-ride" style="stroke:${ride.color}"/>`);
      });

      // Nodes
      F.slots.forEach((sl, i) => {
        const x = X(i);
        const selCls = sel === i ? ' selected' : '';
        if (sl.type === 'station') {
          const st = sl.station;
          const n = st.reachedBy.length;
          out.push(`<circle data-node="${i}" cx="${x}" cy="${yMain}" r="11" class="jy-station ${st.kind}${n > 0 ? ' reached' : ''}${selCls}"/>`);
          if (st.kind === 'step') {
            out.push(`<text x="${x}" y="${yMain + 4}" class="jy-num" text-anchor="middle">${st.label}</text>`);
          } else {
            out.push(`<text x="${x}" y="${yMain - 20}" class="jy-cap" text-anchor="middle">${st.kind === 'start' ? 'START' : '🏁 END'}</text>`);
          }
          out.push(`<text x="${x}" y="${yMain + 32}" class="jy-screen" text-anchor="middle">${n}/${F.total}</text>`);
        } else if (sl.type === 'cluster') {
          const c = sl.cluster;
          const r = Math.min(13, 6.5 + c.hits.length * 1.4);
          out.push(`<circle data-node="${i}" cx="${x}" cy="${yDev}" r="${r}" class="jy-dev ${c.kind}${selCls}"/>`);
          if (c.hits.length > 1) {
            out.push(`<text x="${x}" y="${yDev + 3.5}" class="jy-cl-count" text-anchor="middle">${c.hits.length}</text>`);
          }
        } else {
          const t = sl.term;
          const k = t.outcome.kind;
          const cls = k === 'dropped' ? 'drop' : (k === 'in_progress' ? 'progress' : 'done');
          out.push(`<circle data-node="${i}" cx="${x}" cy="${yDev}" r="10" class="jy-terminal ${cls}${selCls}"/>`);
          const glyph = k === 'dropped' ? '✕' : (k === 'in_progress' ? '…' : '✓');
          out.push(`<text x="${x}" y="${yDev + 4}" class="jy-term-glyph" text-anchor="middle">${glyph}${t.hits.length > 1 ? '×' + t.hits.length : ''}</text>`);
        }
      });

      return `<svg class="jy-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">${out.join('')}</svg>`;
    },

    _flowNodeDetail(idx) {
      const sl = this.flowAgg.slots[idx];
      if (!sl) return null;
      const who = (hits) => hits.map((h) => h.ms != null ? `${h.label} (${this.fmtMs(h.ms)})` : h.label).join(',  ');
      if (sl.type === 'station') {
        const st = sl.station;
        const rows = [['Screen', st.screenId]];
        if (st.kind === 'step') {
          rows.push(['Recorded click', st.elementText || '(no text)']);
          if (st.selector) rows.push(['Selector', st.selector]);
        }
        rows.push(['Reached by', `${st.reachedBy.length} of ${this.flowAgg.total} selected`]);
        if (st.reachedBy.length) rows.push(['Participants', who(st.reachedBy)]);
        return {
          nodeId: idx,
          title: st.kind === 'step' ? `Step ${st.label} — recorded path`
               : (st.kind === 'start' ? 'Session start' : 'End screen'),
          shot: st.shot, rows,
        };
      }
      if (sl.type === 'cluster') {
        const c = sl.cluster;
        const rows = c.kind === 'click'
          ? [
              ['Clicked', c.text || '(no visible text)'],
              ['Selector', c.selector || '—'],
              ['Element', c.tag ? `<${String(c.tag).toLowerCase()}>` : '—'],
              ['On screen', c.screenId],
            ]
          : [['Went to', c.screenId]];
        rows.push(['Taken by', `${c.hits.length} participant${c.hits.length !== 1 ? 's' : ''}`]);
        rows.push(['Participants', who(c.hits)]);
        return {
          nodeId: idx,
          title: (c.kind === 'click' ? 'Off-path click' : 'Off-route page') +
                 (c.hits.length > 1 ? ` — shared by ${c.hits.length}` : ''),
          shot: null, rows,
        };
      }
      const t = sl.term;
      return {
        nodeId: idx,
        title: t.outcome.label,
        shot: null,
        rows: [
          ['Participants', who(t.hits)],
          ['Count', String(t.hits.length)],
        ],
      };
    },

    flowClick(e) {
      const n = e.target.closest('[data-node]');
      if (!n) { this.flowPopout = null; return; }
      const idx = Number(n.getAttribute('data-node'));
      this.flowPopout = this.flowPopout?.nodeId === idx ? null : this._flowNodeDetail(idx);
    },

    flowHover(e) {
      const n = e.target.closest('[data-node]');
      const tip = document.getElementById('timelineTooltip');
      if (!n || !tip) return;
      const sl = this.flowAgg.slots[Number(n.getAttribute('data-node'))];
      if (!sl) return;
      let label;
      if (sl.type === 'station') {
        const st = sl.station;
        label = (st.kind === 'step' ? `Step ${st.label}` : (st.kind === 'start' ? 'Start' : 'End screen'))
          + ` · ${st.reachedBy.length}/${this.flowAgg.total} reached`;
      } else if (sl.type === 'cluster') {
        const c = sl.cluster;
        label = `⚠ ${c.kind === 'click' ? `clicked “${(c.text || c.selector || '?').slice(0, 36)}”` : `went to ${c.screenId}`} · ${c.hits.length}×`;
      } else {
        label = `${sl.term.outcome.label} · ${sl.term.hits.length}×`;
      }
      tip.textContent = label + '  ·  click for details';
      tip.style.display = 'block';
      const half = Math.min(140, tip.offsetWidth / 2 || 140);
      tip.style.left = Math.min(window.innerWidth - half - 8, Math.max(half + 8, e.clientX)) + 'px';
      tip.style.top = (e.clientY - 36) + 'px';
    },

    // Drag the drawer's left edge to resize; the width persists.
    startDrawerResize(e) {
      e.preventDefault();
      const move = (ev) => {
        const w = Math.min(window.innerWidth * 0.95, Math.max(420, window.innerWidth - ev.clientX));
        this.drawerW = Math.round(w);
      };
      const up = () => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        document.body.style.userSelect = '';
        try { localStorage.setItem('uxt_dash_drawer_w', String(this.drawerW)); } catch {}
      };
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    },

    // Popout payload for a clicked node.
    _journeyNodeDetail(idx) {
      const sl = this.journey.slots[idx];
      if (!sl) return null;
      if (sl.type === 'station') {
        const st = sl.station;
        const rows = [['Screen', st.screenId]];
        if (st.kind === 'step') {
          rows.push(['Recorded click', st.elementText || '(no text)']);
          if (st.selector) rows.push(['Selector', st.selector]);
          rows.push(['Participant', st.reached ? `matched it at ${this.fmtMs(st.ms)}` : 'never matched this step']);
        } else if (st.kind === 'start') {
          rows.push(['Session started', 'here']);
        } else {
          rows.push(['Reached', st.reached ? 'yes — session end' : 'no']);
        }
        return {
          nodeId: idx,
          title: st.kind === 'step' ? `Step ${st.label} — recorded path`
               : (st.kind === 'start' ? 'Session start' : 'End screen'),
          shot: st.shot, rows,
        };
      }
      if (sl.type === 'dev') {
        const d = sl.dev;
        const after = this.journey.stations[d.afterStation];
        const afterLabel = after
          ? (after.kind === 'step' ? `step ${after.label} (${after.screenId})` : `${after.kind} (${after.screenId})`)
          : '—';
        const rows = d.kind === 'click'
          ? [
              ['Clicked', d.text || '(no visible text)'],
              ['Selector', d.selector || '—'],
              ['Element', d.tag ? `<${d.tag.toLowerCase()}>` : '—'],
              ['On screen', d.screenId],
              ['When', this.fmtMs(d.ms)],
              ['Last on-path point', afterLabel],
            ]
          : [
              ['Went to', d.screenId],
              ['When', this.fmtMs(d.ms)],
              ['Last on-path point', afterLabel],
            ];
        return {
          nodeId: idx,
          title: d.kind === 'click' ? 'Off-path click' : 'Off-route page',
          shot: null, rows,
        };
      }
      // terminal
      const s = this.drawerSession;
      return {
        nodeId: idx,
        title: sl.outcome.label,
        shot: null,
        rows: [
          ['Status', s?.status ?? '—'],
          ['Duration', this.fmtDuration(s?.duration_ms)],
          ['Steps matched', `${s?.completed_steps ?? 0} / ${s?.total_steps ?? '—'}`],
        ],
      };
    },

    journeyClick(e) {
      const n = e.target.closest('[data-node]');
      if (!n) { this.journeyPopout = null; return; }
      const idx = Number(n.getAttribute('data-node'));
      this.journeyPopout = this.journeyPopout?.nodeId === idx ? null : this._journeyNodeDetail(idx);
    },

    journeyHover(e) {
      const n = e.target.closest('[data-node]');
      const tip = document.getElementById('timelineTooltip');
      if (!n || !tip) return;
      const sl = this.journey.slots[Number(n.getAttribute('data-node'))];
      if (!sl) return;
      let label;
      if (sl.type === 'station') {
        const st = sl.station;
        label = st.kind === 'step'
          ? `Step ${st.label} · ${st.reached ? 'reached ' + this.fmtMs(st.ms) : 'not reached'}`
          : (st.kind === 'start' ? 'Session start' : `End screen · ${st.reached ? 'reached' : 'not reached'}`);
      } else if (sl.type === 'dev') {
        label = sl.dev.kind === 'click'
          ? `⚠ clicked “${(sl.dev.text || sl.dev.selector || '?').slice(0, 40)}” · ${this.fmtMs(sl.dev.ms)}`
          : `⚠ went to ${sl.dev.screenId} · ${this.fmtMs(sl.dev.ms)}`;
      } else {
        label = sl.outcome.label;
      }
      tip.textContent = label + '  ·  click for details';
      tip.style.display = 'block';
      // Clamp so the (center-anchored) tooltip never clips at the viewport edges.
      const half = Math.min(140, tip.offsetWidth / 2 || 140);
      tip.style.left = Math.min(window.innerWidth - half - 8, Math.max(half + 8, e.clientX)) + 'px';
      tip.style.top = (e.clientY - 36) + 'px';
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
