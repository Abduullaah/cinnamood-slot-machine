/* Proves the prize rules agreed for the event, by running the real prize bank
   through thousands of simulated evenings.

   Hard rules — any single breach fails the suite:
     - no prize ever goes out more times than it exists
     - nothing is won before the event starts
     - the jackpot never comes up before the halfway point, and never before
       every other prize has gone unless the late fallback has passed
     - the coffees are spread out, and prizes cannot be emptied by a rush
     - a reload, a wiped iPad, a second tab or a broken storage cannot give a
       prize away twice

   It also prints what an evening actually looks like at different crowd sizes,
   so the timing can be judged, not just the rules. */
const fs = require('fs'), vm = require('vm'), path = require('path');
const dir = process.argv[2] || 'site/shared';

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
const START = S.parseLocalTime(CFG.event.start);
const END = S.parseLocalTime(CFG.event.end);
const DUR = END - START;
const MIN = 60000;
const ev = CFG.event;
const regularIds = CFG.prizes.filter(p => p.tier !== 'none' && p.tier !== 'jackpot').map(p => p.id);
const R = CFG.prizes.filter(p => regularIds.includes(p.id)).reduce((s, p) => s + p.stock, 0);
const stockOf = id => CFG.prizes.find(p => p.id === id).stock;
const hm = t => { const d = new Date(t); return String(d.getHours()).padStart(2, '0') + ':' +
                  String(d.getMinutes()).padStart(2, '0'); };

function rng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

/* ---------------------------------------------------------------------------
   The brief, as written into config.js
   --------------------------------------------------------------------------- */
console.log('\nThe prize list matches what was agreed');
{
  const by = id => CFG.prizes.find(p => p.id === id);
  check('event is 16 Sep 2026, 5pm to 7pm',
        CFG.event.start === '2026-09-16T17:00' && CFG.event.end === '2026-09-16T19:00');
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
  check('jackpot fallback is not before the halfway rule',
        ev.jackpotFallback >= ev.jackpotNotBefore && ev.jackpotNotBefore >= 0.5);
}

/* ---------------------------------------------------------------------------
   A simulated evening
   --------------------------------------------------------------------------- */
function arrivals(n, pattern, r) {
  const lo = START - 15 * MIN, span = DUR + 30 * MIN;
  const ts = [];
  for (let i = 0; i < n; i++) {
    let u;
    if (pattern === 'uniform') u = r();
    else if (pattern === 'early') u = Math.pow(r(), 2.2);        // rush at the door
    else if (pattern === 'late') u = 1 - Math.pow(r(), 2.2);     // crowd builds late
    else {                                                        // three bursts
      const c = [0.12, 0.5, 0.86][Math.floor(r() * 3)];
      u = Math.min(1, Math.max(0, c + (r() - 0.5) * 0.08));
    }
    ts.push(lo + u * span);
  }
  ts.sort((a, b) => a - b);
  // A pull, the reveal and the next guest's form take at least ~25 seconds.
  for (let i = 1; i < ts.length; i++) ts[i] = Math.max(ts[i], ts[i - 1] + 25000);
  return ts;
}

function evening(n, pattern, seed, opts = {}) {
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
  return { wins, ts, bank };
}

/* Every hard rule, checked against one evening. Returns the first breach. */
function breach(wins) {
  const n = {};
  let regular = 0;
  const coffeeTimes = [];
  for (const x of wins) {
    n[x.id] = (n[x.id] || 0) + 1;
    if (n[x.id] > stockOf(x.id)) return x.id + ' given ' + n[x.id] + ' times';
    if (x.t < START) return x.id + ' won before the start at ' + hm(x.t);
    if (x.id === 'jackpot') {
      if (x.t < START + ev.jackpotNotBefore * DUR) return 'jackpot at ' + hm(x.t);
      if (regular < R && x.t < START + ev.jackpotFallback * DUR - 1)
        return 'jackpot at ' + hm(x.t) + ' with ' + (R - regular) + ' prizes still left';
    } else {
      // The j-th regular prize cannot come out before the j-th release.
      if (x.t < START + (regular / R) * ev.releaseSpan * DUR - 1)
        return 'prize ' + (regular + 1) + ' at ' + hm(x.t) + ', before its release';
      regular++;
      if (x.id === 'coffee') {
        const k = coffeeTimes.length;
        if (x.t < START + (k / 5) * ev.releaseSpan * DUR - 1)
          return 'coffee ' + (k + 1) + ' too early at ' + hm(x.t);
        coffeeTimes.push(x.t);
      }
    }
  }
  return null;
}

