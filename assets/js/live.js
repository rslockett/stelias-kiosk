/* ============================================================================
   live.js — what is actually on the television right now
   ----------------------------------------------------------------------------
   The Google Sheet is the one true copy. Not this browser tab, not anybody's
   laptop — the Sheet. Everything in here exists to keep that honest:

     * read the published Sheet and turn it back into editable announcements
     * decide whether what you are looking at matches what is live
     * send changes up, then WATCH the published Sheet until they appear

   That last part matters. Google's Apps Script cannot tell a browser whether
   a publish worked (see the note in import-ui.js), but the published CSV can:
   if the rows we sent turn up in it, they landed. So "live" is never claimed,
   only observed.
   ========================================================================== */

(function (global) {
  'use strict';

  const CFG = global.KIOSK_CONFIG;

  /* ------------------------------------------------------------ signatures -- */

  function norm(s) {
    return String(s == null ? '' : s).replace(/\r\n?/g, '\n').trim();
  }

  /**
   * A short string that changes whenever anything an editor can change
   * changes. Two announcements with the same signature are the same
   * announcement as far as the television is concerned.
   */
  function sig(item) {
    return JSON.stringify([
      item.include === false ? 0 : 1,
      norm(item.title), norm(item.body), norm(item.link),
      norm(item.linkLabel), norm(item.start), norm(item.end), norm(item.image),
    ]);
  }

  /** The same, for a whole list — order included, because order is visible. */
  function deckSig(items) {
    return items.map(sig).join('');
  }

  /**
   * A deliberately more forgiving signature, used only to answer "did the
   * rows we just sent arrive?".
   *
   * Google Sheets does not store what you hand it verbatim. A cell given the
   * text "September 12" comes back out of the published CSV as "9/12/2026",
   * because Sheets recognised a date and reformatted it. That is a change of
   * spelling, not of meaning, and comparing the strings would leave a publish
   * that worked perfectly looking as though it had never landed. So dates are
   * compared as dates here.
   */
  function confirmSig(items) {
    return items.map(it => JSON.stringify([
      it.include === false ? 0 : 1,
      norm(it.title), norm(it.body), norm(it.link), norm(it.linkLabel),
      dateKey(it.start), dateKey(it.end), norm(it.image),
    ])).join('');
  }

  function dateKey(value) {
    const s = norm(value);
    if (!s) return '';
    const d = global.Deck.parseDate(s);
    return d ? d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate() : s.toLowerCase();
  }

  /**
   * The rows we are about to send, read back as announcements — what the
   * Sheet should look like if the publish works. Built from the outgoing rows
   * rather than from the draft, because toMatrix drops blank rows and clears
   * a caption whose link has gone.
   */
  function matrixToItems(matrix) {
    return matrix.map(r => ({
      include: String(r[0] == null ? '' : r[0]).trim().toUpperCase() !== 'FALSE',
      title: String(r[1] || '').trim(),
      body: String(r[2] || '').trim(),
      link: String(r[3] || '').trim(),
      linkLabel: String(r[4] || '').trim(),
      start: String(r[5] || '').trim(),
      end: String(r[6] || '').trim(),
      image: String(r[7] || '').trim(),
    }));
  }

  /* ----------------------------------------------------------------- rows -- */

  const isOff = global.Deck._internals.isOff;

  /**
   * Published CSV rows back into editable announcements.
   *
   * Unlike the television's own reader, nothing is filtered out here: rows
   * that are switched off, rows whose date has passed and rows that have not
   * started yet all have to be visible, or an editor cannot see the state
   * they are editing. Whether a row is on screen today is worked out
   * separately, by showsToday() below.
   */
  function rowsToItems(rows) {
    const items = rows.map((r, i) => {
      const title = (r.title || '').trim();
      const body = (r.body || '').trim();
      if (!title && !body) return null;          // blank spreadsheet line

      const rawOrder = r.order !== undefined && r.order !== '' ? Number(r.order) : null;

      return {
        include: !(r.show !== undefined && r.show !== '' && isOff(r.show)),
        title,
        body,
        link: (r.link || '').trim(),
        linkLabel: (r.linklabel || '').trim(),
        start: (r.start || '').trim(),
        end: (r.end || '').trim(),
        image: (r.image || '').trim(),
        _order: (rawOrder === null || isNaN(rawOrder)) ? null : rawOrder,
        _row: i,
      };
    }).filter(Boolean);

    // Same ordering rule the television uses, so the editor's list reads top
    // to bottom in the order the slides will actually appear.
    items.sort((a, b) => {
      const aHas = a._order !== null;
      const bHas = b._order !== null;
      if (aHas && bHas && a._order !== b._order) return a._order - b._order;
      if (aHas && !bHas) return -1;
      if (!aHas && bHas) return 1;
      return a._row - b._row;
    });

    items.forEach(it => { delete it._order; delete it._row; });
    return items;
  }

  /**
   * Is this announcement on the television today? Returns null when it is,
   * or a plain-English reason when it isn't — which is what the editor shows
   * over the preview so nobody wonders why their slide never appears.
   */
  function showsToday(item, now) {
    if (item.include === false) return 'Switched off — not on the TV';

    now = now || new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const start = global.Deck.parseDate(item.start);
    const end = global.Deck.parseDate(item.end);

    if (start && midnight < start) return 'Not on the TV until ' + friendly(start);
    if (end && midnight > end) return 'Came down after ' + friendly(end);
    return null;
  }

  function friendly(d) {
    return d.toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' });
  }

  /* -------------------------------------------------------------- fetching -- */

  /** Who published last, if the Sheet's Apps Script is new enough to record it. */
  function stampFrom(rows) {
    for (const r of rows) {
      if (r.publishedby || r.publishedat) {
        return { by: (r.publishedby || '').trim(), at: (r.publishedat || '').trim() };
      }
    }
    return null;
  }

  async function fetchLive() {
    const url = CFG.sheetCsvUrl;
    if (!url) throw new Error('No Sheet address is set in config.js');

    // Google caches published CSVs hard; a changing parameter gets a fresh one.
    const bust = url + (url.indexOf('?') === -1 ? '?' : '&') + '_ts=' + Date.now();

    const res = await fetch(bust, { cache: 'no-store' });
    if (!res.ok) throw new Error('The Sheet responded ' + res.status);

    const text = await res.text();

    // A Sheet that has been un-published answers with an HTML error page and a
    // perfectly cheerful 200 status. Catch that rather than parsing markup.
    if (/^\s*</.test(text)) {
      throw new Error('Got a web page instead of the Sheet — check it is still published to the web');
    }

    const rows = global.CSV.parseObjects(text);
    const items = rowsToItems(rows);
    return { items, sig: deckSig(items), stamp: stampFrom(rows), rowCount: rows.length };
  }

  /* ------------------------------------------------------------- publishing -- */

  function isConfigured() {
    return !!(CFG.publishUrl && CFG.publishSecret);
  }

  /**
   * Send rows to the Sheet.
   *
   * Google Apps Script web apps do not return the CORS headers a browser needs
   * to read a reply, so this is sent in "no-cors" mode: the request is
   * delivered and the script runs, but nothing can be read back. Resolving
   * here therefore means "handed to Google", never "saved".
   *
   * Proving it saved is fetchLive()'s job, and the editor does not say the
   * word "live" until fetchLive() has seen the rows for itself.
   */
  async function publish(matrix, editor) {
    await fetch(CFG.publishUrl, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        secret: CFG.publishSecret,
        by: String(editor || '').slice(0, 60),
        rows: matrix,
      }),
    });
  }

  global.Live = {
    sig, deckSig, confirmSig, matrixToItems,
    rowsToItems, showsToday, fetchLive, publish, isConfigured,
  };

})(window);
