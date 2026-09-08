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
const KEY = 'change-me-to-something-only-you-know';

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

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
