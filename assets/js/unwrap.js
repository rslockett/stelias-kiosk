/* ============================================================================
   unwrap.js — finding the real address behind a tracking link
   ----------------------------------------------------------------------------
   The newsletter goes out through Breeze, which rewrites every link into
   links.breezechms.com/ls/click?upn=… — routinely over a thousand characters.
   A QR code carrying that is a dense grey mush nobody can scan from a table
   across the hall.

   The editor used to solve that by running the address through TinyURL. That
   traded one problem for a worse one: TinyURL now shows an advertising page
   with a countdown before it forwards, so a visitor scanning the parish's
   screen got an advert and a wait instead of the sign-up form. From the hall
   that reads as the screen being broken.

   The address behind the wrapper is short, scannable, and goes straight where
   it says. Only the wrapper knows what it is, and a browser cannot ask — the
   cross-origin rule stops it reading the redirect. The Sheet's own Apps Script
   can, so it does, and this asks it.

   Everything here is best-effort. No answer, no script deployed, no network:
   the link stays exactly as it arrived and the editor still shows its warning.
   Nothing about the import waits on this.
   ========================================================================== */

(function (global) {
  'use strict';

  const CFG = global.KIOSK_CONFIG || {};
  const TIMEOUT_MS = 12000;

  let seq = 0;

  // Asked once per address for the life of the page. An import re-run over the
  // same newsletter should not re-ask for forty links it already knows.
  const cache = new Map();

  function jsonp(params) {
    return new Promise((resolve, reject) => {
      const name = '__kioskUnwrap' + (++seq) + '_' + Date.now().toString(36);
      const el = document.createElement('script');

      let timer = null;
      const cleanup = () => {
        clearTimeout(timer);
        delete global[name];
        if (el.parentNode) el.parentNode.removeChild(el);
      };

      global[name] = data => { cleanup(); resolve(data); };
      timer = setTimeout(() => { cleanup(); reject(new Error('timed out')); }, TIMEOUT_MS);
      el.onerror = () => { cleanup(); reject(new Error('could not reach the script')); };

      const qs = Object.keys(params)
        .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k]))
        .join('&');

      el.src = CFG.publishUrl + (CFG.publishUrl.indexOf('?') === -1 ? '?' : '&') +
        qs + '&callback=' + name + '&_ts=' + Date.now();
      document.head.appendChild(el);
    });
  }

  /** Is this an address worth asking about at all? */
  function needsUnwrapping(url) {
    if (!url || !/^https?:\/\//i.test(url)) return false;
    const E = global.Eml;
    if (!E) return false;
    return E.isTrackingUrl(url) || (E.isShortenedUrl && E.isShortenedUrl(url));
  }

  /**
   * One address in, the address it really leads to out. Never rejects — on any
   * failure the original comes back, which is exactly as good as not asking.
   */
  function one(url) {
    if (!needsUnwrapping(url)) return Promise.resolve(url);
    if (!CFG.publishUrl) return Promise.resolve(url);
    if (cache.has(url)) return Promise.resolve(cache.get(url));

    return jsonp({ action: 'unwrap', url: url })
      .then(res => {
        const real = res && res.ok && res.url ? String(res.url) : url;
        // A wrapper that unwraps to another wrapper, or to nothing useful, is
        // no better than what we started with.
        const better = /^https?:\/\//i.test(real) && !needsUnwrapping(real) ? real : url;
        cache.set(url, better);
        return better;
      })
      .catch(err => {
        console.warn('[kiosk] could not unwrap', url, '-', err.message);
        cache.set(url, url);
        return url;
      });
  }

  /**
   * Every link on one announcement. Resolves to true when something changed,
   * so the caller knows whether it needs to redraw.
   */
  function item(it) {
    const pairs = global.Importer.linkPairs(it.link, it.linkLabel);
    if (!pairs.some(p => needsUnwrapping(p.url))) return Promise.resolve(false);

    return Promise.all(pairs.map(p => one(p.url))).then(urls => {
      if (urls.every((u, i) => u === pairs[i].url)) return false;
      it.link = urls.join('\n');
      // A label that was only ever the wrapper's hostname is now wrong. The
      // default reads better than "links.breezechms.com" ever did anyway.
      it.linkLabel = pairs.map((p, i) => {
        const stale = p.label && urls[i] !== p.url &&
          p.url.toLowerCase().indexOf(String(p.label).toLowerCase()) !== -1;
        return stale ? '' : p.label;
      }).join('\n');
      return true;
    });
  }

  global.Unwrap = { one, item, needsUnwrapping };

})(window);