console.log('\nThousands of evenings: the hard rules are never broken');
const SIZES = [30, 60, 100, 150, 200, 300];
const PATTERNS = ['uniform', 'early', 'late', 'bursty'];
const RUNS = process.env.QUICK ? 40 : 300;
const table = {};
for (const pattern of PATTERNS) {
  for (const size of SIZES) {
    let first = null, all11 = 0, jack = 0;
    const jackT = [], gaps = [], firstWin = [], lastRegular = [], firstHour = [];
    const perPrizeT = {};
    for (let s = 1; s <= RUNS; s++) {
      const { wins } = evening(size, pattern, size * 1000 + s + pattern.length * 7919);
      const b = breach(wins);
      if (b && !first) first = b;
      if (wins.length === R + 1) all11++;
      const j = wins.find(x => x.id === 'jackpot');
      if (j) { jack++; jackT.push(j.t); }
      if (wins.length) firstWin.push(wins[0].t);
      let g = 0;
      for (let i = 1; i < wins.length; i++) g = Math.max(g, wins[i].t - wins[i - 1].t);
      gaps.push(g);
      const reg = wins.filter(x => x.id !== 'jackpot');
      if (reg.length === R) lastRegular.push(reg[R - 1].t);
      firstHour.push(wins.filter(x => x.t < START + DUR / 2).length);
      // When each prize FIRST goes out. An average over all five coffees would
      // land mid-evening purely because they are spread out on purpose.
      const firstOf = {};
      wins.forEach(x => { if (!(x.id in firstOf)) firstOf[x.id] = x.t; });
      Object.keys(firstOf).forEach(id => (perPrizeT[id] = perPrizeT[id] || []).push(firstOf[id]));
    }
    check(`${pattern}, ${size} guests: no rule broken in ${RUNS} evenings`, !first, first);
    const med = a => { if (!a.length) return NaN; const b = a.slice().sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
    const mean = a => a.reduce((s, x) => s + x, 0) / (a.length || 1);
    table[pattern + ' ' + size] = {
      all: Math.round(all11 / RUNS * 100), jack: Math.round(jack / RUNS * 100),
      jackT: jackT.length ? hm(med(jackT)) : '—', firstWin: firstWin.length ? hm(med(firstWin)) : '—',
      gap: Math.round(med(gaps) / MIN), firstHour: mean(firstHour).toFixed(1),
      order: Object.keys(perPrizeT).map(id => [id, mean(perPrizeT[id])])
                   .sort((a, b) => a[1] - b[1]).map(x => x[0])
    };
  }
}

console.log('\nWhat an evening looks like (median of ' + RUNS + ' runs each)');
console.log('  crowd              all 11 out  jackpot won  jackpot at  first win  longest gap  wins 5-6pm  typical order');
Object.keys(table).forEach(k => {
  const r = table[k];
  console.log('  ' + k.padEnd(18) + String(r.all + '%').padStart(10) + String(r.jack + '%').padStart(13) +
              r.jackT.padStart(12) + r.firstWin.padStart(11) + String(r.gap + ' min').padStart(13) +
              r.firstHour.padStart(12) + '   ' + r.order.join(' > '));
});

/* The statistical checks need the full sample: with QUICK's 40 evenings, box of
   4 and box of 6 (released minutes apart) can swap places by chance alone. The
   hard rules above are checked at every sample size. */
if (!process.env.QUICK) {
console.log('\nThe timing does what was asked, at realistic crowd sizes');
for (const size of [100, 150, 200]) {
  for (const pattern of PATTERNS) {
    const r = table[pattern + ' ' + size];
    check(`${pattern}, ${size}: every prize goes out in at least 97% of evenings`, r.all >= 97, r.all);
    check(`${pattern}, ${size}: the jackpot is the last prize out, on average`,
          r.order[r.order.length - 1] === 'jackpot', r.order);
  }
  check(`uniform, ${size}: no gap between winners longer than 25 minutes (median)`,
        table['uniform ' + size].gap <= 25, table['uniform ' + size].gap);
  check(`uniform, ${size}: winners in both halves of the evening`,
        +table['uniform ' + size].firstHour >= 3 && +table['uniform ' + size].firstHour <= 8,
        table['uniform ' + size].firstHour);
}
for (const size of [100, 150, 200]) {
  const o = table['uniform ' + size].order, at = id => o.indexOf(id);
  check(`uniform, ${size}: easiest first — coffee, then box of 2, 4, 6, then mug and T-shirt, jackpot last`,
        at('coffee') === 0 && at('coffee') < at('box2') && at('box2') < at('box4') &&
        at('box4') < at('box6') && at('box6') < at('mug') && at('box6') < at('tee') &&
        at('jackpot') === o.length - 1, o);
}
check('a quiet night (60 guests) still gives out the jackpot in 95% of evenings',
      table['uniform 60'].jack >= 95, table['uniform 60'].jack);
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
  const { bank, clock } = bankAt(START - 1);
  let won = 0;
  for (let i = 0; i < 2000; i++) { clock.t = START - 1 - i * 1000; if (bank.decide('B' + i).tier !== 'none') won++; }
  check('2,000 pulls in the half hour before 5pm: nothing won', won === 0, won);
  const { bank: b2 } = bankAt(START - 3 * 24 * 3600000);
  let w2 = 0;
  for (let i = 0; i < 500; i++) if (b2.decide('T' + i).tier !== 'none') w2++;
  check('testing days before the event: nothing won', w2 === 0, w2);
}

console.log('\nThe very first minute cannot be emptied');
{
  const { bank, clock } = bankAt(START, { random: () => 0 });   // luckiest possible guests
  let won = 0;
  for (let i = 0; i < 40; i++) { clock.t = START + i * 1000; if (bank.decide('F' + i).tier !== 'none') won++; }
  check('40 pulls in the first 40 seconds, every one as lucky as possible: one prize', won === 1, won);
}

console.log('\nThe jackpot, pushed as hard as possible');
{
  // Every regular prize given as fast as the clock allows, luckiest guests.
  const { bank, clock } = bankAt(START, { random: () => 0 });
  let jackAt = null;
  for (let t = START; t < END + 30 * MIN; t += 20000) {
    clock.t = t;
    const p = bank.decide('J' + t);
    if (p.id === 'jackpot') { jackAt = t; break; }
  }
  check('with the luckiest crowd it still waits until the rest are gone and past 6pm',
        jackAt >= START + ev.jackpotNotBefore * DUR && jackAt >= START + ((R - 1) / R) * ev.releaseSpan * DUR,
        jackAt && hm(jackAt));
  console.log('       (earliest possible jackpot: ' + hm(jackAt) + ')');

  // Nobody wins anything until late: the fallback brings it into play.
  const { bank: b2, clock: c2 } = bankAt(START, { random: () => 0 });
  c2.t = START + ev.jackpotFallback * DUR - 1;
  b2.forceNext(null);
  const plan = b2.plan(undefined, c2.t);
  check('one second before the fallback, with prizes still left, it is not in play',
        plan.jackpot.length === 0);
  const plan2 = b2.plan(undefined, START + ev.jackpotFallback * DUR);
  check('at the fallback it comes into play', plan2.jackpot.length === 1);
}

console.log('\nA reload in the middle of a spin');
{
  const storage = mkStorage();
  const { bank, clock } = bankAt(START + 30 * MIN, { storage, random: () => 0 });
  const first = bank.decide('GUEST');
  check('the guest won something', first.tier !== 'none', first.id);
  const leftBefore = bank.left(first.id);
  const { bank: again } = bankAt(START + 31 * MIN, { storage, random: () => 0 });
  const second = again.decide('GUEST');
  check('after the reload they are shown the same prize', second.id === first.id);
  check('and it is not counted twice', again.left(first.id) === leftBefore,
        { before: leftBefore, after: again.left(first.id) });
}

console.log('\nThe count survives a reload');
{
  const storage = mkStorage();
  const r = rng(7);
  let now = START;
  const a = new S.PrizeBank(cfgCopy(), { now: () => now, random: r, storage });
  const wins = [];
  for (let t = START; t < START + DUR / 2; t += 30000) { now = t; const p = a.decide('A' + t); if (p.tier !== 'none') wins.push({ t, id: p.id }); }
  const b = new S.PrizeBank(cfgCopy(), { now: () => now, random: r, storage });
  for (let t = START + DUR / 2; t < END + 20 * MIN; t += 30000) { now = t; const p = b.decide('B' + t); if (p.tier !== 'none') wins.push({ t, id: p.id }); }
  check('an evening split by a reload breaks no rule', !breach(wins), breach(wins));
  check('and gives each prize out once', wins.length <= R + 1, wins.length);
}

console.log('\nThe iPad is wiped mid-event; the sheet remembers');
{
  const storage = mkStorage();
  const r = rng(11);
  let now = START;
  const a = new S.PrizeBank(cfgCopy(), { now: () => now, random: r, storage });
  const before = [];
  for (let t = START; t < START + 70 * MIN; t += 20000) { now = t; const p = a.decide('W' + t); if (p.tier !== 'none') before.push({ lead: 'W' + t, prize: p.id }); }
  check('some prizes went out before the wipe', before.length >= 4, before.length);

  const b = new S.PrizeBank(cfgCopy(), { now: () => now, random: r, storage: mkStorage() });
  b.applySheetWins(before);
  const after = [];
  for (let t = START + 70 * MIN; t < END + 30 * MIN; t += 20000) {
    now = t;
    const p = b.decide('X' + t);
    if (p.tier !== 'none') after.push({ lead: 'X' + t, prize: p.id });
    // The sheet catches up with the new wins as the evening goes on, and hands
    // back the old ones again every time. None of it may be counted twice.
    if (t % (3 * MIN) < 20000) b.applySheetWins(before.concat(after));
  }
  const total = {};
  before.concat(after).forEach(x => total[x.prize] = (total[x.prize] || 0) + 1);
  check('nothing given more times than it exists, across the wipe',
        Object.keys(total).every(id => total[id] <= stockOf(id)), total);
  check('the same wins reported again are not counted twice',
        CFG.prizes.filter(p => p.stock).every(p => b.given(p.id) === (total[p.id] || 0)),
        CFG.prizes.filter(p => p.stock).map(p => [p.id, b.given(p.id), total[p.id] || 0]));
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
  for (let t = START; t < END + 30 * MIN; t += 15000) { now = t; const p = bank.decide('S' + t); if (p.tier !== 'none') wins.push({ t, id: p.id }); }
  check('still never over-gives while the page stays up', !breach(wins), breach(wins));
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
  for (let t = START; t < END + 30 * MIN; t += 15000) {
    now = t;
    const p = (i++ % 2 ? a : b).decide('T' + t);
    if (p.tier !== 'none') wins.push({ t, id: p.id });
  }
  const n = {};
  wins.forEach(x => n[x.id] = (n[x.id] || 0) + 1);
  check('between them, nothing given more times than it exists',
        Object.keys(n).every(id => n[id] <= stockOf(id)), n);
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

console.log('\nRehearsal');
{
  const day = S.parseLocalTime('2026-09-15T14:00');
  const { bank, clock } = bankAt(day, { random: rng(9) });
  check('starts the day before', bank.startRehearsal(20).ok === true);
  const w = bank.window();
  check('runs its own 20-minute schedule', w.rehearsal && w.end - w.start === 20 * MIN);
  const wins = [];
  for (let t = day; t < day + 30 * MIN; t += 20000) { clock.t = t; const p = bank.decide('R' + t); if (p.tier !== 'none') wins.push(p.id); }
  check('prizes come out during the rehearsal', wins.length >= 8, wins.length);
  clock.t = START + 10 * MIN;
  check('the real event is untouched by it',
        CFG.prizes.filter(p => p.stock).every(p => bank.left(p.id) === p.stock));
  check('and the rehearsal stops applying once the event starts', !bank.window().rehearsal);

  const { bank: late } = bankAt(START - 10 * MIN);
  check('cannot start a rehearsal that would run into the event', late.startRehearsal(20).ok === false);

  const { bank: b3, clock: c3 } = bankAt(day);
  b3.startRehearsal(20);
  b3.endRehearsal();
  check('ending a rehearsal returns to the real schedule', !b3.window().rehearsal);
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
}

console.log('\nHow winners spread across the evening (150 guests, ' + (process.env.QUICK ? 100 : 1000) + ' evenings)');
{
  const N = process.env.QUICK ? 100 : 1000;
  const BLOCK = 15 * MIN, blocks = Math.ceil((DUR + 30 * MIN) / BLOCK);
  const perBlock = new Array(blocks).fill(0);
  const unitTimes = {};
  const totals = {};
  for (let s = 1; s <= N; s++) {
    const { wins } = evening(150, 'uniform', 900000 + s);
    totals[wins.length] = (totals[wins.length] || 0) + 1;
    const seen = {};
    wins.forEach(x => {
      const b = Math.floor((x.t - START) / BLOCK);
      if (b >= 0 && b < blocks) perBlock[b]++;
      seen[x.id] = (seen[x.id] || 0) + 1;
      const k = x.id + (stockOf(x.id) > 1 ? ' #' + seen[x.id] : '');
      (unitTimes[k] = unitTimes[k] || []).push(x.t);
    });
  }
  const pct = (a, q) => { const b = a.slice().sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(q * b.length))]; };
  console.log('  average winners per 15 minutes:');
  perBlock.forEach((n, i) => console.log('    ' + hm(START + i * BLOCK) + '  ' +
    (n / N).toFixed(2).padStart(5) + '  ' + '#'.repeat(Math.round(n / N * 10))));
  console.log('  when each prize goes (5% / median / 95% of evenings):');
  Object.keys(unitTimes).sort((a, b) => pct(unitTimes[a], .5) - pct(unitTimes[b], .5)).forEach(k =>
    console.log('    ' + k.padEnd(12) + hm(pct(unitTimes[k], .05)) + ' / ' + hm(pct(unitTimes[k], .5)) +
                ' / ' + hm(pct(unitTimes[k], .95)) + '   (' + unitTimes[k].length + ' of ' + N + ')'));
  console.log('  prizes given per evening: ' + JSON.stringify(totals));
  const scattered = perBlock.slice(0, 7).every(n => n / N >= 0.5);
  const clumped = perBlock.some(n => n / N > 3);
  check('winners in every quarter hour from 17:00 to 18:45', scattered, perBlock.map(n => +(n / N).toFixed(2)));
  check('no quarter hour averages more than 3 winners', !clumped);
  check('never more than 11 prizes in an evening', Object.keys(totals).every(k => +k <= 11), totals);
}

