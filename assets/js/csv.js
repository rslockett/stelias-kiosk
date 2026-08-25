/* ============================================================================
   csv.js — a small, correct CSV parser
   ----------------------------------------------------------------------------
   Google Sheets exports real RFC-4180 CSV, which means an announcement body is
   allowed to contain commas, quote marks, and line breaks. Splitting on commas
   would mangle those, so this walks the text character by character instead.
   ========================================================================== */

(function (global) {
  'use strict';

  /**
   * Parse CSV text into an array of arrays.
   * Handles quoted fields, embedded commas and newlines, doubled "" escapes,
   * and CRLF or LF line endings.
   */
  function parseRows(text) {
    // Strip a UTF-8 byte-order mark if Google left one on the front.
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    let i = 0;

    while (i < text.length) {
      const c = text[i];

      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') {   // "" is a literal quote character
            field += '"';
            i += 2;
            continue;
          }
          inQuotes = false;            // closing quote
          i++;
          continue;
        }
        field += c;
        i++;
        continue;
      }

      if (c === '"') { inQuotes = true; i++; continue; }

      if (c === ',') { row.push(field); field = ''; i++; continue; }

      if (c === '\r' || c === '\n') {
        // Consume CRLF as a single line ending.
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
        i++;
        continue;
      }

      field += c;
      i++;
    }

    // Whatever is left over after the last character is the final field.
    row.push(field);
    rows.push(row);

    // Drop trailing blank rows — Sheets exports plenty of them.
    while (rows.length && rows[rows.length - 1].every(v => v.trim() === '')) {
      rows.pop();
    }

    return rows;
  }

  /**
   * Parse CSV into objects keyed by header name.
   *
   * Header matching is deliberately forgiving: case, spaces, and punctuation
   * are ignored, so "Link Label", "link label" and "LinkLabel" all resolve to
   * the same key. This matters because three different people edit the Sheet
   * and someone will eventually retype a header.
   */
  function parseObjects(text) {
    const rows = parseRows(text);
    if (!rows.length) return [];

    const headers = rows[0].map(normalizeKey);

    return rows.slice(1).map(cells => {
      const obj = {};
      headers.forEach((h, idx) => {
        if (!h) return;
        obj[h] = (cells[idx] !== undefined ? cells[idx] : '').trim();
      });
      return obj;
    });
  }

  /** "Link Label" -> "linklabel" */
  function normalizeKey(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  global.CSV = { parseRows, parseObjects, normalizeKey };

})(window);
