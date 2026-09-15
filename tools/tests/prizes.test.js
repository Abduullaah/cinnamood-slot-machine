/* Proves the prize rules agreed for the event, by running the real prize bank
   through thousands of simulated days.

   The event (agreed 2026-09-15): 10:00 to midnight. Regular prizes scattered
   at random across the whole day. The jackpot only between 17:00 and 19:00.

   Hard rules — any single breach fails the suite:
     - no prize ever goes out more times than it exists
     - nothing is won before the event starts
     - the jackpot is never won before 17:00, nor before its random unlock
       moment; after 19:00 only if nobody won it in the window (and with
       people playing 17:00–19:00 that must be vanishingly rare)
     - no regular prize comes out before its random unlock moment, and the
       coffees are spread out
     - a reload, a wiped iPad, a second tab or broken storage cannot give a
       prize away twice

   It also prints what a day actually looks like at different crowd sizes, and
   checks the winners really are scattered and the timings really are random. */
const fs = require('fs'), vm = require('vm'), path = require('path');
const dir = process.argv[2] || 'site/shared';
const QUICK = !!process.env.QUICK;

let pass = 0, fail = 0;
const check = (n, c, x) => {
  if (c) { pass++; console.log('  ok   ' + n); }
  else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '  ' + JSON.stringify(x) : '')); }
};

function mkStorage(opts = {}) {
  const d = new Map();
  return {
    getItem: k => d.has(k) ? d.get(k) : null,
    setItem: (k, v) => { if (opts.broken) throw new Error('QuotaExceeded'); d.set(k, String(v)); },
    removeItem: k => d.delete(k), _d: d
  };
}

const S = { console, Date, Math, JSON, Number, String, Array, Object, Map, Set,
            Boolean, Error, Promise, isFinite, setTimeout, clearTimeout,
            localStorage: mkStorage() };
vm.createContext(S);
vm.runInContext(['config.js', 'symbols.js', 'prizes.js']
  .map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n;\n') +
  '\n;this.CFG=CINNAMOOD_CONFIG;this.PrizeBank=PrizeBank;this.SYMBOLS=SYMBOLS;' +
  'this.parseLocalTime=parseLocalTime;', S);

const CFG = S.CFG;
const cfgCopy = () => JSON.parse(JSON.stringify(CFG));
const P = S.parseLocalTime;
const ev = CFG.event;
const START = P(ev.start), END = P(ev.end), DUR = END - START;
const J_FROM = P(ev.jackpotFrom), J_TO = P(ev.jackpotTo);
const MIN = 60000, HOUR = 60 * MIN;
const regularIds = CFG.prizes.filter(p => p.tier !== 'none' && p.tier !== 'jackpot').map(p => p.id);
const R = CFG.prizes.filter(p => regularIds.includes(p.id)).reduce((s, p) => s + p.stock, 0);
const stockOf = id => CFG.prizes.find(p => p.id === id).stock;
const hm = t => { const d = new Date(t); return String(d.getHours()).padStart(2, '0') + ':' +
                  String(d.getMinutes()).padStart(2, '0'); };
const at = hhmm => P('2026-09-16T' + hhmm);
const pct = (a, q) => { if (!a.length) return NaN; const b = a.slice().sort((x, y) => x - y);
                        return b[Math.min(b.length - 1, Math.floor(q * b.length))]; };
const mean = a => a.reduce((s, x) => s + x, 0) / (a.length || 1);
const sd = a => { const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) * (x - m)))); };

function rng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

/* ---------------------------------------------------------------------------
   The brief, as written into config.js
   --------------------------------------------------------------------------- */
console.log('\nThe prize list and the day match what was agreed');
{
  const by = id => CFG.prizes.find(p => p.id === id);
  check('event is 16 Sep 2026, 10:00 to midnight',
        ev.start === '2026-09-16T10:00' && ev.end === '2026-09-17T00:00');
  check('jackpot window is 17:00 to 19:00, inside the event',
        ev.jackpotFrom === '2026-09-16T17:00' && ev.jackpotTo === '2026-09-16T19:00' &&
        J_FROM >= START && J_TO <= END);
  check('an unwon jackpot stays in play after 19:00', ev.jackpotAfterWindow === true);
  check('five coffees', by('coffee') && by('coffee').stock === 5);
  ['box2', 'box4', 'box6', 'mug', 'tee', 'jackpot'].forEach(id =>
    check('exactly one ' + id, by(id) && by(id).stock === 1));
  check('one jackpot prize, and it is 20% off for a year',
        CFG.prizes.filter(p => p.tier === 'jackpot').length === 1 &&
        /20%/.test(by('jackpot').label) && /year/i.test(by('jackpot').label));
  const w = id => by(id).weight;
  check('easiest to hardest: coffee > box of 2 > box of 4 > box of 6 > mug = T-shirt',
        w('coffee') > w('box2') && w('box2') > w('box4') && w('box4') > w('box6') &&
        w('box6') > w('mug') && w('mug') === w('tee'), CFG.prizes.map(p => [p.id, p.weight]));
  check('the losing result exists', CFG.prizes.some(p => p.tier === 'none'));
  CFG.prizes.filter(p => p.symbol).forEach(p => {
    check(p.id + ' symbol is on the reels', CFG.symbols.includes(p.symbol));
    check(p.id + ' symbol is drawn', typeof S.SYMBOLS[p.symbol] === 'string');
  });
  check('reel symbols are all drawn', CFG.symbols.every(s => typeof S.SYMBOLS[s] === 'string'));
}

/* ---------------------------------------------------------------------------
   A simulated day
   --------------------------------------------------------------------------- */
