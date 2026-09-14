/* The reels must SHOW what the prize bank decided. A bank that is perfectly
   right is worthless if the reels land three coffees on a losing pull, or a
   box of 4 when the card says box of 6.

   Runs the real engine headless: no DOM, no animation. Each spin is decided,
   then the reels are snapped straight to where the choreography would have
   stopped them, and the payline is read back. */
const fs = require('fs'), vm = require('vm'), path = require('path');
const dir = process.argv[2] || 'site/shared';

let pass = 0, fail = 0;
const check = (n, c, x) => {
  if (c) { pass++; console.log('  ok   ' + n); }
  else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '  ' + JSON.stringify(x) : '')); }
};

const timers = [];
function mkStorage() {
  const d = new Map();
  return { getItem: k => d.has(k) ? d.get(k) : null, setItem: (k, v) => d.set(k, String(v)),
           removeItem: k => d.delete(k), get length() { return d.size; },
           key: i => Array.from(d.keys())[i] || null };
}
const S = { console, Date, Math, JSON, Number, String, Array, Object, Map, Set, Boolean, Error,
            Promise, isFinite,
            setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout: () => {},
            requestAnimationFrame: () => 0, performance: { now: () => Date.now() },
            window: { addEventListener() {} }, localStorage: mkStorage() };
vm.createContext(S);
vm.runInContext(['config.js', 'symbols.js', 'engine.js', 'prizes.js']
  .map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n;\n') +
  '\n;this.CFG=CINNAMOOD_CONFIG;this.SlotMachine=SlotMachine;this.PrizeBank=PrizeBank;' +
  'this.parseLocalTime=parseLocalTime;this.applyResetStamp=applyResetStamp;', S);

const cfg = JSON.parse(JSON.stringify(S.CFG));
const noop = () => {};
const audio = new Proxy({}, { get: () => noop });
const START = S.parseLocalTime(cfg.event.start), END = S.parseLocalTime(cfg.event.end);

function machine() {
  return new S.SlotMachine({ config: cfg, audio, reelEls: [null, null, null], rows: 3 });
}

/* Spin, snap to the result, and report what the payline shows. */
function spinOnce(m) {
  m.state = 'idle';
  if (!m.spin()) return null;
  m._recover();
  const p = m.pending;
  const line = m.reels.map(r => r.paylineSymbol);
  const r2 = m.reels[2];
  const above = r2.strip[(r2.paylineIndex - 1 + r2.L) % r2.L];
  return { p, line, above };
}

console.log('\nEvery prize lands its own symbol three times');
{
  const m = machine();
  cfg.prizes.filter(p => p.tier !== 'none').forEach(prize => {
    let ok = 0;
    for (let i = 0; i < 200; i++) {
      m.reels.forEach(r => { r.strip = r._buildStrip(cfg.symbols); r.L = r.strip.length; });
      m.decide = () => prize;
      const s = spinOnce(m);
      if (s.line.every(x => x === prize.symbol)) ok++;
    }
    check(prize.label + ': 200 of 200 spins show three ' + prize.symbol, ok === 200, ok);
  });
}

console.log('\nA real evening, spin by spin through the engine');
{
  let now = START - 10 * 60000;
  const bank = new S.PrizeBank(cfg, { now: () => now, storage: mkStorage(), log: noop });
  const m = machine();
  m.decide = () => bank.decide('G' + now);
  let wins = 0, losses = 0, near = 0, fakeWin = 0, wrongWin = 0, badNear = 0, nearMissOff = 0;
  for (; now < END + 30 * 60000; now += 20000) {
    const s = spinOnce(m);
    const allSame = s.line[0] === s.line[1] && s.line[1] === s.line[2];
    if (s.p.isWin) {
      wins++;
      if (!(allSame && s.line[0] === s.p.prize.symbol)) wrongWin++;
    } else {
      losses++;
      if (allSame) fakeWin++;
      if (s.p.nearMiss) {
        near++;
        if (!(s.line[0] === s.line[1] && s.line[2] !== s.line[0] && s.above === s.line[0])) badNear++;
      }
    }
  }
  check('wins happened', wins > 0 && wins <= 11, wins);
  check('every win shows three of the won prize', wrongWin === 0, wrongWin);
  check('no losing pull ever shows three in a row (' + losses + ' losses)', fakeWin === 0, fakeWin);
  check('every near miss shows two matching and the third one row above', badNear === 0, badNear);
  const rate = near / losses;
  check('near misses happen at about the configured rate (' + (rate * 100).toFixed(1) + '% vs ' +
        (cfg.feel.nearMissRate * 100) + '%)', Math.abs(rate - cfg.feel.nearMissRate) < 0.06, rate);
}

console.log('\nA prize bank that throws cannot jam the reels');
{
  const m = machine();
  m.decide = () => { throw new Error('boom'); };
  const before = timers.length;
  m.state = 'idle';
  const ok = m.spin();
  check('the spin still starts', ok === true);
  check('and it is a loss', m.pending && m.pending.prize.tier === 'none', m.pending && m.pending.prize.id);
  check('the error is re-thrown for the activity log', timers.length > before);
}

console.log('\nA spin cannot start while one is running');
{
  const m = machine();
  m.decide = () => cfg.prizes.find(p => p.tier === 'none');
  m.state = 'idle';
  m.spin();
  check('second pull mid-spin is refused', m.spin() === false);
}

console.log('\nFresh start: a new reset stamp clears the iPad once');
{
  const st = mkStorage();
  ['cinnamood.leads', 'cinnamood.leads.log', 'cinnamood.prizes.ledger', 'cinnamood.prizes.rehearsal',
   'cinnamood.config', 'cinnamood.armed', 'cinnamood.leads.settings'].forEach(k => st.setItem(k, '[1]'));
  st.setItem('someone.else', 'keep');
  const n = S.applyResetStamp(st, 'fresh-1');
  check('every machine key is cleared', n === 7 && st.length === 2, { n, len: st.length });
  check('keys that are not the machine\'s are left alone', st.getItem('someone.else') === 'keep');
  st.setItem('cinnamood.leads', '[{"id":"new"}]');
  check('the same stamp never clears again', S.applyResetStamp(st, 'fresh-1') === 0 &&
        st.getItem('cinnamood.leads') !== null);
  check('no stamp means no clearing', S.applyResetStamp(st, '') === 0 && st.getItem('cinnamood.leads') !== null);
  const broken = { getItem() { throw new Error('denied'); } };
  check('storage that throws does not crash the boot', S.applyResetStamp(broken, 'x') === 0);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
