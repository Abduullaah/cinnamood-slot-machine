/* Proves a device stuck in testing mode is pulled back to the file's rule. */
const fs=require('fs'), vm=require('vm');
let pass=0,fail=0;
const check=(n,c,x)=>{ if(c){pass++;console.log('  ok   '+n);} else {fail++;console.log('  FAIL '+n+(x!==undefined?'  '+JSON.stringify(x):''));} };
function storage(){ const d=new Map(); return {getItem:k=>d.has(k)?d.get(k):null,
  setItem:(k,v)=>d.set(k,v), removeItem:k=>d.delete(k), _d:d}; }
function load(st){ const s={localStorage:st,navigator:{onLine:true},
  window:{addEventListener(){}},document:{hidden:false,addEventListener(){}},
  fetch:async()=>({ok:true,status:200,text:async()=>JSON.stringify({ok:true,saved:[]})}),
  setTimeout,clearTimeout,console,Date,Math,JSON,Number,String,Array,Object,Map,Set,
  Boolean,Error,Promise,AbortController,TypeError};
  vm.createContext(s); vm.runInContext(fs.readFileSync(process.argv[2],'utf8')+'\n;this.LeadStore=LeadStore;',s);
  return s; }
const G=n=>({first:'G'+n,last:'T',email:'g'+n+'@e.co',phone:'697000000'+n});

console.log('\nAn iPad left in testing mode by a staff member');
{
  const st = storage();
  // what that device looks like after someone chose "Straight away — TESTING"
  st.setItem('cinnamood.leads.settings', JSON.stringify({
    syncUrl:'', syncKey:'', settingsVersion:1, dedupeWindowDays:-1 }));

  // the old build: same generation, so the device keeps its own rule
  let s = load(st);
  let store = new s.LeadStore({ settingsVersion:1, dedupeWindowDays:-1 });
  check('was accepting repeats before', (store.add(G(1)), store.add(G(1)).ok) === true);

  // the new build: generation bumped, file says no repeats
  const st2 = storage();
  st2.setItem('cinnamood.leads.settings', JSON.stringify({
    syncUrl:'', syncKey:'', settingsVersion:1, dedupeWindowDays:-1 }));
  s = load(st2);
  store = new s.LeadStore({ settingsVersion:2, dedupeWindowDays:0 });
  check('the stale testing setting is ignored', store.dedupeOff === false);
  store.add(G(1));
  check('the same guest is now refused', store.add(G(1)).reason === 'duplicate');
}

console.log('\nA device that never touched the panel');
{
  const st = storage();
  const s = load(st);
  const store = new s.LeadStore({ settingsVersion:2, dedupeWindowDays:0 });
  store.add(G(1));
  check('follows the file: no repeats', store.add(G(1)).reason === 'duplicate');
}

console.log('\nA deliberate per-machine sheet override still survives the bump');
{
  const st = storage();
  st.setItem('cinnamood.leads.settings', JSON.stringify({
    syncUrl:'https://other.example/exec', syncKey:'k2', settingsVersion:1, dedupeWindowDays:-1 }));
  const s = load(st);
  const store = new s.LeadStore({ settingsVersion:2, dedupeWindowDays:0,
                                  syncUrl:'https://file.example/exec', syncKey:'k1' });
  check('address override kept', store.settings.syncUrl === 'https://other.example/exec');
  check('but the repeat rule is reset', store.settings.dedupeWindowDays === 0);
}

console.log('\n'+pass+' passed, '+fail+' failed\n');
process.exit(fail?1:0);