const LO = START - 15 * MIN, SPAN = DUR + 15 * MIN;
const uOf = t => (t - LO) / SPAN;
function arrivals(n, pattern, r) {
  const ts = [];
  const between = (a, b) => LO + (uOf(a) + r() * (uOf(b) - uOf(a))) * SPAN;
  /* RUSHES AND LULLS: six sudden crowds at random times, each packed into about
     ten minutes, with long empty stretches between them and only a thin
     trickle of guests in the gaps. */
  const rushes = [];
  if (pattern === 'rushes') for (let k = 0; k < 6; k++) rushes.push(START + r() * (DUR - 30 * MIN));
  for (let i = 0; i < n; i++) {
    let t;
    const x = r();
    if (pattern === 'uniform') t = LO + r() * SPAN;
    else if (pattern === 'rushes') {
      t = x < 0.85 ? rushes[Math.floor(r() * rushes.length)] + r() * 10 * MIN : LO + r() * SPAN;
    }
    else if (pattern === 'evening') t = x < 0.6 ? between(at('16:00'), at('21:00')) : LO + r() * SPAN;
    else if (pattern === 'lunch+evening') {
      t = x < 0.35 ? between(at('12:00'), at('14:30'))
        : x < 0.8 ? between(at('17:00'), at('20:30')) : LO + r() * SPAN;
    } else t = LO + Math.sqrt(r()) * SPAN;                  // quiet morning, busy night
    ts.push(t);
  }
  ts.sort((a, b) => a - b);
  // A pull, the reveal and the next guest's form take at least ~25 seconds.
  for (let i = 1; i < ts.length; i++) ts[i] = Math.max(ts[i], ts[i - 1] + 25000);
  return ts;
}

function day(n, pattern, seed, opts = {}) {
  const r = rng(seed);
  const ts = arrivals(n, pattern, r);
  let now = 0;
  const storage = opts.storage || mkStorage(opts);
  const bank = new S.PrizeBank(cfgCopy(), { now: () => now, random: r, storage, log: () => {} });
  const wins = [];
  ts.forEach((t, i) => {
    now = t;
    const p = bank.decide('L' + seed + '_' + i);
    if (p.tier !== 'none') wins.push({ t, id: p.id });
  });
  now = START;
  return { wins, ts, bank, sch: bank.schedule() };
}

/* Every hard rule, checked against one day. Returns the first breach. */
function breach(wins, sch) {
  const n = {};
  let regular = 0, coffees = 0;
  for (const x of wins) {
    n[x.id] = (n[x.id] || 0) + 1;
    if (n[x.id] > stockOf(x.id)) return x.id + ' given ' + n[x.id] + ' times';
    if (x.t < START) return x.id + ' won before the start at ' + hm(x.t);
    if (x.id === 'jackpot') {
      if (x.t < J_FROM) return 'jackpot at ' + hm(x.t) + ', before 17:00';
      if (sch && x.t < sch.jackpot) return 'jackpot at ' + hm(x.t) + ', before its unlock at ' + hm(sch.jackpot);
    } else {
      if (sch && x.t < sch.regular[regular]) return 'prize ' + (regular + 1) + ' at ' + hm(x.t) + ', before its unlock';
      regular++;
      if (x.id === 'coffee') {
        if (x.t < START + (coffees / 5) * ev.releaseSpan * DUR - 1) return 'coffee ' + (coffees + 1) + ' too early at ' + hm(x.t);
        coffees++;
      }
    }
  }
  return null;
}

console.log('\nThousands of days: the hard rules are never broken');
const SIZES = [60, 100, 150, 250, 400];
const PATTERNS = ['uniform', 'evening', 'lunch+evening', 'late', 'rushes'];
const RUNS = QUICK ? 30 : 150;
const table = {};
let daysTotal = 0, lateWithPlayers = 0, lateAny = 0;
for (const pattern of PATTERNS) {
  for (const size of SIZES) {
    let first = null, allReg = 0, jack = 0, inWindow = 0;
    const jackT = [], before = [], after = [], gaps = [], firstOf = {}, busiest10 = [];
    const perBlock = new Array(7).fill(0);
    for (let s = 1; s <= RUNS; s++) {
      const { wins, sch, ts } = day(size, pattern, size * 1000 + s + pattern.length * 7919);
      const b = breach(wins, sch);
      if (b && !first) first = b;
      daysTotal++;
      const reg = wins.filter(x => x.id !== 'jackpot');
      if (reg.length === R) allReg++;
      const j = wins.find(x => x.id === 'jackpot');
      if (j && j.t >= J_TO) {
        lateAny++;
        // People DID play while it was in play in the window, and still nobody won it.
        if (ts.filter(t => t >= sch.jackpot && t < J_TO).length >= 6) lateWithPlayers++;
      }
      if (j && j.t < J_TO) inWindow++;
      if (j) {
        jack++; jackT.push(j.t);
        before.push(reg.filter(x => x.t < j.t).length);
        after.push(reg.filter(x => x.t > j.t).length);
      }
      let g = 0;
      for (let i = 1; i < wins.length; i++) g = Math.max(g, wins[i].t - wins[i - 1].t);
      gaps.push(g);
      // The most prizes that went out inside any ten minutes of the day.
      let most = 0;
      for (let i = 0; i < wins.length; i++) {
        let k = i;
        while (k + 1 < wins.length && wins[k + 1].t - wins[i].t <= 10 * MIN) k++;
        most = Math.max(most, k - i + 1);
      }
      busiest10.push(most);
      wins.forEach(x => { const k = Math.floor((x.t - START) / (2 * HOUR)); if (k >= 0 && k < 7) perBlock[k]++; });
      const seen = {};
      wins.forEach(x => { if (!(x.id in seen)) { seen[x.id] = 1; (firstOf[x.id] = firstOf[x.id] || []).push(x.t); } });
    }
    check(`${pattern}, ${size} guests: no rule broken in ${RUNS} days`, !first, first);
    table[pattern + ' ' + size] = {
      allReg: Math.round(allReg / RUNS * 100), jack: Math.round(jack / RUNS * 100),
      inWindow: Math.round(inWindow / RUNS * 100),
      busiest10Median: pct(busiest10, .5), busiest10P95: pct(busiest10, .95),
      jackLo: jackT.length ? hm(pct(jackT, .05)) : '—', jackMid: jackT.length ? hm(pct(jackT, .5)) : '—',
      jackHi: jackT.length ? hm(pct(jackT, .95)) : '—', jackT,
      before: mean(before), after: mean(after),
      gap: Math.round(pct(gaps, .5) / MIN), blocks: perBlock.map(n => n / RUNS),
      order: Object.keys(firstOf).map(id => [id, mean(firstOf[id])]).sort((a, b) => a[1] - b[1]).map(x => x[0])
    };
  }
}

