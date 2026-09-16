/* ============================================================================
   CINNAMOOD — PRIZE BANK
   ----------------------------------------------------------------------------
   Decides what each pull wins. This replaced a plain weighted draw, which had
   no idea how many of anything was left: it could have handed out a dozen
   coffees and two T-shirts in an evening with one of each on the counter.

   THE RULES, AS AGREED FOR THE EVENT
   ----------------------------------
   1. STOCK IS A HARD LIMIT. Five coffees, one of everything else. A prize that
      has gone out never comes up again — not by chance, not by the staff
      panel's Force button.

   2. NOTHING IS WON BEFORE THE EVENT STARTS.

   3. WINNERS ARE SCATTERED ACROSS THE WHOLE DAY, AT RANDOM. Nobody knows how
      many guests will come, so fixed odds cannot work: odds set for 200 people
      leave prizes on the counter if 80 come, and run dry by lunchtime if 400
      do. Instead each regular prize is RELEASED at its own moment, and those
      moments are random: the day is cut into as many equal stretches as there
      are prizes, and each prize unlocks at a random point inside its stretch.
      That spreads them evenly over the day while no two days, and nobody
      watching, can predict when. The random schedule is drawn once and saved
      on the iPad, so a reload cannot reshuffle it. A released prize waits for
      the next guests and its chance rises the longer it waits, so it goes
      within a few pulls however busy the room is — and nothing can be won
      before its moment, so a rush cannot empty the machine.

   4. COFFEES ARE SPREAD OUT. Each coffee has its own earliest moment, so the
      five cannot all land early.

   5. EASIEST TO HARDEST. When a pull wins, WHICH prize it is follows the
      weights in config.js — coffee most likely, then the box of 2, 4, 6, then
      the mug and the T-shirt equally.

   6. THE JACKPOT IN ITS WINDOW (17:00–19:00). It is decided on its own, not in
      competition with the other prizes, and it unlocks at a random moment in
      the first part of its window. Its chance then climbs steeply, so with
      people playing it goes well before the window shuts. It can never be won
      before the window opens. If nobody won it inside the window — which only
      happens if almost nobody played — it stays in play afterwards at a high
      chance until it goes, so it cannot go home unclaimed. Regular prizes
      carry on before, during and after it.

   WHERE THE COUNT LIVES
   ---------------------
   Every pull is written to the iPad's storage at the instant it is DECIDED,
   before the reels have even started to slow. A reload mid-spin therefore
   cannot give a prize away twice: the guest who comes back is shown the same
   result they were already owed, and it is not counted a second time.

   The Google Sheet is a second copy. If the iPad's storage were ever wiped
   during the event, the machine asks the sheet which guests have won what,
   and counts every win either copy knows about — once per guest.
   ============================================================================ */

const PRIZE_LEDGER_KEY = 'cinnamood.prizes.ledger';
const PRIZE_REHEARSAL_KEY = 'cinnamood.prizes.rehearsal';
const PRIZE_SCHEDULE_KEY = 'cinnamood.prizes.schedule';

/* '2026-09-16T17:00' read as the iPad's own local time. Date.parse on a string
   without a zone is interpreted differently by different Safari versions, so it
   is taken apart by hand. */
function parseLocalTime(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(s || ''));
  if (!m) return NaN;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], 0, 0).getTime();
}

class PrizeBank {
  constructor(cfg, opts = {}) {
    this.cfg = cfg;
    this.now = opts.now || (() => Date.now());
    this.random = opts.random || Math.random;
    this.storage = opts.storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    this.log = opts.log || (() => {});
    this.forced = null;
    this.storageOk = true;
    /* Wins the sheet has reported for the real event, by Lead ID. Only ever
       added to within a session. */
    this.sheetWins = new Map();
    this._rev = 0;
    this._countCache = null;
    this.ledger = this._readLedger();

    const ev = cfg.event || {};
    const start = parseLocalTime(ev.start), end = parseLocalTime(ev.end);
    if (!(end > start)) {
      this.log('error', 'Event times in config.js are not valid — no prizes can be won');
    }
    const jf = parseLocalTime(ev.jackpotFrom), jt = parseLocalTime(ev.jackpotTo);
    if (!(jt > jf && jf >= start && jt <= end)) {
      this.log('error', 'The jackpot window in config.js is not valid — the jackpot cannot be won');
    }
  }

