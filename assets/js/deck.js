/* ============================================================================
   deck.js — getting announcements out of the Sheet and into a slide deck
   ----------------------------------------------------------------------------
   Responsibilities:
     * fetch the published CSV
     * turn rows into slide objects
     * hide rows that are switched off or outside their date window
     * keep a local copy so the TV still shows something if the wifi drops
     * poll for changes and report when the deck has actually changed
   ========================================================================== */

(function (global) {
  'use strict';

  const CFG = global.KIOSK_CONFIG;
  const CACHE_KEY = 'stelias.kiosk.deck.v1';

  /* ---------------------------------------------------------------- dates -- */

  const MONTHS = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };

  /**
   * Parse a date the way a human might have typed it into a spreadsheet cell.
   * Returns a Date at local midnight, or null.
   *
   * Deliberately forgiving — Sheets exports differently depending on the
   * editor's locale and cell format, and three different people type into it.
   */
  function parseDate(raw) {
    if (!raw) return null;
    const s = String(raw).trim();
    if (!s) return null;

    let m;

    // 2026-09-12  (ISO, what Sheets usually exports for a real date cell)
    if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) {
      return atMidnight(+m[1], +m[2] - 1, +m[3]);
    }

    // 9/12/2026 or 9/12/26  (US style)
    if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/))) {
      let y = +m[3];
      if (y < 100) y += 2000;
      return atMidnight(y, +m[1] - 1, +m[2]);
    }

    // September 12, 2026  /  Sept 12  /  12 September 2026
    const monthName = s.match(/([a-z]{3,})/i);
    const dayNum = s.match(/\b(\d{1,2})\b/);
    if (monthName && dayNum) {
      const mo = MONTHS[monthName[1].slice(0, 3).toLowerCase()];
      if (mo !== undefined) {
        const yearMatch = s.match(/\b(20\d{2})\b/);
        if (yearMatch) return atMidnight(+yearMatch[1], mo, +dayNum[1]);
        return nearestOccurrence(mo, +dayNum[1]);
      }
    }

    // Last resort: let the browser try.
    const d = new Date(s);
    return isNaN(d) ? null : atMidnight(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function atMidnight(y, mo, d) {
    const dt = new Date(y, mo, d, 0, 0, 0, 0);
    return isNaN(dt) ? null : dt;
  }

  /**
   * A month and day with no year — "September 12". Assume the occurrence
   * closest to today, allowing a little slack into the recent past so an
   * announcement written last week doesn't jump a whole year forward.
   */
  function nearestOccurrence(mo, day) {
    const now = new Date();
    const candidates = [
      atMidnight(now.getFullYear() - 1, mo, day),
      atMidnight(now.getFullYear(), mo, day),
      atMidnight(now.getFullYear() + 1, mo, day),
    ];
    const today = atMidnight(now.getFullYear(), now.getMonth(), now.getDate());
    let best = null, bestScore = Infinity;
    for (const c of candidates) {
      const days = (c - today) / 86400000;
      // Prefer upcoming dates; tolerate up to 60 days already past.
      const score = days >= -60 ? Math.abs(days) : Infinity;
      if (score < bestScore) { bestScore = score; best = c; }
    }
    return best;
  }

  /* ----------------------------------------------------------------- rows -- */

  function isOff(value) {
    const v = String(value || '').trim().toLowerCase();
    return v === 'false' || v === 'no' || v === 'n' || v === 'hide' || v === 'off' || v === '0';
  }

  /**
   * Turn a parsed CSV row into a slide, or null if it shouldn't be shown.
   * `now` is passed in rather than read from the clock so this is testable
   * and so every row in one pass is judged against the same instant.
   */
  function rowToSlide(row, index, now) {
    const title = (row.title || '').trim();
    const body = (row.body || '').trim();

    // A row with no words on it is almost always an empty spreadsheet line.
    if (!title && !body) return null;

    if (row.show !== undefined && row.show !== '' && isOff(row.show)) return null;

    const start = parseDate(row.start);
    const end = parseDate(row.end);
    const today = atMidnight(now.getFullYear(), now.getMonth(), now.getDate());

    if (start && today < start) return null;
    // `End` is inclusive: an announcement for the 12th shows all day on the 12th.
    if (end && today > end) return null;

    const link = (row.link || '').trim();

    return {
      title,
      body,
      link,
      linkLabel: (row.linklabel || '').trim() || (link ? CFG.defaultQrLabel : ''),
      image: (row.image || '').trim(),
      order: row.order !== undefined && row.order !== '' ? Number(row.order) : null,
      sourceIndex: index,
      endDate: end,
    };
  }

  /** Rows -> ordered, filtered slides. */
  function buildDeck(rows, now) {
    now = now || new Date();
    const slides = rows
      .map((r, i) => rowToSlide(r, i, now))
      .filter(Boolean);

    slides.sort((a, b) => {
      const ao = a.order, bo = b.order;
      const aHas = ao !== null && !isNaN(ao);
      const bHas = bo !== null && !isNaN(bo);
      if (aHas && bHas && ao !== bo) return ao - bo;
      if (aHas && !bHas) return -1;   // explicitly ordered rows float to the top
      if (!aHas && bHas) return 1;
      return a.sourceIndex - b.sourceIndex;  // otherwise: Sheet order
    });

    return slides;
  }

  /* --------------------------------------------------------------- fetch -- */

  function hash(str) {
    // FNV-1a, enough to tell "the Sheet changed" from "it didn't".
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h.toString(16);
  }

  function cacheBust(url) {
    // Google caches published CSVs hard. A changing query param gets us a
    // fresh copy rather than whatever the browser saw an hour ago.
    return url + (url.indexOf('?') === -1 ? '?' : '&') + '_ts=' + Date.now();
  }

  async function fetchCsv(url) {
    const res = await fetch(cacheBust(url), { cache: 'no-store' });
    if (!res.ok) throw new Error('Sheet responded ' + res.status);
    const text = await res.text();

    // A published Sheet that has been unpublished returns an HTML error page
    // with a 200 status. Catch that rather than rendering markup as slides.
    if (/^\s*</.test(text)) {
      throw new Error('Got a web page instead of CSV — check that the Sheet is still published');
    }
    return text;
  }

  /* --------------------------------------------------------------- cache -- */

  function saveCache(csvText) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ csv: csvText, at: Date.now() }));
    } catch (e) {
      /* storage full or disabled — not worth failing over */
    }
  }

  function loadCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  /* ---------------------------------------------------------------- store -- */

  /**
   * Wraps everything above into the thing the app actually talks to.
   * Emits: 'deck'    (slides, meta)  — first good load, or content changed
   *        'status'  ({online, message})
   */
  function createDeckSource(url) {
    let lastHash = null;
    const listeners = { deck: [], status: [] };

    function emit(name, ...args) {
      listeners[name].forEach(fn => {
        try { fn(...args); } catch (e) { console.error(e); }
      });
    }

    function ingest(csvText, source) {
      const h = hash(csvText);
      if (h === lastHash) return false;         // nothing actually changed
      lastHash = h;

      const rows = global.CSV.parseObjects(csvText);
      const slides = buildDeck(rows, new Date());
      emit('deck', slides, { source, totalRows: rows.length });
      return true;
    }

    async function refresh() {
      try {
        const csv = await fetchCsv(url);
        saveCache(csv);
        const changed = ingest(csv, 'network');
        emit('status', { online: true });
        return changed;
      } catch (err) {
        console.warn('[kiosk] could not reach the Sheet:', err.message);
        emit('status', { online: false, message: err.message });

        // Fall back to the last good copy, but only if we have nothing yet.
        if (lastHash === null) {
          const cached = loadCache();
          if (cached && cached.csv) {
            ingest(cached.csv, 'cache');
          } else {
            emit('deck', [], { source: 'empty', error: err.message });
          }
        }
        return false;
      }
    }

    return {
      on(name, fn) { listeners[name].push(fn); return this; },
      refresh,
      start() {
        refresh();
        setInterval(refresh, Math.max(15, CFG.pollSeconds) * 1000);
        return this;
      },
    };
  }

  global.Deck = {
    createDeckSource,
    buildDeck,
    parseDate,
    hash,
    _internals: { rowToSlide, isOff, nearestOccurrence },
  };

})(window);