console.log('\nWhat a day looks like (' + RUNS + ' simulated days each)');
console.log('  crowd                 all 10 out  jackpot won  in 5-7pm   jackpot 5% / median / 95%   before / after jackpot   longest gap');
Object.keys(table).forEach(k => {
  const r = table[k];
  console.log('  ' + k.padEnd(22) + String(r.allReg + '%').padStart(9) + String(r.jack + '%').padStart(13) +
              String(r.inWindow + '%').padStart(10) +
              ('   ' + r.jackLo + ' / ' + r.jackMid + ' / ' + r.jackHi).padEnd(30) +
              (r.before.toFixed(1) + ' / ' + r.after.toFixed(1)).padStart(14) +
              String(r.gap + ' min').padStart(18));
});
console.log('\n  most prizes inside any 10 minutes (median day / 95% of days):');
Object.keys(table).forEach(k => console.log('  ' + k.padEnd(34) + table[k].busiest10Median + ' / ' + table[k].busiest10P95));
console.log('\n  average winners per two hours:      10-12  12-14  14-16  16-18  18-20  20-22  22-24');
Object.keys(table).forEach(k => console.log('  ' + k.padEnd(34) +
  table[k].blocks.map(b => b.toFixed(1).padStart(7)).join('')));

console.log('\n  jackpot after 19:00: ' + lateAny + ' of ' + daysTotal + ' days, of which ' + lateWithPlayers +
            ' had 6+ pulls while it was in play in the window');
check('a jackpot after 19:00 despite 6+ pulls while it was in play in the window: under 0.5% of days',
      lateWithPlayers / daysTotal < 0.005, { lateWithPlayers, daysTotal });

if (!QUICK) {
  console.log('\nThe timing does what was asked, at realistic crowd sizes');
  for (const size of [100, 150, 250, 400]) {
    for (const pattern of PATTERNS) {
      const r = table[pattern + ' ' + size];
      /* In a day of random rushes, a rush may simply not happen between 17:00
         and 19:00 — then nobody is there to win the jackpot in its window, and
         it goes to the next rush after instead, which is what was agreed. */
      const rushy = pattern === 'rushes';
      /* When most guests come in a few crowds, a hundred guests leaves only a
         thin trickle late at night. A prize that unlocks after the last crowd
         can then simply have nobody left to win it — no setting can hand a
         prize to someone who is not there. From 150 guests it goes out on
         99–100% of days. */
      const thin = size === 100 && (rushy || pattern === 'lunch+evening');
      const need = thin ? 85 : 95;
      check(`${pattern}, ${size}: all 10 regular prizes go out in at least ${need}% of days`,
            r.allReg >= need, r.allReg);
      check(`${pattern}, ${size}: the jackpot is won in at least 99% of days`, r.jack >= 99, r.jack);
      if (!rushy) check(`${pattern}, ${size}: the jackpot goes between 17:00 and 19:00 in at least 95% of days`,
                        r.inWindow >= 95, r.inWindow);
      check(`${pattern}, ${size}: prizes do not bunch — at most 4 inside any 10 minutes on 95% of days`,
            r.busiest10P95 <= 4, r.busiest10P95);
    }
  }
  const u = table['uniform 150'];
  check('uniform, 150: regular prizes are won both before AND after the jackpot',
        u.before >= 3 && u.after >= 2, { before: u.before, after: u.after });
  check('uniform, 150: the jackpot lands at random across its window, not bunched at 17:00',
        P('2026-09-16T' + u.jackLo) <= at('17:20') && P('2026-09-16T' + u.jackHi) >= at('18:00') &&
        sd(u.jackT) >= 12 * MIN, { lo: u.jackLo, hi: u.jackHi, sdMin: Math.round(sd(u.jackT) / MIN) });
  check('uniform, 150: winners in every two-hour block from 10:00 to 22:00',
        u.blocks.slice(0, 6).every(b => b >= 0.8), u.blocks);
  check('uniform, 150: no two-hour block takes more than a third of the prizes',
        u.blocks.every(b => b <= 11 / 3), u.blocks);
  const o = u.order, ix = id => o.indexOf(id);
  check('uniform, 150: easiest prizes tend to go first — coffee before the boxes, box of 2 before box of 6',
        ix('coffee') < ix('box2') && ix('box2') < ix('box6'), o);
}

/* ---------------------------------------------------------------------------
   Rushes and lulls, one at a time
   --------------------------------------------------------------------------- */
