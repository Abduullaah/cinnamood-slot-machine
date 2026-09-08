/* ============================================================================
   CINNAMOOD — LEADS SHEET
   ----------------------------------------------------------------------------
   Paste this whole file into Extensions > Apps Script on a new Google Sheet,
   change PASSPHRASE below, then deploy it as a Web app. Full instructions are
   in "Leads Sheet Setup.md".

   It builds the sheet as well as filling it. The first time a lead arrives it
   creates and formats three tabs, so there is nothing to lay out by hand:

     Guests      one row per person, newest at the bottom, brand-styled,
                 filterable, with the prize they won alongside them
     Dashboard   live totals — guests today, this week, all time, win rate,
                 and a breakdown of which prizes have gone out
     Email list  a clean four-column list ready to paste into a mail tool

   Dashboard and Email list are built from formulas that read Guests, so they
   keep themselves up to date. Nothing needs to be re-run.

   The same guest's row is UPDATED when their pull finishes, rather than a
   second row being added — which is also what makes retries safe. Every lead
   carries an id, and an id already in the sheet is never written twice.
   ============================================================================ */

/* ---------------------------------------------------------------------------
   1. CHANGE THIS before deploying. Anything you like, as long as the same
      words go into the Passphrase box in the iPad's staff panel. It is what
      stops anyone who ever sees the web app address writing into your sheet.
   --------------------------------------------------------------------------- */
var PASSPHRASE = 'cinnamoodrolls';

/* ---------------------------------------------------------------------------
   THE ADMIN KEY — a completely separate secret, and it must stay that way.

   PASSPHRASE above is in the kiosk's public source, because the machine has to
   carry it in order to save a guest. Anyone can read it. All it can do is ADD a
   row, so the worst anyone can do with it is add rubbish.

   This key can READ every guest's details and DELETE them. It is never in the
   site, never in the browser, and never posted by the machine. It exists only
   here and wherever you have chosen to keep it.

   Any request that tries an admin command with the public passphrase is
   refused — the two are checked separately and are never interchangeable.

   If it ever leaks, change it here and redeploy. Nothing on any iPad breaks,
   because no iPad has ever used it.
   --------------------------------------------------------------------------- */
var ADMIN_KEY = 'qv9wUTS0shgpQ4JudzqFG4qKasPNz0RUnMUy';

/* ---------------------------------------------------------------------------
   2. Nothing below here needs editing.
   --------------------------------------------------------------------------- */

var TAB_LEADS = 'Guests';
var TAB_DASH = 'Dashboard';
var TAB_MAIL = 'Email list';

/* The four brand colours, and nothing else. */
var BERRY = '#AC1E55';
var ROSE = '#D18B8D';
var BLUSH = '#F3DBEA';
var CREAM = '#F6F1EA';
var INK = '#3A1524';        // berry with black over it, for body text

var COLS = [
  { head: 'When',          width: 165, format: 'd mmm yyyy  HH:mm' },
  { head: 'First name',    width: 130 },
  { head: 'Last name',     width: 140 },
  { head: 'Email',         width: 240 },
  { head: 'Phone',         width: 150, format: '@' },
  { head: 'Prize',         width: 165 },
  { head: 'Won',           width: 70,  align: 'center' },
  { head: 'Repeat',        width: 80,  align: 'center' },
  { head: 'Consent shown', width: 300 },
  { head: 'Lead ID',       width: 150, format: '@' }
];

/* ============================================================================
   RECEIVING
   ============================================================================ */

