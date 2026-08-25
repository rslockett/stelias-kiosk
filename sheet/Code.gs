/**
 * St. Elias Coffee Hour Kiosk — one-click publish
 * ---------------------------------------------------------------------------
 * Lets the importer page send announcements straight into this Sheet, instead
 * of copying rows to the clipboard and pasting them by hand.
 *
 * SETUP (once):
 *   1. Open the announcements Google Sheet.
 *   2. Extensions -> Apps Script.
 *   3. Delete whatever is in Code.gs and paste this whole file in its place.
 *   4. Change SHARED_SECRET below to a password you make up. Anyone who
 *      knows it can overwrite the announcements — treat it like a house key,
 *      not like a bank password. Share it with Ron, the office and Fr. Elias.
 *   5. Deploy -> New deployment -> type "Web app".
 *        Execute as:      Me
 *        Who has access:  Anyone
 *      (This has to be "Anyone" for the importer page to be able to reach
 *      it. The SHARED_SECRET below is what keeps it from being misused --
 *      nobody can write to the Sheet without knowing it.)
 *   6. Click Deploy, authorize it when Google asks, and copy the Web app URL.
 *   7. Paste that URL and your secret into assets/js/config.js on the
 *      publishUrl and publishSecret lines.
 *
 * If you ever change this file, you must deploy a new version for the change
 * to take effect: Deploy -> Manage deployments -> the pencil icon -> New
 * version -> Deploy. Editing the code alone does not update the live URL.
 *
 * This same endpoint also receives Coffee Hour and Holy Bread sign-ups from
 * signup.html — no extra setup needed for that, it uses the deployment
 * above. See SIGNUP_SHEETS below if you rename either tab.
 *
 * ONE MORE ONE-TIME STEP — the daily saints/readings slide:
 *   Add a tab named "Liturgical" to this Sheet (any content in it is fine,
 *   it gets overwritten). Then, in this Apps Script editor, choose
 *   installDailyLiturgicalTrigger from the function dropdown next to Run,
 *   and press Run. Google will ask to authorize a new permission (fetching
 *   an external page) — that's expected, approve it. This installs a
 *   trigger that refreshes the Liturgical tab once a day from GOARCH's
 *   public Online Chapel feed, and also fills it in immediately so you
 *   don't have to wait until tomorrow to see it working. Re-running that
 *   function later is harmless — it replaces the old trigger rather than
 *   adding a second one.
 * ---------------------------------------------------------------------------
 */

var SHARED_SECRET = 'change-me-first';   // <-- set this before deploying
var SHEET_NAME = '';                      // blank = the first tab in the file

var HEADERS = ['Show', 'Title', 'Body', 'Link', 'Link Label', 'Start', 'End', 'Image', 'Order'];

// Two extra columns, written after the announcements, recording who last put
// something on the screen and when. The television ignores columns it does not
// recognise; the editor reads these so that everybody working on the
// announcements can see whether somebody else got there first.
var STAMP_HEADERS = ['Published By', 'Published At'];
var TOTAL_WIDTH = HEADERS.length + STAMP_HEADERS.length;

// Sign-up tabs: the name here has to match the actual Sheet tab name.
var SIGNUP_SHEETS = {
  coffee: 'Coffee Hour',
  bread: 'Holy Bread',
};
var SIGNUP_HEADERS = ['Date', 'Name', 'Signed Up At'];

// GOARCH's public Online Chapel feed — the same one a number of parish
// websites have pulled saints/readings from for years. Not an official,
// supported API, just a stable, publicly documented XML endpoint; if it
// ever moves, this is the only line that needs to change.
var LITURGICAL_FEED_URL = 'https://onlinechapel.goarch.org/daily.asp';
var LITURGICAL_SHEET_NAME = 'Liturgical';
var LITURGICAL_HEADERS = ['Date', 'Title', 'Saints', 'Fasting', 'Tone', 'Icon'];

