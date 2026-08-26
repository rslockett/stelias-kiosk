/* ============================================================================
   format.js — laying announcements out for the screen
   ----------------------------------------------------------------------------
   A newsletter is written to be read sitting down. A coffee hour television is
   read standing up, in a glance, from across a hall. Turning one into the other
   — days into headings, services into bullets, a staff list into an aligned
   directory, and waffle into nothing — is the work this file hands off.

   It goes to Gemini, by way of the parish's own Apps Script. The key lives
   there as a Script Property rather than here, because this file is served by
   GitHub Pages and everything in it is public. See the long note above
   handleFormat() in sheet/Code.gs for why, and for the setup.

   THE SHAPE OF A REQUEST
   Apps Script cannot return a reply a browser is allowed to read — the same
   wall publishing hit, described above publish() in live.js. So a job is sent
   one way and collected the other:

     1. POST the announcements with a job id we invent. Nothing is read back;
        the request either arrives or it doesn't.
     2. Poll for that job id with a <script> tag, which is not subject to the
        cross-origin rule, until the answer appears.

   WHEN IT ISN'T SET UP
   Nothing here pretends. If there is no publish URL, or no API key behind it,
   `available()` says so and the editor tells the truth rather than offering a
   button that quietly does nothing.
   ========================================================================== */