function doPost(e) {
  /* Every write takes a lock. Two iPads posting in the same instant would
     otherwise both read the same last row and one would overwrite the other's
     guest. */
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(25000);
  } catch (err) {
    return reply({ ok: false, error: 'Sheet busy, try again' });
  }

  try {
    var body = JSON.parse(e.postData.contents);

    /* ---- admin commands ---------------------------------------------------
       Checked FIRST and against their own key, so the public passphrase can
       never reach anything that reads or removes a guest. An admin request
       that arrives with the public passphrase falls through to the check below
       and is refused, because `admin` is not a command the kiosk sends. */
    if (body.admin) {
      if (String(body.adminKey || '') !== ADMIN_KEY || !ADMIN_KEY) {
        return reply({ ok: false, error: 'Not authorised' });
      }
      return admin(body);
    }

    if (String(body.key || '') !== PASSPHRASE) {
      return reply({ ok: false, error: 'Wrong passphrase' });
    }

    /* The staff panel's Test button. Proves the address and the passphrase are
       right without putting a row in the sheet, so it can be pressed as often
       as you like while setting up. */
    if (body.ping) {
      ensureWorkbook();
      return reply({ ok: true, pong: true });
    }

    /* ---- has this person already played? ---------------------------------
       Asked by the kiosk BEFORE it lets anyone pull.

       Each iPad remembers who has played on it, which is enough for one
       machine that never loses its storage. It is not enough for the rule as
       stated: two iPads would each let the same person play, and an iPad whose
       storage iOS decided to clear would forget everyone. The sheet is the one
       place that sees every guest from every machine, so the final word on
       "has this person played" belongs here.

       Matching is the same as the kiosk's: email, or the last nine digits of
       the phone, so +971 50…, 0097150… and 50… are all one person. */
    if (body.check) {
      var s = ensureWorkbook();
      var n = s.getLastRow() - 1;
      if (n < 1) return reply({ ok: true, seen: false });

      var wantEmail = normEmail(body.check.email);
      var wantPhone = normPhone(body.check.phone);
      // Columns D (email) and E (phone), read in one go.
      var seenRows = s.getRange(2, 4, n, 2).getValues();
      for (var k = 0; k < seenRows.length; k++) {
        if (wantEmail && normEmail(seenRows[k][0]) === wantEmail) {
          return reply({ ok: true, seen: true, field: 'email' });
        }
        if (wantPhone && normPhone(seenRows[k][1]) === wantPhone) {
          return reply({ ok: true, seen: true, field: 'phone' });
        }
      }
      return reply({ ok: true, seen: false });
    }

    var leads = body.leads;
    if (!Array.isArray(leads)) return reply({ ok: false, error: 'No leads sent' });

    var sheet = ensureWorkbook();

    /* Index the ids already present, once, rather than searching the whole
       column again for every lead in the batch. */
    var lastRow = sheet.getLastRow();
    var idCol = COLS.length;                    // Lead ID is the last column
    var rowOf = {};
    if (lastRow > 1) {
      var ids = sheet.getRange(2, idCol, lastRow - 1, 1).getValues();
      for (var i = 0; i < ids.length; i++) {
        if (ids[i][0]) rowOf[String(ids[i][0])] = i + 2;
      }
    }

    var saved = [];
    var appended = [];
    var queued = {};        // id -> index within `appended`, for this batch only

    for (var j = 0; j < leads.length; j++) {
      var L = leads[j] || {};
      if (!L.id) continue;
      var id = String(L.id);
      var row = buildRow(L);

      if (rowOf[id] > 0) {
        // Already in the sheet: the same guest coming back with their result
        // attached, or a retry whose reply never arrived. Replace, never
        // duplicate.
        sheet.getRange(rowOf[id], 1, 1, row.length).setValues([row]);
      } else if (queued[id] !== undefined) {
        /* The same id twice inside ONE batch. It is not in the sheet yet, so
           there is no row to overwrite — the later version simply replaces the
           one already staged. Tracking this in its own map matters: a previous
           version parked a -1 in rowOf as a marker, but the append test read
           `rowOf[id] > 0`, so -1 fell through and the guest was written twice. */
        appended[queued[id]] = row;
      } else {
        queued[id] = appended.length;
        appended.push(row);
      }
      saved.push(id);
    }

    if (appended.length) {
      var start = sheet.getLastRow() + 1;
      sheet.getRange(start, 1, appended.length, COLS.length).setValues(appended);
      // Same reasoning as above: the stripe is not worth failing a write over.
      try { styleRows(sheet, start, appended.length); } catch (err) {}
    }

    return reply({ ok: true, saved: saved });
  } catch (err) {
    return reply({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

/* ============================================================================
   ADMIN
   ----------------------------------------------------------------------------
   Reached only with ADMIN_KEY. Four commands:

     read    — the guest rows, newest last. `limit` and `offset` page through.
     count   — how many guests, without pulling any of them back.
     delete  — remove specific guests by their Lead ID.
     clear   — remove every guest row, keeping the headers and the layout.
     rebuild — lay the three tabs out again, touching no data.

   `clear` and `delete` are the only things in this whole file that can destroy
   a guest, which is why they sit behind a key the kiosk does not have.
   ============================================================================ */

function admin(body) {
  var cmd = String(body.admin);
  var sheet = ensureWorkbook();
  var last = sheet.getLastRow();
  var rows = Math.max(0, last - 1);

  if (cmd === 'count') return reply({ ok: true, guests: rows });

  /* Everything needed to work out why a sheet does not look the way it should,
     without anyone having to describe it over a message. */
  if (cmd === 'diagnose') {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var props = PropertiesService.getScriptProperties().getProperties();
    return reply({
      ok: true,
      spreadsheet: ss.getName(),
      timeZone: ss.getSpreadsheetTimeZone(),
      tabs: ss.getSheets().map(function (sh) {
        return { name: sh.getName(), index: sh.getIndex(),
                 lastRow: sh.getLastRow(), lastCol: sh.getLastColumn(),
                 hidden: sh.isSheetHidden(),
                 firstRow: sh.getLastRow() ? sh.getRange(1, 1, 1,
                            Math.min(sh.getLastColumn() || 1, 12)).getValues()[0] : [],
                 secondRow: sh.getLastRow() > 1 ? sh.getRange(2, 1, 1,
                            Math.min(sh.getLastColumn() || 1, 12)).getDisplayValues()[0] : [] };
      }),
      scriptProperties: props,
      expectedColumns: COLS.length
    });
  }

  if (cmd === 'rebuild') { setUp(); return reply({ ok: true, rebuilt: true }); }

  if (cmd === 'read') {
    if (!rows) return reply({ ok: true, guests: 0, rows: [] });
    var offset = Math.max(0, Number(body.offset) || 0);
    var limit = Math.min(Number(body.limit) || 200, 500);
    var start = 2 + offset;
    var n = Math.max(0, Math.min(limit, last - start + 1));
    if (n <= 0) return reply({ ok: true, guests: rows, rows: [] });
    var values = sheet.getRange(start, 1, n, COLS.length).getValues();
    var out = values.map(function (r) {
      var o = {};
      COLS.forEach(function (c, i) {
        // Dates would otherwise come back as an opaque object.
        o[c.head] = (r[i] instanceof Date) ? r[i].toISOString() : r[i];
      });
      return o;
    });
    return reply({ ok: true, guests: rows, offset: offset, rows: out });
  }

  if (cmd === 'delete') {
    var ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
    if (!ids.length) return reply({ ok: false, error: 'No ids given' });
    if (!rows) return reply({ ok: true, deleted: 0 });
    var idCol = COLS.length;
    var have = sheet.getRange(2, idCol, rows, 1).getValues();
    /* Collected then removed from the BOTTOM UP. Deleting top-down shifts every
       row beneath it, so the second deletion would land one row off and remove
       somebody else — the kind of bug that quietly destroys the wrong guest. */
    var hits = [];
    for (var i = 0; i < have.length; i++) {
      if (ids.indexOf(String(have[i][0])) !== -1) hits.push(i + 2);
    }
    hits.sort(function (a, b) { return b - a; });
    hits.forEach(function (r) { sheet.deleteRow(r); });
    return reply({ ok: true, deleted: hits.length });
  }

  if (cmd === 'clear') {
    /* Deliberately awkward: it will not fire unless the caller states how many
       guests it expects to destroy and is right. A stale or mistaken wipe
       fails instead of succeeding. */
    if (Number(body.confirmCount) !== rows) {
      return reply({ ok: false, error: 'Expected ' + body.confirmCount +
                                       ' guests but the sheet holds ' + rows });
    }
    if (rows) sheet.deleteRows(2, rows);
    return reply({ ok: true, cleared: rows });
  }

  return reply({ ok: false, error: 'Unknown command: ' + cmd });
}

/* Opening the web app address in a browser should say something useful rather
   than throw a script error — it is the quickest way to check a deployment. */
function doGet() {
  return reply({ ok: true, service: 'Cinnamood leads', note: 'Ready. Post leads here.' });
}

function buildRow(L) {
  return [
    L.ts ? new Date(L.ts) : new Date(),        // a real date, so it sorts and filters
    text(L.first),
    text(L.last),
    text(L.email),
    text(L.phone),
    text(L.prize),
    L.won === null || L.won === undefined ? '' : (L.won ? 'Yes' : 'No'),
    L.repeat ? 'Yes' : '',
    text(L.consent),
    String(L.id)
  ];
}

/* These two must stay identical to the pair in site/shared/leads.js. If the
   kiosk and the sheet ever disagree about what makes two people the same, one
   of them lets a guest through that the other would have stopped, and the rule
   quietly stops meaning anything. */
function normEmail(v) {
  return String(v === null || v === undefined ? '' : v).trim().toLowerCase();
}

function normPhone(v) {
  var d = String(v === null || v === undefined ? '' : v).replace(/[^0-9]/g, '');
  return d.length > 9 ? d.slice(-9) : d;
}

/* A leading =, +, - or @ makes Sheets treat a guest's own typing as a formula.
   Prefixing an apostrophe forces it to stay text — invisible in the cell, and
   it matters most for phone numbers, since +30 694… is otherwise arithmetic. */
function text(v) {
  var s = v === null || v === undefined ? '' : String(v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
                       .setMimeType(ContentService.MimeType.JSON);
}

/* ============================================================================
   BUILDING THE WORKBOOK

   Runs itself on the first lead and then never again — the flag lives in
   script properties, so it survives redeploys. Run `setUp` by hand from the
   editor if you ever want the layout rebuilt.
   ============================================================================ */

function ensureWorkbook() {
  var props = PropertiesService.getScriptProperties();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(TAB_LEADS);

  if (sheet && props.getProperty('built') === String(COLS.length)) return sheet;

  /* Layout is a nicety; the guest's details are not. If anything in the
     formatting throws — a Sheets API that moved, a permission, a tab someone
     renamed — fall back to a plain sheet with headers and take the lead
     anyway. Losing a customer's details because a column width failed to set
     would be an absurd way to lose data, and the client would retry that
     failure forever. */
  try {
    setUp();
    props.setProperty('built', String(COLS.length));
  } catch (err) {
    var bare = ss.getSheetByName(TAB_LEADS) || ss.insertSheet(TAB_LEADS, 0);
    if (bare.getLastRow() === 0) {
      bare.appendRow(COLS.map(function (c) { return c.head; }));
      bare.setFrozenRows(1);
    }
    props.setProperty('layoutError', String(err));
    return bare;
  }
  return ss.getSheetByName(TAB_LEADS);
}

function setUp() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var leads = buildLeadsTab(ss);
  buildDashboardTab(ss);
  buildMailTab(ss);

  /* A brand-new spreadsheet arrives with a "Sheet1" nobody wants. Remove it,
     but only if it is untouched — deleting someone's actual data because of a
     default name would be unforgivable. */
  var stray = ss.getSheetByName('Sheet1');
  if (stray && stray.getLastRow() === 0 && ss.getSheets().length > 1) {
    ss.deleteSheet(stray);
  }

  ss.setActiveSheet(leads);
  return 'Ready. Three tabs built.';
}

function buildLeadsTab(ss) {
  var sheet = ss.getSheetByName(TAB_LEADS) || ss.insertSheet(TAB_LEADS, 0);
  var n = COLS.length;

  // Header
  var head = sheet.getRange(1, 1, 1, n);
  head.setValues([COLS.map(function (c) { return c.head; })]);
  head.setBackground(BERRY).setFontColor(CREAM).setFontWeight('bold')
      .setFontSize(11).setVerticalAlignment('middle')
      .setHorizontalAlignment('left');
  sheet.setRowHeight(1, 38);
  sheet.setFrozenRows(1);

  // Columns
  COLS.forEach(function (c, i) {
    sheet.setColumnWidth(i + 1, c.width);
    var col = sheet.getRange(2, i + 1, Math.max(sheet.getMaxRows() - 1, 1), 1);
    if (c.format) col.setNumberFormat(c.format);
    if (c.align) col.setHorizontalAlignment(c.align);
  });

  // Body text
  var body = sheet.getRange(2, 1, Math.max(sheet.getMaxRows() - 1, 1), n);
  body.setFontColor(INK).setFontSize(10).setVerticalAlignment('middle');

  /* A won row should be findable at a glance from across the counter. Value,
     not hue: blush behind berry text, both from the brand sheet. */
  var wonCol = sheet.getRange(2, 7, Math.max(sheet.getMaxRows() - 1, 1), 1);
  var rules = sheet.getConditionalFormatRules().filter(function (r) {
    // Drop only the rules this script owns, so a rule added by hand survives
    // a rebuild.
    var rr = r.getRanges()[0];
    return !(rr && (rr.getColumn() === 7 || rr.getColumn() === 8));
  });
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('Yes').setBackground(BLUSH).setFontColor(BERRY)
    .setBold(true).setRanges([wonCol]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('Yes').setFontColor(ROSE)
    .setRanges([sheet.getRange(2, 8, Math.max(sheet.getMaxRows() - 1, 1), 1)]).build());
  sheet.setConditionalFormatRules(rules);

  // A filter on the header, so any column can be sorted or narrowed in a tap.
  if (!sheet.getFilter()) {
    sheet.getRange(1, 1, Math.max(sheet.getLastRow(), 2), n).createFilter();
  }

  sheet.setHiddenGridlines(true);
  return sheet;
}

/* New rows inherit column formats but not banding, so the stripe is painted as
   rows land. Painting only the new rows keeps this cheap no matter how long
   the sheet gets. */
function styleRows(sheet, start, count) {
  for (var i = 0; i < count; i++) {
    var r = start + i;
    if (r % 2 === 0) {
      sheet.getRange(r, 1, 1, COLS.length).setBackground(CREAM);
    }
  }
}

function buildDashboardTab(ss) {
  var sheet = ss.getSheetByName(TAB_DASH) || ss.insertSheet(TAB_DASH, 1);
  sheet.clear();
  sheet.clearConditionalFormatRules();

  var L = "'" + TAB_LEADS + "'";

  sheet.setColumnWidth(1, 30);
  sheet.setColumnWidth(2, 230);
  sheet.setColumnWidth(3, 150);
  sheet.setColumnWidth(4, 40);
  sheet.setColumnWidth(5, 230);
  sheet.setColumnWidth(6, 120);

  sheet.getRange('B2').setValue('CINNAMOOD')
       .setFontSize(20).setFontWeight('bold').setFontColor(BERRY);
  sheet.getRange('B3').setValue('Guest details collected at the machine')
       .setFontSize(11).setFontColor(ROSE);

  var tiles = [
    ['Guests all time', '=COUNTA(' + L + '!J2:J)'],
    ['Guests today',    '=COUNTIFS(' + L + '!A2:A,">="&TODAY(),' + L + '!A2:A,"<"&TODAY()+1)'],
    ['Guests last 7 days', '=COUNTIFS(' + L + '!A2:A,">="&TODAY()-6)'],
    ['Pulls played',    '=COUNTIF(' + L + '!G2:G,"<>")'],
    ['Prizes won',      '=COUNTIF(' + L + '!G2:G,"Yes")'],
    ['Win rate',        '=IFERROR(COUNTIF(' + L + '!G2:G,"Yes")/COUNTIF(' + L + '!G2:G,"<>"),0)'],
    ['Latest guest',    '=IFERROR(TEXT(MAX(' + L + '!A2:A),"d mmm yyyy  HH:mm"),"—")']
  ];

  var row = 5;
  tiles.forEach(function (t, i) {
    sheet.getRange(row + i, 2).setValue(t[0])
         .setFontSize(11).setFontColor(INK);
    var v = sheet.getRange(row + i, 3);
    v.setFormula(t[1]).setFontSize(14).setFontWeight('bold').setFontColor(BERRY)
     .setHorizontalAlignment('right');
    if (t[0] === 'Win rate') v.setNumberFormat('0.0%');
    if (t[0] === 'Latest guest') v.setFontSize(11).setFontWeight('normal');
    sheet.getRange(row + i, 2, 1, 2)
         .setBackground(i % 2 ? CREAM : BLUSH)
         .setVerticalAlignment('middle');
    sheet.setRowHeight(row + i, 30);
  });

  sheet.getRange('E5').setValue('Which prizes have gone out')
       .setFontWeight('bold').setFontColor(BERRY).setFontSize(11);
  /* QUERY keeps this list correct as prizes are added or retired — there is no
     hard-coded prize list here to fall out of step with config.js. */
  sheet.getRange('E6').setFormula(
    '=IFERROR(QUERY(' + L + '!F2:F,"select F, count(F) ' +
    'where F is not null and F <> \'\' ' +
    'group by F order by count(F) desc label F \'Prize\', count(F) \'Guests\'",0),' +
    '"Nothing yet")');
  sheet.getRange('E6:F6').setFontWeight('bold').setFontColor(CREAM).setBackground(BERRY);
  sheet.getRange('E7:F30').setBackground(CREAM).setFontColor(INK);

  sheet.getRange('B' + (row + tiles.length + 2))
       .setValue('These numbers update themselves. Nothing here needs re-running.')
       .setFontSize(10).setFontColor(ROSE);

  sheet.setHiddenGridlines(true);
  return sheet;
}

function buildMailTab(ss) {
  var sheet = ss.getSheetByName(TAB_MAIL) || ss.insertSheet(TAB_MAIL, 2);
  sheet.clear();

  var L = "'" + TAB_LEADS + "'";

  sheet.getRange('A1:D1')
       .setValues([['First name', 'Last name', 'Email', 'Phone']])
       .setBackground(BERRY).setFontColor(CREAM).setFontWeight('bold').setFontSize(11);
  sheet.setRowHeight(1, 34);
  sheet.setFrozenRows(1);
  [130, 140, 250, 150].forEach(function (w, i) { sheet.setColumnWidth(i + 1, w); });

  /* Newest first, because the reason you open this tab is almost always to
     mail the people who came in most recently. */
  sheet.getRange('A2').setFormula(
    '=IFERROR(QUERY(' + L + '!A2:E,"select B, C, D, E ' +
    'where D is not null and D <> \'\' order by A desc",0),"")');

  sheet.getRange('A2:D').setFontColor(INK).setFontSize(10);
  sheet.getRange('C2:C').setNumberFormat('@');
  sheet.getRange('D2:D').setNumberFormat('@');
  sheet.setHiddenGridlines(true);
  return sheet;
}
