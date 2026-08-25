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

function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents);

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