function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents);

    if (payload.action === 'signup') {
      return handleSignup(payload);
    }

    if (payload.secret !== SHARED_SECRET) {
      return jsonOut({ ok: false, error: 'Wrong secret. Check config.js matches the Apps Script.' });
    }
    if (!Array.isArray(payload.rows)) {
      return jsonOut({ ok: false, error: 'No rows were sent.' });
    }

    var sheet = SHEET_NAME
      ? SpreadsheetApp.getActive().getSheetByName(SHEET_NAME)
      : SpreadsheetApp.getActive().getSheets()[0];

    if (!sheet) {
      return jsonOut({ ok: false, error: 'Could not find the sheet tab.' });
    }

    ensureHeaders(sheet);
    replaceRows(sheet, payload.rows);
    stampPublisher(sheet, payload.by);

    return jsonOut({ ok: true, rowsWritten: payload.rows.length });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err && err.message || err) });
  }
}

/**
 * Claim a Coffee Hour or Holy Bread Sunday. No secret is required — anyone
 * with the sign-up link can use this, the same as filling out a paper sheet
 * on the narthex table.
 *
 * The lock plus the "already taken" check inside it is what stops two people
 * who tap "Sign up" for the same Sunday within moments of each other from
 * both landing in the sheet: whoever's request gets the lock first wins, and
 * the second request is refused. Because this response travels back to the
 * browser over a no-cors request (see live.js), the browser can't actually
 * read this JSON — it finds out by re-polling the published sheet and seeing
 * whether its own name showed up for that date.
 */
function handleSignup(payload) {
  var kind = payload.type;
  var sheetName = SIGNUP_SHEETS[kind];
  if (!sheetName) {
    return jsonOut({ ok: false, error: 'Unknown sign-up type: ' + kind });
  }

  var date = String(payload.date || '').trim();
  var name = String(payload.name || '').trim().slice(0, 80);
  if (!date || !name) {
    return jsonOut({ ok: false, error: 'A date and a name are both required.' });
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = SpreadsheetApp.getActive().getSheetByName(sheetName);
    if (!sheet) {
      return jsonOut({ ok: false, error: 'Could not find the "' + sheetName + '" tab.' });
    }
    ensureSignupHeaders(sheet);

    var wantKey = dateKey(date);
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (dateKey(data[i][0]) === wantKey && String(data[i][1]).trim() !== '') {
        return jsonOut({ ok: false, error: 'That Sunday was just taken by someone else.' });
      }
    }

    sheet.appendRow([date, name, new Date().toISOString()]);
    return jsonOut({ ok: true });
  } finally {
    lock.releaseLock();
  }
}

/**
 * "2026-09-14", or a Date object read back out of a cell (Sheets silently
 * converts a typed date string to a real Date value) — both become the same
 * comparable key, the same problem live.js's dateKey() solves on the browser
 * side of this Sheet.
 */
function dateKey(v) {
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v)) {
    return v.getFullYear() + '-' + (v.getMonth() + 1) + '-' + v.getDate();
  }
  var s = String(v == null ? '' : v).trim();
  var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return m[1] + '-' + (+m[2]) + '-' + (+m[3]);
  var d = new Date(s);
  if (!isNaN(d)) return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  return s;
}

function ensureSignupHeaders(sheet) {
  var firstRow = sheet.getRange(1, 1, 1, SIGNUP_HEADERS.length).getValues()[0];
  var changed = false;
  for (var i = 0; i < SIGNUP_HEADERS.length; i++) {
    if (String(firstRow[i]).trim() === '') { firstRow[i] = SIGNUP_HEADERS[i]; changed = true; }
  }
  if (changed) sheet.getRange(1, 1, 1, SIGNUP_HEADERS.length).setValues([firstRow]);
}

// A GET request is just for checking the deployment is alive and reachable.
function doGet() {
  return jsonOut({ ok: true, message: 'St. Elias kiosk publish endpoint is running.' });
}

function ensureHeaders(sheet) {
  var all = HEADERS.concat(STAMP_HEADERS);
  var firstRow = sheet.getRange(1, 1, 1, TOTAL_WIDTH).getValues()[0];

  // Only fill in what is missing, so a Sheet somebody has already renamed a
  // column in is not quietly overwritten. The two stamp columns are new, and
  // will be blank on a Sheet set up before this feature existed.
  var changed = false;
  for (var i = 0; i < all.length; i++) {
    if (String(firstRow[i]).trim() === '') { firstRow[i] = all[i]; changed = true; }
  }
  if (changed) sheet.getRange(1, 1, 1, TOTAL_WIDTH).setValues([firstRow]);
}

