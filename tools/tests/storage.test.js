/* Exercises the real leads.js against fake storage, network and clock.
   Everything here is a failure mode a bakery counter will actually produce:
   no wifi, a hung request, a full iPad, storage turned off, a reload at the
   worst moment, two tabs open. */
const fs = require('fs');
const vm = require('vm');

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); }
};
const section = t => console.log('\n' + t);

function makeStorage(opts = {}) {
  const data = new Map();
  return {
    _data: data,
    limit: opts.limit || Infinity,
    throwOnWrite: opts.throwOnWrite || false,
    throwOnRead: opts.throwOnRead || false,
    getItem(k) { if (this.throwOnRead) throw new Error('storage blocked'); return data.has(k) ? data.get(k) : null; },
    setItem(k, v) {
      if (this.throwOnWrite) throw new Error('storage blocked');
      let total = 0; data.forEach((val, key) => { if (key !== k) total += val.length; });
      if (total + v.length > this.limit) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; }
      data.set(k, v);
    },
    removeItem(k) { data.delete(k); },
    clear() { data.clear(); }
  };
}

function loadStore(env = {}) {
  const listeners = {};
  const sandbox = {
    localStorage: env.storage || makeStorage(),
    navigator: { onLine: env.onLine === undefined ? true : env.onLine },
    window: { addEventListener: (t, f) => { (listeners[t] = listeners[t] || []).push(f); } },
    document: { hidden: false, addEventListener: (t, f) => { (listeners[t] = listeners[t] || []).push(f); } },
    fetch: env.fetch || (async () => { throw new Error('no network'); }),
    setTimeout, clearTimeout, console, Date, Math, JSON, Number, String, Array, Object, Map, Set, Boolean, Error,
    AbortController: global.AbortController
  };
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  // A top-level `class` lands in the context's lexical scope, not on the
  // sandbox object, so hand it out explicitly. In the browser skin.js reaches
  // it the same way — both are classic scripts sharing one global scope.
  vm.runInContext(fs.readFileSync(process.argv[2], 'utf8') +
                  '\n;this.LeadStore=LeadStore;this.validateLead=validateLead;', sandbox);
  sandbox._listeners = listeners;
  return sandbox;
}

const GUEST = (n = 1) => ({
  first: 'Guest' + n, last: 'Test',
  email: 'guest' + n + '@example.com', phone: '69700000' + String(n).padStart(2, '0')
});

