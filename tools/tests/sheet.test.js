/* Runs the real leads-sheet.gs against a fake Sheets API to prove the parts
   that are pure logic: the passphrase gate, the ping, the upsert-by-id, the
   row mapping and the formula-injection guard. */
const fs = require('fs');
const src = fs.readFileSync(process.argv[2], 'utf8');

const calls = [];
function mkRange(sheet, r, c, nr, nc) {
  const api = {
    setValues(v) { for (let i=0;i<v.length;i++) sheet._rows[r-1+i] = v[i].slice(); return api; },
    getValues() {
      const out=[]; for(let i=0;i<nr;i++){const row=sheet._rows[r-1+i]||[];out.push(row.slice(c-1,c-1+nc));}
      return out;
    },
    setValue(v){ sheet._rows[r-1]=sheet._rows[r-1]||[]; sheet._rows[r-1][c-1]=v; return api; },
    setFormula(){return api;}, setBackground(){return api;}, setFontColor(){return api;},
    setFontWeight(){return api;}, setFontSize(){return api;}, setVerticalAlignment(){return api;},
    setHorizontalAlignment(){return api;}, setNumberFormat(){return api;}, createFilter(){return {};},
    getColumn(){return c;}
  };
  return api;
}
function mkSheet(name) {
  const s = {
    _rows: [], getName:()=>name,
    getLastRow(){ let n=0; this._rows.forEach((r,i)=>{ if(r && r.some(v=>v!==''&&v!=null)) n=i+1; }); return n; },
    getMaxRows: () => 1000,
    getRange(r,c,nr,nc){ if(typeof r==='string'){return mkRange(s,1,1,1,1);} return mkRange(s,r,c,nr||1,nc||1); },
    appendRow(v){ s._rows[s.getLastRow()] = v.slice(); },
    deleteRow(r){ s._rows.splice(r-1,1); },
    deleteRows(r,n){ s._rows.splice(r-1,n); },
    setRowHeight(){}, setFrozenRows(){}, setColumnWidth(){}, setHiddenGridlines(){},
    getFilter(){return null;}, getConditionalFormatRules(){return [];},
    setConditionalFormatRules(){}, clearConditionalFormatRules(){}, clear(){ s._rows=[]; }
  };
  return s;
}
const sheets = {};
const ss = {
  getSheetByName(n){ return sheets[n] || null; },
  insertSheet(n){ sheets[n]=mkSheet(n); return sheets[n]; },
  getSheets(){ return Object.values(sheets); },
  deleteSheet(sh){ delete sheets[sh.getName()]; },
  setActiveSheet(){}
};
const props = {};
const sandbox = {
  SpreadsheetApp: {
    getActiveSpreadsheet: () => ss,
    newConditionalFormatRule: () => { const b={whenTextEqualTo:()=>b,setBackground:()=>b,setFontColor:()=>b,setBold:()=>b,setRanges:()=>b,build:()=>({getRanges:()=>[{getColumn:()=>7}]})}; return b; }
  },
  PropertiesService: { getScriptProperties: () => ({ getProperty:k=>props[k]||null, setProperty:(k,v)=>{props[k]=v;} }) },
  LockService: { getScriptLock: () => ({ waitLock(){}, releaseLock(){} }) },
  ContentService: { createTextOutput: t => ({ setMimeType: () => t }), MimeType: { JSON: 'json' } },
  console
};
const vm = require('vm');
vm.createContext(sandbox);
vm.runInContext(src, sandbox);

const post = body => JSON.parse(sandbox.doPost({ postData: { contents: JSON.stringify(body) } }));
// Read the real secrets out of the file, so changing them cannot silently
// leave this suite testing a passphrase nobody uses.
const KEY = /var PASSPHRASE = '([^']+)'/.exec(src)[1];
const ADMIN = /var ADMIN_KEY = '([^']+)'/.exec(src)[1];

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '  ' + JSON.stringify(extra) : '')); }
};