/**
 * Wipe every announcement row and write the new ones in their place, leaving
 * row 1 (the headers) untouched. This mirrors exactly what the manual
 * "delete the old rows, paste at A2" instructions did by hand.
 */
function replaceRows(sheet, rows) {
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, TOTAL_WIDTH).clearContent();
  }
  if (rows.length > 0) {
    var width = HEADERS.length;
    var normalized = rows.map(function (row) {
      var out = row.slice(0, width);
      while (out.length < width) out.push('');
      return out;
    });
    sheet.getRange(2, 1, normalized.length, width).setValues(normalized);
  }
}

/**
 * Record who published, in the first data row of the two stamp columns.
 *
 * This is the only thing in the whole system that says which of the three
 * people editing announcements acted last, and it is what lets the editor
 * tell somebody "Fr. Elias published twenty minutes ago" instead of leaving
 * them guessing whether their copy is current.
 *
 * The name is whatever the person typed into the editor. It identifies a
 * colleague to colleagues; it is not a login and does not pretend to be.
 */
function stampPublisher(sheet, name) {
  var who = String(name == null ? '' : name).slice(0, 60);
  sheet.getRange(2, HEADERS.length + 1, 1, STAMP_HEADERS.length)
       .setValues([[who, new Date().toISOString()]]);
}

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Pull today's saints, readings and fasting rule from GOARCH's public
 * Online Chapel feed and write them into the Liturgical tab. Called once a
 * day by the trigger installDailyLiturgicalTrigger sets up — see the note
 * at the top of this file.
 *
 * If the feed can't be reached, the Liturgical tab is left exactly as it
 * was — yesterday's slide staying up one extra day beats the slide going
 * blank because of a network hiccup at 1am.
 */
function fetchDailyLiturgical() {
  var response = UrlFetchApp.fetch(LITURGICAL_FEED_URL, { muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) return;

  var root = XmlService.parse(response.getContentText()).getRootElement();

  var title = childText(root, 'lectionarytitle');
  if (!title) return; // an empty or malformed feed — don't overwrite good data with nothing

  var fasting = childText(root, 'fasting') || 'No Fast';
  var tone = childText(root, 'tone');
  var icon = childText(root, 'icon').replace(/^http:/, 'https:');

  var others = [];
  var saintsEl = root.getChild('saintsfeasts');
  if (saintsEl) {
    var feasts = saintsEl.getChildren('saintfeast');
    for (var i = 0; i < feasts.length; i++) {
      var t = childText(feasts[i], 'title');
      if (t && t !== title) others.push(t);
    }
  }

  var sheet = SpreadsheetApp.getActive().getSheetByName(LITURGICAL_SHEET_NAME);
  if (!sheet) sheet = SpreadsheetApp.getActive().insertSheet(LITURGICAL_SHEET_NAME);

  sheet.clearContents();
  sheet.getRange(1, 1, 1, LITURGICAL_HEADERS.length).setValues([LITURGICAL_HEADERS]);
  sheet.getRange(2, 1, 1, LITURGICAL_HEADERS.length).setValues([[
    childText(root, 'formatteddate'), title, others.join('; '), fasting, tone, icon,
  ]]);
}

function childText(parent, name) {
  var el = parent.getChild(name);
  return el ? el.getText().trim() : '';
}

/**
 * Run this once, manually — select it in the function dropdown next to
 * Run, then press Run — to start the daily refresh. See the note at the
 * top of this file. Safe to run again later: it replaces any existing
 * trigger for this function rather than adding a second one.
 */
function installDailyLiturgicalTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'fetchDailyLiturgical') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger('fetchDailyLiturgical').timeBased().everyDays(1).atHour(1).create();
  fetchDailyLiturgical(); // and populate it right now, rather than waiting until 1am
}