  /* ---- the day's random schedule ----------------------------------------
     Drawn once per run (the event, or each rehearsal) and saved, so a reload
     finds the same moments rather than rolling new ones. If storage is lost a
     new schedule is drawn; stock still cannot be exceeded either way. */
  schedule(w) {
    w = w || this.window();
    if (this._sched && this._sched.run === w.run) return this._sched;
    const R = this._regularUnits();
    let s = null;
    try { s = JSON.parse((this.storage && this.storage.getItem(PRIZE_SCHEDULE_KEY)) || 'null'); }
    catch (e) { s = null; }
    const valid = s && s.run === w.run && Array.isArray(s.regular) && s.regular.length === R &&
                  s.regular.every(t => Number.isFinite(t)) && Number.isFinite(s.jackpot);
    if (!valid) {
      s = this._makeSchedule(w, R);
      try { this.storage.setItem(PRIZE_SCHEDULE_KEY, JSON.stringify(s)); } catch (e) {}
    }
    this._sched = s;
    return s;
  }

  _makeSchedule(w, R) {
    const ev = this.cfg.event;
    const span = (w.end - w.start) * ev.releaseSpan;
    const regular = [];
    // One random moment inside each equal stretch: even coverage, random timing.
    for (let k = 0; k < R; k++) regular.push(w.start + ((k + this.random()) / R) * span);
    const jw = this.jackpotWindow(w);
    const jackpot = jw.from + this.random() * ev.jackpotReleaseBy * (jw.to - jw.from);
    return { run: w.run, regular, jackpot };
  }

  /* The jackpot window, placed within whatever run is live. For the real event
     that is exactly 17:00–19:00; a rehearsal gets the same share of its own
     shorter timeline. */
  jackpotWindow(w) {
    w = w || this.window();
    const ev = this.cfg.event;
    const es = parseLocalTime(ev.start), ee = parseLocalTime(ev.end);
    const jf = (parseLocalTime(ev.jackpotFrom) - es) / (ee - es);
    const jt = (parseLocalTime(ev.jackpotTo) - es) / (ee - es);
    const dur = w.end - w.start;
    return { from: w.start + jf * dur, to: w.start + jt * dur };
  }

  _regularUnits() {
    return this.cfg.prizes.filter(p => p.tier !== 'none' && p.tier !== 'jackpot')
      .reduce((s, p) => s + Math.max(0, p.stock | 0), 0);
  }

  /* ---- which schedule is running -------------------------------------- */

  /* The real event, unless a rehearsal is running. A rehearsal is the same
     schedule squeezed into a few minutes so it can be watched before the day.
     It keeps its own count, can never overlap the real event, and stops
     applying the moment the real event starts. */
  window() {
    const ev = this.cfg.event || {};
    const start = parseLocalTime(ev.start), end = parseLocalTime(ev.end);
    const now = this.now();
    const r = this._readRehearsal();
    if (r && now < start && now - r.start < 12 * 3600000) {
      return { run: r.run, start: r.start, end: r.end, rehearsal: true };
    }
    return { run: 'event:' + ev.start, start, end, rehearsal: false };
  }