(async () => {

section('Validation');
{
  const s = loadStore();
  const st = new s.LeadStore({});
  check('blank form rejected', st.add({}).reason === 'invalid');
  check('missing last name rejected',
        st.add({ first: 'A', email: 'a@b.co', phone: '2101234567' }).errs.last !== undefined);
  check('email without a dot rejected',
        st.add({ first: 'A', last: 'B', email: 'a@b', phone: '2101234567' }).errs.email !== undefined);
  check('5-digit phone rejected',
        st.add({ first: 'A', last: 'B', email: 'a@b.co', phone: '12345' }).errs.phone !== undefined);
  check('16-digit phone rejected',
        st.add({ first: 'A', last: 'B', email: 'a@b.co', phone: '1234567890123456' }).errs.phone !== undefined);
  check('accented name accepted',
        st.add({ first: 'Zoë', last: "O'Brien-Smith", email: 'z@b.co', phone: '+30 210 123 4567' }).ok === true);
  check('whitespace-only name rejected',
        st.add({ first: '   ', last: 'B', email: 'a@b.co', phone: '2101234567' }).errs.first !== undefined);
  check('nothing invalid was stored', st.count === 1, st.count);
}

section('Duplicates, strict mode');
{
  const s = loadStore();
  const st = new s.LeadStore({});
  st.saveSettings({ dedupeWindowDays: 0 });
  check('first entry accepted', st.add(GUEST(1)).ok === true);
  check('identical entry blocked', st.add(GUEST(1)).reason === 'duplicate');
  check('same email, new phone blocked',
        st.add({ first: 'X', last: 'Y', email: 'guest1@example.com', phone: '2109999999' }).field === 'email');
  check('same phone, new email blocked',
        st.add({ first: 'X', last: 'Y', email: 'other@example.com', phone: '6970000001' }).field === 'phone');
  check('email case and spacing ignored',
        st.add({ first: 'X', last: 'Y', email: '  GUEST1@Example.COM ', phone: '2108888888' }).reason === 'duplicate');
  check('+30 vs 0030 vs local all match',
        st.add({ first: 'X', last: 'Y', email: 'z@z.co', phone: '+30 697 000 0001' }).reason === 'duplicate');
  check('a genuinely different guest still gets in', st.add(GUEST(2)).ok === true);
  check('two leads stored', st.count === 2, st.count);
}

section('Duplicates, testing mode');
{
  const s = loadStore();
  const st = new s.LeadStore({});
  st.saveSettings({ dedupeWindowDays: -1 });
  check('first accepted', st.add(GUEST(1)).ok === true);
  const second = st.add(GUEST(1));
  check('same details accepted again', second.ok === true);
  check('second is flagged as a repeat', second.record.repeat === true);
  check('first was not flagged', st.list[0].repeat === false);
}

section('Repeat window');
{
  const s = loadStore();
  const st = new s.LeadStore({});
  st.saveSettings({ dedupeWindowDays: 7 });
  st.add(GUEST(1));
  st.list[0].ts = new Date(Date.now() - 30 * 86400000).toISOString();   // 30 days ago
  check('blocked inside the window',
        (st.saveSettings({ dedupeWindowDays: 60 }), st.add(GUEST(1)).reason) === 'duplicate');
  st.saveSettings({ dedupeWindowDays: 7 });
  check('allowed once the window has passed', st.add(GUEST(1)).ok === true);
}

section('Clearing the sheet resets the iPads too');
{
  const s = loadStore();
  const st = new s.LeadStore({});
  st.saveSettings({ dedupeWindowDays: 0 });
  st.add(GUEST(1));
  st.list[0].synced = true;                       // confirmed on the sheet
  check('blocked while the sheet has them', st.add(GUEST(1)).reason === 'duplicate');

  // The row is deleted from the sheet, so the sheet now says it has never
  // seen them. The iPad must stop refusing them.
  const dropped = st.forgetSynced(GUEST(1));
  check('the stale local record is cleared', dropped === 1, dropped);
  check('they can play again', st.add(GUEST(1)).ok === true);
}
{
  // A guest still queued to be sent must NOT be forgotten — the sheet is about
  // to see them, so refusing a second attempt is correct.
  const s = loadStore();
  const st = new s.LeadStore({});
  st.saveSettings({ dedupeWindowDays: 0 });
  st.add(GUEST(2));                                // stays unsynced
  check('a queued guest is never forgotten', st.forgetSynced(GUEST(2)) === 0);
  check('and still blocks a repeat', st.add(GUEST(2)).reason === 'duplicate');
}
{
  const s = loadStore();
  const st = new s.LeadStore({});
  st.saveSettings({ dedupeWindowDays: 0 });
  st.add({ first:'A', last:'B', email:'x@y.co', phone:'+30 697 000 0001' });
  st.list[0].synced = true;
  check('forgets by a phone written differently',
        st.forgetSynced({ email:'unrelated@z.co', phone:'0030 697 000 0001' }) === 1);
}

section('Saving on the iPad');
{
  const storage = makeStorage();
  const s = loadStore({ storage });
  const st = new s.LeadStore({});
  st.add(GUEST(1));
  check('written to storage immediately', storage._data.has('cinnamood.leads'));
  // reload
  const s2 = loadStore({ storage });
  const st2 = new s2.LeadStore({});
  check('survives a reload', st2.count === 1 && st2.list[0].email === 'guest1@example.com');
  check('dedupe still works after a reload',
        (st2.saveSettings({ dedupeWindowDays: 0 }), st2.add(GUEST(1)).reason) === 'duplicate');
}

section('Corrupt storage');
{
  const storage = makeStorage();
  storage.setItem('cinnamood.leads', '{not json at all');
  const s = loadStore({ storage });
  let st;
  check('does not throw on boot', (() => { try { st = new s.LeadStore({}); return true; } catch (e) { return false; } })());
  check('treated as empty', st.count === 0);
  check('still accepts new guests', st.add(GUEST(1)).ok === true);
}
{
  const storage = makeStorage();
  storage.setItem('cinnamood.leads', JSON.stringify([{ id: 'ok', email: 'a@b.co' }, null, { noId: true }, 'junk']));
  const s = loadStore({ storage });
  const st = new s.LeadStore({});
  check('malformed entries dropped, good ones kept', st.count === 1, st.count);
}

section('Storage turned off entirely (private browsing)');
{
  const storage = makeStorage({ throwOnWrite: true, throwOnRead: true });
  const s = loadStore({ storage });
  let st;
  check('boots without throwing', (() => { try { st = new s.LeadStore({}); return true; } catch (e) { return false; } })());
  const r = st.add(GUEST(1));
  check('guest still accepted', r.ok === true);
  check('held in memory', st.count === 1);
  check('storage reported as failing', st.storageOk === false);
}

section('iPad out of space');
{
  const storage = makeStorage({ limit: 2000 });
  const s = loadStore({ storage });
  const st = new s.LeadStore({});
  for (let i = 1; i <= 12; i++) { const r = st.add(GUEST(i)); if (r.ok) st.list[st.list.length - 1].synced = true; }
  st.list.forEach(r => { r.synced = true; });
  const before = st.count;
  for (let i = 13; i <= 20; i++) st.add(GUEST(i));
  check('kept accepting guests past the limit', st.count > 0);
  check('older synced leads were dropped to make room', st.count < before + 8, { before, now: st.count });
  check('the newest guest survived', st.list[st.list.length - 1].email === 'guest20@example.com');
  check('nothing unsynced was thrown away', st.list.filter(r => !r.synced).length === st.pending);
}
{
  // Everything unsynced and no room: nothing may be discarded.
  const storage = makeStorage({ limit: 900 });
  const s = loadStore({ storage });
  const st = new s.LeadStore({});
  for (let i = 1; i <= 10; i++) st.add(GUEST(i));
  check('no unsynced lead was dropped', st.list.every(r => !r.synced) && st.count === 10, st.count);
  check('flagged as a storage problem', st.storageOk === false);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
})();