(function (global) {
  'use strict';

  const CFG = global.KIOSK_CONFIG;

  // Formatting a whole newsletter is one Gemini call, and a model writing that
  // much text takes a little while — longer if the newest model is busy and
  // the script has to fall back to a quieter one, which it retries through
  // (see GEMINI_MODELS in Code.gs). Three minutes covers the worst of that and
  // still gives up while somebody is sitting there rather than never.
  const JOB_TIMEOUT_MS = 180000;
  const POLL_INTERVAL_MS = 1500;

  // A single JSONP request should answer almost instantly — it is reading a
  // cache entry, not doing work.
  const JSONP_TIMEOUT_MS = 12000;

  let jsonpSeq = 0;

  /**
   * Fetch JSON from the Apps Script using a <script> tag.
   *
   * This is the one way a page on github.io can read a reply from a Google
   * Apps Script web app: a script tag is exempt from the cross-origin rule
   * that blocks reading a fetch() response. Apps Script redirects to
   * googleusercontent.com to serve the body, which a script tag follows
   * without complaint.
   */
  function jsonp(params) {
    return new Promise((resolve, reject) => {
      const name = '__kioskFmt' + (++jsonpSeq) + '_' + Date.now().toString(36);
      const el = document.createElement('script');

      let timer = null;
      const cleanup = () => {
        clearTimeout(timer);
        delete global[name];
        if (el.parentNode) el.parentNode.removeChild(el);
      };

      global[name] = data => { cleanup(); resolve(data); };

      timer = setTimeout(() => {
        cleanup();
        reject(new Error('The Sheet’s script did not answer in time.'));
      }, JSONP_TIMEOUT_MS);

      // A script that 404s or is not deployed fires an error rather than
      // calling us back — without this the promise would simply hang.
      el.onerror = () => {
        cleanup();
        reject(new Error('Could not reach the Sheet’s script. Check publishUrl in ' +
          'config.js, and that Code.gs has been redeployed since the formatting ' +
          'was added to it (Deploy → Manage deployments → pencil → New version).'));
      };

      const qs = Object.keys(params)
        .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k]))
        .join('&');

      el.src = CFG.publishUrl + (CFG.publishUrl.indexOf('?') === -1 ? '?' : '&') +
        qs + '&callback=' + name + '&_ts=' + Date.now();
      document.head.appendChild(el);
    });
  }

  /* ------------------------------------------------------------ readiness -- */

  let availability = null;

  /**
   * Can this actually format anything right now?
   *
   * Asked once and remembered. The answer is a small object rather than a
   * boolean so the editor can say *which* step is missing — "no publish URL"
   * and "publish URL but no API key" are different jobs for whoever is
   * setting this up, and telling them apart saves an afternoon.
   */
  function available() {
    if (!availability) availability = checkAvailable();
    return availability;
  }

  async function checkAvailable() {
    if (!CFG.publishUrl || !CFG.publishSecret) {
      return {
        ready: false,
        reason: 'one-click publish',
        message: 'Set up one-click publish in config.js first — the formatting ' +
                 'goes through the same Apps Script.',
      };
    }
    try {
      const res = await jsonp({ action: 'ai' });
      if (res && res.configured) return { ready: true };
      return {
        ready: false,
        reason: 'no key',
        message: 'Add a free Gemini API key to the Sheet’s Apps Script — see the ' +
                 'note at the top of sheet/Code.gs. It takes about two minutes.',
      };
    } catch (err) {
      // jsonp()'s own errors already read as sentences, so they are passed
      // through rather than wrapped — prefixing them produced "Could not reach
      // the Sheet's script: Could not reach the Sheet's script."
      return { ready: false, reason: 'unreachable', message: err.message };
    }
  }

  /** Ask again from scratch — after somebody has just gone and added the key. */
  function recheck() {
    availability = null;
    return available();
  }

  /* -------------------------------------------------------------- the job -- */

  function newJobId() {
    return 'j' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  /**
   * Lay out a batch of announcements.
   *
   * Returns an array the same length as the one given, in the same order —
   * the Apps Script refuses a reply of any other shape rather than risk
   * pairing one announcement's body with another's headline.
   *
   * `onProgress` is called with a short human sentence as the job moves, so
   * the editor can say what is happening instead of spinning silently.
   */
  async function format(items, onProgress, opts) {
    opts = opts || {};
    const state = await available();
    if (!state.ready) throw new Error(state.message);

    const jobId = newJobId();
    const started = Date.now();
    const deadline = started + JOB_TIMEOUT_MS;

    // The wording walks forward on its own. The POST below does not resolve
    // until the Apps Script has finished the whole job — it runs Gemini
    // synchronously — so there is no event to hang a progress update on, and
    // a message frozen on "Sending…" for a minute reads as a hang. Counting
    // elapsed seconds is honest about the one thing we actually know.
    let ticker = null;
    if (onProgress) {
      const phase = () => {
        const secs = Math.round((Date.now() - started) / 1000);
        if (secs < 8) return 'Reading ' + items.length + ' announcement' +
                              (items.length === 1 ? '' : 's') + '…';
        if (secs < 30) return 'Laying them out for the screen… (' + secs + 's)';
        return 'Still going — the model is busy, trying a quieter one… (' + secs + 's)';
      };
      onProgress(phase());
      ticker = setInterval(() => onProgress(phase()), 1000);
    }
    const stopTicker = () => { if (ticker) clearInterval(ticker); };

    try {
      // no-cors: delivered, never read. The answer comes back through jsonp().
      // Raced against the deadline so a wedged script cannot leave this
      // promise unsettled forever — fetch on its own has no timeout.
      await Promise.race([
        fetch(CFG.publishUrl, {
          method: 'POST',
          mode: 'no-cors',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({
            action: 'format',
            secret: CFG.publishSecret,
            jobId: jobId,
            mode: opts.mode || 'format',
            items: items.map(it => ({
              title: String(it.title || ''),
              body: String(it.body || ''),
              // Only set on the tightening pass, where the editor has drawn
              // the slide and knows what it actually has room for.
              maxChars: it.maxChars || 0,
            })),
          }),
        }),
        sleep(JOB_TIMEOUT_MS),
      ]);

      while (Date.now() < deadline) {
        let res;
        try {
          res = await jsonp({ action: 'result', jobId: jobId });
        } catch (err) {
          // A single dropped poll is not a failed job — the work is happening
          // on Google's side either way. Keep asking until the clock runs out.
          await sleep(POLL_INTERVAL_MS);
          continue;
        }

        if (res && res.done) {
          if (!res.ok) throw new Error(res.error || 'The formatting did not work.');
          return res.items;
        }
        await sleep(POLL_INTERVAL_MS);
      }

      throw new Error('That took longer than three minutes and was given up on. ' +
                      'Nothing was changed — try again in a moment.');
    } finally {
      stopTicker();
    }
  }

  /** One announcement, same path. Used by the per-card "Rewrite it" button. */
  async function formatOne(item, onProgress) {
    const out = await format([item], onProgress);
    return out[0];
  }

  global.Format = { format, formatOne, available, recheck };

})(window);
