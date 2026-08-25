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
  var firstRow = sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0];
  var hasHeaders = firstRow.some(function (v) { return String(v).trim() !== ''; });
  if (!hasHeaders) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  }
}

/**
 * Wipe every announcement row and write the new ones in their place, leaving
 * row 1 (the headers) untouched. This mirrors exactly what the manual
 * "delete the old rows, paste at A2" instructions did by hand.
 */
function replaceRows(sheet, rows) {
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, HEADERS.length).clearContent();
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

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