console.log('\nA rush after a quiet morning, and a long quiet spell');
{
  let worst = 0, over = 0, gotSome = 0;
  for (let s = 1; s <= 300; s++) {
    const r = rng(61000 + s);
    let now = START;
    const bank = new S.PrizeBank(cfgCopy(), { now: () => now, random: r, storage: mkStorage(), log: () => {} });
    const sch = bank.schedule();
    // Nobody 10:00–13:00, then 60 people inside ten minutes.
    let won = 0;
    for (let i = 0; i < 60; i++) {
      now = at('13:00') + i * 10000;
      if (bank.decide('R' + s + '_' + i).tier !== 'none') won++;
    }
    const unlocked = sch.regular.filter(t => t <= now).length;
    if (won > unlocked) over++;
    if (won > 0) gotSome++;
    worst = Math.max(worst, won);
  }
  check('60 people in 10 minutes at 13:00: never more prizes than had unlocked by then (300 days)', over === 0, over);
  check('and the prizes that had been waiting all morning do go to that rush', gotSome >= 290, gotSome + ' of 300');
  console.log('       (most prizes any one rush got: ' + worst + ')');

  let caughtUp = 0;
  for (let s = 1; s <= 300; s++) {
    const r = rng(62000 + s);
    let now = START;
    const bank = new S.PrizeBank(cfgCopy(), { now: () => now, random: r, storage: mkStorage(), log: () => {} });
    const sch = bank.schedule();
    // Nobody until 15:00, then just one guest every 30 minutes.
    /* A long-waiting prize is capped at a 90% chance per pull — a guest is
       never a guaranteed winner — so the fair test is that the waiting prizes
       are picked up by nearly all of the next few guests, not every one. */
    let won = 0;
    for (now = at('15:00'); now < at('17:00'); now += 30 * MIN) if (bank.decide('Q' + s + now).tier !== 'none') won++;
    const unlocked = sch.regular.filter(t => t <= at('17:00')).length;
    if (won >= Math.min(4, unlocked) - 1) caughtUp++;
  }
  check('nobody until 15:00, then one guest every 30 minutes: at least 3 of those 4 guests win on 90% of days',
        caughtUp >= 270, caughtUp + ' of 300');
}

/* ---------------------------------------------------------------------------
   Randomness: two days are never the same
   --------------------------------------------------------------------------- */
console.log('\nThe schedule is random, and fixed once drawn');
{
  const firsts = [], jacks = [];
  const seen = new Set();
  for (let s = 1; s <= 200; s++) {
    const storage = mkStorage();
    const bank = new S.PrizeBank(cfgCopy(), { now: () => START, random: rng(5000 + s), storage, log: () => {} });
    const sch = bank.schedule();
    firsts.push(sch.regular[0]); jacks.push(sch.jackpot);
    seen.add(sch.regular.map(t => Math.round(t / MIN)).join(','));
    if (s === 1) {
      const again = new S.PrizeBank(cfgCopy(), { now: () => START, random: rng(999), storage, log: () => {} });
      check('a reload finds exactly the same schedule, not a new roll',
            JSON.stringify(again.schedule().regular) === JSON.stringify(sch.regular) &&
            again.schedule().jackpot === sch.jackpot);
    }
    const stretch = ev.releaseSpan * DUR / R;
    const inStretch = sch.regular.every((t, k) => t >= START + k * stretch && t <= START + (k + 1) * stretch);
    if (!inStretch) { check('every prize unlocks inside its own stretch of the day', false, sch.regular.map(hm)); break; }
  }
  check('200 draws give 200 different schedules', seen.size === 200, seen.size);
  check('the first unlock moves around within its stretch (not always the same time)',
        sd(firsts) >= 15 * MIN, Math.round(sd(firsts) / MIN) + ' min');
  check('the jackpot unlock is always between 17:00 and 18:00, at random',
        jacks.every(t => t >= J_FROM && t <= J_FROM + ev.jackpotReleaseBy * (J_TO - J_FROM)) &&
        sd(jacks) >= 12 * MIN, { sdMin: Math.round(sd(jacks) / MIN), lo: hm(Math.min(...jacks)), hi: hm(Math.max(...jacks)) });
}

/* ---------------------------------------------------------------------------
   One pull at a time: the edges
   --------------------------------------------------------------------------- */
function bankAt(t, opts = {}) {
  const clock = { t };
  const bank = new S.PrizeBank(cfgCopy(), { now: () => clock.t, random: opts.random || Math.random,
    storage: opts.storage || mkStorage(), log: opts.log || (() => {}) });
  return { bank, clock };
}

console.log('\nBefore the event');
{
  const { bank, clock } = bankAt(START - 1, { random: () => 0 });
  let won = 0;
  for (let i = 0; i < 2000; i++) { clock.t = START - 1 - i * 1000; if (bank.decide('B' + i).tier !== 'none') won++; }
  check('2,000 of the luckiest pulls in the half hour before 10:00: nothing won', won === 0, won);
  const { bank: b2 } = bankAt(START - 3 * 24 * 3600000);
  let w2 = 0;
  for (let i = 0; i < 500; i++) if (b2.decide('T' + i).tier !== 'none') w2++;
  check('days before the event: nothing won', w2 === 0, w2);
}

console.log('\nThe very first minute cannot be emptied');
{
  const { bank, clock } = bankAt(START, { random: () => 0 });   // luckiest possible guests
  let won = 0;
  for (let i = 0; i < 40; i++) { clock.t = START + i * 1000; if (bank.decide('F' + i).tier !== 'none') won++; }
  check('40 pulls in the first 40 seconds, every one as lucky as possible: at most one prize', won <= 1, won);
}

