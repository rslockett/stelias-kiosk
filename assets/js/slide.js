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

  /* ------------------------------------------------------- inline markup -- */

  // An email address, wherever it sits in a line. Used both to spot a contact
  // row and to split the person's name off the front of it.
  const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

  /**
   * `**bold**` and `*italic*` inside a line of body text.
   *
   * Runs on already-escaped text, which is safe because escapeHtml leaves `*`
   * and `_` alone — so the only angle brackets in the string at this point are
   * ones this function put there itself.
   *
   * Bold is matched before italic, otherwise the single-asterisk rule eats the
   * first two asterisks of a `**bold**` run and leaves the closing pair
   * stranded.
   */
  function inlineMarkup(escaped) {
    return escaped
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>')
      .replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');
  }

  function inline(text) {
    return inlineMarkup(escapeHtml(text));
  }

  /* -------------------------------------------------------- body blocks -- */

  const BULLET_LINE = /^[-•*·▪▸]\s+(.*)$/;
  const SUBHEAD_LINE = /^#{2,4}\s+(.*)$/;

  // "Saturday", "Sunday, August 23", "Friday 10/16" — a day standing alone on
  // its line. The date part is spelled out rather than left open so that
  // "Sunday school resumes in September" stays the sentence it is.
  const DAY_LINE = new RegExp(
    '^(?:sun|mon|tues?|wed(?:nes)?|thur?s?|fri|sat(?:ur)?)(?:day)?' +
    '(?:\\s*,?\\s*(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?' +
    '\\s+\\d{1,2}|\\d{1,2}\\s*[/-]\\s*\\d{1,2}))?(?:\\s*,?\\s*20\\d{2})?:?$', 'i');

  /**
   * A day line with a bulleted list directly under it is a schedule, whether
   * or not anybody typed the "##".
   *
   * This exists so that announcements already sitting in the Sheet — written
   * before the markup did — lay themselves out properly tonight rather than
   * next time somebody re-imports the newsletter. Requiring the very next line
   * to be a bullet is what keeps it safe: prose does not do that.
   */
  function isImplicitDayHeading(line, next) {
    return line.length <= 42 && DAY_LINE.test(line) && !!next && BULLET_LINE.test(next);
  }

  /**
   * Split a contact line into the person and the address.
   *
   * "Fr. Elias Murphy, Pastor – fr.elias@sainteliaschurch.org" is one line in
   * the newsletter and two pieces of information on the screen. Anything
   * before the address is the person; the dash, colon or "at" that introduced
   * the address is punctuation from the sentence, not part of either.
   */
  function splitContact(line) {
    const m = line.match(EMAIL_RE);
    if (!m) return null;
    const name = line.slice(0, m.index)
      .replace(/\s*(?:[–—:-]|\bat\b|\be-?mail\b)\s*$/i, '')
      .replace(/[(\s]+$/, '')
      .trim();
    const after = line.slice(m.index + m[0].length).replace(/^[)\s.,]+/, '').trim();
    return { name: name, email: m[0], trailing: after };
  }

  /**
   * Is this run of lines a contact block — a staff list, "who to ask about
   * what" — rather than ordinary prose that happens to mention an address?
   *
   * Two shapes count, because newsletters use both and often mix them in one
   * list: the whole entry on one line, and the name on one line with its
   * address on the next. Either way the screen renders them identically, which
   * is the entire point: three contacts that each wrap differently look like a
   * mistake, and it is the inconsistency people notice rather than the wrap.
   */
  function takeContactBlock(lines, start) {
    const rows = [];
    let i = start;

    while (i < lines.length) {
      const line = lines[i];
      if (!line || BULLET_LINE.test(line) || SUBHEAD_LINE.test(line)) break;

      const here = splitContact(line);

      // Name and address on one line.
      if (here && here.name) {
        // A whole sentence that merely mentions an address is prose, not a
        // directory entry — but the test for that cannot be sentence
        // punctuation, because half the names in an Orthodox parish are
        // "Fr.", "Dcn." or "Sh." and every one of them would fail it. Length
        // rules out the obvious prose, and the real guard is structural: a
        // run of consecutive address lines, checked at the end of this loop.
        // Prose does not come two and three lines deep in that shape.
        if (here.name.length > 60) break;
        // The address has to end the line, give or take punctuation. In prose
        // it sits mid-sentence with the rest of the thought after it.
        if (here.trailing.length > 2) break;
        rows.push(here);
        i++;
        continue;
      }

      // Address alone on its line, with the name on the line before.
      if (here && !here.name && rows.length && !rows[rows.length - 1].email) {
        rows[rows.length - 1].email = here.email;
        i++;
        continue;
      }

      // A bare name, expecting its address on the next line.
      const next = lines[i + 1];
      const nextParts = next ? splitContact(next) : null;
      if (!here && nextParts && !nextParts.name && line.length <= 60) {
        rows.push({ name: line, email: nextParts.email, trailing: '' });
        i += 2;
        continue;
      }

      break;
    }

    // One contact on its own is a sentence, not a directory — leave it as
    // prose so a lone "email Anca to sign up" doesn't become a styled block.
    if (rows.length < 2) return null;
    return { rows: rows.filter(r => r.email), next: i };
  }

  function contactsHtml(rows) {
    return '<dl class="slide__contacts">' + rows.map(r =>
      '<div class="slide__contact">' +
        (r.name ? '<dt>' + inline(r.name) + '</dt>' : '') +
        '<dd>' + escapeHtml(r.email) + '</dd>' +
      '</div>'
    ).join('') + '</dl>';
  }

  /**
   * Render the body text.
   *
   * A Sheet cell holds plain text, so the markup people can use is deliberately
   * tiny and guessable — the kind of thing someone types anyway without being
   * told it means something:
   *
   *   ## Saturday          a sub-heading, for a day or a section within a slide
   *   - Vespers 5pm        a bullet
   *   **bold**  *italic*   emphasis
   *
   * On top of that, a run of two or more lines carrying email addresses is
   * recognised as a contact block on its own and laid out as one, because
   * nobody should have to know a syntax to get a staff directory to line up.
   */
  /**
   * Does this body have structure in it — sub-headings, bullets, contacts —
   * as opposed to being plain sentences? A structured body is laid out as a
   * left-aligned block centred on the slide, because a bulleted list under a
   * centred day heading looks like two different slides fighting.
   */
  function hasStructure(text) {
    const lines = String(text).split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.some((l, n) => SUBHEAD_LINE.test(l) || BULLET_LINE.test(l) ||
                             isImplicitDayHeading(l, lines[n + 1]))) return true;
    for (let i = 0; i < lines.length; i++) {
      if (takeContactBlock(lines, i)) return true;
    }
    return false;
  }

  function renderBody(text) {
    const lines = String(text).split(/\r?\n/).map(l => l.trim());
    let html = '';
    let inList = false;

    const closeList = () => { if (inList) { html += '</ul>'; inList = false; } };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;

      const sub = line.match(SUBHEAD_LINE);
      if (sub) {
        closeList();
        html += '<h3 class="slide__sub">' + inline(sub[1]) + '</h3>';
        continue;
      }

      const nextLine = lines.slice(i + 1).find(l => l);
      if (isImplicitDayHeading(line, nextLine)) {
        closeList();
        html += '<h3 class="slide__sub">' + inline(line.replace(/:$/, '')) + '</h3>';
        continue;
      }

      const bullet = line.match(BULLET_LINE);
      if (bullet) {
        if (!inList) { html += '<ul class="slide__list">'; inList = true; }
        html += '<li>' + inline(bullet[1]) + '</li>';
        continue;
      }

      const contacts = takeContactBlock(lines, i);
      if (contacts) {
        closeList();
        html += contactsHtml(contacts.rows);
        i = contacts.next - 1;
        continue;
      }

      closeList();
      html += '<p>' + inline(line) + '</p>';
    }

    closeList();
    return html || '<p></p>';
  }

  /**
   * "url1\nurl2" / "label1\nlabel2" -> [{url,label}, ...]. A Sheet row's
   * Link and Link Label columns hold one QR code per line — a card naming
   * several people (a staff directory, "contact X or Y") gets one labelled
   * QR each rather than one anonymous code standing in for all of them.
   */
  function parseLinkPairs(link, label) {
    const urls = String(link || '').split('\n').map(s => s.trim()).filter(Boolean);
    const labels = String(label || '').split('\n');
    return urls.map((u, i) => ({ url: u, label: (labels[i] || '').trim() || CFG.defaultQrLabel }));
  }

  /** A picture with its own transparency, rather than a photograph. */
  function isCutout(src) {
    return /\.png(\?|#|$)/i.test(String(src || ''));
  }

  /* ----------------------------------------------------------- ornament -- */

  /**
   * The ornament under a slide's title.
   *
   * It used to be a gold bar with a diamond at each end — correct, and about
   * as interesting as a horizontal rule. The wallpaper behind every slide is
   * an ornamented Byzantine cross, so the divider is a small one of the same
   * family: a cross pattee with a lozenge at its heart, flanked by rules that
   * taper away to nothing.
   *
   * Drawn rather than typed, because at the sizes a television uses this has
   * to stay crisp whether the fit-to-box pass settled on 26px or 62px, and a
   * glyph would be at the mercy of whichever font happened to load.
   */
  function ruleSvg() {
    // The box is kept tight around the ornament. Give the rules a long run
    // either side and the cross has to shrink to keep the whole thing the
    // width of a line of text — it ended up a nine-pixel smudge under a
    // thirty-pixel title. Short rules, big cross.
    const cx = 90, cy = 17;
    const L = 14;     // arm length from centre
    const t = 6.6;    // half-width at the flared tip
    const w = 2.6;    // half-width at the waist

    const cross =
      'M' + (cx - t) + ' ' + (cy - L) +
      'L' + (cx + t) + ' ' + (cy - L) +
      'L' + (cx + w) + ' ' + (cy - w) +
      'L' + (cx + L) + ' ' + (cy - t) +
      'L' + (cx + L) + ' ' + (cy + t) +
      'L' + (cx + w) + ' ' + (cy + w) +
      'L' + (cx + t) + ' ' + (cy + L) +
      'L' + (cx - t) + ' ' + (cy + L) +
      'L' + (cx - w) + ' ' + (cy + w) +
      'L' + (cx - L) + ' ' + (cy + t) +
      'L' + (cx - L) + ' ' + (cy - t) +
      'L' + (cx - w) + ' ' + (cy - w) + 'Z';

    // A rule that starts as a point out at the margin and swells as it comes
    // in, so the eye is carried towards the cross rather than away from it.
    const wedge = (from, to) =>
      'M' + from + ' ' + cy +
      'L' + to + ' ' + (cy - 2.9) +
      'L' + to + ' ' + (cy + 2.9) + 'Z';

    const pip = x =>
      'M' + x + ' ' + (cy - 3.6) + 'L' + (x + 3.6) + ' ' + cy +
      'L' + x + ' ' + (cy + 3.6) + 'L' + (x - 3.6) + ' ' + cy + 'Z';

    return '' +
      '<svg class="slide__rule" viewBox="0 0 180 34" ' +
           'preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">' +
        '<path class="rule__bar" d="' + wedge(20, 68) + '"/>' +
        '<path class="rule__bar" d="' + wedge(160, 112) + '"/>' +
        '<path class="rule__pip" d="' + pip(13) + '"/>' +
        '<path class="rule__pip" d="' + pip(167) + '"/>' +
        '<path class="rule__cross" d="' + cross + '"/>' +
        '<circle class="rule__heart" cx="' + cx + '" cy="' + cy + '" r="3.4"/>' +
      '</svg>';
  }

  /**
   * Build the DOM for one slide.
   * Layout is chosen from what the row actually has in it.
   */
  function buildSlideEl(slide) {
    const links = parseLinkPairs(slide.link, slide.linkLabel);
    const hasQr = links.length > 0;
    const hasImg = !!slide.image;
    const layout = hasImg ? 'image' : (hasQr ? 'qr' : 'text');

    const el = document.createElement('article');
    el.className = 'slide slide--' + layout;

    // One code sizes and centres the same as always. Several share the panel,
    // shrinking to fit rather than running off the bottom of the screen.
    const qrOne = pair =>
      '<div class="qr">' +
        '<div class="qr__frame">' + makeQrSvg(pair.url) + '</div>' +
        '<p class="qr__label">' + escapeHtml(pair.label) + '</p>' +
      '</div>';

    let qrHtml = '';
    if (links.length === 1) {
      qrHtml = '<aside class="slide__qr">' + qrOne(links[0]) + '</aside>';
    } else if (links.length > 1) {
      qrHtml =
        '<aside class="slide__qr qr-group qr-group--' + Math.min(links.length, 4) + '">' +
          links.map(qrOne).join('') +
        '</aside>';
    }

    // A .png is taken to be a cut-out — an icon on a transparent ground — and
    // is shown without the white mount a photograph gets. A photograph is a
    // .jpg, which is the convention already in use for everything in the
    // Sheet's Image column.
    const imgHtml = hasImg
      ? '<div class="slide__image' + (isCutout(slide.image) ? ' slide__image--plain' : '') +
        '"><img src="' + escapeHtml(slide.image) + '" alt="" loading="eager"></div>'
      : '';

    el.innerHTML =
      imgHtml +
      '<div class="slide__main">' +
        '<div class="slide__fit">' +
          '<h2 class="slide__title">' + escapeHtml(slide.title) + '</h2>' +
          ruleSvg() +
          '<div class="slide__body' +
            (hasStructure(slide.body) ? ' slide__body--structured' : '') + '">' +
            renderBody(slide.body) +
          '</div>' +
        '</div>' +
      '</div>' +
      qrHtml;

    // Trimming works from this rather than from the rendered text. Reading it
    // back out of the DOM would lose every "##" and "-" along the way, so a
    // slide that had to be cut would also silently lose its sub-headings and
    // bullets — the trim would reformat the slide as well as shorten it.
    const bodyEl = el.querySelector('.slide__body');
    if (bodyEl) bodyEl.dataset.source = String(slide.body == null ? '' : slide.body);

    if (hasImg) dropImageIfBroken(el, hasQr ? 'qr' : 'text');

    return el;
  }

  /**
   * An Image address that 404s — a photo taken down, a link typed wrong, a
   * file not added yet — otherwise leaves a broken-image box sitting on the
   * wall of the hall for fourteen seconds. Nobody in the building can fix
   * that while it is happening, so the slide gives the picture up and lays
   * itself out as the words-and-QR slide it would have been without one.
   */
  function dropImageIfBroken(el, fallbackLayout) {
    const wrap = el.querySelector('.slide__image');
    const img = wrap && wrap.querySelector('img');
    if (!img) return;

    const drop = () => {
      if (!wrap.parentNode) return;
      console.warn('[kiosk] image would not load, showing the slide without it:', img.src);
      wrap.remove();
      el.className = el.className.replace(/slide--image/, 'slide--' + fallbackLayout);
    };

    // complete && naturalWidth === 0 means it has already failed — a cached
    // failure fires no error event, so the listener alone would never run.
    if (img.complete && !img.naturalWidth) drop();
    else img.addEventListener('error', drop, { once: true });
  }

  /* -------------------------------------------------------- signup card -- */

  /**
   * One sign-up (Coffee Hour or Holy Bread) as it stands in the rail down the
   * right-hand side of the screen — permanently, rather than taking a turn in
   * the rotation.
   *
   * The code sits beside the title rather than under the list, which is a
   * height decision and not a stylistic one: two of these cards, each six
   * Sundays deep, only fit the column at all with the header laid out this
   * way. See the note above .rail in kiosk.css before rearranging it.
   */
  function buildSignupCardEl(card) {
    const el = document.createElement('section');
    el.className = 'card';

    const rowsHtml = card.entries.map(entry => {
      const fastBadge = entry.fastName
        ? '<span class="card__fast">' + escapeHtml(entry.fastName) + '</span>'
        : '';
      const status = entry.filled
        ? '<span class="card__name">' + escapeHtml(entry.name) + '</span>'
        : '<span class="card__open">Open</span>';

      return (
        '<li class="card__row' + (entry.filled ? ' is-filled' : ' is-open') + '">' +
          '<span class="card__date">' +
            escapeHtml(entry.shortLabel || entry.label) + fastBadge +
          '</span>' +
          status +
        '</li>'
      );
    }).join('');

    const qrHtml = card.qrUrl
      ? '<div class="qr__frame">' + makeQrSvg(card.qrUrl) + '</div>' : '';

    el.innerHTML =
      '<div class="card__head">' +
        qrHtml +
        '<div class="card__headtext">' +
          '<h3 class="card__title">' + escapeHtml(card.title) + '</h3>' +
          '<p class="card__count">' + escapeHtml(countLine(card)) + '</p>' +
          (card.qrUrl
            ? '<p class="card__scan">' + escapeHtml(card.qrLabel || CFG.defaultQrLabel) + '</p>'
            : '') +
        '</div>' +
      '</div>' +
      '<ul class="card__list">' + rowsHtml + '</ul>';

    return el;
  }

  /**
   * The line under the title. A full sign-up sheet says so in words — "0 of
   * the next 6 Sundays open" is a sentence nobody should have to parse to
   * learn that there is nothing to do here.
   */
  function countLine(card) {
    const total = card.entries.length;
    if (!card.openCount) return 'Every Sunday is spoken for — thank you';
    return card.openCount + ' of the next ' + total + ' Sundays open';
  }

  /* ------------------------------------------------------------- welcome -- */

  /**
   * The welcome band: a code, and the sentence a visitor should read before
   * they leave.
   *
   * The instruction shares the title's line rather than taking one of its
   * own. It is a band, not a card — every line it spends is a line the
   * announcements above it do not get, and the words are what the visitor is
   * actually meant to read.
   */
  function buildWelcomeBandHtml(w) {
    return (
      '<div class="qr__frame">' + makeQrSvg(w.url) + '</div>' +
      '<div class="band__text">' +
        '<p class="band__title">' + escapeHtml(w.title) +
          '<span class="band__scan">' + escapeHtml(w.qrLabel) + '</span>' +
        '</p>' +
        '<p class="band__body">' + escapeHtml(w.body) + '</p>' +
      '</div>'
    );
  }

  /* --------------------------------------------------------- fitting: qr -- */

  /**
   * Shrink the codes until they fit the box they are standing in.
   *
   * WHY THIS EXISTS
   *
   * fitToBox below sizes the words, and has always been careful about it.
   * Nothing ever sized the codes. They are set in `vh` — a fraction of the
   * height of the SCREEN — while the space they actually have is the height
   * of the stage, which is a different and smaller number the moment anything
   * else on the screen claims height.
   *
   * That was survivable while the stage was very nearly the whole screen. It
   * stopped being survivable the moment a sign-up column and a welcome band
   * arrived: a staff directory carrying three or four codes ran them straight
   * off the bottom of the stage and over the top of whatever was underneath,
   * on a screen that is supposed to be the tidiest thing in the hall.
   *
   * So: measure, and shrink until it fits. The floor is the point below which
   * a phone camera starts to struggle from across a table — past that there is
   * no sense shrinking further, and `overflow: hidden` on the stage is the
   * backstop that keeps the mess inside its own box either way.
   */
  const QR_FLOOR_PX = 84;

  function fitQrColumn(slideEl) {
    const qrEl = slideEl.querySelector('.slide__qr');
    if (!qrEl) return { shrunk: false, floored: false };

    const frames = Array.prototype.slice.call(qrEl.querySelectorAll('.qr__frame'));
    const labels = Array.prototype.slice.call(qrEl.querySelectorAll('.qr__label'));
    if (!frames.length) return { shrunk: false, floored: false };

    // Overflowing its own cell, or pushing the whole slide past its box —
    // either counts, because which one happens depends on the layout.
    const overflows = () =>
      qrEl.scrollHeight > qrEl.clientHeight + 1 ||
      slideEl.scrollHeight > slideEl.clientHeight + 1;

    if (!overflows()) return { shrunk: false, floored: false };

    let width = frames[0].getBoundingClientRect().width;
    let guard = 0;

    while (overflows() && width > QR_FLOOR_PX && guard++ < 30) {
      width = Math.max(QR_FLOOR_PX, width * 0.93);
      frames.forEach(f => { f.style.width = width + 'px'; });
      // The label is set to the frame's width in CSS; keep them together or a
      // long label starts setting the column's width on its own.
      labels.forEach(l => { l.style.maxWidth = width + 'px'; });
    }

    return { shrunk: true, floored: overflows() };
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
    const full = bodyEl.dataset.source != null ? bodyEl.dataset.source : bodyEl.textContent;

    // The notice has to be part of every measurement. Measuring without it and
    // appending it afterwards makes the slide overflow again by exactly the
    // height of the line we forgot to account for.
    const render = n => {
      const cut = dropDanglingHeading(preferSentenceBoundary(cutAtWord(full, n)));
      const suffix = /[.!?]$/.test(cut) || /\n\s*[-•*·]/.test(cut) ? '' : '…';
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

  /**
   * A cut that lands just after a sub-heading leaves "Sunday" sitting at the
   * bottom of the slide with nothing under it, which reads as though the
   * screen broke rather than that it ran out of room. Drop the orphan; the
   * "full details in the bulletin" line beneath says the rest is elsewhere.
   */
  function dropDanglingHeading(cut) {
    return cut.replace(/\n\s*#{2,4}\s+[^\n]*$/, '').trim();
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
    buildSignupCardEl,
    fitQrColumn,
    buildWelcomeBandHtml,
    fitToBox,
    makeQrSvg,
    qrDensity,
    renderBody,
    hasStructure,
    escapeHtml,
    lengthVerdict,
  };

})(window);
