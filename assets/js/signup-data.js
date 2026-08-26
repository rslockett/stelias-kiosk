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
   * A Deck-like source for one sign-up (Coffee Hour or Holy Bread), turning
   * the tab's CSV into a single "signup" slide for the kiosk. Mirrors
   * Deck.createDeckSource's polling and offline-cache behaviour so a wifi
   * drop degrades the same way an announcements outage does: keep showing
   * the last thing that worked.
   *
   * Emits 'slide' with either a slide object, or null if `csvUrl` is blank
   * (this sign-up isn't configured — leave it off the TV).
   */
  function createKioskSource(opts) {
    const listeners = [];
    let lastHash = null;

    if (!opts.csvUrl) {
      return {
        on(fn) { listeners.push(fn); return this; },
        start() { listeners.forEach(fn => fn(null)); return this; },
        refresh() {},
      };
    }

    // However many weeks signup.html is configured to list, the TV only has
    // room for so many rows before they either overflow the slide (nothing
    // shrinks a fixed list the way prose shrinks) or turn to noise from
    // across the hall. signup.html shows the full list regardless — this
    // cap is a kiosk-display concern only.
    const KIOSK_ROW_CAP = 6;

    function toSlide(rows) {
      const entries = buildSlots(rows, global.KIOSK_CONFIG.signupWeeksAhead || 6, {
        markFasting: !!opts.markFasting,
      }).slice(0, KIOSK_ROW_CAP);
      return {
        kind: 'signup',
        title: opts.title,
        subtitle: opts.subtitle,
        entries,
        image: opts.image,
        qrUrl: opts.qrUrl,
        qrLabel: opts.qrLabel,
      };
    }

    async function refresh() {
      try {
        // Deck.fetchCsv rather than a bare fetch: it retries the intermittent
        // redirect Google's published CSVs occasionally answer with, which is
        // what put "could not reach the Holy Bread sheet" in the console and
        // fell this slide back to a cached copy for no good reason.
        const text = await global.Deck.fetchCsv(opts.csvUrl);

        saveCache(opts.kind, text);
        const h = global.Deck.hash(text);
        if (h === lastHash) return;
        lastHash = h;
        listeners.forEach(fn => fn(toSlide(global.CSV.parseObjects(text))));
      } catch (err) {
        console.warn('[kiosk] could not reach the ' + opts.title + ' sheet:', err.message);
        if (lastHash === null) {
          const cached = loadCache(opts.kind);
          if (cached && cached.csv) {
            lastHash = global.Deck.hash(cached.csv);
            listeners.forEach(fn => fn(toSlide(global.CSV.parseObjects(cached.csv))));
          }
        }
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