console.log('\nPassphrase gate');
check('wrong passphrase refused', post({ key:'nope', ping:true }).ok === false);
check('right passphrase accepted', post({ key:KEY, ping:true }).ok === true);

console.log('\nFirst lead builds the workbook');
const lead = { id:'L1', ts:'2026-09-08T09:15:00.000Z', first:'Maria', last:'Papadopoulou',
               email:'maria@example.com', phone:'+30 694 123 4567', prize:'', won:null, repeat:false,
               consent:'We keep your details...' };
let r = post({ key:KEY, leads:[lead] });
check('lead accepted', r.ok === true && r.saved[0] === 'L1');
check('Guests tab exists', !!sheets['Guests']);
check('Dashboard tab exists', !!sheets['Dashboard']);
check('Email list tab exists', !!sheets['Email list']);
const rows = sheets['Guests']._rows;
check('header written', rows[0] && rows[0][0] === 'When' && rows[0][9] === 'Lead ID');
check('one data row', sheets['Guests'].getLastRow() === 2, rows.length);
// instanceof is realm-sensitive: the script runs inside a vm context, so its
// Date is not this file's Date. Compare the brand instead.
check('date stored as a real Date',
      Object.prototype.toString.call(rows[1][0]) === '[object Date]', rows[1][0]);
check('phone escaped against formula parsing', rows[1][4] === "'+30 694 123 4567", rows[1][4]);
check('no-pull leaves Won blank', rows[1][6] === '');

console.log('\nSame lead again with a result — updates, never duplicates');
r = post({ key:KEY, leads:[Object.assign({}, lead, { prize:'Free Iced Latte', won:true })] });
check('accepted', r.ok === true);
check('still one data row', sheets['Guests'].getLastRow() === 2, sheets['Guests'].getLastRow());
check('prize written', sheets['Guests']._rows[1][5] === 'Free Iced Latte');
check('Won = Yes', sheets['Guests']._rows[1][6] === 'Yes');

console.log('\nRetry of an already-saved lead is ignored');
r = post({ key:KEY, leads:[Object.assign({}, lead, { prize:'Free Iced Latte', won:true })] });
check('still one data row', sheets['Guests'].getLastRow() === 2);

console.log('\nA second guest appends');
r = post({ key:KEY, leads:[{ id:'L2', ts:'2026-09-08T09:20:00.000Z', first:'Nikos', last:'G',
                             email:'n@example.com', phone:'2101234567', prize:'Not This Time',
                             won:false, repeat:true, consent:'x' }] });
check('two data rows', sheets['Guests'].getLastRow() === 3, sheets['Guests'].getLastRow());
check('repeat flag written', sheets['Guests']._rows[2][7] === 'Yes');
check('loss recorded as No', sheets['Guests']._rows[2][6] === 'No');

console.log('\nA batch containing the same id twice writes it once');
r = post({ key:KEY, leads:[{ id:'L3', first:'A', last:'B', email:'a@b.co', phone:'2100000000', consent:'' },
                           { id:'L3', first:'A', last:'B', email:'a@b.co', phone:'2100000000', consent:'' }] });
check('three data rows', sheets['Guests'].getLastRow() === 4, sheets['Guests'].getLastRow());

console.log('\nHostile input');
r = post({ key:KEY, leads:[{ id:'L4', first:'=HYPERLINK("http://evil","click")', last:'X',
                             email:'x@y.co', phone:'2100000001', consent:'' }] });
check('formula in a name is neutralised',
      String(sheets['Guests']._rows[4][1]).charAt(0) === "'", sheets['Guests']._rows[4][1]);
check('malformed body refused', post({ key:KEY, leads:'not-an-array' }).ok === false);