  /* `kind` is 'rehearsal' (the panel's quick run), 'test' (test mode's loop)
     or 'sim' (the full event simulation). All work identically; the name only
     lets the machine tell them apart — so a round left behind by test mode can
     be thrown away the moment the real machine starts, instead of handing out
     prizes before the event. */
  startRehearsal(minutes, kind) {
    const ev = this.cfg.event || {};
    const now = this.now();
    const len = Math.max(2, Number(minutes) || 20) * 60000;
    if (now + len > parseLocalTime(ev.start)) {
      return { ok: false, reason: 'A rehearsal cannot run into the real event.' };
    }
    const prefix = (kind === 'sim' || kind === 'test') ? kind : 'rehearsal';
    const r = { run: prefix + ':' + now, start: now, end: now + len };
    try { this.storage.setItem(PRIZE_REHEARSAL_KEY, JSON.stringify(r)); }
    catch (e) { return { ok: false, reason: 'This iPad would not save the rehearsal.' }; }
    // Old rehearsals are of no further use; the real event is never touched.
    this.ledger = this.ledger.filter(e => !/^(rehearsal|sim|test):/.test(e.run));
    this._rev++;
    this._persist();
    this.log('prize', 'Rehearsal started — ' + Math.round(len / 60000) + ' minutes');
    return { ok: true };
  }

  endRehearsal() {
    try { this.storage.removeItem(PRIZE_REHEARSAL_KEY); } catch (e) {}
    this.log('prize', 'Rehearsal ended');
  }

  _readRehearsal() {
    try {
      const r = JSON.parse(this.storage.getItem(PRIZE_REHEARSAL_KEY) || 'null');
      return (r && r.run && r.end > r.start) ? r : null;
    } catch (e) { return null; }
  }

  /* ---- counting ---------------------------------------------------------- */

  /* Wins are counted as a UNION BY GUEST across the iPad and the sheet — never
     as "whichever count is higher". Taking the higher count looked safe and was
     not: after a wipe, the sheet says 2 coffees, the iPad goes on to give its
     own, and max(2, 1) stays 2 while a third coffee has gone out. Each guest's
     win is counted once, whichever copy knows about it. */
  given(id, w) {
    w = w || this.window();
    const key = w.run + '|' + this._rev;
    if (!this._countCache || this._countCache.key !== key) {
      const byPrize = {};
      const add = (prize, k) => (byPrize[prize] = byPrize[prize] || new Set()).add(k);
      const elsewhere = new Set();
      for (const e of this.ledger) {
        if (e.run === w.run) add(e.prize, e.lead ? 'L:' + e.lead : 'T:' + e.t);
        else if (e.lead) elsewhere.add(e.lead);
      }
      /* A guest this iPad already filed under a demo or a rehearsal is not
         counted again from the sheet. */
      if (!w.rehearsal) {
        this.sheetWins.forEach((prize, lead) => {
          if (!elsewhere.has(lead)) add(prize, 'L:' + lead);
        });
      }
      const counts = {};
      Object.keys(byPrize).forEach(p => counts[p] = byPrize[p].size);
      this._countCache = { key, counts };
    }
    return this._countCache.counts[id] || 0;
  }

  left(id, w) {
    const p = this._byId(id);
    if (!p || p.tier === 'none') return Infinity;
    return Math.max(0, (p.stock | 0) - this.given(id, w));
  }

  applySheetWins(list) {
    if (!Array.isArray(list)) return;
    list.forEach(x => {
      if (!x || !x.lead || !x.prize) return;
      const lead = String(x.lead);
      if (this.sheetWins.has(lead)) return;
      this.sheetWins.set(lead, String(x.prize));
      this._rev++;
    });
  }