console.log('\nThe jackpot window, pushed as hard as possible');
{
  // The luckiest guests, pulling every 20 seconds all day.
  const { bank, clock } = bankAt(START, { random: () => 0 });
  const jackAt = [];
  for (let t = START; t < END; t += 20000) {
    clock.t = t;
    if (bank.decide('J' + t).id === 'jackpot') jackAt.push(t);
  }
  check('with the luckiest guests all day, the jackpot is won once, inside 17:00–19:00',
        jackAt.length === 1 && jackAt[0] >= J_FROM && jackAt[0] < J_TO, jackAt.map(hm));

  const { bank: early, clock: ec } = bankAt(START, { random: () => 0 });
  let j1 = 0;
  for (let t = START; t < J_FROM; t += 20000) { ec.t = t; if (early.decide('E' + t).id === 'jackpot') j1++; }
  check('every pull from 10:00 to 16:59: never the jackpot', j1 === 0, j1);

  // Nobody at all between 17:00 and 19:00: the jackpot goes to the next guests after.
  const { bank: late, clock: lc } = bankAt(J_TO + 5 * MIN, { random: () => 0 });
  lc.t = J_TO + 5 * MIN;
  check('nobody played 17:00–19:00: the first guest after 19:00 can win the jackpot',
        late.decide('A1').id === 'jackpot');
  let quickly = 0;
  for (let s = 1; s <= 200; s++) {
    const r = rng(88000 + s);
    const { bank: lb, clock: lcc } = bankAt(J_TO, { random: r });
    let k = 0;
    for (let t = J_TO + 7 * MIN; t < END; t += 10 * MIN) {
      lcc.t = t; k++;
      if (lb.decide('N' + s + t).id === 'jackpot') break;
    }
    if (k <= 3) quickly++;
  }
  check('nobody played 17:00–19:00: it goes within the first 3 guests after 19:00 in 97% of days',
        quickly >= 194, quickly + ' of 200');
  const { bank: once, clock: oc } = bankAt(J_TO, { random: () => 0 });
  let j2 = 0;
  for (let t = J_TO; t < END + HOUR; t += 20000) { oc.t = t; if (once.decide('O' + t).id === 'jackpot') j2++; }
  check('after 19:00 it can still only be won once', j2 === 1, j2);

  // Quiet at 17:00 but people from 18:30: it still goes before 19:00.
  let goes = 0;
  for (let s = 1; s <= 200; s++) {
    const r = rng(77000 + s);
    const { bank: qb, clock: qc } = bankAt(at('18:30'), { random: r });
    for (let t = at('18:30'); t < J_TO; t += 4 * MIN) { qc.t = t; if (qb.decide('Q' + s + t).id === 'jackpot') { goes++; break; } }
  }
  check('a guest every 4 minutes from 18:30 only: the jackpot still goes before 19:00 in 97% of days',
        goes >= 194, goes + ' of 200');
}

console.log('\nA reload in the middle of a spin');
{
  const storage = mkStorage();
  const { bank } = bankAt(START + 30 * MIN, { storage, random: () => 0 });
  const first = bank.decide('GUEST');
  check('the guest won something', first.tier !== 'none', first.id);
  const leftBefore = bank.left(first.id);
  const { bank: again } = bankAt(START + 31 * MIN, { storage, random: () => 0 });
  const second = again.decide('GUEST');
  check('after the reload they are shown the same prize', second.id === first.id);
  check('and it is not counted twice', again.left(first.id) === leftBefore,
        { before: leftBefore, after: again.left(first.id) });
}

console.log('\nThe count and the schedule survive a reload');
{
  const storage = mkStorage();
  const r = rng(7);
  let now = START;
  const a = new S.PrizeBank(cfgCopy(), { now: () => now, random: r, storage });
  const wins = [];
  for (let t = START; t < at('17:30'); t += 60000) { now = t; const p = a.decide('A' + t); if (p.tier !== 'none') wins.push({ t, id: p.id }); }
  const b = new S.PrizeBank(cfgCopy(), { now: () => now, random: r, storage });
  check('the reloaded machine has the same schedule', JSON.stringify(b.schedule()) === JSON.stringify(a.schedule()));
  for (let t = at('17:30'); t < END; t += 60000) { now = t; const p = b.decide('B' + t); if (p.tier !== 'none') wins.push({ t, id: p.id }); }
  check('a day split by a reload breaks no rule', !breach(wins, a.schedule()), breach(wins, a.schedule()));
  check('and gives each prize out once', wins.length <= R + 1, wins.length);
}

console.log('\nThe iPad is wiped mid-event; the sheet remembers');
{
  const storage = mkStorage();
  const r = rng(11);
  let now = START;
  const a = new S.PrizeBank(cfgCopy(), { now: () => now, random: r, storage });
  const before = [];
  for (let t = START; t < at('16:00'); t += 60000) { now = t; const p = a.decide('W' + t); if (p.tier !== 'none') before.push({ lead: 'W' + t, prize: p.id }); }
  check('some prizes went out before the wipe', before.length >= 3, before.length);

  const b = new S.PrizeBank(cfgCopy(), { now: () => now, random: r, storage: mkStorage() });
  b.applySheetWins(before);
  const after = [];
  for (let t = at('16:00'); t < END; t += 60000) {
    now = t;
    const p = b.decide('X' + t);
    if (p.tier !== 'none') after.push({ lead: 'X' + t, prize: p.id, t });
    if (t % (3 * MIN) < 60000) b.applySheetWins(before.concat(after));
  }
  const total = {};
  before.concat(after).forEach(x => total[x.prize] = (total[x.prize] || 0) + 1);
  check('nothing given more times than it exists, across the wipe',
        Object.keys(total).every(id => total[id] <= stockOf(id)), total);
  check('the same wins reported again are not counted twice',
        CFG.prizes.filter(p => p.stock).every(p => b.given(p.id) === (total[p.id] || 0)),
        CFG.prizes.filter(p => p.stock).map(p => [p.id, b.given(p.id), total[p.id] || 0]));
  const j = after.find(x => x.prize === 'jackpot');
  check('even after a wipe the jackpot is never before 17:00', !j || j.t >= J_FROM, j && hm(j.t));
}