console.log('\nThe sheet is the final word on who has already played');
{
  // one guest on record, from a DIFFERENT iPad as far as this machine knows
  post({ key:KEY, leads:[{ id:'LC1', ts:'2026-09-08T10:00:00.000Z', first:'Sara',
    last:'H', email:'Sara.H@Example.COM', phone:'+971 50 987 6543', consent:'' }] });

  const ask = (email, phone) => post({ key: KEY, check: { email, phone } });
  const asAdminCount = () => post({ admin: 'count', adminKey: ADMIN }).guests;
  const rowsBeforeChecks = asAdminCount();

  check('an unseen guest is allowed', ask('new@example.com','+971 50 111 0000').seen === false);
  check('the same email is caught', ask('sara.h@example.com','+971 50 000 0000').seen === true);
  check('email case and spacing ignored', ask('  SARA.H@EXAMPLE.com ','+9715000').seen === true);
  check('reports which field matched', ask('sara.h@example.com','+971 50 000 0000').field === 'email');
  check('the same phone with a different email is caught',
        ask('someone.else@example.com','00971509876543').seen === true);
  check('phone match is reported as phone',
        ask('someone.else@example.com','0509876543').field === 'phone');
  // Asking is a question, not a visit: it must leave the sheet exactly as it was.
  check('a checking request never adds a row',
        asAdminCount() === rowsBeforeChecks, {before: rowsBeforeChecks, after: asAdminCount()});
}

console.log('\nAdmin commands are locked to their own key');
{
  const asAdmin = (b) => post(Object.assign({ adminKey: ADMIN }, b));
  check('the public passphrase cannot read guests',
        post({ key: KEY, admin: 'read' }).ok === false);
  check('a wrong admin key is refused',
        post({ admin: 'read', adminKey: 'nope' }).error === 'Not authorised');
  check('no admin key at all is refused',
        post({ admin: 'read' }).ok === false);

  const before = asAdmin({ admin: 'count' });
  check('count works', before.ok === true && before.guests > 0, before);

  const readBack = asAdmin({ admin: 'read' });
  check('read returns the guests', readBack.rows.length === before.guests, readBack.rows.length);
  check('read gives readable column names',
        readBack.rows[0]['First name'] !== undefined, Object.keys(readBack.rows[0]));
  check('dates come back as text, not objects',
        typeof readBack.rows[0]['When'] === 'string', typeof readBack.rows[0]['When']);

  const paged = asAdmin({ admin: 'read', offset: 1, limit: 1 });
  check('paging works', paged.rows.length === 1 && paged.rows[0]['Lead ID'] !== readBack.rows[0]['Lead ID']);

  const targetId = readBack.rows[0]['Lead ID'];
  const del = asAdmin({ admin: 'delete', ids: [targetId] });
  check('delete removes exactly one', del.deleted === 1, del);
  const after = asAdmin({ admin: 'read' });
  check('the right guest went', !after.rows.some(r => r['Lead ID'] === targetId));
  check('everyone else stayed', after.rows.length === before.guests - 1, after.rows.length);

  check('delete with no ids is refused', asAdmin({ admin: 'delete', ids: [] }).ok === false);

  check('clear refuses a wrong expected count',
        asAdmin({ admin: 'clear', confirmCount: 999 }).ok === false);
  const n = asAdmin({ admin: 'count' }).guests;
  const cleared = asAdmin({ admin: 'clear', confirmCount: n });
  check('clear removes every guest', cleared.cleared === n, cleared);
  check('the header row survived', sheets['Guests']._rows[0][0] === 'When');
  check('the sheet is empty', asAdmin({ admin: 'count' }).guests === 0);

  check('unknown commands are refused', asAdmin({ admin: 'nonsense' }).ok === false);
}

console.log('\nThe kiosk still works after all that');
{
  const r = post({ key: KEY, leads: [{ id:'LX', ts:'2026-09-08T10:00:00.000Z',
    first:'After', last:'Admin', email:'a@a.co', phone:'2100000009', consent:'' }] });
  check('a new guest lands in the empty sheet', r.ok === true);
  check('as the first data row', sheets['Guests'].getLastRow() === 2, sheets['Guests'].getLastRow());
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