  async refreshFromSheet(url, key, fetchImpl) {
    const w = this.window();
    url = String(url || '').trim();
    if (w.rehearsal || !url || !(w.start > 0)) return null;
    const f = fetchImpl || (typeof fetch === 'function' ? fetch : null);
    if (!f) return null;
    try {
      const res = await f(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        /* A few minutes before the start: the sheet dates each row by when the
           guest typed their details, which can be just before they pulled. */
        body: JSON.stringify({ key: key || '',
                               wins: { since: new Date(w.start - 5 * 60000).toISOString() } })
      });
      const json = JSON.parse(await res.text());
      if (!json || json.ok !== true || !Array.isArray(json.wins)) return null;
      this.applySheetWins(json.wins);
      return json.wins;
    } catch (e) {
      return null;
    }
  }

  /* ---- the plan for this instant ----------------------------------------
     Pure: reads the clock and the counts, changes nothing. Used by decide()
     and by the staff panel to show what the machine is currently allowed to
     give away. */
  plan(w, now) {
    w = w || this.window();
    now = now === undefined ? this.now() : now;
    const ev = this.cfg.event;
    const dur = w.end - w.start;
    const f = (now - w.start) / dur;
    const S = ev.releaseSpan;

    const stocked = this.cfg.prizes.filter(p => p.tier !== 'none' && (p.stock | 0) > 0);
    const regular = stocked.filter(p => p.tier !== 'jackpot');
    const jackpots = stocked.filter(p => p.tier === 'jackpot');

    const R = regular.reduce((s, p) => s + (p.stock | 0), 0);
    const givenR = regular.reduce((s, p) => s + Math.min(p.stock | 0, this.given(p.id, w)), 0);

    const out = { w, now, f, R, givenR, released: 0, releaseAt: () => NaN,
                  regular: [], jackpot: [], pR: 0, pJ: 0,
                  jackpotFrom: NaN, jackpotTo: NaN, jackpotAt: NaN };
    if (!(dur > 0)) return out;

    const sch = this.schedule(w);
    const releaseAt = k => (k < sch.regular.length ? sch.regular[k] : Infinity);
    let released = 0;
    while (released < R && releaseAt(released) <= now) released++;
    const jw = this.jackpotWindow(w);
    Object.assign(out, { released, releaseAt, jackpotFrom: jw.from, jackpotTo: jw.to,
                         jackpotAt: sch.jackpot });
    if (now < w.start) return out;

    if (givenR < released) {
      const unlockOf = p => w.start + (this.given(p.id, w) / (p.stock | 0)) * S * dur;
      out.regular = regular.filter(p =>
        this.given(p.id, w) < (p.stock | 0) && now >= unlockOf(p));
      if (out.regular.length) {
        const since = Math.max(releaseAt(givenR),
                               Math.min(...out.regular.map(unlockOf)));
        out.pR = this._chance(now - since, released - givenR, f);
      }
    }

    /* The jackpot: only from its random release moment, never before its
       window opens. Late in the window its chance is held high so it goes
       while the window is still open; if it somehow did not, it stays in play
       after the window at that same high chance (when jackpotAfterWindow). */
    jackpots.forEach(j => {
      if (ev.jackpotHold) return;                 // on hold: only staff can force it
      if (this.given(j.id, w) >= (j.stock | 0)) return;
      if (!(now >= sch.jackpot && now >= jw.from)) return;
      const late = now >= jw.to;
      if (late && !ev.jackpotAfterWindow) return;
      out.jackpot.push(j);
      out.jackpotLate = late;
      let p = this._chance(now - sch.jackpot, 1, 0);
      if (late || now >= jw.from + ev.jackpotFloorFrom * (jw.to - jw.from)) p = Math.max(p, ev.jackpotFloor);
      out.pJ = Math.min(1, Math.max(0, p));
    });

    return out;
  }

  _chance(waitMs, backlog, f) {
    const ev = this.cfg.event, c = ev.chance;
    let p = c.base + c.perMinute * Math.max(0, waitMs) / 60000
                   + c.perBacklog * Math.max(0, backlog - 1);
    if (f >= ev.finalStretch) p = Math.max(p, c.finalFloor);
    return Math.min(c.max, Math.max(0, p));
  }

  /* ---- deciding a pull --------------------------------------------------- */

  forceNext(id) { this.forced = id || null; }

  decide(leadId) {
    this._mergeFromDisk();
    const none = this._none();

    /* A guest who already has a decided pull — the page reloaded while their
       reels were turning — gets exactly that result again, uncounted. */
    if (leadId) {
      const prev = this.ledger.find(e => e.lead === leadId);
      if (prev) {
        this.log('prize', 'Replaying the result this guest was already owed');
        return this._byId(prev.prize) || none;
      }
    }

    const w = this.window();
    const now = this.now();
    const before = !(now >= w.start);
    let prize = null, forced = false;

    if (this.forced) {
      const want = this._byId(this.forced);
      this.forced = null;
      /* Before the event nothing is being counted, so a demo may show
         anything. From the start, a forced prize still has to be in stock. */
      if (want && (want.tier === 'none' || before || this.left(want.id, w) > 0)) {
        prize = want; forced = true;
      } else if (want) {
        this.log('prize', 'Force refused — ' + want.label + ' has all gone');
      }
    }

    if (!prize) prize = this._draw(w, now);

    /* The last word, whatever path got here. */
    if (prize.tier !== 'none' && !before && this.left(prize.id, w) <= 0) {
      this.log('error', 'Blocked a ' + prize.label + ' that was out of stock');
      prize = none;
    }

    this._record({ run: before ? 'demo' : w.run, lead: leadId || null,
                   prize: prize.id, t: now, forced: forced || undefined });
    if (prize.tier !== 'none') {
      this.log('prize', prize.label + (forced ? ' (forced)' : '') + ' — ' +
               (before ? 'before the event, not counted'
                       : this.left(prize.id, w) + ' left'));
    }
    return prize;
  }

  _draw(w, now) {
    const none = this._none();
    const plan = this.plan(w, now);

    /* The jackpot is rolled on its own first. If it shared one roll with the
       regular prizes, a backlog of coffees waiting at 18:30 could keep
       winning the draw and push the jackpot past its window. */
    if (plan.pJ > 0 && plan.jackpot.length && this.random() < plan.pJ) return plan.jackpot[0];

    const pool = plan.regular;
    if (!(plan.pR > 0) || !pool.length || this.random() >= plan.pR) return none;
    const weightOf = x => Math.max(0, Number(x.weight) || 0);
    const total = pool.reduce((s, x) => s + weightOf(x), 0);
    if (total <= 0) return pool[Math.floor(this.random() * pool.length)];
    let r = this.random() * total;
    for (const x of pool) { r -= weightOf(x); if (r < 0) return x; }
    return pool[pool.length - 1];
  }

  /* ---- storage ----------------------------------------------------------- */

  _none() {
    return this.cfg.prizes.find(p => p.tier === 'none') ||
           { id: 'none', tier: 'none', symbol: null, label: 'Not This Time', sub: '' };
  }

  _byId(id) { return this.cfg.prizes.find(p => p.id === id) || null; }

  _readLedger() {
    try {
      const arr = JSON.parse((this.storage && this.storage.getItem(PRIZE_LEDGER_KEY)) || '[]');
      return Array.isArray(arr)
        ? arr.filter(e => e && typeof e.run === 'string' && typeof e.prize === 'string')
        : [];
    } catch (e) { return []; }
  }

  /* Another tab may have pulled since this one last looked. Union, never
     replace: an entry this tab could not write to storage must not vanish. */
  _mergeFromDisk() {
    const disk = this._readLedger();
    const k = e => e.run + '|' + e.lead + '|' + e.t + '|' + e.prize;
    const seen = new Set(this.ledger.map(k));
    let added = false;
    disk.forEach(e => { if (!seen.has(k(e))) { this.ledger.push(e); seen.add(k(e)); added = true; } });
    if (added) { this.ledger.sort((a, b) => a.t - b.t); this._rev++; }
  }

  _record(e) {
    if (e.forced === undefined) delete e.forced;
    this.ledger.push(e);
    this._rev++;
    this._persist();
  }

  _persist() {
    // Demo, rehearsal and simulation pulls are trimmed; the real event's never are.
    const keep = this.ledger.filter(e => /^event:/.test(e.run));
    const other = this.ledger.filter(e => !/^event:/.test(e.run)).slice(-400);
    this.ledger = keep.concat(other).sort((a, b) => a.t - b.t);
    try {
      this.storage.setItem(PRIZE_LEDGER_KEY, JSON.stringify(this.ledger));
      this.storageOk = true;
    } catch (e) {
      /* Still counted in memory for this session, so nothing is given twice
         while the page stays up; the sheet is the copy that survives. */
      if (this.storageOk) this.log('error', 'Could not save the prize count to this iPad');
      this.storageOk = false;
    }
  }
}