console.log('\nRandom settings, stock and crowds: the hard rules hold for ANY tuning');
{
  const R0 = rng(424242);
  const FUZZ = process.env.QUICK ? 150 : 1500;
  const pick = (a, b) => a + R0() * (b - a);
  const fmt = t => { const x = new Date(t), p = v => String(v).padStart(2, '0');
    return x.getFullYear() + '-' + p(x.getMonth() + 1) + '-' + p(x.getDate()) + 'T' + p(x.getHours()) + ':' + p(x.getMinutes()); };
  let firstBreach = null, pulls = 0, prizesOut = 0;
  for (let n = 0; n < FUZZ; n++) {
    const c = cfgCopy();
    const d = new Date(2026, 8, 1 + Math.floor(R0() * 50), Math.floor(pick(6, 19)), Math.floor(R0() * 4) * 15);
    const lenMin = Math.round(pick(20, 300));
    c.event.start = fmt(d.getTime());
    c.event.end = fmt(d.getTime() + lenMin * MIN);
    c.event.releaseSpan = pick(0.2, 1);
    c.event.jackpotNotBefore = pick(0, 0.9);
    c.event.jackpotFallback = pick(c.event.jackpotNotBefore, 1);
    c.event.finalStretch = pick(0, 1.2);
    c.event.chance = { base: pick(0, 1), perMinute: pick(0, 0.5), perBacklog: pick(0, 0.5),
                       finalFloor: pick(0, 1), max: pick(0.05, 1) };
    c.prizes.forEach(p => { if (p.tier !== 'none') { p.stock = Math.floor(R0() * 7); p.weight = Math.floor(R0() * 10); } });
    const s0 = S.parseLocalTime(c.event.start), dur = S.parseLocalTime(c.event.end) - s0;
    const storage = mkStorage();
    let now = s0 - 20 * MIN;
    const mk = () => new S.PrizeBank(c, { now: () => now, random: R0, storage, log: () => {} });
    let bank = mk();
    const wins = [];
    const guests = Math.floor(R0() * 400);
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
    const b = fuzzBreach(wins, c, s0, dur);
    if (b && !firstBreach) firstBreach = { breach: b, evening: n, event: c.event,
                                           stock: c.prizes.map(p => [p.id, p.stock]) };
  }
  check(FUZZ + ' random evenings, ' + pulls + ' pulls, ' + prizesOut +
        ' prizes, with clock corrections, reloads and forced results: no rule broken', !firstBreach, firstBreach);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
}

