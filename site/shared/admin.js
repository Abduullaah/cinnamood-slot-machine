/* ============================================================================
   CINNAMOOD — STAFF PANEL
   ----------------------------------------------------------------------------
   Opens on a 2.5s press-and-hold in the TOP-LEFT corner of the screen
   (or Shift+A on a keyboard while testing). Nothing on screen advertises it,
   so a customer will never find it, but staff can reach it in one gesture
   without a password to forget.

   Everything edited here is saved to the iPad itself and survives a reload.
   "Restore defaults" puts it back to the values written in config.js.

   The one to know about while you're showcasing this: FORCE NEXT RESULT.
   Set it to Box of Six and the very next pull lands the jackpot, complete with
   the slow third reel. Then it clears itself, so you can't leave it on by
   accident.
   ============================================================================ */

/* Prize names are typed by staff and then written into HTML attributes and into
   innerHTML. A single double-quote in a name used to break out of the attribute
   and mangle the panel — permanently, because the name is saved to localStorage
   and re-rendered on every load, so the panel came back broken and there was no
   way to fix it from inside the panel. */
function esc(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

class AdminPanel {
  constructor(machine, audio, cfg, leads) {
    this.machine = machine;
    this.audio = audio;
    this.cfg = cfg;
    this.leads = leads || null;
    this.stats = { spins: 0, byPrize: {} };
    this.forced = null;

    this._injectStyles();
    this._buildDOM();
    this._bindOpener();
    this._hookMachine();

    /* The lead counters have to follow the store rather than the panel, since
       leads arrive and sync while the panel is sitting open. */
    if (this.leads) {
      this.leads.onChange = () => { this._syncLeads(); this._syncLog(); };
      this._syncLeads();
      this._syncLog();
      this._syncTestWarn();
    }
  }

  /* Intercept the draw so the panel can force an outcome. */
  _hookMachine() {
    const m = this.machine;
    const origSpin = m.spin.bind(m);
    const self = this;

    m.spin = function () {
      if (self.forced) {
        const forcedPrize = self.cfg.prizes.find(p => p.id === self.forced);
        if (forcedPrize) {
          /* Temporarily make this prize a certainty, spin, then restore.

             The restore MUST be in a `finally`. Without it, any throw inside
             origSpin() left the real prize table zeroed out — the machine would
             hand out that one prize on every single pull until someone reloaded
             the iPad, while the staff panel went on displaying the correct
             weights, so nothing looked wrong. */
          const snapshot = self.cfg.prizes.map(p => p.weight);
          let ok = false;
          try {
            self.cfg.prizes.forEach(p => { p.weight = (p.id === self.forced) ? 1 : 0; });
            ok = origSpin();
          } finally {
            self.cfg.prizes.forEach((p, i) => { p.weight = snapshot[i]; });
          }
          if (ok) { self.forced = null; self._syncForceUI(); }
          return ok;
        }
      }
      return origSpin();
    };

    const origResult = m.hooks.onResult;
    m.hooks.onResult = (r) => {
      this.stats.spins++;
      this.stats.byPrize[r.prize.id] = (this.stats.byPrize[r.prize.id] || 0) + 1;
      this._syncStats();
      origResult(r);
    };
  }

  _bindOpener() {
    const hot = document.createElement('div');
    hot.className = 'cm-admin-hot';
    document.body.appendChild(hot);

    let timer = null, startX = 0, startY = 0;
    const start = (e) => {
      startX = e.clientX; startY = e.clientY;
      timer = setTimeout(() => { this.open(); }, 2500);
    };
    const cancel = () => { clearTimeout(timer); timer = null; };
    /* A hold that wanders is a customer fidgeting, not staff opening a panel.
       Without this, any 2.5s contact in the corner — a resting thumb, a sleeve
       dragged across the glass — opened the admin sheet in front of a queue. */
    const move = (e) => {
      if (timer && Math.hypot(e.clientX - startX, e.clientY - startY) > 14) cancel();
    };
    hot.addEventListener('pointerdown', start);
    hot.addEventListener('pointermove', move);
    hot.addEventListener('pointerup', cancel);
    hot.addEventListener('pointerleave', cancel);
    hot.addEventListener('pointercancel', cancel);

    window.addEventListener('keydown', e => {
      /* Ignore the shortcut while someone is typing. Prize names are edited in
         this very panel, so a capital "A" in a prize name used to re-open it,
         and Escape closed it mid-edit. */
      const t = e.target;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' ||
                           t.isContentEditable);
      if (!typing && e.shiftKey && (e.key === 'A' || e.key === 'a')) this.open();
      if (e.key === 'Escape' && !typing) this.close();
    });
  }

  open() {
    this.root.classList.add('open');
    this.audio?.tick();
    this._syncLeads();
    this._syncLog();
    this._syncStats();
  }
  close() {
    this.root.classList.remove('open');
    this.audio?.tick(true);
  }

  _save() {
    saveConfig({
      prizes: this.cfg.prizes,
      feel: this.cfg.feel,
      audio: this.cfg.audio
    });
    this._syncOdds();
  }

  _totalWeight() {
    return this.cfg.prizes.reduce((s, p) => s + (Number(p.weight) || 0), 0);
  }

  _syncOdds() {
    const total = this._totalWeight();
    this.root.querySelectorAll('[data-odds]').forEach(el => {
      const id = el.dataset.odds;
      const p = this.cfg.prizes.find(x => x.id === id);
      const pct = total > 0 ? (p.weight / total) * 100 : 0;
      el.textContent = pct.toFixed(1) + '%';
      el.classList.toggle('zero', p.weight <= 0);
    });
    const winPct = this.cfg.prizes
      .filter(p => p.tier !== 'none')
      .reduce((s, p) => s + p.weight, 0) / (total || 1) * 100;
    const rate = this.root.querySelector('#cm-winrate');
    rate.textContent = winPct.toFixed(1) + '%';

    /* Two states that silently produce a machine nobody can win on, and neither
       one looked like an error before: every weight at zero (the draw falls
       through to the last row, which is "Not This Time"), and every WINNING
       weight at zero. Both used to render a tidy 0.0% and nothing else. */
    const winTotal = this.cfg.prizes
      .filter(p => p.tier !== 'none')
      .reduce((s, p) => s + (Number(p.weight) || 0), 0);
    const broken = total <= 0 || winTotal <= 0;
    rate.classList.toggle('cm-bad', broken);
    const warn = this.root.querySelector('#cm-warn');
    warn.textContent = total <= 0
      ? 'Every weight is zero — this machine cannot pick a prize. Give at least one prize a weight.'
      : (winTotal <= 0
        ? 'Every winning prize is at zero — nobody can win. Give at least one prize a weight.'
        : '');
    warn.hidden = !broken;
  }

  _syncStats() {
    const s = this.stats;
    const wins = Object.entries(s.byPrize)
      .filter(([id]) => id !== 'none')
      .reduce((a, [, n]) => a + n, 0);
    this.root.querySelector('#cm-stat-spins').textContent = s.spins;
    this.root.querySelector('#cm-stat-wins').textContent = wins;
    this.root.querySelector('#cm-stat-rate').textContent =
      s.spins ? ((wins / s.spins) * 100).toFixed(1) + '%' : '—';
    const bd = this.root.querySelector('#cm-stat-breakdown');
    bd.innerHTML = this.cfg.prizes.map(p => {
      const n = s.byPrize[p.id] || 0;
      return `<div class="cm-bdrow"><span>${esc(p.label)}</span><b>${n}</b></div>`;
    }).join('');
  }

  _syncForceUI() {
    this.root.querySelectorAll('.cm-force').forEach(b => {
      b.classList.toggle('on', b.dataset.force === this.forced);
    });
  }

  _buildDOM() {
    const root = document.createElement('div');
    root.className = 'cm-admin';
    root.innerHTML = `
      <div class="cm-admin-scrim"></div>
      <div class="cm-admin-sheet" role="dialog" aria-label="Staff panel">
        <header>
          <div>
            <h2>Staff Panel</h2>
            <p>Changes save to this iPad and take effect on the next pull.</p>
          </div>
          <button class="cm-x" aria-label="Close">&times;</button>
        </header>

        <section>
          <h3>Prizes &amp; odds
            <span class="cm-hint">Overall win rate <b id="cm-winrate">—</b></span>
          </h3>
          <div class="cm-prizes">
            ${this.cfg.prizes.map((p, i) => `
              <div class="cm-prize" data-i="${i}">
                <div class="cm-prow">
                  <input class="cm-label" value="${esc(p.label)}" data-f="label" aria-label="Prize name">
                  <span class="cm-odds" data-odds="${esc(p.id)}">—</span>
                </div>
                <input class="cm-sub" value="${esc(p.sub || '')}" data-f="sub"
                       placeholder="Supporting line" aria-label="Supporting line">
                <div class="cm-wrow">
                  <!-- Both controls share one range. They used to disagree
                       (slider 0-100, number 0-1000) and the slider pinned its
                       value with Math.min(100,…), so a weight of 400 was
                       silently destroyed the next time anyone nudged it. -->
                  <input type="range" min="0" max="${AdminPanel.MAX_WEIGHT}" step="1"
                         value="${p.weight}" data-f="weight" aria-label="Weight">
                  <input type="number" min="0" max="${AdminPanel.MAX_WEIGHT}" step="1"
                         value="${p.weight}" data-f="weightnum" aria-label="Weight value">
                </div>
              </div>`).join('')}
          </div>
          <p class="cm-warn" id="cm-warn" role="alert" hidden></p>
          <p class="cm-note">
            Weights are relative, not percentages — the real odds are shown on the
            right and always add up to 100%. Set one to 0 to retire it.
          </p>
        </section>

        <section>
          <h3>Force next result <span class="cm-hint">for demos</span></h3>
          <div class="cm-forces">
            ${this.cfg.prizes.map(p => `
              <button class="cm-force" data-force="${p.id}">${p.label}</button>`).join('')}
            <button class="cm-force cm-clear" data-force="">Off</button>
          </div>
          <p class="cm-note">Applies to the next pull only, then switches itself off.</p>
        </section>

        <section>
          <h3>Feel</h3>
          <label class="cm-field">
            <span>Near-miss frequency <i>how often a loss teases</i></span>
            <input type="range" id="cm-near" min="0" max="100" step="5"
                   value="${Math.round(this.cfg.feel.nearMissRate * 100)}">
            <output id="cm-near-o">${Math.round(this.cfg.feel.nearMissRate * 100)}%</output>
          </label>
          <label class="cm-field">
            <span>Hold result <i>before returning to rest</i></span>
            <input type="range" id="cm-hold" min="4" max="30" step="1"
                   value="${Math.round(this.cfg.feel.holdMs / 1000)}">
            <output id="cm-hold-o">${Math.round(this.cfg.feel.holdMs / 1000)}s</output>
          </label>
          <label class="cm-field">
            <span>Lever lockout <i>stops one person chaining spins</i></span>
            <input type="range" id="cm-cool" min="0" max="20" step="1"
                   value="${Math.round(this.cfg.feel.cooldownMs / 1000)}">
            <output id="cm-cool-o">${Math.round(this.cfg.feel.cooldownMs / 1000)}s</output>
          </label>
        </section>

        <section>
          <h3>Sound</h3>
          <label class="cm-field cm-toggle">
            <span>Sound on</span>
            <input type="checkbox" id="cm-sound" ${this.cfg.audio.startMuted ? '' : 'checked'}>
          </label>
          <label class="cm-field">
            <span>Volume</span>
            <input type="range" id="cm-vol" min="0" max="100" step="5"
                   value="${Math.round(this.cfg.audio.volume * 100)}">
            <output id="cm-vol-o">${Math.round(this.cfg.audio.volume * 100)}%</output>
          </label>
        </section>

        <section class="cm-leads-sec">
          <h3>Guest details
            <span class="cm-hint"><b id="cm-lead-count">0</b> collected</span>
          </h3>

          <div class="cm-stats">
            <div><b id="cm-lead-total">0</b><span>on this iPad</span></div>
            <div><b id="cm-lead-pending">0</b><span>waiting to send</span></div>
          </div>

          <p class="cm-syncstate" id="cm-syncstate">—</p>

          <details class="cm-adv">
            <summary>Advanced — where the sheet lives</summary>
            <p class="cm-note" style="margin-top:0">
              Already set up on the server, so any iPad works the moment it opens
              the link. Only change these to point this one machine somewhere
              else.
            </p>
            <label class="cm-stack">
              <span>Sheet address</span>
              <input type="url" id="cm-sync-url" placeholder="/api/leads"
                     autocomplete="off" spellcheck="false">
            </label>
            <label class="cm-stack">
              <span>Passphrase <i>only needed when posting straight to Google</i></span>
              <input type="text" id="cm-sync-key" autocomplete="off" spellcheck="false">
            </label>
          </details>

          <div class="cm-btnrow">
            <button class="cm-ghost" id="cm-sync-test">Test connection</button>
            <button class="cm-ghost" id="cm-sync-now">Send now</button>
          </div>

          <label class="cm-field">
            <span>Same guest may play again <i>how long a set of details is blocked</i></span>
            <select id="cm-lead-window" class="cm-select">
              <option value="-1">Straight away — TESTING</option>
              <option value="0">Never</option>
              <option value="1">After a day</option>
              <option value="7">After a week</option>
              <option value="30">After a month</option>
            </select>
          </label>

          <p class="cm-testwarn" id="cm-testwarn" hidden>
            Testing mode. The same name, email and phone can play over and over.
            Set this to Never before real customers use the machine.
          </p>

          <div class="cm-btnrow">
            <button class="cm-ghost" id="cm-lead-csv">Download CSV</button>
            <button class="cm-ghost" id="cm-lead-copy">Copy to clipboard</button>
          </div>
          <div class="cm-btnrow">
            <button class="cm-ghost cm-danger" id="cm-lead-wipe">Delete all details</button>
          </div>

          <p class="cm-note">
            Details are saved on this iPad the instant a guest submits them, and
            sent to the sheet straight after. If the wifi is down they queue here
            and go out on their own once it is back — nothing is lost. Deleting
            them here does not remove them from the sheet.
          </p>
        </section>

        <section>
          <h3>Activity log
            <span class="cm-hint">what the machine has been doing</span>
          </h3>
          <div class="cm-log" id="cm-log"></div>
          <div class="cm-btnrow">
            <button class="cm-ghost" id="cm-log-copy">Copy log</button>
            <button class="cm-ghost" id="cm-log-clear">Clear log</button>
          </div>
          <div class="cm-btnrow">
            <button class="cm-ghost" id="cm-update">Update the machine</button>
          </div>
          <p class="cm-note">
            The last 60 things that happened, kept on this iPad and surviving a
            reload. No guest details are in here. If something has gone wrong,
            copy this and send it over — it is the only record of what the
            machine did while nobody was watching.
          </p>
        </section>

        <section>
          <h3>This session</h3>
          <div class="cm-stats">
            <div><b id="cm-stat-spins">0</b><span>pulls</span></div>
            <div><b id="cm-stat-wins">0</b><span>wins</span></div>
            <div><b id="cm-stat-rate">—</b><span>actual rate</span></div>
          </div>
          <div id="cm-stat-breakdown" class="cm-breakdown"></div>
          <p class="cm-note">Counts since this page was last loaded. Useful for
            sanity-checking that the odds behave the way you set them.</p>
        </section>

        <footer>
          <button class="cm-ghost" id="cm-restore">Restore defaults</button>
          <button class="cm-solid" id="cm-done">Done</button>
        </footer>
      </div>`;
    document.body.appendChild(root);
    this.root = root;

    /* ---- wiring ---- */
    root.querySelector('.cm-x').onclick = () => this.close();
    root.querySelector('.cm-admin-scrim').onclick = () => this.close();
    root.querySelector('#cm-done').onclick = () => this.close();

    /* Two taps, not one. This button wipes every prize name, every weight and
       the day's stats irreversibly, and it sits beside "Done" at the same size —
       one mis-tap on a busy counter used to be enough. */
    const restore = root.querySelector('#cm-restore');
    let armed = false, armTimer = null;
    restore.onclick = () => {
      if (!armed) {
        armed = true;
        restore.textContent = 'Tap again to erase';
        restore.classList.add('cm-armed');
        this.audio?.tick();
        clearTimeout(armTimer);
        armTimer = setTimeout(() => {
          armed = false;
          restore.textContent = 'Restore defaults';
          restore.classList.remove('cm-armed');
        }, 4000);
        return;
      }
      resetConfig();
      location.reload();
    };

    root.querySelectorAll('.cm-prize').forEach(row => {
      const i = +row.dataset.i;
      const p = this.cfg.prizes[i];
      const range = row.querySelector('[data-f="weight"]');
      const num = row.querySelector('[data-f="weightnum"]');

      row.querySelector('[data-f="label"]').oninput = e => {
        p.label = e.target.value; this._save();
      };
      row.querySelector('[data-f="sub"]').oninput = e => {
        p.sub = e.target.value; this._save();
      };
      const setW = v => {
        // Clamp at BOTH ends. The upper clamp was missing, and the slider had a
        // lower ceiling than the number field, so the two controls disagreed.
        p.weight = clamp(Math.round(Number(v) || 0), 0, AdminPanel.MAX_WEIGHT);
        range.value = p.weight;
        num.value = p.weight;
        this._save();
      };
      range.oninput = e => { setW(e.target.value); this.audio?.tick(true); };
      num.oninput = e => setW(e.target.value);
    });

    root.querySelectorAll('.cm-force').forEach(b => {
      b.onclick = () => {
        this.forced = b.dataset.force || null;
        this._syncForceUI();
        this.audio?.tick();
      };
    });

    const bindRange = (id, outId, fmt, apply) => {
      const el = root.querySelector(id), out = root.querySelector(outId);
      el.oninput = e => {
        const v = Number(e.target.value);
        out.textContent = fmt(v);
        apply(v);
        this._save();
      };
    };
    bindRange('#cm-near', '#cm-near-o', v => v + '%',
              v => this.cfg.feel.nearMissRate = v / 100);
    bindRange('#cm-hold', '#cm-hold-o', v => v + 's',
              v => this.cfg.feel.holdMs = v * 1000);
    bindRange('#cm-cool', '#cm-cool-o', v => v + 's',
              v => this.cfg.feel.cooldownMs = v * 1000);
    bindRange('#cm-vol', '#cm-vol-o', v => v + '%', v => {
      this.cfg.audio.volume = v / 100;
      if (!this.audio) return;
      this.audio.masterVol = v / 100;
      /* Ramp, don't assign. Writing `.gain.value` while a scheduled ramp is in
         flight is unreliable, and dragging the slider produced a stepped zipper
         instead of the smooth change the audio module was built for. */
      if (this.audio.master && this.audio.ctx && !this.audio.muted) {
        const t = this.audio.ctx.currentTime;
        this.audio.master.gain.cancelScheduledValues(t);
        this.audio.master.gain.setTargetAtTime(v / 100, t, 0.02);
      }
    });

    root.querySelector('#cm-sound').onchange = e => {
      this.cfg.audio.startMuted = !e.target.checked;
      this.audio?.setMuted(!e.target.checked);
      this._save();
      if (e.target.checked) this.audio.tick();
    };

    this._bindLeads();
    this._syncOdds();
    this._syncForceUI();
  }

  /* ---- guest details ------------------------------------------------------
     The panel is the only place the sheet address is ever entered, and it is
     the only place anyone can see that syncing has stopped working. Both of
     those matter more than they look: a kiosk cannot tell you it is failing,
     so the failure has to be visible the moment someone opens this. */
  _bindLeads() {
    const root = this.root;
    const leads = this.leads;
    if (!leads) {
      const sec = root.querySelector('.cm-leads-sec');
      if (sec) sec.remove();
      return;
    }

    const urlEl = root.querySelector('#cm-sync-url');
    const keyEl = root.querySelector('#cm-sync-key');
    const winEl = root.querySelector('#cm-lead-window');

    urlEl.value = leads.settings.syncUrl || '';
    keyEl.value = leads.settings.syncKey || '';
    winEl.value = String(Number(leads.settings.dedupeWindowDays) || 0);

    /* Saved on `change`, not `input`. Saving every keystroke would fire a sync
       attempt against a dozen half-typed URLs while the address is being
       pasted in, and each failure lengthens the retry backoff. */
    urlEl.onchange = () => leads.saveSettings({ syncUrl: urlEl.value.trim() });
    keyEl.onchange = () => leads.saveSettings({ syncKey: keyEl.value.trim() });
    winEl.onchange = () => {
      // Number(winEl.value) || 0 would have turned "-1" into -1 correctly but
      // silently mapped any unparseable value to 0; be explicit instead.
      const v = Number(winEl.value);
      leads.saveSettings({ dedupeWindowDays: Number.isFinite(v) ? v : 0 });
      this._syncTestWarn();
      this.audio?.tick();
    };
    this._syncTestWarn();

    const state = root.querySelector('#cm-syncstate');
    const last = { text: '', kind: '' };
    const setState = (text, kind) => {
      last.text = text;
      last.kind = kind || '';
      state.textContent = text;
      state.className = 'cm-syncstate' + (kind ? ' ' + kind : '');
    };

    root.querySelector('#cm-sync-test').onclick = async (e) => {
      const b = e.currentTarget;
      const label = b.textContent;
      b.disabled = true; b.textContent = 'Testing…';
      // Save first, so Test always checks what is actually in the boxes even if
      // the field never lost focus.
      leads.saveSettings({ syncUrl: urlEl.value.trim(), syncKey: keyEl.value.trim() });
      try {
        await leads.test(urlEl.value, keyEl.value);
        setState('Connected. The sheet answered.', 'ok');
      } catch (err) {
        setState('Could not reach the sheet: ' + (err.message || err), 'bad');
      }
      /* Counts first, THEN the verdict. The other way round, refreshing the
         counts wiped the answer the person just pressed the button for. */
      this._syncLeads();
      state.textContent = last.text;
      state.className = 'cm-syncstate' + (last.kind ? ' ' + last.kind : '');
      b.disabled = false; b.textContent = label;
    };

    root.querySelector('#cm-sync-now').onclick = () => {
      leads._fails = 0;              // a person is watching; don't make them wait out a backoff
      leads.sync();
      this.audio?.tick();
    };

    root.querySelector('#cm-lead-csv').onclick = () => {
      if (!leads.count) return setState('There is nothing to export yet.', '');
      const blob = new Blob([leads.csv()], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'cinnamood-guests-' + new Date().toISOString().slice(0, 10) + '.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoking immediately can cancel the download on some builds of Safari.
      setTimeout(() => URL.revokeObjectURL(url), 20000);
    };

    root.querySelector('#cm-lead-copy').onclick = async () => {
      if (!leads.count) return setState('There is nothing to copy yet.', '');
      const text = leads.csv();
      try {
        await navigator.clipboard.writeText(text);
        setState('Copied. Paste it into any spreadsheet.', 'ok');
      } catch (err) {
        /* Clipboard access is refused outside a secure context, which includes
           an iPad opening this over plain http from a laptop — exactly how it
           gets demoed. Fall back to the old selection trick. */
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;top:-1000px;left:0;opacity:0';
        document.body.appendChild(ta);
        ta.select();
        let ok = false;
        try { ok = document.execCommand('copy'); } catch (e2) {}
        ta.remove();
        setState(ok ? 'Copied. Paste it into any spreadsheet.'
                    : 'Copying was blocked. Use Download CSV instead.', ok ? 'ok' : 'bad');
      }
    };

    root.querySelector('#cm-log-copy').onclick = async () => {
      const text = leads.log.map(e =>
        new Date(e.t).toISOString() + '  [' + e.kind + '] ' + e.m).join('\n');
      try {
        await navigator.clipboard.writeText(text);
        setState('Log copied.', 'ok');
      } catch (err) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;top:-1000px;left:0;opacity:0';
        document.body.appendChild(ta); ta.select();
        let ok = false;
        try { ok = document.execCommand('copy'); } catch (e2) {}
        ta.remove();
        setState(ok ? 'Log copied.' : 'Copying was blocked.', ok ? 'ok' : 'bad');
      }
    };
    root.querySelector('#cm-log-clear').onclick = () => {
      leads.clearLog();
      this._syncLog();
      this.audio?.tick();
    };

    /* The iPad keeps its own copy of the machine so it can start with no
       network. The cost of that is a version staff cannot otherwise get past —
       so this is the way out: throw the copy away and fetch a fresh one. It
       does NOT touch guests, which live somewhere else entirely. */
    root.querySelector('#cm-update').onclick = async () => {
      setState('Fetching a fresh copy…', '');
      try {
        if ('caches' in window) {
          const names = await caches.keys();
          await Promise.all(names.map(n => caches.delete(n)));
        }
        if (navigator.serviceWorker) {
          const regs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(regs.map(r => r.unregister()));
        }
      } catch (e) { /* reloading is still worth a try */ }
      location.reload();
    };

    /* Two taps, like Restore defaults — and with a harder warning, because
       anything not yet on the sheet is gone for good. */
    const wipe = root.querySelector('#cm-lead-wipe');
    let armed = false, armTimer = null;
    wipe.onclick = () => {
      if (!armed) {
        armed = true;
        wipe.textContent = leads.pending
          ? `Tap again — ${leads.pending} not sent yet`
          : 'Tap again to delete';
        wipe.classList.add('cm-armed');
        this.audio?.tick();
        clearTimeout(armTimer);
        armTimer = setTimeout(() => {
          armed = false;
          wipe.textContent = 'Delete all details';
          wipe.classList.remove('cm-armed');
        }, 4000);
        return;
      }
      leads.clearAll();
      armed = false;
      wipe.textContent = 'Delete all details';
      wipe.classList.remove('cm-armed');
      setState('Deleted from this iPad.', '');
    };
  }

  /* Testing mode is the one setting that can quietly ruin the data, so it
     announces itself every time the panel is open rather than hiding in a
     dropdown that already looks answered. */
  _syncTestWarn() {
    const w = this.root && this.root.querySelector('#cm-testwarn');
    if (!w || !this.leads) return;
    w.hidden = !this.leads.dedupeOff;
  }

  _syncLog() {
    const box = this.root && this.root.querySelector('#cm-log');
    if (!box || !this.leads) return;
    const entries = this.leads.log.slice().reverse();   // newest first
    if (!entries.length) { box.innerHTML = '<i>Nothing yet.</i>'; return; }
    const when = t => {
      const d = new Date(t);
      const p = n => String(n).padStart(2, '0');
      return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
    };
    /* Entry text is escaped even though it is written by this code and not by
       any guest — an error message can carry a URL or a fragment of a server's
       HTML, and this box would happily render it. */
    box.innerHTML = entries.map(e =>
      `<div class="cm-log-row cm-log-${esc(e.kind)}">
         <b>${when(e.t)}</b><span>${esc(e.m)}</span>
       </div>`).join('');
  }

  _syncLeads() {
    const leads = this.leads;
    if (!leads || !this.root) return;
    const set = (id, v) => {
      const el = this.root.querySelector(id);
      if (el) el.textContent = v;
    };
    set('#cm-lead-count', leads.count);
    set('#cm-lead-total', leads.count);
    set('#cm-lead-pending', leads.pending);

    const state = this.root.querySelector('#cm-syncstate');
    if (!state) return;
    let text, kind = '';
    if (!leads.settings.syncUrl) {
      text = 'No sheet connected — this iPad is the only copy.';
      kind = 'warn';
    } else if (leads.syncing) {
      text = 'Sending…';
    } else if (leads.lastSyncError && leads.pending) {
      text = 'Not reaching the sheet: ' + leads.lastSyncError;
      kind = 'bad';
    } else if (leads.pending) {
      text = leads.pending + ' waiting to go out.';
      kind = 'warn';
    } else if (!leads.count) {
      text = 'Connected to the sheet. No guests yet.';
      kind = 'ok';
    } else {
      text = 'Everything is on the sheet.';
      kind = 'ok';
    }
    if (!leads.storageOk) {
      text += ' This iPad is out of storage space.';
      kind = 'bad';
    }
    state.textContent = text;
    state.className = 'cm-syncstate' + (kind ? ' ' + kind : '');
  }

  _injectStyles() {
    const css = `
    .cm-admin-hot{position:fixed;top:0;left:0;width:84px;height:84px;z-index:900}
    /* The sheet animates BOTH ways. It used to slide in over 340ms and then
       vanish in a single frame, because close() removed .open from a
       display:none container — the one interaction staff perform most often
       ended with a pop. Now the container stays laid out through the exit and
       is only taken out of the flow once the transition has finished.
       (No backticks in here: this whole block is inside a template literal.) */
    .cm-admin{position:fixed;inset:0;z-index:1000;visibility:hidden;
      transition:visibility 0s linear .3s}
    .cm-admin.open{visibility:visible;transition-delay:0s}
    .cm-admin-scrim{position:absolute;inset:0;background:rgba(24,8,16,.44);
      backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);
      opacity:0;transition:opacity .3s cubic-bezier(.4,0,.2,1)}
    .cm-admin.open .cm-admin-scrim{opacity:1}
    .cm-admin-sheet{position:absolute;top:0;right:0;bottom:0;width:min(560px,100%);
      background:#F6F1EA;color:#3a1524;overflow-y:auto;-webkit-overflow-scrolling:touch;
      box-shadow:-30px 0 80px rgba(60,10,35,.3);
      font-family:Verdana,-apple-system,system-ui,sans-serif;
      transform:translateX(28px);opacity:0;
      transition:transform .34s cubic-bezier(.2,.9,.25,1),
                 opacity .26s cubic-bezier(.4,0,.2,1)}
    .cm-admin.open .cm-admin-sheet{transform:none;opacity:1}
    @media (prefers-reduced-motion: reduce){
      .cm-admin-sheet,.cm-admin-scrim{transition-duration:.01s}
    }
    /* An unwinnable machine has to look like an error, not like a tidy 0.0%. */
    .cm-warn{margin:12px 0 0;padding:10px 12px;border-radius:9px;font-size:11.5px;
      line-height:1.55;background:rgba(172,30,85,.1);color:#AC1E55;font-weight:700}
    .cm-hint b.cm-bad{color:#AC1E55;background:rgba(172,30,85,.14);
      padding:1px 6px;border-radius:5px}
    .cm-ghost.cm-armed{background:#AC1E55;color:#F6F1EA;border-color:#AC1E55}
    .cm-admin-sheet header{display:flex;justify-content:space-between;align-items:flex-start;
      gap:16px;padding:26px 26px 18px;position:sticky;top:0;background:#F6F1EA;z-index:2;
      border-bottom:1px solid rgba(172,30,85,.14)}
    /* Lyno Stan is a caps-only face: its lowercase slots hold decorative
       alternates, and lowercase f comes out as a cross — so this heading read
       STA++ PANEL until the uppercase transform was added. Anything set in
       Lyno Stan needs it; h3 below already had it. */
    .cm-admin-sheet h2{font-family:'Lyno Stan',Verdana,sans-serif;font-size:24px;
      text-transform:uppercase;
      letter-spacing:.06em;color:#AC1E55;margin:0 0 4px}
    .cm-admin-sheet header p{margin:0;font-size:12px;line-height:1.5;opacity:.62}
    .cm-x{border:0;background:rgba(172,30,85,.08);color:#AC1E55;width:38px;height:38px;
      border-radius:50%;font-size:24px;line-height:1;cursor:pointer;flex:0 0 auto}
    .cm-admin section{padding:20px 26px;border-bottom:1px solid rgba(172,30,85,.1)}
    .cm-admin h3{font-family:'Lyno Stan',Verdana,sans-serif;font-size:13px;letter-spacing:.14em;
      text-transform:uppercase;color:#AC1E55;margin:0 0 14px;display:flex;
      justify-content:space-between;align-items:baseline;gap:10px}
    .cm-hint{font-family:Verdana,sans-serif;font-size:11px;letter-spacing:0;
      text-transform:none;opacity:.6;font-weight:400}
    .cm-hint b{color:#AC1E55}
    .cm-prize{background:#fff;border-radius:14px;padding:12px 14px;margin-bottom:10px;
      border:1px solid rgba(172,30,85,.1)}
    .cm-prow{display:flex;align-items:center;gap:10px}
    .cm-prize input{font-family:Verdana,sans-serif;font-size:13px;color:#3a1524}
    .cm-label{flex:1;border:0;border-bottom:1px solid rgba(172,30,85,.2);
      padding:5px 0;font-weight:700;background:none;min-width:0}
    .cm-sub{width:100%;border:0;padding:5px 0;background:none;font-size:12px;opacity:.7}
    .cm-odds{font-family:'Lyno Stan',Verdana,sans-serif;font-size:16px;color:#AC1E55;
      min-width:56px;text-align:right;flex:0 0 auto}
    .cm-odds.zero{opacity:.28}
    .cm-wrow{display:flex;align-items:center;gap:10px;margin-top:6px}
    .cm-wrow input[type=range]{flex:1;min-width:0}
    .cm-wrow input[type=number]{width:62px;border:1px solid rgba(172,30,85,.2);
      border-radius:8px;padding:5px 7px;text-align:center;background:#fff}
    .cm-admin input[type=range]{-webkit-appearance:none;appearance:none;height:4px;
      border-radius:2px;background:rgba(172,30,85,.18);outline:none}
    .cm-admin input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;
      width:22px;height:22px;border-radius:50%;background:#AC1E55;cursor:pointer;
      box-shadow:0 2px 6px rgba(172,30,85,.4)}
    .cm-note{font-size:11px;line-height:1.6;opacity:.55;margin:10px 0 0}
    .cm-forces{display:flex;flex-wrap:wrap;gap:7px}
    .cm-force{font-family:Verdana,sans-serif;font-size:11.5px;padding:8px 13px;
      border-radius:999px;border:1px solid rgba(172,30,85,.28);background:#fff;
      color:#AC1E55;cursor:pointer}
    .cm-force.on{background:#AC1E55;color:#F6F1EA;border-color:#AC1E55}
    .cm-force.cm-clear{opacity:.6}
    .cm-field{display:grid;grid-template-columns:1fr 130px 46px;align-items:center;
      gap:12px;padding:9px 0;font-size:12.5px}
    .cm-field span i{display:block;font-style:normal;font-size:10.5px;opacity:.55;margin-top:2px}
    .cm-field output{font-family:'Lyno Stan',Verdana,sans-serif;color:#AC1E55;
      font-size:14px;text-align:right}
    .cm-toggle{grid-template-columns:1fr auto}
    .cm-toggle input{width:52px;height:30px;-webkit-appearance:none;appearance:none;
      background:rgba(172,30,85,.18);border-radius:999px;position:relative;cursor:pointer;
      transition:background .2s}
    .cm-toggle input:checked{background:#AC1E55}
    .cm-toggle input::after{content:'';position:absolute;top:3px;left:3px;width:24px;
      height:24px;border-radius:50%;background:#fff;transition:transform .22s
      cubic-bezier(.2,.9,.25,1)}
    .cm-toggle input:checked::after{transform:translateX(22px)}
    .cm-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:12px}
    .cm-stats div{background:#fff;border-radius:12px;padding:12px;text-align:center;
      border:1px solid rgba(172,30,85,.1)}
    .cm-stats b{display:block;font-family:'Lyno Stan',Verdana,sans-serif;font-size:23px;
      color:#AC1E55}
    .cm-stats span{font-size:10px;text-transform:uppercase;letter-spacing:.09em;opacity:.55}
    .cm-breakdown{background:#fff;border-radius:12px;border:1px solid rgba(172,30,85,.1);
      overflow:hidden}
    .cm-bdrow{display:flex;justify-content:space-between;padding:8px 13px;font-size:12px;
      border-bottom:1px solid rgba(172,30,85,.07)}
    .cm-bdrow:last-child{border-bottom:0}
    .cm-bdrow b{color:#AC1E55}
    .cm-admin footer{display:flex;gap:10px;padding:20px 26px 30px}
    .cm-admin footer button{flex:1;padding:14px;border-radius:12px;font-size:13px;
      font-family:Verdana,sans-serif;cursor:pointer}
    .cm-ghost{background:none;border:1px solid rgba(172,30,85,.3);color:#AC1E55}
    .cm-solid{background:#AC1E55;border:0;color:#F6F1EA;font-weight:700}
    @media (max-width:600px){ .cm-field{grid-template-columns:1fr 90px 42px} }

    /* ---- guest details ---- */
    .cm-stack{display:block;margin-bottom:12px}
    .cm-stack span{display:block;font-size:12px;margin-bottom:6px}
    .cm-stack span i{display:block;font-style:normal;font-size:10.5px;opacity:.55;margin-top:2px}
    .cm-stack input{width:100%;padding:11px 12px;border-radius:10px;
      border:1px solid rgba(172,30,85,.25);background:#fff;color:#3a1524;
      font-family:Verdana,sans-serif;font-size:13px;-webkit-appearance:none;appearance:none}
    .cm-stack input:focus{outline:none;border-color:#AC1E55;
      box-shadow:0 0 0 3px rgba(172,30,85,.14)}
    .cm-select{padding:9px 10px;border-radius:10px;border:1px solid rgba(172,30,85,.25);
      background:#fff;color:#3a1524;font-family:Verdana,sans-serif;font-size:12.5px;
      grid-column:2 / -1;width:100%}
    .cm-btnrow{display:flex;gap:10px;margin-bottom:12px}
    .cm-btnrow button{flex:1;padding:12px;border-radius:11px;font-size:12.5px;
      cursor:pointer;font-family:Verdana,sans-serif}
    .cm-btnrow button:disabled{opacity:.5}
    .cm-danger{border-color:rgba(172,30,85,.45)}
    /* The sync line is the only warning this machine can give, so it is allowed
       to be loud. Value, not hue: berry on a tint, never a new colour. */
    .cm-syncstate{font-size:12px;line-height:1.5;padding:10px 12px;border-radius:10px;
      background:rgba(172,30,85,.06);margin-bottom:14px;opacity:.75}
    .cm-syncstate.ok{background:rgba(172,30,85,.08);opacity:.8}
    .cm-syncstate.warn{background:rgba(172,30,85,.14);opacity:1}
    .cm-syncstate.bad{background:#AC1E55;color:#F6F1EA;opacity:1;font-weight:700}
    .cm-testwarn{font-size:12px;line-height:1.5;padding:10px 12px;border-radius:10px;
      background:#AC1E55;color:#F6F1EA;font-weight:700;margin:0 0 12px}
    .cm-adv{margin-bottom:12px;border:1px solid rgba(172,30,85,.16);border-radius:12px;
      padding:10px 12px}
    .cm-adv summary{cursor:pointer;font-size:12px;color:#AC1E55;font-weight:700;
      list-style:none}
    .cm-adv summary::-webkit-details-marker{display:none}
    .cm-adv summary::before{content:'▸ ';font-size:10px}
    .cm-adv[open] summary::before{content:'▾ '}
    .cm-log{max-height:230px;overflow:auto;-webkit-overflow-scrolling:touch;
      background:#fff;border:1px solid rgba(172,30,85,.16);border-radius:12px;
      padding:6px 4px;margin-bottom:12px;font-size:11.5px;line-height:1.45}
    .cm-log i{display:block;padding:10px 10px;opacity:.5;font-style:normal}
    .cm-log-row{display:flex;gap:10px;padding:5px 10px;align-items:baseline}
    .cm-log-row + .cm-log-row{border-top:1px solid rgba(172,30,85,.07)}
    .cm-log-row b{flex:0 0 auto;font-weight:400;opacity:.45;font-variant-numeric:tabular-nums}
    .cm-log-row span{flex:1;min-width:0;word-break:break-word}
    .cm-log-failed span,.cm-log-offline span{color:#AC1E55;font-weight:700}
    .cm-log-sent span,.cm-log-online span{opacity:.8}
    .cm-log-lead span{font-weight:700}
    .cm-log-start span,.cm-log-merge span{opacity:.55}
    `;
    const s = document.createElement('style');
    s.textContent = css;
    document.head.appendChild(s);
  }
}

/* One ceiling, shared by the slider and the number field so they can never
   disagree. 200 is far above any sane weight — the table is designed to sum to
   100 — but leaves room for someone to think in tenths of a percent. */
AdminPanel.MAX_WEIGHT = 200;
