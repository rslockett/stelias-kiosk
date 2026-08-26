/* ============================================================================
   liturgical-data.js — today's saints and fasting rule, as a slide
   ----------------------------------------------------------------------------
   The Liturgical Sheet tab holds exactly one row, refreshed once a day by
   sheet/Code.gs from GOARCH's public Online Chapel feed (see the note at the
   top of that file). This turns that row into an ordinary announcement-shaped
   slide — title, body, optional image — so it gets the same shrink-to-fit
   treatment as everything else on the TV rather than needing its own layout.
   ========================================================================== */

(function (global) {
  'use strict';

  const CACHE_KEY = 'stelias.kiosk.liturgical.v1';

  function saveCache(csvText) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ csv: csvText, at: Date.now() }));
    } catch (e) { /* storage full or disabled — not worth failing over */ }
  }

  function loadCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function rowToSlide(row) {
    const title = (row && row.title || '').trim();
    if (!title) return null;

    const saints = (row.saints || '').trim();
    const fasting = (row.fasting || '').trim() || 'No Fast';
    const tone = (row.tone || '').trim();

    let body = '';
    if (saints) body += 'Also commemorated: ' + saints + '.\n\n';
    body += fasting + (tone ? ' — ' + tone : '');

    return {
      title,
      body,
      link: '',
      linkLabel: '',
      image: (row.icon || '').trim(),
      order: null,
    };
  }

  /**
   * Mirrors SignupData.createKioskSource's polling and offline-cache shape,
   * for the same one-tab-in-the-Sheet, one-slide-on-the-TV pattern.
   */
  function createLiturgicalSource(csvUrl) {
    const listeners = [];
    let lastHash = null;

    if (!csvUrl) {
      return {
        on(fn) { listeners.push(fn); return this; },
        start() { listeners.forEach(fn => fn(null)); return this; },
        refresh() {},
      };
    }

    async function refresh() {
      try {
        // Deck.fetchCsv rather than a bare fetch: it retries the intermittent
        // redirect Google's published CSVs occasionally answer with, which
        // otherwise dropped this slide off the rotation at random.
        const text = await global.Deck.fetchCsv(csvUrl);

        saveCache(text);
        const h = global.Deck.hash(text);
        if (h === lastHash) return;
        lastHash = h;
        const rows = global.CSV.parseObjects(text);
        listeners.forEach(fn => fn(rowToSlide(rows[0])));
      } catch (err) {
        console.warn('[kiosk] could not reach the Liturgical sheet:', err.message);
        if (lastHash === null) {
          const cached = loadCache();
          if (cached && cached.csv) {
            lastHash = global.Deck.hash(cached.csv);
            const rows = global.CSV.parseObjects(cached.csv);
            listeners.forEach(fn => fn(rowToSlide(rows[0])));
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

  global.LiturgicalData = { createLiturgicalSource };

})(window);
