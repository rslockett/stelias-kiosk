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

  async function fetchOnce(url) {
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

  /**
   * Read the published Sheet, trying more than once before believing a
   * failure.
   *
   * Google does not serve a published CSV directly. It answers with a
   * redirect, and which host it redirects to varies — one of those paths
   * sometimes comes back without the header a browser requires in order to
   * let the page read the response, and the fetch is refused. It is
   * intermittent, it has nothing to do with the Sheet or the network, and the
   * very next request usually succeeds.
   *
   * Left unhandled this put "showing last saved copy" on the wall of the hall
   * for two minutes at a time, on a screen that was perfectly healthy and
   * displaying perfectly current announcements. Retrying costs a second and
   * removes the whole class of false alarm.
   */
  async function fetchCsv(url) {
    let lastErr = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, 900 * attempt));
      try {
        return await fetchOnce(url);
      } catch (err) {
        lastErr = err;
        // An unpublished Sheet is a real answer, not a blip — asking again
        // will get the same web page, so stop and say so.
        if (/web page instead of CSV/.test(err.message)) throw err;
      }
    }
    throw lastErr;
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
  // How many polls in a row have to fail before the screen says anything.
  //
  // "Showing last saved copy" is a message for the hall — it means somebody
  // should go and look at the Pi. One failed read does not mean that, and
  // announcing it on a wall for two minutes because of a transient hiccup
  // teaches everybody to ignore the warning, which is worse than not having
  // one. Two consecutive failures, each already retried three times, is a
  // genuine four-minute outage and worth saying out loud.
  const FAILURES_BEFORE_SAYING_SO = 2;

  function createDeckSource(url) {
    let lastHash = null;
    let consecutiveFailures = 0;
    const listeners = { deck: [], status: [] };

    function emit(name, ...args) {
      listeners[name].forEach(fn => {
        try { fn(...args); } catch (e) { console.error(e); }
      });
    }

    /**
     * Who published last, and when, if the Sheet's Apps Script records it.
     * The same two columns the editor reads — which is the point: the time
     * shown in the hall and the time shown in the editor are then the same
     * number, and matching them is how somebody confirms the screen is
     * current without having to trust anything.
     */
    function stampFrom(rows) {
      for (const r of rows) {
        if (r.publishedby || r.publishedat) {
          return { by: (r.publishedby || '').trim(), at: (r.publishedat || '').trim() };
        }
      }
      return null;
    }

    function ingest(csvText, source) {
      const h = hash(csvText);
      if (h === lastHash) return false;         // nothing actually changed
      lastHash = h;

      const rows = global.CSV.parseObjects(csvText);
      const slides = buildDeck(rows, new Date());
      emit('deck', slides, {
        source,
        totalRows: rows.length,
        stamp: stampFrom(rows),
        // How long each slide should stay up, if the Sheet says. Null when it
        // does not, and the figure in config.js stands.
        slideSeconds: secondsFrom(rows),
      });
      return true;
    }

    async function refresh() {
      try {
        const csv = await fetchCsv(url);
        saveCache(csv);
        const changed = ingest(csv, 'network');
        consecutiveFailures = 0;
        // Emitted on every successful read, not only when something changed —
        // "we reached the Sheet just now" is exactly the fact the footer
        // clock needs, and most reads find nothing new.
        emit('status', { online: true, checkedAt: Date.now() });
        return changed;
      } catch (err) {
        consecutiveFailures++;
        console.warn('[kiosk] could not reach the Sheet (' + consecutiveFailures +
          ' in a row):', err.message);
        emit('status', {
          online: consecutiveFailures < FAILURES_BEFORE_SAYING_SO,
          message: err.message,
        });

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

  /**
   * How long each slide should stay up, as the Sheet has it.
   *
   * Null when the Sheet says nothing — an older Apps Script, or a parish that
   * has never changed it — and the figure in config.js stands. It lives in the
   * Sheet because the people who can tell the hall is being rushed are
   * standing in it, and the alternative is editing a file in a repository.
   */
  function secondsFrom(rows) {
    for (const r of rows) {
      if (r.secondsperslide !== undefined && String(r.secondsperslide).trim() !== '') {
        const n = Math.round(Number(r.secondsperslide));
        if (isFinite(n) && n > 0) return Math.min(120, Math.max(4, n));
      }
    }
    return null;
  }

  /* ------------------------------------------------- keeping your place -- */

  /**
   * Enough of a slide to recognise it again in a rebuilt deck. Not an id —
   * nothing upstream gives these rows one — but a slide whose title and
   * opening words are unchanged is the same slide to anybody watching.
   */
  function slideKey(slide) {
    if (!slide) return '';
    if (slide.kind === 'signup') return 'signup:' + slide.title;
    return (slide.title || '') + '\u0000' + String(slide.body || '').slice(0, 120);
  }

  /**
   * Where the rotation should carry on from, once the deck has been rebuilt
   * underneath it.
   *
   * The screen has four independent sources — announcements, the day's saints,
   * and the two sign-ups — and each hands over a whole rebuilt deck whenever
   * its own content changes. At start-up all four land within a few seconds of
   * each other. Restarting at slide 0 each time meant the first slide played,
   * was interrupted, played again, and again: the day's saints three or four
   * times over before the hall saw anything else, while the slides at the end
   * waited for a cycle that kept being cut short.
   *
   * So find the slide that is on screen and carry on from there. If it has
   * gone — deleted, or its date passed — hold the same position instead,
   * clamped to however long the deck is now.
   */
  function keepPosition(current, newDeck, fallbackIndex) {
    if (!newDeck || !newDeck.length) return 0;

    const key = slideKey(current);
    if (key) {
      const found = newDeck.findIndex(s => slideKey(s) === key);
      if (found !== -1) return found;
    }

    const n = Number(fallbackIndex);
    if (!isFinite(n) || n < 0) return 0;
    return Math.min(n, newDeck.length - 1);
  }

  global.Deck = {
    createDeckSource,
    buildDeck,
    parseDate,
    hash,
    slideKey,
    keepPosition,
    secondsFrom,
    // Shared so the liturgical and sign-up tabs get the same retry. They read
    // published CSVs from the same Google endpoint and hit the same
    // intermittent redirect — see the note above fetchCsv.
    fetchCsv,
    _internals: { rowToSlide, isOff, nearestOccurrence },
  };

})(window);
