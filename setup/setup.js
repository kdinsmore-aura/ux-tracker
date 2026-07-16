/* UX Tracker — Researcher Setup Tool
   Alpine.js v3 component. Depends on window.supabase (UMD build loaded before this file). */

function setupApp() {
  return {

    // ── Navigation ────────────────────────────────────────────────────────────
    currentStep: 0,
    _maxStep: 0,   // highest step reached for the current study
    studyId: null,
    study: null,
    _savedStep: null,

    // ── Step 0 — Credentials ──────────────────────────────────────────────────
    creds: { url: '', key: '', email: '', password: '' },
    credError: '',
    credSuccess: '',
    credTesting: false,
    credSaving: false,

    // ── Step 1 — Studies list ──────────────────────────────────────────────────
    studies: [],
    pStats: {},          // studyId → { total, completed }
    studiesLoading: false,
    studiesError: '',
    deleteTarget: null,  // studyId awaiting confirm

    // ── Step 2 — Create / edit study ──────────────────────────────────────────
    editMode: false,
    newStudy: { name: '', description: '', tasks: [], surveys: [], completion: { thankYou: '', rating: { enabled: false, prompt: '' }, comment: { enabled: false, prompt: '' }, required: false } },
    surveyCounter: 1,
    screenOptions: [],   // recorded screen ids, suggested in the goal picker
    taskCounter: 1,
    createError: '',
    createSaving: false,

    // ── Step 3 — Record ideal path ────────────────────────────────────────────
    protoUrl: '',
    recordWaiting: false,
    recordError: '',
    _poll: null,

    // ── Step 4 — Review path ──────────────────────────────────────────────────
    idealPath: [],
    pathScreens: {},     // screen_id → screenshot_url
    pathLoading: false,
    pathError: '',
    previewIndex: null,  // index into previewItems for the screenshot modal (null = closed)

    // ── Step 5 — Generate links ───────────────────────────────────────────────
    linkCount: 5,
    protoBaseUrl: '',
    participantLabels: '',
    generatedLinks: [],
    existingLinks: [],       // all participants already created for this study
    existingLoading: false,
    copiedExistingId: null,
    linksGenerating: false,
    linksError: '',
    copiedSnippetMinimal: false,
    copiedSnippetFull: false,
    copiedUrls: false,
    copiedLinkId: null,

    // ── Supabase client ───────────────────────────────────────────────────────
    _db: null,
    githubUser: '',


    // ── Init (called automatically by Alpine) ─────────────────────────────────

    async init() {
      const h = window.location.hostname;
      if (h.endsWith('.github.io')) {
        this.githubUser = h.slice(0, -'.github.io'.length);
      }

      const raw = sessionStorage.getItem('uxt_setup_state');
      if (raw) {
        try {
          const s = JSON.parse(raw);
          if (s.studyId)  this.studyId  = s.studyId;
          if (s.step)     this._savedStep = s.step;
          if (s.maxStep)  this._maxStep = s.maxStep;
        } catch {}
      }

      const stored = localStorage.getItem('uxt_researcher_config');
      if (stored) {
        try {
          const { url, key } = JSON.parse(stored);
          if (url && key) {
            this.creds = { url, key, email: '', password: '' };
            this._initDb(url, key);
            // Only proceed if a researcher session is still active —
            // otherwise fall through to the gate to sign in again.
            const { data: { session } } = await this._db.auth.getSession();
            if (session) {
              await this._goto(this._savedStep || 1);
              return;
            }
            this.credError = 'Session expired — sign in again to continue.';
          }
        } catch {}
      }

      this.currentStep = 0;
    },


    // ── Supabase ──────────────────────────────────────────────────────────────

    _initDb(url, key) {
      this._db = window.supabase.createClient(url.trim(), key.trim());
    },


    // ── Step 0 — Credentials ──────────────────────────────────────────────────

    // Reuse an active researcher session if one exists; otherwise sign in
    // with the provided email + password. The password is never persisted —
    // supabase-js stores only the resulting session token.
    async _signIn() {
      const { data: { session } } = await this._db.auth.getSession();
      if (session) return;
      const email = this.creds.email.trim();
      const password = this.creds.password;
      if (!email || !password) {
        throw new Error('Researcher sign-in required — enter your email and password.');
      }
      const { error } = await this._db.auth.signInWithPassword({ email, password });
      if (error) throw new Error(`Sign-in failed: ${error.message}`);
    },

    async testConnection() {
      this.credError = '';
      this.credSuccess = '';
      if (!this._checkCreds()) return;
      this.credTesting = true;
      try {
        this._initDb(this.creds.url, this.creds.key);
        await this._signIn();
        const { data, error } = await this._db.from('studies').select('id').limit(1);
        if (error) throw error;
        this.credSuccess = `Connected — ${(data || []).length} study record(s) visible.`;
      } catch (e) {
        this.credError = `Connection failed: ${e.message}`;
        this._db = null;
      } finally {
        this.credTesting = false;
      }
    },

    async saveCredentials() {
      this.credError = '';
      this.credSuccess = '';
      if (!this._checkCreds()) return;
      this.credSaving = true;
      try {
        this._initDb(this.creds.url, this.creds.key);
        await this._signIn();
        const { error } = await this._db.from('studies').select('id').limit(1);
        if (error) throw error;
        localStorage.setItem('uxt_researcher_config', JSON.stringify({
          url: this.creds.url.trim(),
          key: this.creds.key.trim(),
        }));
        this.creds.password = '';
        await this._goto(1);
      } catch (e) {
        this.credError = `Could not connect: ${e.message}`;
        this._db = null;
      } finally {
        this.credSaving = false;
      }
    },

    clearCredentials() {
      try { this._db?.auth.signOut(); } catch {}
      localStorage.removeItem('uxt_researcher_config');
      sessionStorage.removeItem('uxt_setup_state');
      this._db = null;
      this.studies = [];
      this.studyId = null;
      this.study = null;
      this._maxStep = 0;
      this.currentStep = 0;
    },

    _checkCreds() {
      const url = this.creds.url.trim();
      const key = this.creds.key.trim();
      if (!url)                         { this.credError = 'Project URL is required.';       return false; }
      if (!url.startsWith('https://'))  { this.credError = 'URL must start with https://.';  return false; }
      if (!key)                         { this.credError = 'Anon key is required.';           return false; }
      return true;
    },


    // ── Navigation ────────────────────────────────────────────────────────────

    async _goto(step) {
      if (this._poll) { clearInterval(this._poll); this._poll = null; }
      if (step > this._maxStep) this._maxStep = step;
      this.currentStep = step;
      sessionStorage.setItem('uxt_setup_state', JSON.stringify({
        step: this.currentStep,
        maxStep: this._maxStep,
        studyId: this.studyId,
      }));
      if (step === 1) await this._loadStudies();
      if (step === 4) await this._loadPath();
      if (step === 5) {
        // Restore the base URL last used for this study so existing links
        // render as full, resendable URLs.
        if (!this.protoBaseUrl.trim() && this.studyId) {
          this.protoBaseUrl = localStorage.getItem(`uxt_proto_base_${this.studyId}`) || '';
        }
        await this._loadExistingLinks();
      }
    },

    stepClass(n) {
      if (n === this.currentStep) return 'is-active';
      if (n <= this._maxStep)     return 'is-done is-clickable';
      return '';
    },

    stepNumDisplay(n) {
      return n < this.currentStep ? '✓' : n;
    },

    canNav(n) {
      return n <= this._maxStep && n !== this.currentStep && n >= 2;
    },


    // ── Step 1 — Studies list ──────────────────────────────────────────────────

    async _loadStudies() {
      this.studiesLoading = true;
      this.studiesError = '';
      try {
        const [sr, pr] = await Promise.all([
          this._db.from('studies').select('*').order('created_at', { ascending: false }),
          this._db.from('participants').select('study_id, status'),
        ]);
        if (sr.error) throw sr.error;
        if (pr.error) throw pr.error;

        this.studies = sr.data || [];

        const stats = {};
        for (const p of pr.data || []) {
          if (!stats[p.study_id]) stats[p.study_id] = { total: 0, completed: 0 };
          stats[p.study_id].total++;
          if (p.status === 'completed') stats[p.study_id].completed++;
        }
        this.pStats = stats;
      } catch (e) {
        this.studiesError = e.message;
      } finally {
        this.studiesLoading = false;
      }
    },

    pCount(id)  { return this.pStats[id]?.total ?? 0; },
    pRate(id)   {
      const s = this.pStats[id];
      if (!s || s.total === 0) return '—';
      return Math.round((s.completed / s.total) * 100) + '%';
    },

    fmtDate(iso) {
      if (!iso) return '—';
      return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    },

    openDashboardFor(id) {
      const creds = btoa(JSON.stringify({ u: this.creds.url.trim(), k: this.creds.key.trim() }));
      window.location.href = `../dashboard/index.html?study=${encodeURIComponent(id)}#c=${creds}`;
    },

    editStudy(study) {
      this.editMode = true;
      this.studyId = study.id;
      this.study = study;
      const tasks = Array.isArray(study.tasks) ? study.tasks : [];
      this.newStudy = {
        name: study.name || '',
        description: study.description || '',
        tasks: tasks.map((t, i) => {
          const g = (typeof t === 'object' && t?.goal) || null;
          return {
            id: i + 1,
            prompt: typeof t === 'string' ? t : (t.prompt || ''),
            goalType: (g?.type === 'screen' || g?.type === 'click') ? g.type : 'none',
            goalScreenId: g?.type === 'screen' ? (g.screenId || '') : '',
            goalSelector: g?.type === 'click' ? (g.selector || '') : '',
            goalText: g?.type === 'click' ? (g.elementText || '') : '',
          };
        }),
        surveys: (Array.isArray(study.surveys) ? study.surveys : []).map((s, i) => ({
          id: i + 1,
          afterTaskId: s.trigger?.taskId ?? null,
          ratingEnabled: !!s.rating?.enabled,
          ratingPrompt: s.rating?.prompt || '',
          commentEnabled: !!s.comment?.enabled,
          commentPrompt: s.comment?.prompt || '',
          required: !!s.required,
          presentation: s.presentation === 'overlay' ? 'overlay' : 'panel',
        })),
        completion: this._normalizeCompletion(study.completion),
      };
      this.taskCounter = this.newStudy.tasks.length + 1;
      this.surveyCounter = this.newStudy.surveys.length + 1;
      this._loadScreenOptions();
      if (this.newStudy.tasks.length === 0) this._addTask();
      this.createError = '';
      // Unlock steps already completed for this study
      this._maxStep = (study.ideal_path?.length > 0) ? 5 : 2;
      this._goto(2);
    },

    generateMoreFor(study) {
      this.studyId = study.id;
      this.study = study;
      this.protoBaseUrl = '';
      this.generatedLinks = [];
      this.linkCount = 5;
      this.participantLabels = '';
      this.linksError = '';
      this._goto(5);
    },

    promptDelete(id) { this.deleteTarget = id; },
    cancelDelete()   { this.deleteTarget = null; },

    async confirmDelete() {
      const id = this.deleteTarget;
      this.deleteTarget = null;
      if (!id) return;
      const { error } = await this._db.from('studies').delete().eq('id', id);
      if (error) { this.studiesError = `Delete failed: ${error.message}`; return; }
      await this._loadStudies();
    },


    // ── Step 2 — Create / edit study ──────────────────────────────────────────

    startCreate() {
      this.editMode = false;
      this.studyId = null;
      this.study = null;
      this.newStudy = { name: '', description: '', tasks: [], surveys: [], completion: this._normalizeCompletion(null) };
      this.taskCounter = 1;
      this.surveyCounter = 1;
      this.screenOptions = [];
      this.createError = '';
      this._maxStep = 2;
      this._addTask();
      this._goto(2);
    },

    _addTask() {
      this.newStudy.tasks.push({
        id: this.taskCounter++, prompt: '',
        goalType: 'none', goalScreenId: '', goalSelector: '', goalText: '',
      });
    },

    addTask() { this._addTask(); },

    removeTask(id) {
      this.newStudy.tasks = this.newStudy.tasks.filter(t => t.id !== id);
    },

    moveTaskUp(idx) {
      if (idx === 0) return;
      const t = this.newStudy.tasks;
      [t[idx - 1], t[idx]] = [t[idx], t[idx - 1]];
      this.newStudy.tasks = [...t];
    },

    moveTaskDown(idx) {
      const t = this.newStudy.tasks;
      if (idx >= t.length - 1) return;
      [t[idx], t[idx + 1]] = [t[idx + 1], t[idx]];
      this.newStudy.tasks = [...t];
    },

    addSurvey() {
      const firstTask = this.newStudy.tasks[0];
      this.newStudy.surveys.push({
        id: this.surveyCounter++,
        afterTaskId: firstTask ? firstTask.id : null,
        ratingEnabled: true,  ratingPrompt: '',
        commentEnabled: false, commentPrompt: '',
        required: false,
        presentation: 'panel',
      });
    },

    removeSurvey(id) {
      this.newStudy.surveys = this.newStudy.surveys.filter(s => s.id !== id);
    },

    // Recorded screen ids for this study — offered as suggestions in the
    // task-goal picker (datalist, so free text still works pre-recording).
    async _loadScreenOptions() {
      this.screenOptions = [];
      if (!this.studyId || !this._db) return;
      try {
        const { data } = await this._db
          .from('screens')
          .select('screen_id')
          .eq('study_id', this.studyId)
          .order('screen_id');
        this.screenOptions = (data || []).map(s => s.screen_id);
      } catch {}
    },

    // Fill in any missing completion-config fields with defaults (used when
    // loading an existing study or resetting the form).
    _normalizeCompletion(c) {
      c = c || {};
      const r = c.rating || {};
      const m = c.comment || {};
      return {
        thankYou: c.thankYou || '',
        rating:   { enabled: !!r.enabled, prompt: r.prompt || '' },
        comment:  { enabled: !!m.enabled, prompt: m.prompt || '' },
        required: !!c.required,
      };
    },

    // Trim and sanitise the completion config for persistence.
    _cleanCompletion(c) {
      const n = this._normalizeCompletion(c);
      return {
        thankYou: n.thankYou.trim(),
        rating:   { enabled: n.rating.enabled,  prompt: n.rating.prompt.trim() },
        comment:  { enabled: n.comment.enabled, prompt: n.comment.prompt.trim() },
        // "required" is meaningless with no field enabled.
        required: n.required && (n.rating.enabled || n.comment.enabled),
      };
    },

    async saveStudy() {
      this.createError = '';
      if (!this.newStudy.name.trim()) {
        this.createError = 'Study name is required.';
        return;
      }
      // Task ids are reassigned to 1..N on save; idMap lets surveys keep
      // referencing the right task after empty rows are filtered out.
      const editorTasks = this.newStudy.tasks.filter(t => t.prompt.trim());
      const idMap = {};
      const tasks = editorTasks.map((t, i) => {
        idMap[t.id] = i + 1;
        const row = { id: i + 1, prompt: t.prompt.trim(), order: i };
        if (t.goalType === 'screen' && t.goalScreenId.trim()) {
          row.goal = { type: 'screen', screenId: t.goalScreenId.trim().toLowerCase() };
        } else if (t.goalType === 'click' && (t.goalSelector.trim() || t.goalText.trim())) {
          row.goal = {
            type: 'click',
            selector:    t.goalSelector.trim() || null,
            elementText: t.goalText.trim() || null,
          };
        }
        return row;
      });
      if (tasks.length === 0) {
        this.createError = 'At least one task prompt is required.';
        return;
      }

      const surveys = [];
      for (const s of this.newStudy.surveys) {
        if (!s.ratingEnabled && !s.commentEnabled) {
          this.createError = 'Each survey needs a rating or comment field enabled (or remove the survey).';
          return;
        }
        const taskId = idMap[s.afterTaskId];
        if (!taskId) {
          this.createError = 'Each survey must be attached to one of the tasks above.';
          return;
        }
        surveys.push({
          id: surveys.length + 1,
          trigger: { type: 'after_task', taskId },
          rating:  { enabled: s.ratingEnabled,  prompt: s.ratingPrompt.trim() },
          comment: { enabled: s.commentEnabled, prompt: s.commentPrompt.trim() },
          required: !!s.required,
          presentation: s.presentation === 'overlay' ? 'overlay' : 'panel',
        });
      }

      this.createSaving = true;
      const payload = {
        name:        this.newStudy.name.trim(),
        description: this.newStudy.description.trim() || null,
        tasks,
        surveys,
        completion:  this._cleanCompletion(this.newStudy.completion),
      };

      try {
        if (this.editMode && this.studyId) {
          const { error } = await this._db
            .from('studies')
            .update({ ...payload, updated_at: new Date().toISOString() })
            .eq('id', this.studyId);
          if (error) throw error;
          this.study = { ...(this.study || {}), ...payload };
          // If no path has been recorded yet, continue setup; otherwise return to list
          if (this.study.ideal_path?.length > 0) {
            await this._goto(1);
          } else {
            await this._goto(3);
          }
        } else {
          const { data, error } = await this._db
            .from('studies')
            .insert({ ...payload, status: 'draft' })
            .select()
            .single();
          if (error) throw error;
          this.studyId = data.id;
          this.study   = data;
          sessionStorage.setItem('uxt_setup_state', JSON.stringify({ step: 3, studyId: data.id }));
          await this._goto(3);
        }
      } catch (e) {
        this.createError = `Save failed: ${e.message}`;
      } finally {
        this.createSaving = false;
      }
    },


    // ── Step 3 — Record ideal path ────────────────────────────────────────────

    startRecording() {
      this.recordError = '';
      const raw = this.protoUrl.trim();
      if (!raw) { this.recordError = 'Enter the prototype URL first.'; return; }

      let url;
      try {
        url = new URL(raw);
      } catch {
        this.recordError = 'Enter a valid URL (must include https://).';
        return;
      }

      url.searchParams.set('mode', 'record');
      url.searchParams.set('study', this.studyId);
      window.open(url.toString(), '_blank');

      this.recordWaiting = true;
      this._poll = setInterval(() => this._pollStatus(), 5000);
    },

    async _pollStatus() {
      try {
        const { data } = await this._db
          .from('studies').select('status').eq('id', this.studyId).single();
        if (data?.status === 'active') {
          clearInterval(this._poll);
          this._poll = null;
          this.recordWaiting = false;
          await this._goto(4);
        }
      } catch {}
    },

    cancelRecording() {
      if (this._poll) { clearInterval(this._poll); this._poll = null; }
      this.recordWaiting = false;
    },


    // ── Step 4 — Review path ──────────────────────────────────────────────────

    async _loadPath() {
      if (!this.studyId) return;
      this.pathLoading = true;
      this.pathError = '';
      try {
        const [sr, scr] = await Promise.all([
          this._db.from('studies').select('*').eq('id', this.studyId).single(),
          this._db.from('screens').select('screen_id, screenshot_url').eq('study_id', this.studyId),
        ]);
        if (sr.error) throw sr.error;

        this.study     = sr.data;
        this.idealPath = sr.data.ideal_path || [];

        const m = {};
        for (const s of scr.data || []) { m[s.screen_id] = s.screenshot_url; }
        this.pathScreens = m;
      } catch (e) {
        this.pathError = e.message;
      } finally {
        this.pathLoading = false;
      }
    },

    fmtMs(ms) {
      if (ms == null) return '—';
      return `~${(ms / 1000).toFixed(1)}s`;
    },

    // Resolve a step's screenshot: prefer the per-step capture, fall back to the
    // screen-level one (older recordings have no per-step screenshotUrl).
    stepShot(step) {
      return (step && step.screenshotUrl) || (step && this.pathScreens[step.screenId]) || null;
    },

    // The recorded steps plus an optional trailing "final screen" card.
    get previewItems() {
      const items = this.idealPath.map((s, i) => ({
        label: 'Step ' + (i + 1),
        screenId: s.screenId,
        selector: s.elementSelector,
        text: s.elementText,
        duration: s.expectedDuration,
        url: this.stepShot(s),
        isEnd: false,
      }));
      const last = this.idealPath[this.idealPath.length - 1];
      if (last && last.endScreenshotUrl) {
        items.push({
          label: 'Final screen',
          screenId: last.endScreenId || last.screenId,
          selector: null,
          text: null,
          duration: null,
          url: last.endScreenshotUrl,
          isEnd: true,
        });
      }
      return items;
    },

    get previewCurrent() {
      return this.previewIndex == null ? null : (this.previewItems[this.previewIndex] || null);
    },

    openPreview(i) { this.previewIndex = i; },
    closePreview() { this.previewIndex = null; },

    previewPrev() {
      if (this.previewIndex != null && this.previewIndex > 0) this.previewIndex -= 1;
    },

    previewNext() {
      if (this.previewIndex != null && this.previewIndex < this.previewItems.length - 1) {
        this.previewIndex += 1;
      }
    },


    // ── Step 5 — Generate links ───────────────────────────────────────────────

    // All participants already created for this study, so previously generated
    // links are visible (no accidental repeats; easy to re-send a reminder).
    async _loadExistingLinks() {
      if (!this.studyId) return;
      this.existingLoading = true;
      try {
        const { data, error } = await this._db
          .from('participants')
          .select('id, label, status, created_at')
          .eq('study_id', this.studyId)
          .order('created_at', { ascending: true });
        if (error) throw error;
        this.existingLinks = data || [];
      } catch (e) {
        this.linksError = `Failed to load existing links: ${e.message}`;
      } finally {
        this.existingLoading = false;
      }
    },

    participantUrl(id) {
      const base = this.protoBaseUrl.trim().split('?')[0];
      const qs = `?study=${encodeURIComponent(this.studyId)}&participant=${encodeURIComponent(id)}`;
      return base ? `${base}${qs}` : qs;
    },

    async copyExistingUrl(id) {
      await navigator.clipboard.writeText(this.participantUrl(id));
      this.copiedExistingId = id;
      setTimeout(() => { this.copiedExistingId = null; }, 1500);
    },

    async generateLinks() {
      this.linksError = '';
      const count = parseInt(this.linkCount, 10);
      if (!count || count < 1 || count > 100) {
        this.linksError = 'Enter a number between 1 and 100.';
        return;
      }
      const base = this.protoBaseUrl.trim();
      if (!base) {
        this.linksError = 'Prototype base URL is required.';
        return;
      }

      let labels = [];
      if (this.participantLabels.trim()) {
        labels = this.participantLabels.trim().split('\n').map(l => l.trim()).filter(Boolean);
        if (labels.length !== count) {
          this.linksError = `Label count (${labels.length}) does not match link count (${count}).`;
          return;
        }
      }

      this.linksGenerating = true;
      try {
        // Continue auto-numbering after existing participants so a second
        // batch doesn't repeat P01, P02, …
        const offset = this.existingLinks.length;
        const rows = Array.from({ length: count }, (_, i) => ({
          study_id:   this.studyId,
          label:      labels[i] || `P${String(offset + i + 1).padStart(2, '0')}`,
          status:     'invited',
          invited_at: new Date().toISOString(),
        }));

        const { data, error } = await this._db
          .from('participants')
          .insert(rows)
          .select('id, label, status');
        if (error) throw error;

        const cleanBase = base.split('?')[0];
        this.generatedLinks = data.map(p => ({
          id:     p.id,
          label:  p.label,
          status: p.status,
          url:    `${cleanBase}?study=${encodeURIComponent(this.studyId)}&participant=${encodeURIComponent(p.id)}`,
        }));
        try { localStorage.setItem(`uxt_proto_base_${this.studyId}`, base); } catch {}
        await this._loadExistingLinks();
      } catch (e) {
        this.linksError = `Failed to generate links: ${e.message}`;
      } finally {
        this.linksGenerating = false;
      }
    },

    downloadCSV() {
      const rows = [
        'Label,Invite URL,Status',
        ...this.generatedLinks.map(l => `${l.label},${l.url},${l.status}`),
      ].join('\n');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([rows], { type: 'text/csv' }));
      a.download = `participants-${(this.studyId || 'study').slice(0, 8)}.csv`;
      a.click();
    },

    async copyAllUrls() {
      await navigator.clipboard.writeText(this.generatedLinks.map(l => l.url).join('\n'));
      this.copiedUrls = true;
      setTimeout(() => { this.copiedUrls = false; }, 2000);
    },

    async copyLinkUrl(id, url) {
      await navigator.clipboard.writeText(url);
      this.copiedLinkId = id;
      setTimeout(() => { this.copiedLinkId = null; }, 1500);
    },

    _edgeFunctionUrl() {
      const rawUrl = (this.creds.url || '').trim();
      if (!rawUrl) return '{EDGE_FUNCTION_URL}';
      try {
        const ref = new URL(rawUrl).hostname.split('.')[0];
        return `https://${ref}.supabase.co/functions/v1/ux-tracker-ingest`;
      } catch {
        return '{EDGE_FUNCTION_URL}';
      }
    },

    get scriptSnippetMinimal() {
      const base = this.githubUser
        ? `https://${this.githubUser}.github.io/ux-tracker`
        : 'https://YOUR_USERNAME.github.io/ux-tracker';
      return [
        `<script`,
        `  src="${base}/v1/tracker.js"`,
        `  data-ingest-url="${this._edgeFunctionUrl()}">`,
        `<\/script>`,
      ].join('\n');
    },

    get scriptSnippetFull() {
      const studyId = this.studyId || 'STUDY_ID';
      const base = this.githubUser
        ? `https://${this.githubUser}.github.io/ux-tracker`
        : 'https://YOUR_USERNAME.github.io/ux-tracker';
      return [
        `<script`,
        `  src="${base}/v1/tracker.js"`,
        `  data-ingest-url="${this._edgeFunctionUrl()}"`,
        `  data-study="${studyId}">`,
        `<\/script>`,
      ].join('\n');
    },

    async copySnippetMinimal() {
      await navigator.clipboard.writeText(this.scriptSnippetMinimal);
      this.copiedSnippetMinimal = true;
      setTimeout(() => { this.copiedSnippetMinimal = false; }, 2000);
    },

    async copySnippetFull() {
      await navigator.clipboard.writeText(this.scriptSnippetFull);
      this.copiedSnippetFull = true;
      setTimeout(() => { this.copiedSnippetFull = false; }, 2000);
    },

    openDashboard() {
      const creds = btoa(JSON.stringify({ u: this.creds.url.trim(), k: this.creds.key.trim() }));
      window.location.href = `../dashboard/index.html?study=${encodeURIComponent(this.studyId)}#c=${creds}`;
    },

  };
}
