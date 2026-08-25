/* ============================================================================
   slide.js — turning one announcement into one screen
   ----------------------------------------------------------------------------
   The important promise this file keeps: an announcement always fits on a
   single slide. It is never cut in half and continued somewhere else. That is
   done by measuring the rendered text and shrinking it until it fits, with a
   readability floor below which we trim instead of shrinking further.
   ========================================================================== */

(function (global) {
  'use strict';

  const CFG = global.KIOSK_CONFIG;

  /* ------------------------------------------------------------------ qr -- */

  /**
   * Build a QR code as an inline SVG.
   *
   * Error-correction level "M" is deliberate. Higher levels pack more redundancy
   * in, which makes the symbol denser — smaller squares, harder to scan from
   * across a hall. These codes live on a clean screen where nothing is going to
   * scratch or smudge them, so the reliability of "H" buys us nothing and costs
   * real scanning distance.
   */
  function makeQrSvg(text) {
    const q = global.qrcode(0, 'M');
    q.addData(text);
    q.make();

    const n = q.getModuleCount();
    const quiet = 4;                  // quiet zone, in modules — spec minimum
    const size = n + quiet * 2;

    let d = '';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (q.isDark(r, c)) d += 'M' + (c + quiet) + ' ' + (r + quiet) + 'h1v1h-1z';
      }
    }

    return (
      '<svg class="qr__svg" viewBox="0 0 ' + size + ' ' + size + '" ' +
      'xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges" ' +
      'role="img" aria-label="QR code">' +
      '<rect width="' + size + '" height="' + size + '" fill="#ffffff"/>' +
      '<path d="' + d + '" fill="#000000"/>' +
      '</svg>'
    );
  }

  /** How many modules across the code is — a rough proxy for scan difficulty. */
  function qrDensity(text) {
    try {
      const q = global.qrcode(0, 'M');
      q.addData(text);
      q.make();
      return q.getModuleCount();
    } catch (e) {
      return 0;
    }
  }

  /* --------------------------------------------------------------- markup -- */

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /**
   * Render the body text. A Sheet cell can contain line breaks, and people
   * naturally write bullet lists, so both are honoured.
   */
  function renderBody(text) {
    const lines = String(text).split(/\r?\n/).map(l => l.trim());
    let html = '';
    let inList = false;

    for (const line of lines) {
      if (!line) continue;
      const bullet = line.match(/^[-•*·]\s+(.*)$/);
      if (bullet) {
        if (!inList) { html += '<ul class="slide__list">'; inList = true; }
        html += '<li>' + escapeHtml(bullet[1]) + '</li>';
      } else {
        if (inList) { html += '</ul>'; inList = false; }
        html += '<p>' + escapeHtml(line) + '</p>';
      }
    }
    if (inList) html += '</ul>';
    return html || '<p></p>';
  }

  /**
   * Build the DOM for one slide.
   * Layout is chosen from what the row actually has in it.
   */
  function buildSlideEl(slide) {
    const hasQr = !!slide.link;
    const hasImg = !!slide.image;
    const layout = hasImg ? 'image' : (hasQr ? 'qr' : 'text');

    const el = document.createElement('article');
    el.className = 'slide slide--' + layout;

    let qrHtml = '';
    if (hasQr) {
      qrHtml =
        '<aside class="slide__qr qr">' +
          '<div class="qr__frame">' + makeQrSvg(slide.link) + '</div>' +
          (slide.linkLabel
            ? '<p class="qr__label">' + escapeHtml(slide.linkLabel) + '</p>'
            : '') +
        '</aside>';
    }

    const imgHtml = hasImg
      ? '<div class="slide__image"><img src="' + escapeHtml(slide.image) +
        '" alt="" loading="eager"></div>'
      : '';

    el.innerHTML =
      imgHtml +
      '<div class="slide__main">' +
        '<div class="slide__fit">' +
          '<h2 class="slide__title">' + escapeHtml(slide.title) + '</h2>' +
          '<div class="slide__rule" aria-hidden="true"></div>' +
          '<div class="slide__body">' + renderBody(slide.body) + '</div>' +
        '</div>' +
      '</div>' +
      qrHtml;

    return el;
  }

  /* ------------------------------------------------------------ fitting -- */

  /**
   * Shrink text until it fits its box.
   *
   * `fitEl` sets a base font size in px; everything inside it is sized in `em`,
   * so changing that one number scales the whole block proportionally. We
   * binary-search that number between the configured floor and ceiling.
   *
   * Returns { px, trimmed } so the caller can tell whether we had to cut text.
   */
  function fitToBox(mainEl, fitEl, opts) {
    const min = opts.minPx;
    const max = opts.maxPx;

    // Scale the floor/ceiling to the actual screen. The configured numbers are
    // expressed for 1080p; on a smaller window everything should shrink with it,
    // otherwise a laptop preview looks nothing like the TV.
    const scale = Math.min(1, mainEl.clientHeight / (1080 * 0.62));
    const lo0 = Math.max(11, min * scale);
    const hi0 = Math.max(lo0 + 1, max * scale);

    // Measure the text block itself rather than its container. The container
    // centres its content vertically, and overflow that spills off the *top*
    // doesn't show up in the container's scrollHeight — so asking the container
    // would quietly under-report and let text run off the screen.
    const fits = () => fitEl.scrollHeight <= mainEl.clientHeight + 1;

    let lo = lo0, hi = hi0, best = lo0;

    fitEl.style.fontSize = hi + 'px';
    if (fits()) {                       // short announcement — use full size
      return { px: hi, trimmed: false };
    }

    for (let i = 0; i < 9; i++) {
      const mid = (lo + hi) / 2;
      fitEl.style.fontSize = mid + 'px';
      if (fits()) { best = mid; lo = mid; } else { hi = mid; }
    }

    fitEl.style.fontSize = best + 'px';

    // Still overflowing at the readability floor? Then the announcement is
    // genuinely too long for one screen. Trim it rather than render something
    // nobody across the room can read.
    let trimmed = false;
    if (!fits()) {
      trimmed = trimToFit(mainEl, fitEl, fits);
    }

    return { px: best, trimmed };
  }

  /**
   * Binary-search the body text down to the longest prefix that fits,
   * cutting on a word boundary and marking the cut visibly.
   */
  function trimToFit(mainEl, fitEl, fits) {
    const bodyEl = fitEl.querySelector('.slide__body');
    if (!bodyEl) return false;

    const NOTICE = '<p class="slide__truncated">Full details in this week’s bulletin</p>';
    const full = bodyEl.textContent;

    // The notice has to be part of every measurement. Measuring without it and
    // appending it afterwards makes the slide overflow again by exactly the
    // height of the line we forgot to account for.
    const render = n => {
      const cut = preferSentenceBoundary(cutAtWord(full, n));
      const suffix = /[.!?]$/.test(cut) ? '' : '…';
      bodyEl.innerHTML = renderBody(cut + suffix) + NOTICE;
    };

    let lo = 0, hi = full.length, best = -1;
    for (let i = 0; i < 12 && lo <= hi; i++) {
      const mid = Math.floor((lo + hi) / 2);
      render(mid);
      if (fits()) { best = mid; lo = mid + 1; } else { hi = mid - 1; }
    }

    if (best < 0) {
      // Not even an empty body fits — the title alone has filled the screen.
      bodyEl.innerHTML = NOTICE;
    } else {
      render(best);
    }
    return true;
  }

  function cutAtWord(s, n) {
    if (n >= s.length) return s;
    const cut = s.slice(0, n);
    const sp = cut.lastIndexOf(' ');
    return (sp > 40 ? cut.slice(0, sp) : cut).replace(/[\s,;:.]+$/, '');
  }

  /**
   * When a word-boundary cut still has most of its last sentence intact,
   * snap back to end on that sentence instead. "One clean thought, then a
   * pointer to the bulletin" reads far better than a clause chopped
   * mid-breath — and costs only a little text, which is already headed for
   * the trim.
   */
  function preferSentenceBoundary(cut) {
    const m = cut.match(/^[\s\S]*[.!?](?=\s|$)/);
    if (!m || m[0].length < cut.length * 0.55) return cut;
    return m[0].trim();
  }

  /* --------------------------------------------------------------- length -- */

  /**
   * Rough guidance used by the import tool: will this comfortably fit?
   * Thresholds come from what actually fits at a readable size at 1080p.
   */
  function lengthVerdict(title, body, hasQr) {
    const chars = (title || '').length + (body || '').length;
    const budget = hasQr ? 520 : 720;   // a QR panel eats about a third of the width
    const ratio = chars / budget;
    if (ratio <= 0.75) return { level: 'good', chars, budget };
    if (ratio <= 1.0) return { level: 'tight', chars, budget };
    return { level: 'over', chars, budget };
  }

  global.Slide = {
    buildSlideEl,
    fitToBox,
    makeQrSvg,
    qrDensity,
    renderBody,
    escapeHtml,
    lengthVerdict,
  };

})(window);
