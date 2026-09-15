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

   3. WINNERS ARE SCATTERED, NOT FRONT-LOADED. Nobody knows how many guests will
      come, so fixed odds cannot work: odds set for 200 people leave prizes on
      the counter if 80 come, and odds set for 80 run dry in the first hour if
      200 do. Instead the regular prizes are RELEASED one at a time on a clock
      across the event. A released prize waits for the next guests, and its
      chance of coming up rises the longer it waits, so it goes within a few
      pulls however busy or quiet the room is. A prize cannot be won before it
      has been released, so a rush at the door cannot empty the machine.

   4. COFFEES ARE SPREAD OUT. Each coffee has its own earliest moment, so the
      five cannot all land in the first half hour.

   5. EASIEST TO HARDEST. When a pull wins, WHICH prize it is follows the
      weights in config.js — coffee most likely, then the box of 2, 4, 6, then
      the mug and the T-shirt equally. The harder prizes therefore tend to be
      the ones still waiting late in the evening.

   6. THE JACKPOT COMES LAST. Never before the halfway point. After that it
      comes into play once every other prize has gone — or, if the room was
      quiet and some are still left late on, at a fixed late moment anyway, so
      it cannot go home unclaimed.

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

  /* `kind` is 'rehearsal' (the panel's quick run, and test mode's loop) or
     'sim' (the full event simulation). Both work identically; the name only
     lets the machine tell them apart, so a leftover quick rehearsal can never
     be mistaken for a simulation somebody pressed Start on. */
  startRehearsal(minutes, kind) {
    const ev = this.cfg.event || {};
    const now = this.now();
    const len = Math.max(2, Number(minutes) || 20) * 60000;
    if (now + len > parseLocalTime(ev.start)) {
      return { ok: false, reason: 'A rehearsal cannot run into the real event.' };
    }
    const r = { run: (kind === 'sim' ? 'sim' : 'rehearsal') + ':' + now, start: now, end: now + len };
    try { this.storage.setItem(PRIZE_REHEARSAL_KEY, JSON.stringify(r)); }
    catch (e) { return { ok: false, reason: 'This iPad would not save the rehearsal.' }; }
    // Old rehearsals are of no further use; the real event is never touched.
    this.ledger = this.ledger.filter(e => !/^(rehearsal|sim):/.test(e.run));
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
    const releaseAt = k => w.start + (R ? k / R : 0) * S * dur;
    let released = 0;
    if (dur > 0) while (released < R && releaseAt(released) <= now) released++;

    const out = { w, now, f, R, givenR, released, releaseAt,
                  regular: [], jackpot: [], pR: 0, pJ: 0,
                  jackpotSince: null };
    if (!(dur > 0) || now < w.start) return out;

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

    jackpots.forEach(j => {
      if (this.given(j.id, w) >= (j.stock | 0)) return;
      const notBefore = w.start + ev.jackpotNotBefore * dur;
      const fallback = w.start + Math.max(ev.jackpotFallback, ev.jackpotNotBefore) * dur;
      let since;
      if (givenR >= R) {
        /* When the last regular prize went. If the count came from the sheet
           and this iPad has no record of the moment, assume the latest it
           could have been — the last release. */
        let lastT = 0;
        for (const e of this.ledger) {
          if (e.run === w.run && regular.some(p => p.id === e.prize)) lastT = Math.max(lastT, e.t);
        }
        since = Math.min(Math.max(notBefore, lastT || releaseAt(Math.max(0, R - 1))), fallback);
      } else {
        since = fallback;
      }
      out.jackpotSince = since;
      if (now >= since && now >= notBefore) {
        out.jackpot.push(j);
        out.pJ = this._chance(now - since, 1, f);
      }
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
    const p = Math.max(plan.pR, plan.pJ);
    if (!(p > 0) || this.random() >= p) return none;

    const pool = [].concat(plan.pR > 0 ? plan.regular : [], plan.pJ > 0 ? plan.jackpot : []);
    if (!pool.length) return none;
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
