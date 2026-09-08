/* ============================================================================
   CINNAMOOD — LEADS
   ----------------------------------------------------------------------------
   Every guest types their details before they are allowed to pull, and this
   file is where those details go.

   TWO COPIES, ON PURPOSE
   ----------------------
   1. THE IPAD. The lead is written to the iPad's own storage the instant it is
      accepted, before anything touches the network. This copy is what makes
      the machine work on a dead wifi connection, and it is what the CSV export
      in the staff panel reads from.

   2. THE SHEET. The lead is then posted to a Google Sheet (or any URL that
      accepts a POST) so it can be read from a phone, anywhere, at any time.

   The iPad copy is the one that must never fail, so it is written first and
   synchronously. The sheet copy is allowed to fail — no wifi, sheet moved,
   Google having a bad morning — so it is queued and retried until it lands.
   Nothing a guest does can be lost by the network being down.

   WHY THE SHEET IS THE IMPORTANT COPY
   -----------------------------------
   Browser storage is not a safe. iOS can evict a site's storage when the
   device runs low, "Clear History and Website Data" wipes it, and so does
   deleting the home-screen icon. The iPad copy is a working copy and a network
   buffer; the sheet is the record. If sync has been failing for days the staff
   panel says so in red, because a silent backlog is how a month of leads
   quietly turns into nothing.

   IDEMPOTENCY
   -----------
   Every lead carries an `id` generated on the iPad, and the sheet script skips
   an id it has already written. That is what makes retrying safe: a lead that
   was actually saved but whose reply we never got is sent again and harmlessly
   ignored, instead of appearing twice.
   ============================================================================ */

const LEADS_KEY = 'cinnamood.leads';
const LEADS_SETTINGS_KEY = 'cinnamood.leads.settings';
const LEADS_LOG_KEY = 'cinnamood.leads.log';

/* ---------------------------------------------------------------------------
   MATCHING TWO SETS OF DETAILS
   ---------------------------------------------------------------------------
   "The same details cannot be repeated" means we have to decide when two
   entries are the same person, and people do not type their own details the
   same way twice.

   Email is easy: trim and lowercase.

   Phone is not. The same handset is written +30 694 123 4567, 0030 6941234567
   and 694 123 4567 by three different people, and comparing those as strings
   finds no match at all — so the same person plays three times. Comparing only
   the LAST NINE DIGITS makes all three the same number, which is the behaviour
   we actually want. Nine is chosen because national subscriber numbers are
   almost always nine digits or fewer, so it strips country and trunk prefixes
   without reaching far enough back to collide with a genuinely different line.
   --------------------------------------------------------------------------- */
function normEmail(v) {
  return String(v == null ? '' : v).trim().toLowerCase();
}

function normPhone(v) {
  const d = String(v == null ? '' : v).replace(/\D+/g, '');
  return d.length > 9 ? d.slice(-9) : d;
}

/* ---------------------------------------------------------------------------
   VALIDATION
   Deliberately loose. This runs on a bakery counter, not a bank: the cost of
   rejecting a real customer's unusual name or a valid foreign number is far
   higher than the cost of one imperfect row in a spreadsheet. So it checks
   shape and length, never plausibility.
   --------------------------------------------------------------------------- */
const LEAD_LIMITS = { name: 60, email: 120, phone: 32 };

function validateLead(f) {
  const errs = {};
  const first = String(f.first || '').trim();
  const last = String(f.last || '').trim();
  const email = String(f.email || '').trim();
  const phone = String(f.phone || '').trim();

  if (!first) errs.first = 'Please add your first name';
  else if (first.length > LEAD_LIMITS.name) errs.first = 'That name is too long';

  if (!last) errs.last = 'Please add your last name';
  else if (last.length > LEAD_LIMITS.name) errs.last = 'That name is too long';

  // One @, something either side, and a dot in the domain. Anything stricter
  // than this starts rejecting addresses that genuinely deliver.
  if (!email) errs.email = 'Please add your email';
  else if (email.length > LEAD_LIMITS.email) errs.email = 'That email is too long';
  else if (!/^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(email)) errs.email = 'That email looks incomplete';

  const digits = phone.replace(/\D+/g, '');
  if (!phone) errs.phone = 'Please add your phone number';
  else if (phone.length > LEAD_LIMITS.phone) errs.phone = 'That number is too long';
  // 7 is the shortest real subscriber number; 15 is the E.164 ceiling.
  else if (digits.length < 7 || digits.length > 15) errs.phone = 'That number looks incomplete';

  return { ok: Object.keys(errs).length === 0, errs,
           clean: { first, last, email, phone } };
}