console.log('\nAsking the sheet');
{
  const { bank } = bankAt(START + 10 * MIN);
  let sent = null;
  const fakeFetch = async (url, opts) => { sent = JSON.parse(opts.body);
    return { text: async () => JSON.stringify({ ok: true, wins: [
      { lead: 'S1', prize: 'coffee' }, { lead: 'S2', prize: 'coffee' },
      { lead: 'S3', prize: 'coffee' }, { lead: 'S4', prize: 'mug' }] }) }; };
  (async () => {
    await bank.refreshFromSheet('https://example/exec', 'k', fakeFetch);
    check('asks for wins since just before the start',
          sent && sent.wins && new Date(sent.wins.since).getTime() === START - 5 * MIN, sent);
    check('uses the sheet count', bank.left('coffee') === 2 && bank.left('mug') === 0,
          { coffee: bank.left('coffee'), mug: bank.left('mug') });
    const broken = async () => { throw new Error('offline'); };
    check('an unreachable sheet changes nothing',
          (await bank.refreshFromSheet('https://example/exec', 'k', broken)) === null && bank.left('coffee') === 2);
    finish();
  })();
}

function finish() {
console.log('\nStorage that refuses to save');
{
  const r = rng(3);
  let now = START;
  const log = [];
  const bank = new S.PrizeBank(cfgCopy(), { now: () => now, random: r,
    storage: mkStorage({ broken: true }), log: (k, m) => log.push(k) });
  const wins = [];
  for (let t = START; t < END; t += 30000) { now = t; const p = bank.decide('S' + t); if (p.tier !== 'none') wins.push({ t, id: p.id }); }
  check('still never over-gives, or breaks the timing, while the page stays up',
        !breach(wins, bank.schedule()), breach(wins, bank.schedule()));
  check('and says so in the activity log', log.includes('error'));
}

console.log('\nTwo tabs open on the same iPad');
{
  const storage = mkStorage();
  const r = rng(5);
  let now = START;
  const a = new S.PrizeBank(cfgCopy(), { now: () => now, random: r, storage });
  const b = new S.PrizeBank(cfgCopy(), { now: () => now, random: r, storage });
  const wins = [];
  let i = 0;
  for (let t = START; t < END; t += 30000) {
    now = t;
    const p = (i++ % 2 ? a : b).decide('T' + t);
    if (p.tier !== 'none') wins.push({ t, id: p.id });
  }
  const n = {};
  wins.forEach(x => n[x.id] = (n[x.id] || 0) + 1);
  check('between them, nothing given more times than it exists',
        Object.keys(n).every(id => n[id] <= stockOf(id)), n);
  check('both tabs follow the same schedule', JSON.stringify(a.schedule()) === JSON.stringify(b.schedule()));
}

console.log('\nForce next result');
{
  const { bank, clock } = bankAt(START + 40 * MIN);
  bank.forceNext('mug');
  check('a prize in stock can be forced', bank.decide('F1').id === 'mug');
  bank.forceNext('mug');
  check('once it has gone it cannot be forced again', bank.decide('F2').id !== 'mug');
  check('the mug was counted once', bank.given('mug') === 1);
  bank.forceNext('none');
  check('a loss can always be forced', bank.decide('F3').id === 'none');

  const { bank: early, clock: ec } = bankAt(START - 60 * MIN);
  early.forceNext('jackpot');
  check('before the event a demo can show the jackpot', early.decide('D1').id === 'jackpot');
  ec.t = START + 60 * MIN;
  check('and the real jackpot is still there at the event', early.left('jackpot') === 1);
  check('force switches itself off after one pull', early.forced === null);
}

console.log('\nRehearsal and simulation');
{
  const dayBefore = P('2026-09-15T14:00');
  const { bank, clock } = bankAt(dayBefore, { random: rng(9) });
  check('a rehearsal can start the day before', bank.startRehearsal(20).ok === true);
  const w = bank.window();
  check('it runs its own 20-minute timeline', w.rehearsal && w.end - w.start === 20 * MIN);
  const wins = [];
  for (let t = dayBefore; t < dayBefore + 30 * MIN; t += 20000) { clock.t = t; const p = bank.decide('R' + t); if (p.tier !== 'none') wins.push(p.id); }
  check('prizes come out during the rehearsal', wins.length >= 8, wins.length);
  clock.t = START + 10 * MIN;
  check('the real event is untouched by it',
        CFG.prizes.filter(p => p.stock).every(p => bank.left(p.id) === p.stock));
  check('and the rehearsal stops applying once the event starts', !bank.window().rehearsal);

  const { bank: late } = bankAt(START - 10 * MIN);
  check('cannot start a rehearsal that would run into the event', late.startRehearsal(20).ok === false);

  const { bank: b3 } = bankAt(dayBefore);
  b3.startRehearsal(20);
  b3.endRehearsal();
  check('ending a rehearsal returns to the real schedule', !b3.window().rehearsal);

  const { bank: sim, clock: sc } = bankAt(dayBefore, { random: rng(21) });
  let before = 0;
  for (let i = 0; i < 300; i++) { sc.t = dayBefore + i * 1000; if (sim.decide('P' + i).tier !== 'none') before++; }
  check('simulation not started: 300 pulls, nothing won', before === 0, before);
  sc.t = dayBefore + 10 * MIN;
  check('simulation starts on demand', sim.startRehearsal(30, 'sim').ok === true &&
        /^sim:/.test(sim.window().run) && sim.window().end - sim.window().start === 30 * MIN);
  const jw = sim.jackpotWindow();
  const simWins = [];
  const simFrom = sc.t;
  for (let t = simFrom; t < simFrom + 40 * MIN; t += 15000) { sc.t = t; const p = sim.decide('S' + t); if (p.tier !== 'none') simWins.push({ id: p.id, t }); }
  const sn = {};
  simWins.forEach(x => sn[x.id] = (sn[x.id] || 0) + 1);
  check('a 30-minute simulation gives out all 11 prizes, each within stock',
        simWins.length === 11 && Object.keys(sn).every(id => sn[id] <= stockOf(id)), sn);
  const sj = simWins.find(x => x.id === 'jackpot');
  check('and its jackpot lands inside the simulation\'s own 17:00–19:00 stretch',
        sj && sj.t >= jw.from && sj.t < jw.to, sj && { at: sj.t - simFrom, from: jw.from - simFrom, to: jw.to - simFrom });
  const again = sim.startRehearsal(30, 'sim');
  check('starting it again gives a fresh full stock and a fresh schedule', again.ok &&
        CFG.prizes.filter(p => p.stock).every(p => sim.left(p.id) === p.stock) &&
        /^sim:/.test(sim.schedule().run) && sim.schedule().run === sim.window().run);
}

console.log('\nThe machine never throws on a broken config');
{
  const bad = cfgCopy();
  bad.event.start = 'nonsense';
  let ok = true, won = 0;
  try {
    const bank = new S.PrizeBank(bad, { now: () => START + 30 * MIN, storage: mkStorage(), log: () => {} });
    for (let i = 0; i < 200; i++) if (bank.decide('Z' + i).tier !== 'none') won++;
  } catch (e) { ok = false; }
  check('invalid event times: no crash', ok);
  check('invalid event times: nothing won rather than everything', won === 0, won);

  const badJ = cfgCopy();
  badJ.event.jackpotFrom = 'nonsense';
  let jwon = 0, ok2 = true;
  try {
    let t = START;
    const bank = new S.PrizeBank(badJ, { now: () => t, random: () => 0, storage: mkStorage(), log: () => {} });
    for (; t < END; t += 20000) if (bank.decide('Y' + t).id === 'jackpot') jwon++;
  } catch (e) { ok2 = false; }
  check('invalid jackpot window: no crash, and the jackpot is never given', ok2 && jwon === 0, { ok2, jwon });
}

console.log('\nHow winners spread across the day (150 guests, ' + (QUICK ? 100 : 1000) + ' days)');
{
  const N = QUICK ? 100 : 1000;
  const perHour = new Array(14).fill(0);
  const unitTimes = {};
  const totals = {};
  const jackBins = new Array(9).fill(0);   // eight quarter hours 17:00–19:00, then "after 19:00"
  let beforeJ = 0, afterJ = 0, withJ = 0;
  for (let s = 1; s <= N; s++) {
    const { wins } = day(150, 'uniform', 900000 + s);
    totals[wins.length] = (totals[wins.length] || 0) + 1;
    const seen = {};
    const j = wins.find(x => x.id === 'jackpot');
    if (j) {
      withJ++;
      jackBins[j.t >= J_TO ? 8 : Math.floor((j.t - J_FROM) / (15 * MIN))]++;
      beforeJ += wins.filter(x => x.id !== 'jackpot' && x.t < j.t).length;
      afterJ += wins.filter(x => x.id !== 'jackpot' && x.t > j.t).length;
    }
    wins.forEach(x => {
      const h = Math.floor((x.t - START) / HOUR);
      if (h >= 0 && h < 14) perHour[h]++;
      seen[x.id] = (seen[x.id] || 0) + 1;
      const k = x.id + (stockOf(x.id) > 1 ? ' #' + seen[x.id] : '');
      (unitTimes[k] = unitTimes[k] || []).push(x.t);
    });
  }
  console.log('  average winners per hour:');
  perHour.forEach((n, i) => console.log('    ' + hm(START + i * HOUR) + '  ' +
    (n / N).toFixed(2).padStart(5) + '  ' + '#'.repeat(Math.round(n / N * 20))));
  console.log('  when the jackpot is won (share of days, per quarter hour from 17:00):');
  jackBins.forEach((n, i) => console.log('    ' + (i === 8 ? 'after' : hm(J_FROM + i * 15 * MIN)) + '  ' +
    (n / N * 100).toFixed(1).padStart(5) + '%  ' + '#'.repeat(Math.round(n / N * 60))));
  console.log('  regular prizes won before / after the jackpot, on average: ' +
              (beforeJ / (withJ || 1)).toFixed(1) + ' / ' + (afterJ / (withJ || 1)).toFixed(1));
  console.log('  when each prize goes (5% / median / 95% of days):');
  Object.keys(unitTimes).sort((a, b) => pct(unitTimes[a], .5) - pct(unitTimes[b], .5)).forEach(k =>
    console.log('    ' + k.padEnd(12) + hm(pct(unitTimes[k], .05)) + ' / ' + hm(pct(unitTimes[k], .5)) +
                ' / ' + hm(pct(unitTimes[k], .95)) + '   (' + unitTimes[k].length + ' of ' + N + ')'));
  console.log('  prizes given per day: ' + JSON.stringify(totals));
  check('never more than 11 prizes in a day', Object.keys(totals).every(k => +k <= 11), totals);
  check('winners in every hour from 10:00 to 23:00 on average', perHour.slice(0, 13).every(n => n / N >= 0.3),
        perHour.map(n => +(n / N).toFixed(2)));
  check('the jackpot is spread over at least four different quarter hours of its window',
        jackBins.slice(0, 8).filter(n => n / N >= 0.05).length >= 4, jackBins.map(n => +(n / N * 100).toFixed(1)));
  check('at 150 guests the jackpot lands after 19:00 in under 1% of days', jackBins[8] / N < 0.01, jackBins[8]);
}

console.log('\nRandom settings, stock and crowds: the hard rules hold for ANY tuning');
{
  const R0 = rng(424242);
  const FUZZ = QUICK ? 150 : 1200;
  const pick = (a, b) => a + R0() * (b - a);
  const fmt = t => { const x = new Date(t), p = v => String(v).padStart(2, '0');
    return x.getFullYear() + '-' + p(x.getMonth() + 1) + '-' + p(x.getDate()) + 'T' + p(x.getHours()) + ':' + p(x.getMinutes()); };
  let firstBreach = null, pulls = 0, prizesOut = 0;
  for (let n = 0; n < FUZZ; n++) {
    const c = cfgCopy();
    const d = new Date(2026, 8, 1 + Math.floor(R0() * 50), Math.floor(pick(6, 14)), Math.floor(R0() * 4) * 15);
    const lenMin = Math.round(pick(60, 900));
    const s0 = d.getTime(), e0 = s0 + lenMin * MIN;
    c.event.start = fmt(s0);
    c.event.end = fmt(e0);
    const jfMin = Math.round(pick(0, lenMin * 0.8)), jlen = Math.max(5, Math.round(pick(0.05, 0.3) * lenMin));
    c.event.jackpotFrom = fmt(s0 + jfMin * MIN);
    c.event.jackpotTo = fmt(Math.min(e0, s0 + (jfMin + jlen) * MIN));
    c.event.releaseSpan = pick(0.2, 1);
    c.event.jackpotReleaseBy = pick(0, 1);
    c.event.jackpotFloorFrom = pick(0, 1);
    c.event.jackpotFloor = pick(0, 1);
    c.event.jackpotAfterWindow = R0() < 0.5;
    c.event.finalStretch = pick(0, 1.2);
    c.event.chance = { base: pick(0, 1), perMinute: pick(0, 0.5), perBacklog: pick(0, 0.5),
                       finalFloor: pick(0, 1), max: pick(0.05, 1) };
    c.prizes.forEach(p => { if (p.tier !== 'none') { p.stock = Math.floor(R0() * 7); p.weight = Math.floor(R0() * 10); } });
    const dur = e0 - s0;
    const storage = mkStorage();
    let now = s0 - 20 * MIN;
    const mk = () => new S.PrizeBank(c, { now: () => now, random: R0, storage, log: () => {} });
    let bank = mk();
    const wins = [];
    const guests = Math.floor(R0() * 500);
    for (let g = 0; g < guests; g++) {
      now += R0() * 2 * (dur + 60 * MIN) / Math.max(1, guests);
      if (R0() < 0.03) now -= R0() * 10 * MIN;       // the iPad clock is corrected backwards
      if (R0() < 0.02) bank = mk();                   // the page reloads
      let forced = null;
      if (R0() < 0.03) { forced = c.prizes[Math.floor(R0() * c.prizes.length)].id; bank.forceNext(forced); }
      const p = bank.decide('Z' + n + '_' + g);
      pulls++;
      if (p.tier !== 'none') { wins.push({ t: now, id: p.id, forced: forced === p.id }); prizesOut++; }
    }
    now = s0;
    const b = fuzzBreach(wins, c, s0, dur, bank.schedule());
    if (b && !firstBreach) firstBreach = { breach: b, day: n, event: c.event,
                                           stock: c.prizes.map(p => [p.id, p.stock]) };
  }
  check(FUZZ + ' random days, ' + pulls + ' pulls, ' + prizesOut +
        ' prizes, with clock corrections, reloads and forced results: no rule broken', !firstBreach, firstBreach);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
}

/* The hard rules for any configuration. Forced results are staff decisions:
   they must respect stock, but not the clock. */
function fuzzBreach(wins, c, s0, dur, sch) {
  const e = c.event, n = {}, unit = {};
  const stock = id => c.prizes.find(p => p.id === id).stock | 0;
  const regIds = c.prizes.filter(p => p.tier !== 'none' && p.tier !== 'jackpot').map(p => p.id);
  const jf = P(e.jackpotFrom), jt = P(e.jackpotTo);
  let reg = 0;
  for (const x of wins) {
    if (x.t < s0) { if (!x.forced) return 'a prize won before the start'; continue; }
    n[x.id] = (n[x.id] || 0) + 1;
    if (n[x.id] > stock(x.id)) return x.id + ' given beyond its stock of ' + stock(x.id);
    const isReg = regIds.includes(x.id);
    if (!x.forced) {
      if (x.id === 'jackpot') {
        if (!(x.t >= jf)) return 'jackpot before its window';
        if (x.t >= jt && !e.jackpotAfterWindow) return 'jackpot after its window when that is switched off';
        if (x.t < sch.jackpot) return 'jackpot before its random unlock';
      } else if (isReg) {
        if (!(x.t >= sch.regular[reg])) return 'a prize before its random unlock';
        const k = unit[x.id] || 0;
        if (x.t < s0 + (k / stock(x.id)) * e.releaseSpan * dur - 1) return x.id + ' #' + (k + 1) + ' before its spread time';
      }
    }
    if (isReg) { reg++; unit[x.id] = (unit[x.id] || 0) + 1; }
  }
  return null;
}
