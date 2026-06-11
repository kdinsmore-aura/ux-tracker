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
    creds: { url: '', key: '' },
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
    newStudy: { name: '', description: '', tasks: [] },
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

    // ── Step 5 — Generate links ───────────────────────────────────────────────
    linkCount: 5,
    protoBaseUrl: '',
    participantLabels: '',
    generatedLinks: [],
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
            this.creds = { url, key };
            this._initDb(url, key);
            await this._goto(this._savedStep || 1);
            return;
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

    async testConnection() {
      this.credError = '';
      this.credSuccess = '';
      if (!this._checkCreds()) return;
      this.credTesting = true;
      try {
        this._initDb(this.creds.url, this.creds.key);
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
        const { error } = await this._db.from('studies').select('id').limit(1);
        if (error) throw error;
        localStorage.setItem('uxt_researcher_config', JSON.stringify({
          url: this.creds.url.trim(),
          key: this.creds.key.trim(),
        }));
        await this._goto(1);
      } catch (e) {
        this.credError = `Could not connect: ${e.message}`;
        this._db = null;
      } finally {
        this.credSaving = false;
      }
    },

    clearCredentials() {
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
        tasks: tasks.map((t, i) => ({ id: i + 1, prompt: typeof t === 'string' ? t : (t.prompt || '') })),
      };
      this.taskCounter = this.newStudy.tasks.length + 1;
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
      this.newStudy = { name: '', description: '', tasks: [] };
      this.taskCounter = 1;
      this.createError = '';
      this._maxStep = 2;
      this._addTask();
      this._goto(2);
    },

    _addTask() {
      this.newStudy.tasks.push({ id: this.taskCounter++, prompt: '' });
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

    async saveStudy() {
      this.createError = '';
      if (!this.newStudy.name.trim()) {
        this.createError = 'Study name is required.';
        return;
      }
      const tasks = this.newStudy.tasks
        .filter(t => t.prompt.trim())
        .map((t, i) => ({ id: i + 1, prompt: t.prompt.trim(), order: i }));
      if (tasks.length === 0) {
        this.createError = 'At least one task prompt is required.';
        return;
      }

      this.createSaving = true;
      const payload = {
        name:        this.newStudy.name.trim(),
        description: this.newStudy.description.trim() || null,
        tasks,
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


    // ── Step 5 — Generate links ───────────────────────────────────────────────

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
        const rows = Array.from({ length: count }, (_, i) => ({
          study_id:   this.studyId,
          label:      labels[i] || `P${String(i + 1).padStart(2, '0')}`,
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