class LeadStore {
  constructor(opts = {}) {
    this.cfg = Object.assign({
      dedupeWindowDays: 0,     // 0 = the same details never play twice
      syncRetryMs: 45000,
      syncMaxBackoffMs: 300000,
      /* A request that never answers must not be waited on forever — see the
         abort in sync(). 30s is deliberately generous: the very first post
         also builds and formats the workbook, which is the slowest thing the
         sheet ever does. */
      syncTimeoutMs: 30000,
      logMax: 60
    }, opts);

    this.list = this._read();
    this.settings = this._readSettings();
    this.storageOk = true;
    this.lastSyncError = null;
    this.lastSyncAt = null;
    this.syncing = false;
    this._fails = 0;
    this._timer = null;
    this.onChange = () => {};
    this.log = this._readLog();

    this._reindex();

    /* Anything left over from a previous session goes out as soon as we can. */
    window.addEventListener('online', () => { this._note('online', 'Back online'); this.sync(); });
    window.addEventListener('offline', () => this._note('offline', 'Lost the connection'));
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this.sync();
    });

    /* TWO TABS.
       Staff open the site twice — a second tab, a stale one left from setting
       up — and each tab runs its own store over the SAME storage. Whichever
       tab wrote last would blindly overwrite the other's leads with its own
       in-memory list, silently deleting real guests. So when another tab
       writes, take its list as the truth and fold back anything only this tab
       knows about. */
    window.addEventListener('storage', e => {
      if (!e || e.key !== LEADS_KEY) return;
      this._mergeExternal();
    });

    this._note('start', 'Machine started');
    this._schedule(1500);
  }

  /* ---- the log ------------------------------------------------------------
     A kiosk cannot tell anyone it is unwell. Without a record of what
     happened, a staff member reporting "it stopped working yesterday" leaves
     nothing to go on — the counters only ever show the state right now. This
     is a short rolling record, kept on the iPad and shown in the panel. It
     holds no guest details, only what the machine did. */
  _readLog() {
    try {
      const raw = localStorage.getItem(LEADS_LOG_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.slice(-this.cfg.logMax) : [];
    } catch (e) { return []; }
  }

  _note(kind, message) {
    this.log.push({ t: Date.now(), kind: kind, m: String(message).slice(0, 160) });
    if (this.log.length > this.cfg.logMax) this.log = this.log.slice(-this.cfg.logMax);
    try {
      localStorage.setItem(LEADS_LOG_KEY, JSON.stringify(this.log));
    } catch (e) {
      /* The log is the first thing to give up its space — never let writing it
         be the reason a guest cannot be saved. */
      this.log = this.log.slice(-10);
      try { localStorage.setItem(LEADS_LOG_KEY, JSON.stringify(this.log)); } catch (e2) {}
    }
    this.onChange();
  }

  clearLog() {
    this.log = [];
    try { localStorage.removeItem(LEADS_LOG_KEY); } catch (e) {}
    this.onChange();
  }

  /* Fold another tab's version of the list together with this one. Union by
     id, newest wins on conflict, and `synced` is sticky — if either tab got
     confirmation from the sheet, the lead is on the sheet. */
  _mergeExternal() {
    const theirs = this._read();
    const byId = new Map();
    theirs.forEach(r => byId.set(r.id, r));
    this.list.forEach(mine => {
      const t = byId.get(mine.id);
      if (!t) { byId.set(mine.id, mine); return; }
      /* Whichever copy knows the pull's outcome is the later one. Taking this
         tab's copy unconditionally would erase a result the other tab had
         already recorded and sent. `synced` is sticky either way: if either
         tab heard back from the sheet, it is on the sheet. */
      const richer = (mine.won !== null && mine.won !== undefined) ? mine
                   : ((t.won !== null && t.won !== undefined) ? t : mine);
      byId.set(mine.id, Object.assign({}, t, mine, richer,
                                      { synced: !!(t.synced || mine.synced) }));
    });
    const merged = Array.from(byId.values())
                        .sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
    const grew = merged.length !== this.list.length;
    this.list = merged;
    this._reindex();
    if (grew) this._note('merge', 'Merged leads from another tab');
    this.onChange();
  }

  /* ---- reading and writing the iPad copy -------------------------------- */

  _read() {
    try {
      const raw = localStorage.getItem(LEADS_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.filter(r => r && r.id) : [];
    } catch (e) {
      /* Corrupt storage must not take the machine down with it. An unreadable
         list is treated as an empty one; the sheet still has everything that
         was ever synced, which is the whole reason there are two copies. */
      return [];
    }
  }

  _persist() {
    for (let attempt = 0; attempt < 40; attempt++) {
      try {
        localStorage.setItem(LEADS_KEY, JSON.stringify(this.list));
        this.storageOk = true;
        return true;
      } catch (e) {
        /* Out of room. Drop the OLDEST lead that is already safely on the
           sheet and try again — never an unsynced one, because for those this
           is the only copy in existence. */
        const i = this.list.findIndex(r => r.synced);
        if (i === -1) break;
        this.list.splice(i, 1);
      }
    }
    /* Still no room, and everything left is unsynced. Keep the list in memory
       so the session carries on and the sheet still gets it; the panel will
       show storage as failing. */
    this.storageOk = false;
    return false;
  }

  /* True while the only copy of at least one guest is this page's memory. */
  get atRisk() {
    return !this.storageOk && this.pending > 0;
  }

  _readSettings() {
    try {
      const raw = localStorage.getItem(LEADS_SETTINGS_KEY);
      const s = raw ? JSON.parse(raw) : {};

      /* A device's saved repeat rule is only honoured while it belongs to the
         same generation as the file. Bumping `settingsVersion` retires every
         saved rule at once.

         This exists because of a specific way to lose an event: testing mode is
         switched off in the file and deployed, but the one iPad where a staff
         member had opened the panel keeps its own saved -1 and goes on letting
         the same person play all night. Nothing on screen would say so, and
         every other machine would look correct. The address and passphrase are
         not versioned — those are a deliberate per-machine override, and a
         wrong one is obvious immediately. */
      const sameGeneration =
        Number(s.settingsVersion || 0) === Number(this.cfg.settingsVersion || 0);

      return {
        /* The file's address is the default; anything a staff member typed on
           this device wins. An empty saved value means "never set", not
           "deliberately blank", so it falls through to the default rather than
           leaving the machine with nowhere to send. */
        syncUrl: (typeof s.syncUrl === 'string' && s.syncUrl.trim())
                   ? s.syncUrl : (this.cfg.syncUrl || ''),
        syncKey: (typeof s.syncKey === 'string' && s.syncKey.trim())
                   ? s.syncKey : (this.cfg.syncKey || ''),
        settingsVersion: Number(this.cfg.settingsVersion || 0),
        dedupeWindowDays: (sameGeneration && Number.isFinite(Number(s.dedupeWindowDays)))
          ? Number(s.dedupeWindowDays) : this.cfg.dedupeWindowDays
      };
    } catch (e) {
      return { syncUrl: this.cfg.syncUrl || '', syncKey: this.cfg.syncKey || '',
               settingsVersion: Number(this.cfg.settingsVersion || 0),
               dedupeWindowDays: this.cfg.dedupeWindowDays };
    }
  }

  saveSettings(patch) {
    Object.assign(this.settings, patch);
    try {
      localStorage.setItem(LEADS_SETTINGS_KEY, JSON.stringify(this.settings));
    } catch (e) { /* nothing useful to do; the value stays live for this session */ }
    this._reindex();
    this.onChange();
    /* Connecting a sheet for the first time is exactly the moment a backlog
       should go out. Without this the queue sat there until the next guest or
       the next reload, because sync() gives up early when there is no URL and
       schedules no retry — there would have been nowhere to retry to. */
    this.sync();
  }

  /* ---- duplicate detection ---------------------------------------------- */

  /* -1 is TESTING MODE: the same details may play as often as they like.
     It exists so the machine can be demonstrated without inventing a new email
     address for every pull. It is not a setting to ship with. */
  get dedupeOff() { return Number(this.settings.dedupeWindowDays) < 0; }

  _reindex() {
    /* Rebuilt rather than maintained, so it can never drift from the list —
       and so changing the repeat window takes effect immediately. */
    this.emails = new Map();
    this.phones = new Map();
    if (this.dedupeOff) return;
    const cutoff = this._cutoff();
    this.list.forEach(r => {
      if (cutoff && new Date(r.ts).getTime() < cutoff) return;
      if (r.emailKey) this.emails.set(r.emailKey, r);
      if (r.phoneKey) this.phones.set(r.phoneKey, r);
    });
  }

  _cutoff() {
    const d = Number(this.settings.dedupeWindowDays) || 0;
    return d > 0 ? Date.now() - d * 86400000 : 0;
  }

  /* Testing mode lets the same person submit repeatedly, so the sheet would
     otherwise fill with rows that are obviously the same guest. Each repeat is
     still its own row (they each bought a pull), but they are marked, so the
     real leads can be told apart from the demo ones later. */
  _isRepeat(clean) {
    const e = normEmail(clean.email), p = normPhone(clean.phone);
    return this.list.some(r => r.emailKey === e || r.phoneKey === p);
  }

  /* Returns 'email', 'phone' or null. Checked against BOTH, because someone
     who is turned away for a repeated email will otherwise simply retype it
     with one letter changed and keep the same phone number. */
  findDuplicate(fields) {
    if (this.dedupeOff) return null;
    this._reindex();
    if (this.emails.has(normEmail(fields.email))) return 'email';
    if (this.phones.has(normPhone(fields.phone))) return 'phone';
    return null;
  }

  /* THE SAME QUESTION, ASKED OF THE SHEET.

     The check above only knows who has played on THIS iPad. That is not the
     rule: no email and no phone may play twice, full stop. Two machines would
     each happily let the same person play, and an iPad whose storage iOS
     cleared would forget everyone it had ever seen.

     The sheet has seen every guest from every machine, so it gets the final
     word — asked before the lever is handed over, not after.

     WHEN THE SHEET CANNOT BE REACHED it returns null, meaning "no answer", and
     the caller lets the guest play on the strength of the local check alone.
     That is a deliberate choice: refusing everyone the moment the venue wifi
     wobbles would take the machine down completely, which is a far bigger
     failure than one person managing a second pull during an outage. Every
     such moment is written to the activity log. */
  /* The sheet has just said it has never seen these details, so any record of
     them on THIS iPad is out of date — the row was deleted, or the sheet was
     cleared for a fresh start. Drop it, or the machine would go on refusing
     someone the record no longer contains, and clearing the sheet would only
     reset the devices that happened not to have met them.

     Only records already confirmed on the sheet are dropped. An unsynced one
     matching these details is a guest still queued to be written, so the sheet
     is about to see them and the refusal is correct. */
  forgetSynced(fields) {
    const e = normEmail(fields.email), p = normPhone(fields.phone);
    const before = this.list.length;
    this.list = this.list.filter(r =>
      !(r.synced && ((e && r.emailKey === e) || (p && r.phoneKey === p))));
    const dropped = before - this.list.length;
    if (dropped) {
      this._persist();
      this._reindex();
      this._note('forget', 'Sheet no longer has this guest — cleared ' +
                           dropped + ' stale record' + (dropped === 1 ? '' : 's'));
      this.onChange();
    }
    return dropped;
  }

  async askSheet(fields, timeoutMs) {
    if (this.dedupeOff) return null;
    const url = (this.settings.syncUrl || '').trim();
    if (!url || !navigator.onLine) return null;

    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const killer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs || 7000) : null;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          key: this.settings.syncKey || '',
          check: { email: fields.email, phone: fields.phone }
        }),
        signal: ctrl ? ctrl.signal : undefined
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const json = JSON.parse(await res.text());
      if (json.ok !== true) throw new Error(json.error || 'refused');
      return json.seen ? (json.field || 'email') : false;
    } catch (err) {
      this._note('checkfail',
        'Could not ask the sheet whether this guest had played: ' +
        ((err && err.message) ? err.message : String(err)));
      return null;
    } finally {
      if (killer) clearTimeout(killer);
    }
  }

  /* ---- adding ------------------------------------------------------------ */

  add(fields, extra = {}) {
    const v = validateLead(fields);
    if (!v.ok) return { ok: false, reason: 'invalid', errs: v.errs };

    const dup = this.findDuplicate(v.clean);
    if (dup) return { ok: false, reason: 'duplicate', field: dup };

    const rec = {
      id: 'L' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      ts: new Date().toISOString(),
      first: v.clean.first,
      last: v.clean.last,
      email: v.clean.email,
      phone: v.clean.phone,
      emailKey: normEmail(v.clean.email),
      phoneKey: normPhone(v.clean.phone),
      // What the guest was actually shown when they handed these over. Stored
      // per lead rather than looked up later, because the wording may change
      // and consent is only ever evidence of what was on screen at the time.
      consent: extra.consent || '',
      repeat: this.dedupeOff && this._isRepeat(v.clean),
      prize: '',
      prizeId: '',
      won: null,
      synced: false
    };

    this.list.push(rec);
    const stored = this._persist();
    this._reindex();
    this._note('lead', 'Guest saved' + (stored ? '' : ' — BUT NOT TO STORAGE'));
    this.onChange();
    this.sync();
    return { ok: true, record: rec };
  }

  /* The result of the pull this lead paid for. Written back onto the same row
     rather than a second one, so the sheet reads one line per guest. */
  attachResult(id, result) {
    const rec = this.list.find(r => r.id === id);
    if (!rec) return;
    rec.prize = result && result.prize ? result.prize.label : '';
    rec.prizeId = result && result.prize ? result.prize.id : '';
    rec.won = !!(result && result.isWin);
    rec.synced = false;          // the row changed, so send it again
    this._persist();
    this.onChange();
    this.sync();
  }

  /* ---- counts ------------------------------------------------------------ */

  get count() { return this.list.length; }
  get pending() { return this.list.filter(r => !r.synced).length; }

  /* ---- the sheet copy ---------------------------------------------------- */

  _schedule(ms) {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.sync(), ms);
  }

  async sync() {
    if (this.syncing) return;
    const url = (this.settings.syncUrl || '').trim();
    const queue = this.list.filter(r => !r.synced);
    if (!url || !queue.length) return;
    if (!navigator.onLine) { this._schedule(this.cfg.syncRetryMs); return; }

    this.syncing = true;
    this.onChange();

    // Batched, but not unboundedly: a first sync after a long outage should not
    // try to push a thousand rows into one request that then times out.
    const batch = queue.slice(0, 25);

    /* A request that hangs — captive wifi portal, a dead socket the OS never
       tears down — used to leave `syncing` true for the rest of the session.
       Nothing ever cleared it, so every lead from that moment on lived only on
       the iPad while the panel cheerfully showed "Sending…". An unattended
       kiosk cannot recover from that, so the request is given a deadline. */
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const killer = ctrl ? setTimeout(() => ctrl.abort(), this.cfg.syncTimeoutMs) : null;

    try {
      /* text/plain is a CORS-safelisted content type, so the browser sends the
         POST directly. With application/json it would first send an OPTIONS
         preflight, which Google Apps Script does not answer — the request then
         fails before it ever reaches the sheet. The body is still JSON; only
         the declared type differs. */
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          key: this.settings.syncKey || '',
          leads: batch
        }),
        signal: ctrl ? ctrl.signal : undefined
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const body = await res.text();
      let json = null;
      try { json = JSON.parse(body); } catch (e) { /* handled below */ }
      if (!json || json.ok !== true) {
        throw new Error(json && json.error ? json.error :
          'The sheet replied with something unexpected');
      }

      /* ONLY the ids the sheet names are marked as saved.

         This used to fall back to "assume the whole batch landed" when the
         reply carried no list. That is the one shortcut in this file that
         could lose a guest silently: a sheet that saved three of five and said
         so vaguely would have had the other two marked done and never sent
         again. If the sheet will not say what it kept, the batch is a failure
         and gets retried — which is safe, because it dedupes on id. */
      if (!Array.isArray(json.saved)) {
        throw new Error('The sheet did not confirm which guests it saved');
      }
      const done = new Set(json.saved.map(String));
      let n = 0;
      this.list.forEach(r => { if (done.has(String(r.id)) && !r.synced) { r.synced = true; n++; } });
      this._persist();

      this._fails = 0;
      this.lastSyncError = null;
      this.lastSyncAt = Date.now();
      if (n) this._note('sent', n + (n === 1 ? ' guest' : ' guests') + ' to the sheet');

      // More waiting? Go round again, after a breath — Apps Script rate-limits
      // a client that hammers it.
      if (this.pending) this._schedule(this.cfg.batchGapMs || 600);
    } catch (err) {
      this._fails++;
      const aborted = err && (err.name === 'AbortError' || /abort/i.test(err.message || ''));
      this.lastSyncError = aborted
        ? 'The sheet did not answer in time'
        : (err && err.message ? err.message : String(err));
      this._note('failed', this.lastSyncError);
      /* Back off, but keep trying forever. A kiosk is unattended; giving up
         would mean the backlog only ever clears if someone happens to open the
         staff panel and press a button. */
      const wait = Math.min(this.cfg.syncRetryMs * Math.pow(1.8, this._fails - 1),
                            this.cfg.syncMaxBackoffMs);
      this._schedule(wait);
    } finally {
      /* In a finally, not in both branches. A throw from anywhere above — a
         JSON reviver, a storage failure inside _persist — would otherwise skip
         the reset and wedge syncing exactly as the hang used to. */
      if (killer) clearTimeout(killer);
      this.syncing = false;
      this.onChange();
    }
  }

  /* Used by the staff panel's Test button: proves the URL is reachable and the
     key is right WITHOUT writing a row, so it can be pressed as often as you
     like while setting it up. */
  async test(url, key) {
    const res = await fetch((url || '').trim(), {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ key: key || '', ping: true })
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = JSON.parse(await res.text());
    if (json.ok !== true) throw new Error(json.error || 'The sheet said no');
    return json;
  }

  /* ---- export ------------------------------------------------------------ */

  csv() {
    const head = ['Saved at', 'First name', 'Last name', 'Email', 'Phone',
                  'Result', 'Won', 'Repeat', 'On sheet', 'Consent shown', 'ID'];
    // A field containing a comma, a quote or a newline has to be quoted and its
    // quotes doubled, or one guest with a comma in their name shifts every
    // column after it.
    const q = v => {
      const s = String(v == null ? '' : v);
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const rows = this.list.map(r => [
      r.ts, r.first, r.last, r.email, r.phone,
      r.prize || '', r.won === null ? '' : (r.won ? 'yes' : 'no'),
      r.repeat ? 'yes' : '', r.synced ? 'yes' : 'no', r.consent || '', r.id
    ].map(q).join(','));
    /* The BOM is what stops Excel rendering an é as Ã©. */
    return '﻿' + [head.map(q).join(','), ...rows].join('\r\n');
  }

  clearAll() {
    this.list = [];
    try { localStorage.removeItem(LEADS_KEY); } catch (e) {}
    this._reindex();
    this.onChange();
  }
}