/* The hard rules for any configuration. Forced results are staff decisions:
   they must respect stock, but not the clock. */
function fuzzBreach(wins, c, s0, dur) {
  const ev = c.event, n = {}, unit = {};
  const stock = id => c.prizes.find(p => p.id === id).stock | 0;
  const regIds = c.prizes.filter(p => p.tier !== 'none' && p.tier !== 'jackpot').map(p => p.id);
  const Rr = c.prizes.filter(p => regIds.includes(p.id)).reduce((s, p) => s + (p.stock | 0), 0);
  let reg = 0;
  for (const x of wins) {
    if (x.t < s0) { if (!x.forced) return 'a prize won before the start'; continue; }
    n[x.id] = (n[x.id] || 0) + 1;
    if (n[x.id] > stock(x.id)) return x.id + ' given beyond its stock of ' + stock(x.id);
    const isReg = regIds.includes(x.id);
    if (!x.forced) {
      if (x.id === 'jackpot') {
        if (x.t < s0 + ev.jackpotNotBefore * dur - 1) return 'jackpot before its earliest time';
        if (reg < Rr && x.t < s0 + Math.max(ev.jackpotFallback, ev.jackpotNotBefore) * dur - 1)
          return 'jackpot while other prizes were left, before the fallback';
      } else if (isReg) {
        if (x.t < s0 + (reg / Rr) * ev.releaseSpan * dur - 1) return 'a prize before its release';
        const k = unit[x.id] || 0;
        if (x.t < s0 + (k / stock(x.id)) * ev.releaseSpan * dur - 1) return x.id + ' #' + (k + 1) + ' before its spread time';
      }
    }
    if (isReg) { reg++; unit[x.id] = (unit[x.id] || 0) + 1; }
  }
  return null;
}
