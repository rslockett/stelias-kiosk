/* ============================================================================
   signup-data.js — turning a "who signed up" Sheet tab into a list of Sundays
   ----------------------------------------------------------------------------
   Shared by the kiosk (which only displays this) and signup.html (which also
   lets someone claim a slot). One Sheet row means one filled Sunday: Date,
   Name, Signed Up At. A Sunday with no row is simply open — nobody has to
   pre-populate empty rows for weeks nobody has claimed yet.
   ========================================================================== */

(function (global) {
  'use strict';

  /** The next `count` Sundays from today, at local midnight, soonest first. */
  function nextSundays(count, from) {
    const now = from || new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const untilSunday = (7 - today.getDay()) % 7; // today.getDay(): 0 = Sunday
    const firstSunday = new Date(
      today.getFullYear(), today.getMonth(), today.getDate() + untilSunday);

    const out = [];
    for (let i = 0; i < count; i++) {
      out.push(new Date(
        firstSunday.getFullYear(), firstSunday.getMonth(), firstSunday.getDate() + i * 7));
    }
    return out;
  }

  function dateKey(d) {
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  }

  /**
   * CSV rows (Date, Name, Signed Up At) -> a map of "filled by" keyed the
   * same way nextSundays() dates compare, last row for a date wins so a
   * corrected name (edited by hand in the Sheet) takes effect.
   */
  function fillsByDate(rows) {
    const fills = {};
    for (const row of rows) {
      const d = global.Deck.parseDate(row.date);
      const name = (row.name || '').trim();
      if (!d || !name) continue;
      fills[dateKey(d)] = name;
    }
    return fills;
  }

  /**
   * Build the list of upcoming Sundays, each marked open or filled, and
   * (for Coffee Hour only — `markFasting: true`) flagged with the fast it
   * falls in, if any.
   */
  function buildSlots(rows, weeksAhead, opts) {
    opts = opts || {};
    const fills = fillsByDate(rows);

    return nextSundays(weeksAhead).map(date => {
      const key = dateKey(date);
      const name = fills[key] || null;
      const fastName = opts.markFasting ? global.OrthodoxCalendar.fastingInfo(date) : null;
      return {
        date,
        dateKey: key,
        iso: date.getFullYear() + '-' +
          String(date.getMonth() + 1).padStart(2, '0') + '-' +
          String(date.getDate()).padStart(2, '0'),
        label: date.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }),
        // The same Sunday, short enough for the kiosk's sign-up column, where
        // the date shares a narrow row with somebody's name. "Sunday" is
        // dropped rather than abbreviated: every date in these lists is a
        // Sunday, so the word distinguishes nothing and costs the name room.
        shortLabel: date.toLocaleDateString([], { month: 'short', day: 'numeric' }),
        filled: !!name,
        name,
        fastName,
      };
    });
  }

  /* --------------------------------------------------------------- kiosk -- */

  const CACHE_PREFIX = 'stelias.kiosk.signup.';

  function saveCache(kind, csvText) {
    try {
      localStorage.setItem(CACHE_PREFIX + kind, JSON.stringify({ csv: csvText, at: Date.now() }));
    } catch (e) { /* storage full or disabled — not worth failing over */ }
  }

  function loadCache(kind) {
    try {
      const raw = localStorage.getItem(CACHE_PREFIX + kind);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  /**
   * A source for one sign-up (Coffee Hour or Holy Bread), turning the tab's
   * CSV into the card that stands permanently in the kiosk's right-hand
   * column. Mirrors Deck.createDeckSource's polling and offline-cache
   * behaviour so a wifi drop degrades the same way an announcements outage
   * does: keep showing the last thing that worked.
   *
   * Emits either a card object, or null if `csvUrl` is blank (this sign-up
   * isn't configured — leave it off the screen).
   */
  function createKioskSource(opts) {
    const listeners = [];
    let lastHash = null;
    // The CSV is not the only thing that can change what this card should
    // say: so can the calendar. A kiosk left running from Saturday to Monday
    // is fetching the same unchanged sheet the whole time, so hashing the
    // CSV alone would leave yesterday's Sunday sitting at the top of the
    // list. Remember which day the current card was built for, and rebuild
    // when that day rolls over even though the sheet hasn't moved.
    let lastDayKey = null;
    let lastText = null;

    if (!opts.csvUrl) {
      return {
        on(fn) { listeners.push(fn); return this; },
        start() { listeners.forEach(fn => fn(null)); return this; },
        refresh() {},
      };
    }

    // However many weeks signup.html is configured to list, the column beside
    // the announcements has room for exactly this many. Two cards, each six
    // Sundays deep and each with a code big enough to scan, come to within a
    // few pixels of the full height of that column at 1080p — a seventh row
    // does not fit without shrinking the type below what a phone-holding
    // adult can comfortably read. signup.html shows the full list regardless;
    // this cap is a kiosk-display concern only.
    const RAIL_ROW_CAP = 6;

    function toCard(rows) {
      const entries = buildSlots(rows, global.KIOSK_CONFIG.signupWeeksAhead || 6, {
        markFasting: !!opts.markFasting,
      }).slice(0, RAIL_ROW_CAP);
      return {
        kind: 'signup',
        title: opts.title,
        entries,
        openCount: entries.filter(e => !e.filled).length,
        qrUrl: opts.qrUrl,
        qrLabel: opts.qrLabel,
      };
    }

    function today() {
      return dateKey(new Date());
    }

    function emit(text) {
      lastHash = global.Deck.hash(text);
      lastText = text;
      lastDayKey = today();
      listeners.forEach(fn => fn(toCard(global.CSV.parseObjects(text))));
    }

    async function refresh() {
      try {
        // Deck.fetchCsv rather than a bare fetch: it retries the intermittent
        // redirect Google's published CSVs occasionally answer with, which is
        // what put "could not reach the Holy Bread sheet" in the console and
        // fell this slide back to a cached copy for no good reason.
        const text = await global.Deck.fetchCsv(opts.csvUrl);

        saveCache(opts.kind, text);
        if (global.Deck.hash(text) === lastHash && today() === lastDayKey) return;
        emit(text);
      } catch (err) {
        console.warn('[kiosk] could not reach the ' + opts.title + ' sheet:', err.message);
        if (lastText !== null) {
          // Offline, but the day may still have turned over. Redraw the
          // Sundays from what we already have rather than leaving a Sunday
          // that has been and gone at the top of the list.
          if (today() !== lastDayKey) emit(lastText);
          return;
        }
        const cached = loadCache(opts.kind);
        if (cached && cached.csv) emit(cached.csv);
      }
    }

    return {
      on(fn) { listeners.push(fn); return this; },
      start() {
        refresh();
        setInterval(refresh, Math.max(15, global.KIOSK_CONFIG.pollSeconds) * 1000);
        return this;
      },
      refresh,
    };
  }

  global.SignupData = { nextSundays, dateKey, buildSlots, createKioskSource };

})(window);
