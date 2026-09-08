/* The network half. Every case here is something a cafe wifi will do. */
const fs = require('fs'), vm = require('vm');
let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '  ' + JSON.stringify(x) : '')); } };
const section = t => console.log('\n' + t);
const wait = ms => new Promise(r => setTimeout(r, ms));

function makeStorage() {
  const d = new Map();
  return { getItem: k => d.has(k) ? d.get(k) : null, setItem: (k, v) => d.set(k, v),
           removeItem: k => d.delete(k), _data: d };
}
function load(env = {}) {
  const sandbox = {
    localStorage: env.storage || makeStorage(),
    navigator: { onLine: env.onLine === undefined ? true : env.onLine },
    window: { addEventListener(){} }, document: { hidden: false, addEventListener(){} },
    fetch: env.fetch, setTimeout, clearTimeout, console, Date, Math, JSON, Number,
    String, Array, Object, Map, Set, Boolean, Error, Promise, AbortController, TypeError
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(process.argv[2], 'utf8') + '\n;this.LeadStore=LeadStore;', sandbox);
  return sandbox;
}
const G = n => ({ first: 'G' + n, last: 'T', email: 'g' + n + '@e.co', phone: '69700000' + String(n).padStart(2, '0') });

(async () => {

section('The happy path');
{
  const seen = [];
  const s = load({ fetch: async (u, o) => { const b = JSON.parse(o.body); seen.push(b);
    return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, saved: (b.leads || []).map(l => l.id) }) }; } });
  const st = new s.LeadStore({});
  st.saveSettings({ syncUrl: 'https://sheet', syncKey: 'k', dedupeWindowDays: -1 });
  st.add(G(1)); await wait(60);
  check('posted once', seen.filter(b => b.leads).length === 1, seen.length);
  check('passphrase sent', seen[seen.length - 1].key === 'k');
  check('marked as on the sheet', st.list[0].synced === true);
  check('nothing left pending', st.pending === 0);
}

section('No wifi');
{
  let attempts = 0;
  const s = load({ fetch: async () => { attempts++; throw new TypeError('Failed to fetch'); } });
  const st = new s.LeadStore({ syncRetryMs: 60, syncMaxBackoffMs: 200 });
  st.saveSettings({ syncUrl: 'https://sheet', syncKey: 'k', dedupeWindowDays: -1 });
  st.add(G(1)); await wait(80);
  check('the guest is still saved locally', st.count === 1);
  check('still queued for the sheet', st.pending === 1);
  check('failure is reported', !!st.lastSyncError, st.lastSyncError);
  const a1 = attempts; await wait(400);
  check('it keeps retrying by itself', attempts > a1, { a1, now: attempts });
}

section('Wifi comes back');
{
  let down = true, attempts = 0;
  const s = load({ fetch: async (u, o) => { attempts++;
    if (down) throw new TypeError('Failed to fetch');
    const b = JSON.parse(o.body);
    return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, saved: b.leads.map(l => l.id) }) }; } });
  const st = new s.LeadStore({ syncRetryMs: 50, syncMaxBackoffMs: 120 });
  st.saveSettings({ syncUrl: 'https://sheet', syncKey: 'k', dedupeWindowDays: -1 });
  st.add(G(1)); st.add(G(2)); await wait(120);
  check('backlog waiting', st.pending === 2, st.pending);
  down = false; await wait(500);
  check('backlog cleared on its own', st.pending === 0, st.pending);
  check('error cleared', st.lastSyncError === null);
}

section('The sheet says no');
{
  const s = load({ fetch: async () => ({ ok: true, status: 200,
    text: async () => JSON.stringify({ ok: false, error: 'Wrong passphrase' }) }) });
  const st = new s.LeadStore({ syncRetryMs: 60 });
  st.saveSettings({ syncUrl: 'https://sheet', syncKey: 'wrong', dedupeWindowDays: -1 });
  st.add(G(1)); await wait(80);
  check('not marked as saved', st.list[0].synced === false);
  check('the reason is shown', /passphrase/i.test(st.lastSyncError || ''), st.lastSyncError);
}

section('Google returns an HTML error page instead of JSON');
{
  const s = load({ fetch: async () => ({ ok: true, status: 200, text: async () => '<!DOCTYPE html><html>...' }) });
  const st = new s.LeadStore({ syncRetryMs: 60 });
  st.saveSettings({ syncUrl: 'https://sheet', syncKey: 'k', dedupeWindowDays: -1 });
  st.add(G(1)); await wait(80);
  check('not treated as success', st.list[0].synced === false);
  check('an error is recorded', !!st.lastSyncError);
}

