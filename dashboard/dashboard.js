/* UX Tracker — Researcher Dashboard
   Depends on window.supabase (Supabase JS v2), window.Chart (Chart.js v4).
   Alpine.js loaded after this file. */

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
        label: 'Click Maps',
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
        partial: 0,
        notCompleted: 0,
        avgDuration: '—',
        completionRate: 0,
        avgSteps: '—',
      },
      taskRates: [],
      durationSeries: [],
      feedback: [],   // survey + end-of-study responses, grouped for surfacing
    },

    // ── Sessions ───────────────────────────────────────────────────────────
    sessions: { loading: false, error: '', loaded: false, list: [] },
    sessionsFilter: { status: 'all', screenChanges: 'all', duration: 'all' },

    // ── Screens ────────────────────────────────────────────────────────────
    screens: { loading: false, error: '', loaded: false, list: [] },

    // ── Click maps (heatmaps) ──────────────────────────────────────────────
    heatmap: {
      mode: 'steps',        // 'steps' (one map per recorded step) | 'screens' (by URL)
      view: 'dots',         // 'dots' (small-N click map) | 'density' (heat blur)
      clickFilter: 'all',   // all | on_path | mis_click
      sessionFilter: 'all', // all | completed
      selectedKey: null,
      radius: 26,           // density blur radius
      loading: false, loaded: false, error: '',
      clicks: [],           // every click event for the study (single fetch)
      labels: {},           // session_id → participant label
    },
    heatPopout: null,       // clicked-dot detail card

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
    flowVert: true,        // aggregate map orientation — vertical by default

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
        const fv = localStorage.getItem('uxt_dash_flow_vert');
        if (fv !== null) this.flowVert = fv === '1';
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
      if (id === 'heatmaps' && !this.heatmap.loaded) this.loadHeatmaps();
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

        // Levels of success: partial completions (reached the end screen with
        // task goals unmet) are reported as their own level, never inside the
        // full-completion count or rate.
        const partial = completed.filter(s => this.sessionPartial(s));
        const fullyCompleted = completed.filter(s => !this.sessionPartial(s));

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
          completed: fullyCompleted.length,
          partial: partial.length,
          notCompleted: notCompleted.length,
          avgDuration: avgDurationMs != null ? this.fmtDuration(avgDurationMs) : '—',
          completionRate: totalInvited > 0 ? Math.round((fullyCompleted.length / totalInvited) * 100) : 0,
          avgSteps,
        };

        // Duration series for line chart (completed sessions ordered by started_at)
        this.overview.durationSeries = completed
          .filter(s => s.duration_ms > 0)
          .map((s, i) => ({ x: i + 1, y: Math.round(s.duration_ms / 1000) }));

        // Task completion rates
        await this._loadTaskRates();

        // Survey + end-of-study feedback, grouped for the responses panel
        this._computeFeedback();

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

    // Aggregate every survey response and the end-of-study feedback across all
    // sessions into display groups — one per defined survey, plus one for the
    // completion feedback. Empty groups (no responses yet) are dropped.
    _computeFeedback() {
      const sessions = this.sessions.list || [];
      const who = (s) => s.participant_label || (s.participant_id ? s.participant_id.slice(0, 8) : 'Participant');
      const groups = [];

      (this.study?.surveys || []).forEach((sv) => {
        if (!sv || !sv.id) return;
        const responses = [];
        sessions.forEach((s) => {
          (Array.isArray(s.survey_responses) ? s.survey_responses : []).forEach((r) => {
            if (r.surveyId === sv.id) responses.push({ ...r, who: who(s) });
          });
        });
        if (responses.length) {
          groups.push(this._feedbackGroup(this._surveyTriggerLabel(sv.trigger, null), sv, responses));
        }
      });

      // Orphan responses: answered under a surveyId no longer in study.surveys
      // (the survey was renamed or removed after sessions ran). They still
      // count — group them by surveyId so collected feedback is never silently
      // dropped from the panel (the per-session journey shows them regardless).
      const knownIds = new Set((this.study?.surveys || []).map((sv) => sv && sv.id).filter(Boolean));
      const orphansById = {};
      sessions.forEach((s) => {
        (Array.isArray(s.survey_responses) ? s.survey_responses : []).forEach((r) => {
          if (r.surveyId && !knownIds.has(r.surveyId)) {
            if (!orphansById[r.surveyId]) orphansById[r.surveyId] = [];
            orphansById[r.surveyId].push({ ...r, who: who(s) });
          }
        });
      });
      Object.values(orphansById).forEach((responses) => {
        const trig = responses.find((r) => r.trigger)?.trigger || null;
        const title = `${this._surveyTriggerLabel(trig, responses[0])} (removed survey)`;
        groups.push(this._feedbackGroup(title, null, responses));
      });

      const endResponses = [];
      sessions.forEach((s) => {
        const fb = s.feedback;
        if (fb && (fb.rating != null || (fb.comment && String(fb.comment).trim()))) {
          endResponses.push({ rating: fb.rating, comment: fb.comment, who: who(s) });
        }
      });
      if (endResponses.length) {
        const comp = this.study?.completion || {};
        groups.push(this._feedbackGroup('End-of-study feedback',
          { rating: comp.rating, comment: comp.comment }, endResponses));
      }

      this.overview.feedback = groups;
    },

    _feedbackGroup(title, def, responses) {
      const rated = responses.filter((r) => r.rating != null && !r.skipped);
      const avgNum = rated.length
        ? rated.reduce((a, r) => a + Number(r.rating), 0) / rated.length
        : null;
      const comments = responses
        .filter((r) => !r.skipped && r.comment && String(r.comment).trim())
        .map((r) => ({ who: r.who, text: String(r.comment).trim(), rating: r.rating ?? null }));
      return {
        title,
        ratingPrompt:  (def?.rating?.prompt || '').trim(),
        commentPrompt: (def?.comment?.prompt || '').trim(),
        count:         responses.length,
        ratedCount:    rated.length,
        avg:           avgNum != null ? avgNum.toFixed(1) : null,
        avgStars:      avgNum != null ? this.stars(avgNum) : '',
        skipped:       responses.filter((r) => r.skipped).length,
        comments,
      };
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

    // One fetch: every click for the study, plus screens + sessions for
    // screenshots, labels, and the completed filter.
    async loadHeatmaps(force = false) {
      if (this.heatmap.loaded && !force) return;
      this.heatmap.loading = true;
      this.heatmap.error = '';
      try {
        await Promise.all([this.loadScreens(), this.loadSessions()]);
        const { data, error } = await this._db
          .from('events')
          .select('session_id, screen_id, step_index, viewport_x, viewport_y, is_on_path, is_mis_click, element_text, element_selector, element_tag, ms_since_session_start')
          .eq('study_id', this.studyId)
          .eq('event_type', 'click')
          .order('ms_since_session_start', { ascending: true });
        if (error) throw error;
        this.heatmap.clicks = data || [];
        const labels = {};
        (this.sessions.list || []).forEach((s) => {
          labels[s.id] = s.participant_label || s.id.slice(0, 6);
        });
        this.heatmap.labels = labels;
        this.heatmap.loaded = true;
        if (!this.heatmap.selectedKey && this.heatmapItems[0]) {
          this.heatmap.selectedKey = this.heatmapItems[0].key;
        }
        this.$nextTick(() => this.renderHeatmap());
      } catch (e) {
        this.heatmap.error = `Failed to load click maps: ${e.message}`;
      } finally {
        this.heatmap.loading = false;
      }
    },

    get _screensByNorm() {
      const map = {};
      (this.screens.list || []).forEach((s) => { map[this._normScreen(s.screen_id)] = s; });
      return map;
    },

    // Selector entries. By Step (default): one map per recorded step with the
    // step's own screenshot — in-page flows get one map per step even when the
    // URL never changes. By Screen: one aggregate map per captured URL.
    get heatmapItems() {
      if (this.heatmap.mode === 'screens') {
        return (this.screens.list || []).map((s) => ({
          key: 's:' + s.screen_id, kind: 'screen',
          label: this._shortScreen(s.screen_id), sub: s.screen_id,
          screenId: this._normScreen(s.screen_id),
          shot: s.screenshot_url, vw: s.viewport_width, vh: s.viewport_height,
          stale: s.is_stale, staleAt: s.change_detected_at,
        }));
      }
      const path = this.study?.ideal_path || [];
      const items = path.map((p, i) => {
        const sid = this._normScreen(p.screenId);
        const scr = this._screensByNorm[sid];
        return {
          key: 'p:' + i, kind: 'step', stepIndex: i,
          label: 'Step ' + (i + 1),
          sub: p.elementText || p.elementSelector || sid,
          screenId: sid,
          shot: p.screenshotUrl || scr?.screenshot_url || null,
          vw: scr?.viewport_width, vh: scr?.viewport_height,
          stale: scr?.is_stale, staleAt: scr?.change_detected_at,
          expected: p.elementText || '', expectedSel: p.elementSelector || '',
        };
      });
      const last = path[path.length - 1];
      const endSid = this._normScreen(last?.endScreenId || '');
      if (endSid) {
        const scr = this._screensByNorm[endSid];
        items.push({
          key: 'p:end', kind: 'end', label: 'End screen', sub: endSid,
          screenId: endSid,
          shot: last.endScreenshotUrl || scr?.screenshot_url || null,
          vw: scr?.viewport_width, vh: scr?.viewport_height,
          stale: scr?.is_stale, staleAt: scr?.change_detected_at,
        });
      }
      return items;
    },

    get heatmapSelected() {
      return this.heatmapItems.find((i) => i.key === this.heatmap.selectedKey) || null;
    },

    get _completedIds() {
      return new Set((this.sessions.list || [])
        .filter((s) => s.status === 'completed').map((s) => s.id));
    },

    // Clicks plotted on the selected map. Step maps take only clicks made
    // WHILE AT that step AND on that step's screen — a deviating participant's
    // clicks on other pages never pollute a step's screenshot.
    get heatmapClicks() {
      const it = this.heatmapSelected;
      if (!it) return [];
      let list = this.heatmap.clicks.filter((c) => this._normScreen(c.screen_id) === it.screenId);
      if (it.kind === 'step') list = list.filter((c) => c.step_index === it.stepIndex);
      if (this.heatmap.clickFilter === 'on_path')   list = list.filter((c) => c.is_on_path);
      if (this.heatmap.clickFilter === 'mis_click') list = list.filter((c) => c.is_mis_click);
      if (this.heatmap.sessionFilter === 'completed') {
        list = list.filter((c) => this._completedIds.has(c.session_id));
      }
      return list;
    },

    // Step mode: clicks made at this step but on OTHER screens — the
    // deviation clicks that have no home on this screenshot.
    get heatmapOffScreen() {
      const it = this.heatmapSelected;
      if (!it || it.kind !== 'step') return [];
      const groups = {};
      this.heatmap.clicks
        .filter((c) => c.step_index === it.stepIndex && this._normScreen(c.screen_id) !== it.screenId)
        .forEach((c) => {
          const sid = this._normScreen(c.screen_id);
          groups[sid] ??= { screenId: sid, count: 0, who: new Set() };
          groups[sid].count++;
          groups[sid].who.add(this.heatmap.labels[c.session_id] || '?');
        });
      return Object.values(groups).map((g) => ({ ...g, who: [...g.who].join(', ') }));
    },

    get heatmapStats() {
      const list = this.heatmapClicks;
      return {
        clicks: list.length,
        participants: new Set(list.map((c) => c.session_id)).size,
        mis: list.filter((c) => c.is_mis_click).length,
      };
    },

    selectHeatmapItem(key) {
      this.heatmap.selectedKey = key;
      this.heatPopout = null;
      this.$nextTick(() => this.renderHeatmap());
    },

    setHeatmapMode(mode) {
      this.heatmap.mode = mode;
      this.heatPopout = null;
      this.heatmap.selectedKey = this.heatmapItems[0]?.key ?? null;
      this.$nextTick(() => this.renderHeatmap());
    },

    setHeatmapFilter(key, val) {
      this.heatmap[key] = val;
      this.heatPopout = null;
      this.$nextTick(() => this.renderHeatmap());
    },

    onHeatmapImgLoad() {
      this.$nextTick(() => this.renderHeatmap());
    },

    // Custom canvas renderer — no external heatmap library.
    // Dots (default): one mark per click, blue = on-path, red = mis-click,
    // ring = that participant's FIRST click on this map (first-click testing).
    // Density: alpha-accumulated blur colorized blue→green→amber→red.
    renderHeatmap() {
      const wrap = document.getElementById('heatmapCanvasWrap');
      const img  = document.getElementById('heatmapImg');
      const it   = this.heatmapSelected;
      if (!wrap || !img || !it) return;
      const dw = img.clientWidth, dh = img.clientHeight;
      if (!dw || !dh) return;   // not laid out yet — img @load re-invokes

      let canvas = wrap.querySelector('canvas');
      if (!canvas) { canvas = document.createElement('canvas'); wrap.appendChild(canvas); }
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(dw * dpr);
      canvas.height = Math.round(dh * dpr);
      canvas.style.width = dw + 'px';
      canvas.style.height = dh + 'px';
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, dw, dh);

      // Clicks are in the participant's viewport space; the screenshot was
      // captured at the recorder's viewport. Scale via capture dimensions.
      const sx = it.vw > 0 ? dw / it.vw : 1;
      const sy = it.vh > 0 ? dh / it.vh : 1;
      const clicks = this.heatmapClicks;

      if (this.heatmap.view === 'density') {
        const off = document.createElement('canvas');
        off.width = dw; off.height = dh;
        const octx = off.getContext('2d');
        const r = Number(this.heatmap.radius) || 26;
        clicks.forEach((c) => {
          const x = (c.viewport_x || 0) * sx, y = (c.viewport_y || 0) * sy;
          const g = octx.createRadialGradient(x, y, 0, x, y, r);
          g.addColorStop(0, 'rgba(0,0,0,0.4)');
          g.addColorStop(1, 'rgba(0,0,0,0)');
          octx.fillStyle = g;
          octx.fillRect(x - r, y - r, r * 2, r * 2);
        });
        const idata = octx.getImageData(0, 0, dw, dh);
        const px = idata.data;
        for (let i = 0; i < px.length; i += 4) {
          const a = px[i + 3] / 255;
          if (a <= 0.03) { px[i + 3] = 0; continue; }
          const t = Math.min(1, a * 1.5);
          let r2, g2, b2;
          if (t < 0.35)      { r2 = 37;  g2 = 99;  b2 = 235; }
          else if (t < 0.65) { r2 = 16;  g2 = 185; b2 = 129; }
          else if (t < 0.85) { r2 = 245; g2 = 158; b2 = 11;  }
          else               { r2 = 239; g2 = 68;  b2 = 68;  }
          px[i] = r2; px[i + 1] = g2; px[i + 2] = b2;
          px[i + 3] = Math.round(Math.min(0.72, 0.18 + t * 0.55) * 255);
        }
        octx.putImageData(idata, 0, 0);
        ctx.drawImage(off, 0, 0, dw, dh);
        return;
      }

      // Dot mode
      const seen = new Set();
      clicks.forEach((c) => {
        const x = (c.viewport_x || 0) * sx, y = (c.viewport_y || 0) * sy;
        const mis = !!c.is_mis_click;
        const first = !seen.has(c.session_id);
        seen.add(c.session_id);
        ctx.beginPath();
        ctx.arc(x, y, 7, 0, Math.PI * 2);
        ctx.fillStyle = mis ? 'rgba(239,68,68,.8)' : 'rgba(37,99,235,.8)';
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = 'rgba(255,255,255,.95)';
        ctx.stroke();
        if (first) {
          ctx.beginPath();
          ctx.arc(x, y, 12, 0, Math.PI * 2);
          ctx.lineWidth = 2;
          ctx.strokeStyle = mis ? 'rgba(239,68,68,.9)' : 'rgba(37,99,235,.9)';
          ctx.stroke();
        }
      });
    },

    // Click a dot → forensic card: what was clicked, by whom, when.
    heatmapCanvasClick(e) {
      const img = document.getElementById('heatmapImg');
      const it = this.heatmapSelected;
      if (!img || !it) return;
      const rect = img.getBoundingClientRect();
      const dx = e.clientX - rect.left, dy = e.clientY - rect.top;
      const sx = it.vw > 0 ? rect.width / it.vw : 1;
      const sy = it.vh > 0 ? rect.height / it.vh : 1;
      let best = null, bestDist = 14 * 14;
      this.heatmapClicks.forEach((c) => {
        const x = (c.viewport_x || 0) * sx, y = (c.viewport_y || 0) * sy;
        const d2 = (x - dx) * (x - dx) + (y - dy) * (y - dy);
        if (d2 < bestDist) { best = c; bestDist = d2; }
      });
      if (!best) { this.heatPopout = null; return; }
      this.heatPopout = {
        title: best.is_mis_click ? 'Mis-click' : (best.is_on_path ? 'On-path click' : 'Click'),
        rows: [
          ['Clicked', best.element_text || '(no visible text)'],
          ['Selector', best.element_selector || '—'],
          ['Element', best.element_tag ? `<${String(best.element_tag).toLowerCase()}>` : '—'],
          ['Participant', this.heatmap.labels[best.session_id] || best.session_id.slice(0, 6)],
          ['When', this.fmtMs(best.ms_since_session_start)],
        ],
      };
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

    // Goal mode mirrors the participant runtime: any task with a usable goal.
    _studyGoalMode() {
      return (this.study?.tasks || []).some((t) => {
        const g = t?.goal;
        if (!g) return false;
        return (g.type === 'screen' && g.screenId) ||
               (g.type === 'click' && (g.selector || g.elementText));
      });
    },

    // Partial completion: a goal-mode participant who confirmed "Finish study"
    // on the end screen with task goals still unmet. Recorded as
    // completed_via='end_screen' with completed_tasks left honest — in goal
    // mode that combination can only come from the partial-finish prompt.
    // (Strict-mode end_screen completions are indirect FULL successes and
    // never match: _studyGoalMode() is false for them.)
    sessionPartial(s) {
      if (!s || s.status !== 'completed' || s.completed_via !== 'end_screen') return false;
      const nTasks = (this.study?.tasks || []).length;
      return nTasks > 0 && this._studyGoalMode() && (s.completed_tasks ?? 0) < nTasks;
    },

    // Drawer label: the base completed_via label, expanded for partials.
    completedViaLabelFor(s) {
      if (this.sessionPartial(s)) {
        const nTasks = (this.study?.tasks || []).length;
        return `Reached the end with ${s.completed_tasks ?? 0} of ${nTasks} tasks completed (partial)`;
      }
      return this.completedViaLabel(s?.completed_via);
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

      // Mid-study survey responses live on the session row (not the event
      // stream), so fold them into the branch lane by time: each one hangs off
      // the recorded step the participant had most recently matched when they
      // answered. Sorted by time so they interleave with deviations in order.
      const surveyDefs = {};
      (this.study?.surveys || []).forEach((sv) => { if (sv && sv.id) surveyDefs[sv.id] = sv; });
      const surveyMarkers = (Array.isArray(s.survey_responses) ? s.survey_responses : [])
        .map((r) => ({
          kind:     'survey',
          ms:       r.msSinceSessionStart ?? null,
          screenId: this._normScreen(r.screenId),
          response: r,
          def:      surveyDefs[r.surveyId] || null,
          trigger:  r.trigger || surveyDefs[r.surveyId]?.trigger || null,
        }))
        .sort((a, b) => (a.ms ?? 0) - (b.ms ?? 0));
      let svIdx = 0;
      const flushSurveys = (uptoMs) => {
        while (svIdx < surveyMarkers.length && (surveyMarkers[svIdx].ms ?? 0) <= uptoMs) {
          const mk = surveyMarkers[svIdx++];
          mk.afterStation = pos;
          devAfter[pos].push(mk);
        }
      };

      for (const e of evs) {
        flushSurveys(e.ms_since_session_start ?? 0);
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
      flushSurveys(Infinity);   // any responses after the last event → final position

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

      // Outcome — partial completions (goal mode, finished early on the end
      // screen with tasks unmet) are their own level, per levels-of-success
      // practice: never lumped in with full successes.
      let outcome;
      if (this.sessionPartial(s)) {
        outcome = { kind: 'partial', label: this.completedViaLabelFor(s) };
      } else if (s.status === 'completed') {
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
      } else if (outcome.kind === 'partial') {
        // Partial completions DO reach the end station, but the ride must not
        // read as a full success — an explicit amber terminal closes it out.
        slots.push({ type: 'terminal', outcome, si: stations.length - 1 });
      }

      // End-of-study feedback (the completion-screen rating/comment) closes the
      // journey — a clickable marker after the terminal, shown when answered.
      const fb = s.feedback;
      if (fb && (fb.rating != null || (fb.comment && String(fb.comment).trim()))) {
        slots.push({ type: 'endfb', feedback: fb, si: stations.length - 1 });
      }

      const devCount = devAfter.reduce((n, l) =>
        n + l.filter((d) => d.kind !== 'survey').length, 0);
      const surveyCount = surveyMarkers.length;
      const reachedSteps = stations.filter((st) => st.kind === 'step' && st.reached).length;
      const parts = [outcome.label];
      if (s.duration_ms != null) parts.push(this.fmtDuration(s.duration_ms));
      parts.push(`${reachedSteps}/${path.length} recorded steps matched`);
      parts.push(devCount === 0 ? 'no off-path points' :
        `${devCount} off-path point${devCount !== 1 ? 's' : ''}`);
      if (surveyCount > 0) {
        parts.push(`${surveyCount} survey response${surveyCount !== 1 ? 's' : ''}`);
      }

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
      // Survey markers and the end-feedback marker are annotations, not ride
      // points — they never join the participant line.
      const pts = [];
      J.slots.forEach((sl, i) => {
        if (sl.type === 'station' && sl.station.reached) pts.push({ a: A(i), lane: mainL, si: i });
        else if (sl.type === 'terminal') pts.push({ a: A(i), lane: devL, si: i });
        else if (sl.type === 'dev' && sl.dev.kind !== 'survey') pts.push({ a: A(i), lane: devL, si: i });
      });
      if (pts.length > 1) {
        const m0 = P(pts[0].a, pts[0].lane);
        let d = `M ${m0.x} ${m0.y}`;
        for (let i = 1; i < pts.length; i++) {
          const a = pts[i - 1], b = pts[i];
          const B = P(b.a, b.lane);
          // Dip through the branch lane only when a genuinely skipped (hollow,
          // unreached) station sits between the two points — NOT merely because
          // they're far apart. Survey/feedback slots widen the raw gap without
          // implying a skip, so measure by structure, not pixel distance.
          const hollowBetween = J.slots
            .slice(a.si + 1, b.si)
            .some((s) => s.type === 'station' && !s.station.reached);
          if (a.lane === b.lane && a.lane === mainL && hollowBetween) {
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
          if (sl.dev.kind === 'survey') {
            out.push(`<circle data-node="${i}" cx="${c.x}" cy="${c.y}" r="9" class="jy-survey${selCls}"/>`);
            out.push(`<text x="${c.x}" y="${c.y + 3}" class="jy-survey-glyph" text-anchor="middle">★</text>`);
            out.push(vert
              ? `<text x="${devL + 16}" y="${a + 4}" class="jy-screen" text-anchor="start">survey</text>`
              : `<text x="${c.x}" y="${devL + 22}" class="jy-screen" text-anchor="middle">survey</text>`);
          } else {
            out.push(`<circle data-node="${i}" cx="${c.x}" cy="${c.y}" r="7" class="jy-dev ${sl.dev.kind}${selCls}"/>`);
            if (sl.dev.kind === 'screen') {
              const scr = esc(this._shortScreen(sl.dev.screenId));
              out.push(vert
                ? `<text x="${devL + 14}" y="${a + 4}" class="jy-screen" text-anchor="start">${scr}</text>`
                : `<text x="${c.x}" y="${devL + 22}" class="jy-screen" text-anchor="middle">${scr}</text>`);
            }
          }
        } else if (sl.type === 'endfb') {
          const c = P(a, devL);
          out.push(`<circle data-node="${i}" cx="${c.x}" cy="${c.y}" r="10" class="jy-survey end${selCls}"/>`);
          out.push(`<text x="${c.x}" y="${c.y + 3}" class="jy-survey-glyph" text-anchor="middle">★</text>`);
          out.push(vert
            ? `<text x="${devL + 16}" y="${a + 4}" class="jy-screen" text-anchor="start">feedback</text>`
            : `<text x="${c.x}" y="${devL + 26}" class="jy-screen" text-anchor="middle">feedback</text>`);
        } else {
          const k = sl.outcome.kind;
          const cls = k === 'dropped' ? 'drop' : (k === 'in_progress' ? 'progress' : (k === 'partial' ? 'partial' : 'done'));
          const c = P(a, devL);
          out.push(`<circle data-node="${i}" cx="${c.x}" cy="${c.y}" r="10" class="jy-terminal ${cls}${selCls}"/>`);
          const glyph = k === 'dropped' ? '✕' : (k === 'in_progress' ? '…' : '✓');
          out.push(`<text x="${c.x}" y="${c.y + 4}" class="jy-term-glyph" text-anchor="middle">${glyph}</text>`);
          const lbl = k === 'dropped' ? 'dropped' : (k === 'in_progress' ? 'in progress' : (k === 'partial' ? 'partial' : 'completed'));
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

    toggleFlowVert() {
      this.flowVert = !this.flowVert;
      try { localStorage.setItem('uxt_dash_flow_vert', this.flowVert ? '1' : '0'); } catch {}
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
          // Survey / end-feedback markers are annotations, not off-path
          // deviations — they must not fold into the aggregate deviation
          // clusters (they'd otherwise render and read as off-route navigation).
          if (sl.type === 'dev' && sl.dev.kind !== 'survey') {
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
          } else if (sl.type === 'dev' && sl.dev.kind !== 'survey') {
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
      const vert = this.flowVert;
      const SP = vert ? 66 : 92;
      const M  = vert ? 48 : 70;
      const mainL = vert ? 200 : 64;    // cross offset of the printed line
      const devL  = vert ? 268 : 138;   // cross offset of the branch lane
      const A = (i) => M + i * SP;
      const P = (a, l) => (vert ? { x: l, y: a } : { x: a, y: l });
      const span = M * 2 + (F.slots.length - 1) * SP;
      const W = vert ? 440 : span;
      const H = vert ? span : 196;
      const sel = this.flowPopout?.nodeId;
      const esc = (v) => this._escXml(v);
      const out = [];

      const stationSlots = F.slots.map((sl, i) => (sl.type === 'station' ? i : null)).filter((v) => v !== null);
      if (stationSlots.length > 1) {
        const p1 = P(A(stationSlots[0]), mainL);
        const p2 = P(A(stationSlots[stationSlots.length - 1]), mainL);
        out.push(`<line x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}" class="jy-main"/>`);
      }

      // Rides (behind nodes). Straight main-line segments dip through the
      // branch lane only when they skip an intermediate STATION slot. The
      // per-participant jitter shifts the cross-lane offset, so overlapping
      // rides stay distinguishable in either orientation.
      F.rides.forEach((ride, ri) => {
        if (ride.pts.length < 2) return;
        const jitter = ((ri % 5) - 2) * 2.4;
        const laneOf = (p) => (p.lane === 'main' ? mainL + jitter : devL);
        const m0 = P(A(ride.pts[0].slot), laneOf(ride.pts[0]));
        let d = `M ${m0.x} ${m0.y}`;
        for (let i = 1; i < ride.pts.length; i++) {
          const a = ride.pts[i - 1], b = ride.pts[i];
          const aa = A(a.slot), ba = A(b.slot);
          const al = laneOf(a), bl = laneOf(b);
          const B = P(ba, bl);
          const skipsStation = a.lane === 'main' && b.lane === 'main' &&
            F.slots.some((sl, si) => sl.type === 'station' &&
              si > Math.min(a.slot, b.slot) && si < Math.max(a.slot, b.slot));
          if (skipsStation) {
            const c1 = P(aa + 40, devL), c2 = P(ba - 40, devL);
            d += ` C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${B.x} ${B.y}`;
          } else if (al === bl) {
            d += ` L ${B.x} ${B.y}`;
          } else {
            const mid = (aa + ba) / 2;
            const c1 = P(mid, al), c2 = P(mid, bl);
            d += ` C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${B.x} ${B.y}`;
          }
        }
        out.push(`<path d="${d}" class="jy-ride" style="stroke:${ride.color}"/>`);
      });

      // Nodes + labels
      F.slots.forEach((sl, i) => {
        const a = A(i);
        const selCls = sel === i ? ' selected' : '';
        if (sl.type === 'station') {
          const st = sl.station;
          const n = st.reachedBy.length;
          const c = P(a, mainL);
          out.push(`<circle data-node="${i}" cx="${c.x}" cy="${c.y}" r="11" class="jy-station ${st.kind}${n > 0 ? ' reached' : ''}${selCls}"/>`);
          if (st.kind === 'step') {
            out.push(`<text x="${c.x}" y="${c.y + 4}" class="jy-num" text-anchor="middle">${st.label}</text>`);
          } else {
            const cap = st.kind === 'start' ? 'START' : '🏁 END';
            out.push(vert
              ? `<text x="${mainL - 20}" y="${a - 4}" class="jy-cap" text-anchor="end">${cap}</text>`
              : `<text x="${c.x}" y="${mainL - 20}" class="jy-cap" text-anchor="middle">${cap}</text>`);
          }
          const frac = `${n}/${F.total}`;
          out.push(vert
            ? `<text x="${mainL - 20}" y="${a + (st.kind === 'step' ? 4 : 12)}" class="jy-screen" text-anchor="end">${frac}</text>`
            : `<text x="${c.x}" y="${mainL + 32}" class="jy-screen" text-anchor="middle">${frac}</text>`);
        } else if (sl.type === 'cluster') {
          const c = sl.cluster;
          const r = Math.min(13, 6.5 + c.hits.length * 1.4);
          const p = P(a, devL);
          out.push(`<circle data-node="${i}" cx="${p.x}" cy="${p.y}" r="${r}" class="jy-dev ${c.kind}${selCls}"/>`);
          if (c.hits.length > 1) {
            out.push(`<text x="${p.x}" y="${p.y + 3.5}" class="jy-cl-count" text-anchor="middle">${c.hits.length}</text>`);
          }
          if (vert) {
            const lbl = c.kind === 'click' ? (c.text || c.selector || '') : c.screenId;
            out.push(`<text x="${devL + 18}" y="${a + 4}" class="jy-screen" text-anchor="start">${esc(this._shortScreen(lbl))}</text>`);
          }
        } else {
          const t = sl.term;
          const k = t.outcome.kind;
          const cls = k === 'dropped' ? 'drop' : (k === 'in_progress' ? 'progress' : (k === 'partial' ? 'partial' : 'done'));
          const p = P(a, devL);
          out.push(`<circle data-node="${i}" cx="${p.x}" cy="${p.y}" r="10" class="jy-terminal ${cls}${selCls}"/>`);
          const glyph = k === 'dropped' ? '✕' : (k === 'in_progress' ? '…' : '✓');
          out.push(`<text x="${p.x}" y="${p.y + 4}" class="jy-term-glyph" text-anchor="middle">${glyph}${t.hits.length > 1 ? '×' + t.hits.length : ''}</text>`);
          if (vert) {
            const lbl = k === 'dropped' ? 'dropped' : (k === 'in_progress' ? 'in progress' : (k === 'partial' ? 'partial' : 'completed'));
            out.push(`<text x="${devL + 18}" y="${a + 4}" class="jy-screen" text-anchor="start">${lbl}</text>`);
          }
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

    // ── Survey / feedback helpers ────────────────────────────────────────────

    // Star string for a rating, e.g. 4 → "★★★★☆". stars() has no numeric
    // suffix (for compact UI); _stars() appends "(n/5)" for the detail popout.
    stars(n) {
      const v = Math.max(0, Math.min(5, Math.round(Number(n) || 0)));
      return '★★★★★'.slice(0, v) + '☆☆☆☆☆'.slice(0, 5 - v);
    },
    _stars(n) {
      const v = Math.max(0, Math.min(5, Math.round(Number(n) || 0)));
      return `${this.stars(n)}  ${v}/5`;
    },

    // Human-readable description of what triggered a survey.
    _surveyTriggerLabel(trigger, response) {
      const t = trigger || {};
      if (t.type === 'after_task') {
        const tasks = this.study?.tasks || [];
        const k = tasks.findIndex((x) => x && x.id === t.taskId);
        const task = k >= 0 ? tasks[k] : null;
        const num = k >= 0 ? k + 1 : ((response?.taskIndex ?? -1) + 1 || null);
        const promptTxt = task ? ` — “${String(task.prompt || '').slice(0, 40)}”` : '';
        return num ? `After task ${num}${promptTxt}` : 'After a task';
      }
      if (t.type === 'screen_enter')  return `On reaching ${this._shortScreen(t.screenId)}`;
      if (t.type === 'element_click') return `After clicking “${String(t.elementText || t.selector || 'an element').slice(0, 36)}”`;
      return 'Survey';
    },

    // Detail popout for a mid-study survey response marker.
    _surveyDetail(idx, d) {
      const r    = d.response || {};
      const def  = d.def || {};
      const rows = [];
      if (d.ms != null) rows.push(['When', this.fmtMs(d.ms)]);
      rows.push(['Trigger', this._surveyTriggerLabel(d.trigger, r)]);
      if (r.skipped) {
        rows.push(['Response', 'Skipped by participant']);
      } else {
        if (r.rating != null) {
          rows.push([(def.rating?.prompt || '').trim() || 'Rating', this._stars(r.rating)]);
        }
        const comment = (r.comment || '').trim();
        if (comment) {
          rows.push([(def.comment?.prompt || '').trim() || 'Comment', `“${comment}”`]);
        }
        if (r.rating == null && !comment) rows.push(['Response', '(no answer given)']);
      }
      return { nodeId: idx, title: '★ Survey response', shot: null, rows };
    },

    // Detail popout for the end-of-study feedback marker.
    _endFeedbackDetail(idx, fb) {
      const comp = this.study?.completion || {};
      const rows = [];
      if (fb.submittedAt) rows.push(['Submitted', this.fmtDateTime(fb.submittedAt)]);
      if (fb.rating != null) {
        rows.push([(comp.rating?.prompt || '').trim() || 'How would you rate your experience?', this._stars(fb.rating)]);
      }
      const comment = (fb.comment || '').trim();
      if (comment) {
        rows.push([(comp.comment?.prompt || '').trim() || "Anything else you'd like to share?", `“${comment}”`]);
      }
      return { nodeId: idx, title: '★ End-of-study feedback', shot: null, rows };
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
      if (sl.type === 'endfb') return this._endFeedbackDetail(idx, sl.feedback);
      if (sl.type === 'dev') {
        const d = sl.dev;
        if (d.kind === 'survey') return this._surveyDetail(idx, d);
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
      const rows = [
        ['Status', s?.status ?? '—'],
        ['Duration', this.fmtDuration(s?.duration_ms)],
        ['Steps matched', `${s?.completed_steps ?? 0} / ${s?.total_steps ?? '—'}`],
      ];
      if (this.sessionPartial(s)) {
        const tasks = this.study?.tasks || [];
        rows.push(['Tasks completed', `${s.completed_tasks ?? 0} / ${tasks.length}`]);
        const sorted = [...tasks].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        const skipped = sorted.slice(s.completed_tasks ?? 0)
          .map((t) => String(t.prompt || '').slice(0, 40)).filter(Boolean);
        if (skipped.length) rows.push(['Skipped', skipped.join(' · ')]);
      }
      return {
        nodeId: idx,
        title: sl.outcome.label,
        shot: null,
        rows,
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
        label = sl.dev.kind === 'survey'
          ? `★ survey response · ${this.fmtMs(sl.dev.ms)}`
          : (sl.dev.kind === 'click'
              ? `⚠ clicked “${(sl.dev.text || sl.dev.selector || '?').slice(0, 40)}” · ${this.fmtMs(sl.dev.ms)}`
              : `⚠ went to ${sl.dev.screenId} · ${this.fmtMs(sl.dev.ms)}`);
      } else if (sl.type === 'endfb') {
        label = '★ end-of-study feedback';
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