section('The sheet saves only some of the batch');
{
  const s = load({ fetch: async (u, o) => { const b = JSON.parse(o.body);
    return { ok: true, status: 200,
             text: async () => JSON.stringify({ ok: true, saved: [b.leads[0].id] }) }; } });
  const st = new s.LeadStore({ syncRetryMs: 5000 });
  st.saveSettings({ syncUrl: 'https://sheet', syncKey: 'k', dedupeWindowDays: -1 });
  st.add(G(1)); st.add(G(2)); st.add(G(3)); await wait(150);
  check('only the confirmed one is marked saved', st.list.filter(r => r.synced).length === 1,
        st.list.map(r => r.synced));
  check('the rest stay queued', st.pending === 2, st.pending);
}

section('The sheet confirms nothing (no saved list)');
{
  const s = load({ fetch: async () => ({ ok: true, status: 200,
    text: async () => JSON.stringify({ ok: true }) }) });
  const st = new s.LeadStore({ syncRetryMs: 5000 });
  st.saveSettings({ syncUrl: 'https://sheet', syncKey: 'k', dedupeWindowDays: -1 });
  st.add(G(1)); await wait(120);
  check('NOT assumed saved', st.list[0].synced === false, st.list[0].synced);
}

section('The request hangs and never answers');
{
  const s = load({ fetch: (u, o) => new Promise((res, rej) => {
    if (o && o.signal) o.signal.addEventListener('abort', () => rej(new Error('aborted')));
    /* otherwise never settles */ }) });
  const st = new s.LeadStore({ syncRetryMs: 60, syncMaxBackoffMs: 200, syncTimeoutMs: 150 });
  st.saveSettings({ syncUrl: 'https://sheet', syncKey: 'k', dedupeWindowDays: -1 });
  st.add(G(1)); await wait(400);
  check('the sync did not lock up forever', st.syncing === false, { syncing: st.syncing });
  check('it recorded a failure and will retry', !!st.lastSyncError, st.lastSyncError);
}

section('A big backlog goes out in batches');
{
  let batches = 0;
  const s = load({ fetch: async (u, o) => { const b = JSON.parse(o.body); batches++;
    return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, saved: b.leads.map(l => l.id) }) }; } });
  const st = new s.LeadStore({ syncRetryMs: 30 });
  st.saveSettings({ syncUrl: 'https://sheet', syncKey: 'k', dedupeWindowDays: -1 });
  for (let i = 1; i <= 60; i++) st.add(G(i));
  await wait(3000);
  check('all 60 reached the sheet', st.pending === 0, st.pending);
  check('sent in batches, not one huge request', batches >= 3, batches);
}

section('Result attached after the guest already synced');
{
  const posts = [];
  const s = load({ fetch: async (u, o) => { const b = JSON.parse(o.body); posts.push(b.leads);
    return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, saved: b.leads.map(l => l.id) }) }; } });
  const st = new s.LeadStore({});
  st.saveSettings({ syncUrl: 'https://sheet', syncKey: 'k', dedupeWindowDays: -1 });
  const r = st.add(G(1)); await wait(60);
  st.attachResult(r.record.id, { prize: { label: 'Box of Six', id: 'jackpot' }, isWin: true });
  await wait(120);
  check('sent a second time with the prize', posts.length === 2, posts.length);
  check('same id both times, so the sheet updates one row',
        posts[0][0].id === posts[1][0].id);
  check('prize present the second time', posts[1][0].prize === 'Box of Six');
  check('nothing pending', st.pending === 0);
}

section('attachResult for an id that is gone');
{
  const s = load({ fetch: async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ ok: true, saved: [] }) }) });
  const st = new s.LeadStore({});
  check('does not throw', (() => { try { st.attachResult('nope', { prize: { label: 'x' }, isWin: true }); return true; } catch (e) { return false; } })());
}

section('CSV export');
{
  const s = load({ fetch: async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ ok: true, saved: [] }) }) });
  const st = new s.LeadStore({});
  st.saveSettings({ dedupeWindowDays: -1 });
  st.add({ first: 'Anna, "The Boss"', last: 'Smith\nJones', email: 'a@b.co', phone: '+30 210 111 2222' });
  const csv = st.csv();
  const lines = csv.split('\r\n');
  check('has a header', /First name/.test(lines[0]));
  check('one row per guest', lines.length === 2, lines.length);
  check('commas and quotes are escaped', lines[1].indexOf('"Anna, ""The Boss"""') !== -1, lines[1]);
  check('newline inside a field is quoted, not split', lines.length === 2);
  check('starts with a BOM so Excel reads accents', csv.charCodeAt(0) === 0xFEFF);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
})();
