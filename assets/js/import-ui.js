/* ============================================================================
   import-ui.js — the editor for the coffee hour screen
   ----------------------------------------------------------------------------
   Three people edit this parish's announcements, from three different
   computers, and none of them should have to wonder which of them is looking
   at the truth. So the shape of this file is:

     * on opening, READ the Sheet — you always start from what the hall sees
     * every edit is a draft, held in this browser, and clearly marked as one
     * "Make it live" sends the draft up, and then WATCHES the published Sheet
       until the change actually appears there
     * if somebody else publishes while you are editing, you are told

   Nothing is ever called live because we sent it. It is called live because
   we went and looked.
   ========================================================================== */

(function (global) {
  'use strict';

  const CFG = global.KIOSK_CONFIG;
  const $ = id => document.getElementById(id);

  /* ------------------------------------------------------------- elements -- */

  const statusbarEl = $('statusbar');
  const statusPillEl = $('status-pill');
  const statusLineEl = $('status-line');
  const statusSubEl = $('status-sub');
  const publishBtn = $('publish-btn');
  const discardBtn = $('discard-btn');
  const editorChip = $('editor-chip');
  const sheetLink = $('sheet-link');

  const bannerEl = $('banner');
  const bannerTextEl = $('banner-text');
  const bannerActionsEl = $('banner-actions');

  const listEl = $('list');
  const listEmptyEl = $('list-empty');
  const countEl = $('count');

  const importerEl = $('importer');
  const importToggle = $('import-toggle');
  const dropEl = $('drop');
  const fileEl = $('file');
  const pasteEl = $('paste');

  const landingEl = $('landing');
  const landingTextEl = $('landing-text');

  const workingEl = $('working');
  const workingTextEl = $('working-text');
  const workingSkipEl = $('working-skip');

  const frameEl = $('preview-frame');
  const tvScreenEl = $('tv-screen');
  const veilEl = $('tv-veil');
  const veilTextEl = $('tv-veil-text');
  const previewPosEl = $('preview-pos');
  const verdictEl = $('verdict');
  const playBtn = $('play-btn');

  const toastEl = $('toast');

  /* ---------------------------------------------------------------- state -- */

  let items = [];             // the draft — what you are editing
  let liveItems = null;       // the last copy of the Sheet we actually read
  let liveSig = null;
  let liveStamp = null;       // { by, at } if the Apps Script records it

  let selected = 0;
  let keySeq = 0;

  let booted = false;
  let online = true;
  let offlineMessage = '';

  let publishing = false;
  let publishExpectSig = null;
  let publishStartedAt = 0;

  let conflict = false;
  let pendingImport = null;   // announcements read from a newsletter, awaiting a choice

  // 'checking' | 'ready' | 'unavailable' — whether the Sheet's Apps Script has
  // a Gemini key behind it and can lay announcements out. Checked once at boot
  // (see boot() below) so the buttons that depend on it can say so up front,
  // rather than the editor finding out only after clicking and waiting.
  let aiStatus = 'checking';
  let aiMessage = '';

  const DRAFT_KEY = 'stelias.editor.draft.' + global.Deck.hash(String(CFG.sheetCsvUrl || ''));
  const NAME_KEY = 'stelias.editor.name';

  // How long to keep watching the published Sheet before admitting we cannot
  // see the change. Google's publishing lag is normally under a minute but is
  // documented as "up to five", so give it that before saying anything worrying.
  const PUBLISH_PATIENCE_MS = 5 * 60 * 1000;

  /* ---------------------------------------------------------------- basics -- */

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  let toastTimer;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('is-shown');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('is-shown'), 3600);
  }

  function debounce(fn, ms) {
    let t;
    return function () {
      const args = arguments;
      clearTimeout(t);
      t = setTimeout(() => fn.apply(null, args), ms);
    };
  }

  function plural(n, one, many) {
    return n + ' ' + (n === 1 ? one : (many || one + 's'));
  }

  function timeAgo(iso) {
    const then = new Date(iso);
    if (isNaN(then)) return '';
    const mins = Math.round((Date.now() - then.getTime()) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return plural(mins, 'minute') + ' ago';
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return plural(hrs, 'hour') + ' ago';
    const days = Math.round(hrs / 24);
    if (days < 7) return plural(days, 'day') + ' ago';
    return 'on ' + then.toLocaleDateString([], { month: 'long', day: 'numeric' });
  }

  /* ----------------------------------------------------------- editor name -- */

  function editorName() {
    try { return localStorage.getItem(NAME_KEY) || ''; } catch (e) { return ''; }
  }

  function setEditorName(name) {
    try { localStorage.setItem(NAME_KEY, name); } catch (e) { /* private mode */ }
    renderEditorChip();
  }

  function renderEditorChip() {
    const name = editorName();
    editorChip.textContent = name ? name : 'Set your name';
    editorChip.classList.toggle('chip--named', !!name);
    editorChip.title = name
      ? 'The others will see “last published by ' + name + '”. Click to change it.'
      : 'Add your name so the others know who published last.';
  }

  function askEditorName() {
    const current = editorName();
    const name = global.prompt(
      'Your name — the others see this as who published last.', current || '');
    if (name === null) return current;             // cancelled
    setEditorName(name.trim());
    return name.trim();
  }

  /* -------------------------------------------------------- draft storage -- */

  const saveDraft = debounce(function () {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({
        // _fit is a measurement of how the text fitted the screen, not part
        // of the announcement. Storing it would restore a stale verdict on
        // the next visit; leaving it out means every card is measured afresh.
        items: items.map(it => Object.assign({}, it, { _fit: undefined })),
        liveSig, savedAt: Date.now(),
      }));
    } catch (e) { /* storage full or disabled — the Sheet is the real copy */ }
  }, 400);

  function loadDraft() {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      const d = raw ? JSON.parse(raw) : null;
      return d && Array.isArray(d.items) ? d : null;
    } catch (e) { return null; }
  }

  function clearDraft() {
    try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* nothing to do */ }
  }

  /* ----------------------------------------------------------------- diff -- */

  const sig = global.Live.sig;

  function draftSig() { return global.Live.deckSig(items); }

  function isDirty() { return liveSig !== null && draftSig() !== liveSig; }

  /**
   * What has changed since the Sheet was last read. Each announcement that
   * came from the Sheet carries the signature it had at the time, so "edited"
   * is a fact rather than a guess, and an announcement that was changed and
   * then changed back correctly counts as unchanged.
   */
  function changeSummary() {
    if (!liveItems) return null;

    let added = 0, edited = 0, kept = 0;
    items.forEach(it => {
      if (it.baseSig == null) { added++; return; }
      kept++;
      if (sig(it) !== it.baseSig) edited++;
    });

    const removed = Math.max(0, liveItems.length - kept);

    // Order counts as a change: it is the order the slides appear in.
    const draftOrder = items.filter(it => it.baseKey != null).map(it => it.baseKey).join(',');
    const liveOrder = liveItems.map((_, i) => 'L' + i).join(',');
    const reordered = added === 0 && removed === 0 && draftOrder !== liveOrder;

    return { added, edited, removed, reordered, total: added + edited + removed };
  }

  function changeSentence() {
    const c = changeSummary();
    if (!c) return '';
    const bits = [];
    if (c.added) bits.push(plural(c.added, 'new one'));
    if (c.edited) bits.push(plural(c.edited, 'edit'));
    if (c.removed) bits.push(plural(c.removed, 'removal'));
    if (!bits.length) return c.reordered ? 'The running order has changed.' : 'Something has changed.';
    const list = bits.length === 1 ? bits[0]
      : bits.slice(0, -1).join(', ') + ' and ' + bits[bits.length - 1];
    return list.charAt(0).toUpperCase() + list.slice(1) +
      (c.reordered ? ', and the running order changed.' : '.');
  }

  /* ------------------------------------------------------------ item model -- */

  function blankItem() {
    return {
      key: 'N' + (++keySeq),
      baseKey: null,
      baseSig: null,
      include: true,
      title: '', body: '', link: '', linkLabel: '', start: '', end: '', image: '',
    };
  }

  /** A copy of the Sheet's announcements, stamped so edits can be spotted. */
  function fromLive(liveList) {
    return liveList.map((it, i) => Object.assign({}, it, {
      key: 'L' + i,
      baseKey: 'L' + i,
      baseSig: sig(it),
    }));
  }

  function adoptLive() {
    items = fromLive(liveItems);
    conflict = false;
    selected = Math.min(selected, Math.max(0, items.length - 1));
    clearDraft();
    renderAll();
  }

  /* ---------------------------------------------------------------- meter -- */

  /* Readability thresholds, in px of body text at 1080p.
   *
   * These are about being *read from across a hall*, which is a much higher
   * bar than "fitted on the slide without being cut". A capital letter is
   * roughly 0.7 of the font size, and on a 55" 1080p screen one pixel is
   * about 0.025" — so 34px of body text is a little under 0.6" of letter,
   * which signage practice puts at comfortable for roughly six feet. Six
   * feet is standing at the television, not sitting with a coffee.
   *
   * Both numbers sit above config.js's minBodyPx, which is where the text
   * stops shrinking and gets cut instead. That is deliberate: the warning
   * has to arrive while there is still room to fix it by shortening the
   * words, rather than after the screen has already thrown some away.
   */
  const COMFORTABLE_PX = 46;   // at or above this, it reads from across the room
  const SMALL_TEXT_PX = 34;    // below this, it is too small for the hall

  /**
   * How full this slide is — measured, never guessed.
   *
   * Every announcement is rendered off-screen at a real 1920x1080 and the
   * fitting code reports back the font size it settled on and whether it had
   * to cut anything. The bar is that font size read backwards: text sitting
   * at the maximum size is a nearly empty slide, text pushed down to the
   * floor is a full one.
   *
   * This used to be a character count with a fixed budget, and it was wrong
   * in both directions on real parish announcements — flagging a 1266
   * character notice that fits comfortably as "Too long", which then sent
   * people to a Tighten button that correctly found nothing to fix. A number
   * that argues with the screen is worse than no number.
   */
  function meterFor(item) {
    const fit = item._fit;
    if (!fit) return { level: 'unknown', pct: 0, note: 'Checking how it fits…' };

    if (fit.trimmed) {
      return { level: 'over', pct: 100, note: 'Too long — the TV cut this short' };
    }

    // The bar fills as the text shrinks, and reads 100% at the point the text
    // becomes too small for the room — not at the point the screen gives up
    // and starts cutting. Measuring it against the cutting floor made a slide
    // nobody could read from a table look like it still had a quarter of its
    // space left.
    const max = CFG.maxBodyPx || 62;
    const pct = Math.max(0, Math.min(100,
      Math.round(((max - fit.px) / Math.max(1, max - SMALL_TEXT_PX)) * 100)));

    if (fit.px < SMALL_TEXT_PX) {
      return {
        level: 'over',
        pct: 100,
        note: 'Text shrank to ' + Math.round(fit.px) + 'px — too small to read from the hall',
      };
    }
    if (fit.px < COMFORTABLE_PX) {
      return { level: 'tight', pct, note: pct + '% full — getting small, worth shortening' };
    }
    return { level: 'good', pct, note: pct + '% full — reads well from across the hall' };
  }

  /* ------------------------------------------------------------ link check -- */

  function denseUrls(item) {
    return global.Importer.linkPairs(item.link, item.linkLabel)
      .map(p => p.url)
      .filter(url => {
        if (global.Eml && global.Eml.isTrackingUrl(url)) return true;
        return global.Slide.qrDensity(url) >= 45;
      });
  }

  /**
   * Warn about links that make a QR code nobody can scan. A long tracking URL
   * produces a very dense symbol, and a dense symbol has to be walked up to.
   */
  function linkWarning(item) {
    if (!item.link) return '';
    const dense = denseUrls(item);
    if (!dense.length) return '';
    const many = global.Importer.linkPairs(item.link, item.linkLabel).length > 1;
    return (many ? dense.length + ' of these links are' : 'This link is') +
      ' long enough to make a QR code too dense to scan from across the hall.';
  }

  /* ============================================================ the list == */

  function badgesFor(item) {
    const out = [];
    if (item.baseSig == null) out.push('<span class="badge badge--new">New</span>');
    else if (sig(item) !== item.baseSig) out.push('<span class="badge badge--edited">Edited</span>');

    if (item.include === false) out.push('<span class="badge badge--off">Off</span>');
    else {
      const why = global.Live.showsToday(item);
      if (why) out.push('<span class="badge badge--dated">Not showing</span>');
    }

    const m = meterFor(item);
    if (m.level === 'over') out.push('<span class="badge badge--over">Too long</span>');

    return out.join('');
  }

  function barHtml(item, i, total) {
    const name = String(item.title || '').trim();
    return '' +
      '<div class="item__bar">' +
        '<span class="item__num">' + (i + 1) + '</span>' +
        '<button class="item__open" type="button" data-act="select">' +
          '<span class="item__name' + (name ? '' : ' item__name--blank') + '">' +
            esc(name || 'Untitled announcement') +
          '</span>' +
        '</button>' +
        '<span class="item__badges">' + badgesFor(item) + '</span>' +
        '<span class="item__tools">' +
          '<button class="iconbtn" type="button" data-act="up" title="Move up"' +
            (i === 0 ? ' disabled' : '') + '>↑</button>' +
          '<button class="iconbtn" type="button" data-act="down" title="Move down"' +
            (i === total - 1 ? ' disabled' : '') + '>↓</button>' +
        '</span>' +
        '<label class="switch" title="' +
          (item.include === false ? 'Switched off — put it on the TV' : 'On the TV — switch it off') + '">' +
          '<input type="checkbox" data-f="include"' + (item.include !== false ? ' checked' : '') + '>' +
          '<span class="switch__track"></span>' +
        '</label>' +
      '</div>';
  }

  /**
   * "Rewrite it for the screen" — offered on any announcement, not only a
   * long one, because laying one out is as much a job as shortening it. A
   * schedule that fits perfectly can still be a wall of undifferentiated
   * lines, and that is worth fixing too.
   *
   * Without a key behind the Sheet's script there is nothing to offer, so
   * nothing is shown. A button that thinks about it and then apologises is
   * worse than no button — that is exactly what the old word-trimming
   * fallback did, and why it is gone.
   */
  function rewriteButtonHtml(item) {
    if (aiStatus !== 'ready') return '';
    const level = meterFor(item).level;
    const urgent = level === 'tight' || level === 'over';
    return '<button class="btn btn--ghost btn--sm meter__tighten" type="button" ' +
      'data-act="rewrite" title="Lay this out for the television — headings, ' +
      'bullets and contacts, with the waffle cut">' +
      (urgent ? 'Shorten &amp; tidy' : 'Tidy it up') +
      '<span class="ai-badge">✨</span>' +
      '</button>';
  }

  function editHtml(item) {
    const warn = linkWarning(item);
    return '' +
      '<div class="item__edit">' +

        '<div class="field">' +
          '<label class="field__label">Headline</label>' +
          '<input type="text" data-f="title" value="' + esc(item.title) + '">' +
        '</div>' +

        '<div class="field">' +
          '<label class="field__label">Announcement</label>' +
          '<div class="fmtbar">' +
            '<button type="button" class="fmtbar__btn" data-wrap="**" ' +
              'title="Bold — wraps the selected words in **">' +
              '<strong>B</strong></button>' +
            '<button type="button" class="fmtbar__btn" data-wrap="*" ' +
              'title="Italic — wraps the selected words in *">' +
              '<em>I</em></button>' +
            '<span class="fmtbar__sep" aria-hidden="true"></span>' +
            '<button type="button" class="fmtbar__btn" data-prefix="## " ' +
              'title="Sub-heading — a day, or a section within this announcement">' +
              'Heading</button>' +
            '<button type="button" class="fmtbar__btn" data-prefix="- " ' +
              'title="Bullet — one item in a list">• List</button>' +
          '</div>' +
          '<textarea data-f="body">' + esc(item.body) + '</textarea>' +
          '<div class="meter" title="How much of one TV slide this announcement fills, measured by actually drawing it.">' +
            '<span class="meter__label">Slide space</span>' +
            '<span class="meter__track"><span class="meter__fill"></span></span>' +
            '<span class="meter__note"></span>' +
            rewriteButtonHtml(item) +
          '</div>' +
          '<div class="tighten-panel" data-tighten-panel hidden></div>' +
        '</div>' +

        '<div class="grid3">' +
          '<div class="field">' +
            '<label class="field__label">Link <small>— one per line for several QR codes</small></label>' +
            '<textarea class="field--compact" rows="2" data-f="link" ' +
              'placeholder="sainteliaschurch.org/give">' + esc(item.link) + '</textarea>' +
          '</div>' +
          '<div class="field">' +
            '<label class="field__label">Caption under the QR code</label>' +
            '<textarea class="field--compact" rows="2" data-f="linkLabel" ' +
              'placeholder="Scan to sign up">' + esc(item.linkLabel) + '</textarea>' +
          '</div>' +
        '</div>' +

        (warn ?
          '<p class="linkwarn">' +
            '<span>⚠ ' + esc(warn) + '</span>' +
            '<button type="button" class="btn btn--ghost btn--sm" data-act="shorten">Shorten it</button>' +
          '</p>' : '') +

        '<div class="grid2" style="margin-top:.8rem">' +
          '<div class="field">' +
            '<label class="field__label">Don’t show before <small>— optional</small></label>' +
            '<input type="text" data-f="start" value="' + esc(item.start) + '" placeholder="e.g. September 1">' +
          '</div>' +
          '<div class="field">' +
            '<label class="field__label">Take it down after <small>— the day of the event</small></label>' +
            '<input type="text" data-f="end" value="' + esc(item.end) + '" placeholder="e.g. September 12">' +
          '</div>' +
        '</div>' +

        '<div class="field">' +
          '<label class="field__label">Photo address <small>— optional</small></label>' +
          '<input type="text" data-f="image" value="' + esc(item.image) + '" placeholder="https://…">' +
        '</div>' +

        '<div class="item__footer">' +
          '<button class="btn btn--ghost btn--sm" type="button" data-act="duplicate">Duplicate</button>' +
          '<button class="btn btn--danger btn--sm" type="button" data-act="del" ' +
            'style="margin-left:auto">Delete</button>' +
        '</div>' +
      '</div>';
  }

  function classesFor(item, i) {
    const m = meterFor(item);
    let cls = 'item is-' + m.level;
    if (item.include === false) cls += ' is-off';
    if (i === selected) cls += ' is-selected';
    return cls;
  }

  function refreshMeter(card, item) {
    const meter = card.querySelector('.meter');
    if (!meter) return;
    const m = meterFor(item);
    meter.querySelector('.meter__fill').style.width = m.pct + '%';
    meter.querySelector('.meter__note').textContent = m.note;

    // A measurement can flip an announcement into or out of needing help, so
    // the button has to come and go with it — but never while it is mid-click
    // and spinning, which would throw away the work in flight.
    const existing = meter.querySelector('.meter__tighten');
    if (existing && existing.classList.contains('is-busy')) return;
    const wanted = rewriteButtonHtml(item);
    if (wanted && !existing) meter.insertAdjacentHTML('beforeend', wanted);
    else if (!wanted && existing) existing.remove();
  }

  function renderList() {
    const total = items.length;
    listEmptyEl.hidden = total > 0;

    const on = items.filter(it => it.include !== false && !global.Live.showsToday(it)).length;
    countEl.textContent = total
      ? plural(total, 'announcement') + ' · ' + on + ' on the TV today'
      : '';

    listEl.innerHTML = '';
    items.forEach((item, i) => {
      const card = document.createElement('article');
      card.className = classesFor(item, i);
      card.dataset.i = i;
      card.innerHTML = barHtml(item, i, total) + (i === selected ? editHtml(item) : '');
      listEl.appendChild(card);
      if (i === selected) refreshMeter(card, item);
    });
  }

  function cardAt(i) { return listEl.querySelector('.item[data-i="' + i + '"]'); }

  /** Update one card's chrome without rebuilding it, so typing isn't disturbed. */
  function patchCard(i) {
    const card = cardAt(i);
    const item = items[i];
    if (!card || !item) return;
    card.className = classesFor(item, i);
    card.querySelector('.item__badges').innerHTML = badgesFor(item);
    const name = card.querySelector('.item__name');
    const title = String(item.title || '').trim();
    name.textContent = title || 'Untitled announcement';
    name.classList.toggle('item__name--blank', !title);
    refreshMeter(card, item);
  }

  function select(i) {
    if (i === selected) return;
    selected = Math.max(0, Math.min(i, items.length - 1));
    stopPlaying();
    renderList();
    pushPreview();
  }

  /* ======================================================== measuring == */

  const measureFrameEl = $('measure-frame');
  let measureReady = false;
  let measureToken = 0;
  const pendingMeasures = new Map();

  function slidePayload(item) {
    return {
      title: item.title,
      body: item.body,
      link: item.link,
      linkLabel: item.linkLabel,
      image: item.image,
    };
  }

  /** Render one announcement on the off-screen TV and report what it took. */
  function measureOne(item) {
    return new Promise(resolve => {
      if (!measureReady) { resolve(null); return; }
      const token = ++measureToken;
      pendingMeasures.set(token, resolve);
      measureFrameEl.contentWindow.postMessage(
        { type: 'render', token, index: 0, total: 1, slide: slidePayload(item) },
        global.location.origin);
      // The measuring frame is ordinary code on an ordinary page, but the
      // meter must never sit on "Checking…" forever if a message goes astray.
      setTimeout(() => {
        if (pendingMeasures.has(token)) { pendingMeasures.delete(token); resolve(null); }
      }, 5000);
    });
  }

  /**
   * Measure one announcement and update just its card. Announcements are
   * measured one at a time because they all share a single off-screen frame.
   */
  async function measureItem(i) {
    const item = items[i];
    if (!item) return;
    const r = await measureOne(item);
    // The list can be rebuilt while a measurement is in flight; make sure the
    // answer is still about the announcement we asked about.
    if (!r || items[i] !== item) return;
    item._fit = { trimmed: !!r.trimmed, atFloor: !!r.atFloor, px: r.px };
    patchCard(i);
    if (i === selected) renderVerdict(item);
  }

  async function measureAll() {
    for (let i = 0; i < items.length; i++) await measureItem(i);
  }

  const measureSelectedSoon = debounce(() => measureItem(selected), 280);

  /* ============================================================ preview == */

  let frameReady = false;
  let pendingPreview = null;
  let previewToken = 0;
  let playing = false;
  let playTimer = null;

  function scaleFrame() {
    const w = tvScreenEl.clientWidth;
    if (!w) return;
    frameEl.style.transform = 'scale(' + (w / 1920) + ')';
  }

  if (global.ResizeObserver) {
    new ResizeObserver(scaleFrame).observe(tvScreenEl);
  } else {
    global.addEventListener('resize', scaleFrame);
  }

  function send(msg) {
    if (!frameReady) { pendingPreview = msg; return; }
    frameEl.contentWindow.postMessage(msg, global.location.origin);
  }

  /** The announcements the television would actually be showing today. */
  function tvDeck() {
    return items.filter(it => it.include !== false && !global.Live.showsToday(it));
  }

  function dwellMs(item) {
    const chars = (item.title || '').length + (item.body || '').length;
    const extra = (CFG.extraSecondsPerHundredChars || 0) * (chars / 100);
    return Math.round((CFG.slideSeconds + extra) * 1000);
  }

  function pushPreview() {
    const item = items[selected];

    if (!item) {
      previewPosEl.textContent = '';
      veilEl.hidden = true;
      verdictEl.textContent = 'With nothing here, the TV shows a welcome message.';
      verdictEl.className = 'verdict';
      send({ type: 'empty', token: ++previewToken });
      return;
    }

    const deck = tvDeck();
    const pos = deck.indexOf(item);

    if (pos >= 0) {
      previewPosEl.textContent = 'Slide ' + (pos + 1) + ' of ' + deck.length +
        ' · ' + Math.round(dwellMs(item) / 1000) + 's on screen';
    } else {
      previewPosEl.textContent = 'Not in today’s rotation';
    }

    const why = item.include === false
      ? 'Switched off — this is not on the TV'
      : global.Live.showsToday(item);
    veilEl.hidden = !why;
    if (why) veilTextEl.textContent = why;

    send({
      type: 'render',
      token: ++previewToken,
      index: pos >= 0 ? pos : 0,
      total: deck.length,
      slide: slidePayload(item),
    });

    renderVerdict(item);
  }

  const pushPreviewSoon = debounce(pushPreview, 260);

  /**
   * The preview reports back what it had to do to make the text fit. This is
   * the honest answer — it comes from the same measuring code the television
   * runs — where the length meter on the card is only an estimate.
   */
  /** The sentence under the preview, written from the measured result. */
  function renderVerdict(item) {
    const fit = item && item._fit;
    if (!fit) {
      verdictEl.className = 'verdict';
      verdictEl.textContent = 'Checking how this fits on the TV…';
      return;
    }
    if (fit.trimmed) {
      verdictEl.className = 'verdict is-over';
      verdictEl.textContent =
        'Too long. The TV cut this short and pointed people at the bulletin — ' +
        'shorten it here and the whole thing will show.';
    } else if (fit.px < SMALL_TEXT_PX) {
      verdictEl.className = 'verdict is-over';
      verdictEl.textContent =
        'All of it fits, but only by shrinking the text to ' + Math.round(fit.px) +
        'px — too small to read from a table across the hall. This needs shortening.';
    } else if (fit.px < COMFORTABLE_PX) {
      verdictEl.className = 'verdict is-tight';
      verdictEl.textContent =
        'Fits at ' + Math.round(fit.px) + 'px. Readable, but on the small side — ' +
        'cutting a sentence would carry better across the room.';
    } else {
      verdictEl.className = 'verdict is-good';
      verdictEl.textContent =
        'Fits at ' + Math.round(fit.px) + 'px — reads comfortably from across the hall.';
    }
  }

  global.addEventListener('message', e => {
    if (e.origin !== global.location.origin) return;
    if (!e.data || typeof e.data !== 'object') return;

    // The off-screen measuring frame. Its answers never touch the preview.
    if (measureFrameEl && e.source === measureFrameEl.contentWindow) {
      if (e.data.type === 'ready') {
        measureReady = true;
        measureAll();
      } else if (e.data.type === 'rendered') {
        const resolve = pendingMeasures.get(e.data.token);
        if (resolve) { pendingMeasures.delete(e.data.token); resolve(e.data); }
      }
      return;
    }

    if (e.source !== frameEl.contentWindow) return;

    if (e.data.type === 'ready') {
      frameReady = true;
      scaleFrame();
      if (pendingPreview) { const m = pendingPreview; pendingPreview = null; send(m); }
      else pushPreview();
    }
  });

  /* ------------------------------------------------------------- play mode -- */

  function stopPlaying() {
    playing = false;
    clearTimeout(playTimer);
    playBtn.textContent = 'Play all';
    send({ type: 'progress', ms: 0 });
  }

  function playStep() {
    const deck = tvDeck();
    if (!deck.length) { stopPlaying(); return; }

    const item = items[selected];
    let pos = deck.indexOf(item);
    pos = pos < 0 ? 0 : (pos + 1) % deck.length;

    selected = items.indexOf(deck[pos]);
    renderList();
    pushPreview();

    const ms = dwellMs(deck[pos]);
    send({ type: 'progress', ms });
    playTimer = setTimeout(playStep, ms);
  }

  playBtn.addEventListener('click', () => {
    if (playing) { stopPlaying(); return; }
    const deck = tvDeck();
    if (!deck.length) { toast('Nothing is switched on to play'); return; }
    playing = true;
    playBtn.textContent = 'Stop';

    // Start where the eye already is, if that slide is in the rotation.
    const item = items[selected];
    const ms = dwellMs(deck.indexOf(item) >= 0 ? item : deck[0]);
    if (deck.indexOf(item) < 0) { selected = items.indexOf(deck[0]); renderList(); pushPreview(); }
    send({ type: 'progress', ms });
    playTimer = setTimeout(playStep, ms);
  });

  $('prev-btn').addEventListener('click', () => { stopPlaying(); select(selected - 1); });
  $('next-btn').addEventListener('click', () => { stopPlaying(); select(selected + 1); });

  /* ============================================================== status == */

  /**
   * What can honestly be said about the screen in the hall.
   *
   * "Live" here means the published Sheet has been re-read and genuinely
   * contains these announcements. It does NOT mean the television has them:
   * the Pi fetches that same Sheet on its own clock, and nothing on this page
   * ever hears back from it. A Pi that is unplugged, or a hall with its wifi
   * down, looks from here exactly like one that is working perfectly.
   *
   * This used to read "Everything here is on the TV", which is a claim this
   * page is in no position to make. So it says what it knows — published —
   * and then says what follows from that, as an expectation with a clock on
   * it rather than as a fact.
   */
  function hallSentence() {
    if (!liveStamp || !liveStamp.at) return '';
    const at = new Date(liveStamp.at).getTime();
    if (isNaN(at)) return '';

    // The screen re-reads the Sheet on this interval; give it one full cycle
    // plus a little, since the publish and the poll are not in step.
    const cycleMs = Math.max(15, CFG.pollSeconds || 120) * 1000;
    const due = at + cycleMs + 30000;

    if (Date.now() < due) {
      const mins = Math.max(1, Math.ceil((due - Date.now()) / 60000));
      return 'The hall screen picks this up within about ' +
        (mins === 1 ? 'a minute' : mins + ' minutes') + '.';
    }
    return 'The hall screen should be showing this, if it is switched on.';
  }

  function renderStatus() {
    let state, pill, line, sub = '';

    if (!online) {
      state = 'offline';
      pill = 'No connection';
      line = 'Can’t reach the Sheet.';
      sub = (offlineMessage || '') +
        ' Your edits are safe in this browser and can be published once you’re back online.';
    } else if (publishing) {
      state = 'publishing';
      pill = 'Publishing';
      line = 'Sent to Google — waiting for it to appear.';
      sub = Date.now() - publishStartedAt > 45000
        ? 'Google can take a few minutes to republish the Sheet. Still checking…'
        : 'Checking the published Sheet every few seconds.';
    } else if (conflict) {
      state = 'conflict';
      pill = 'Out of step';
      line = 'Somebody else published while you were editing.';
      sub = 'Your changes are still here, but they were made against an older version.';
    } else if (liveSig === null) {
      state = 'loading';
      pill = 'Checking…';
      line = 'Reading what’s on the TV right now.';
    } else if (!isDirty()) {
      state = 'live';
      pill = 'Live';
      line = 'Everything here is published.';
      sub = [
        liveStamp && liveStamp.at
          ? 'Last published' + (liveStamp.by ? ' by ' + liveStamp.by : '') + ' ' + timeAgo(liveStamp.at) + '.'
          : '',
        hallSentence(),
      ].filter(Boolean).join(' ');
    } else {
      const c = changeSummary();
      state = 'draft';
      pill = 'Not live yet';
      line = c && c.total
        ? plural(c.total, 'change') + ' not on the TV yet.'
        : 'Changes not on the TV yet.';
      sub = changeSentence() + ' Press “Make it live” when you’re ready.';
    }

    statusbarEl.dataset.state = state;
    statusPillEl.textContent = pill;
    statusLineEl.textContent = line;
    statusSubEl.textContent = sub.trim();

    publishBtn.disabled = publishing || !isDirty() || !global.Live.isConfigured();
    publishBtn.classList.toggle('is-busy', publishing);
    discardBtn.hidden = !isDirty() || publishing;

    if (!global.Live.isConfigured()) {
      publishBtn.title = 'One-click publishing is not set up — use ⋯ → Copy rows for the Sheet.';
    } else {
      publishBtn.title = '';
    }
  }

  /* ------------------------------------------------------------- the banner -- */

  // Which message the banner is currently carrying. Only the code that put a
  // message there is allowed to take it away again — otherwise a routine
  // redraw would quietly clear something the editor still needs to answer.
  let bannerKind = null;

  function showBanner(kind, text, actions, warn) {
    bannerKind = kind;
    bannerTextEl.textContent = text;
    bannerActionsEl.innerHTML = '';
    actions.forEach(a => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn btn--sm ' + (a.primary ? 'btn--primary' : 'btn--ghost');
      b.textContent = a.label;
      b.addEventListener('click', a.onClick);
      bannerActionsEl.appendChild(b);
    });
    bannerEl.classList.toggle('banner--warn', !!warn);
    bannerEl.hidden = false;
  }

  function hideBanner() { bannerKind = null; bannerEl.hidden = true; }

  function renderBanner() {
    if (conflict) {
      showBanner('conflict',
        'The Sheet changed while you were working — somebody else published. ' +
        'You can start again from what is live, or keep what you have and publish over it.',
        [
          { label: 'Show me what’s live', onClick: () => { adoptLive(); toast('Loaded what is on the TV'); } },
          { label: 'Keep my version', primary: true, onClick: () => { conflict = false; renderAll(); } },
        ],
        true);
      return;
    }
    // A conflict that resolved itself is the one thing a redraw may clear.
    if (bannerKind === 'conflict') hideBanner();
  }

  /* ---------------------------------------------------------------- render -- */

  function renderAll() {
    renderList();
    renderStatus();
    renderBanner();
    pushPreview();
    saveDraft();
    // Anything that rebuilds the whole list may have brought in announcements
    // never measured before — a newsletter import, a fresh copy of the Sheet,
    // a duplicate. Measuring is cheap and skipping it would leave those cards
    // reading "Checking…" indefinitely.
    measureUnmeasured();
  }

  async function measureUnmeasured() {
    for (let i = 0; i < items.length; i++) {
      if (!items[i]._fit) await measureItem(i);
    }
  }

  /* ============================================================== editing == */

  listEl.addEventListener('input', e => {
    const field = e.target.dataset.f;
    if (!field || field === 'include') return;

    const card = e.target.closest('.item');
    const i = +card.dataset.i;
    const item = items[i];
    item[field] = e.target.value;

    // Typing a link with no caption yet: fill in a sensible one rather than
    // leaving the QR code on the TV captioned with nothing.
    if (field === 'link' && e.target.value && !item.linkLabel) {
      const pairs = global.Importer.linkPairs(e.target.value, '');
      item.linkLabel = pairs.map(p => global.Importer.defaultLabelFor(p.url)).join('\n');
      const labelEl = card.querySelector('[data-f="linkLabel"]');
      if (labelEl) labelEl.value = item.linkLabel;
    }

    patchCard(i);
    renderStatus();
    saveDraft();
    pushPreviewSoon();
    measureSelectedSoon();
  });

  listEl.addEventListener('change', e => {
    if (e.target.dataset.f !== 'include') return;
    const card = e.target.closest('.item');
    const i = +card.dataset.i;
    items[i].include = e.target.checked;
    stopPlaying();

    // Switching one off changes the whole rotation — every card's position in
    // it, and the preview's "slide 3 of 9" — so this is a full redraw.
    selected = i;
    renderAll();
  });

  listEl.addEventListener('click', e => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const card = btn.closest('.item');
    if (!card) return;
    const i = +card.dataset.i;
    const act = btn.dataset.act;

    if (act === 'select') { select(i); return; }

    if (act === 'shorten') { shortenOnCard(btn, i); return; }
    if (act === 'rewrite') { rewriteOnCard(i); return; }
    if (act === 'rewrite-retry') { rewriteOnCard(i, { noCache: true }); return; }

    if (act === 'tighten-use') {
      const panel = btn.closest('[data-tighten-panel]');
      const text = panel.querySelector('.tighten-panel__text').value;
      items[i].body = text;
      // The headline is taken only if the rewrite actually proposed a new one;
      // the panel records it so that accepting the body accepts the pair the
      // editor was shown, rather than half of it.
      if (panel.dataset.newTitle) items[i].title = panel.dataset.newTitle;
      panel.hidden = true;
      panel.innerHTML = '';
      delete panel.dataset.newTitle;
      renderAll();
      const fresh = cardAt(i);
      if (fresh) fresh.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      toast('Updated — check the preview before publishing');
      return;
    }
    if (act === 'tighten-discard') {
      const panel = btn.closest('[data-tighten-panel]');
      panel.hidden = true;
      panel.innerHTML = '';
      delete panel.dataset.newTitle;
      return;
    }

    if (act === 'up' && i > 0) {
      items.splice(i - 1, 0, items.splice(i, 1)[0]);
      if (selected === i) selected = i - 1;
      else if (selected === i - 1) selected = i;
      stopPlaying();
      renderAll();
      return;
    }

    if (act === 'down' && i < items.length - 1) {
      items.splice(i + 1, 0, items.splice(i, 1)[0]);
      if (selected === i) selected = i + 1;
      else if (selected === i + 1) selected = i;
      stopPlaying();
      renderAll();
      return;
    }

    if (act === 'duplicate') {
      const copy = Object.assign({}, items[i], {
        key: 'N' + (++keySeq), baseKey: null, baseSig: null,
      });
      items.splice(i + 1, 0, copy);
      selected = i + 1;
      stopPlaying();
      renderAll();
      return;
    }

    if (act === 'del') {
      const item = items[i];
      const named = String(item.title || '').trim() || 'this announcement';
      // Only worth asking about something that is actually on the TV now —
      // deleting a line you just typed shouldn't need a dialogue box.
      if (item.baseSig != null && !global.confirm(
        'Delete “' + named + '”?\n\nIt comes off the TV when you next make it live.')) return;
      items.splice(i, 1);
      if (selected >= items.length) selected = Math.max(0, items.length - 1);
      stopPlaying();
      renderAll();
    }
  });

  $('add-btn').addEventListener('click', () => {
    items.push(blankItem());
    selected = items.length - 1;
    stopPlaying();
    renderAll();
    const card = cardAt(selected);
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const t = card.querySelector('[data-f="title"]');
      if (t) t.focus();
    }
  });

  /* -------------------------------------------------------------- shorten -- */

  /**
   * Replace a long link with a short one via TinyURL's free, keyless
   * endpoint. This sends the destination address to a third party — fine for
   * the public signup and donation pages these point at, which is why it is a
   * button somebody presses rather than something that happens quietly.
   */
  function shortenLink(url) {
    return fetch('https://tinyurl.com/api-create.php?url=' + encodeURIComponent(url))
      .then(r => { if (!r.ok) throw new Error('TinyURL returned ' + r.status); return r.text(); })
      .then(t => {
        const short = t.trim();
        if (!/^https?:\/\/\S+$/.test(short)) throw new Error('Unexpected response');
        return short;
      });
  }

  /**
   * Shorten every dense link on one announcement, leaving the fine ones
   * alone. A single failure keeps that one link as it was rather than losing
   * the whole set over one bad request.
   */
  function shortenItemLinks(item) {
    const pairs = global.Importer.linkPairs(item.link, item.linkLabel);
    const dense = new Set(denseUrls(item));
    if (!dense.size) return Promise.resolve(false);
    return Promise.all(pairs.map(p =>
      dense.has(p.url)
        ? shortenLink(p.url).then(short => ({ url: short, label: p.label })).catch(() => p)
        : Promise.resolve(p)
    )).then(updated => {
      item.link = updated.map(p => p.url).join('\n');
      item.linkLabel = updated.map(p => p.label).join('\n');
      return true;
    });
  }

  /* ------------------------------------------------------- formatting bar -- */

  /**
   * The bold / italic / heading / bullet buttons over the announcement box.
   *
   * These write the same plain markers a person can type by hand — slide.js
   * reads "##", "-" and "**" and nothing else, and the Sheet holds plain text
   * either way. The buttons exist because nobody should have to know that, not
   * because there is a second, richer format hiding behind them.
   *
   * Wrapping applies to the selection; prefixes apply to whole lines, and
   * toggle off if the line already has one, so clicking "List" twice does not
   * leave "- - Vespers".
   */
  listEl.addEventListener('click', e => {
    const btn = e.target.closest('.fmtbar__btn');
    if (!btn) return;
    e.preventDefault();

    const card = btn.closest('.item');
    const ta = card && card.querySelector('textarea[data-f="body"]');
    if (!ta) return;

    const i = +card.dataset.i;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const value = ta.value;

    if (btn.dataset.wrap) {
      const mark = btn.dataset.wrap;
      const chosen = value.slice(start, end) || 'text';
      ta.value = value.slice(0, start) + mark + chosen + mark + value.slice(end);
      ta.selectionStart = start + mark.length;
      ta.selectionEnd = start + mark.length + chosen.length;
    } else if (btn.dataset.prefix) {
      const prefix = btn.dataset.prefix;
      // Grow the selection out to whole lines — a prefix belongs to a line,
      // not to wherever the cursor happened to be sitting in one.
      const from = value.lastIndexOf('\n', start - 1) + 1;
      const toRaw = value.indexOf('\n', end);
      const to = toRaw === -1 ? value.length : toRaw;

      const lines = value.slice(from, to).split('\n');
      const allHave = lines.every(l => l.startsWith(prefix));
      const next = lines.map(l => {
        const bare = l.replace(/^(?:#{2,4}\s+|[-•*·]\s+)/, '');
        return allHave ? bare : prefix + bare;
      }).join('\n');

      ta.value = value.slice(0, from) + next + value.slice(to);
      ta.selectionStart = from;
      ta.selectionEnd = from + next.length;
    }

    ta.focus();
    items[i].body = ta.value;
    patchCard(i);
    renderStatus();
    saveDraft();
    pushPreviewSoon();
    measureSelectedSoon();
  });

  /* --------------------------------------------------------------- rewrite -- */

  /**
   * Ask for this announcement laid out for the screen, then show the result
   * next to the original for the editor to accept or discard. format.js does
   * the asking; nothing here writes to the announcement — "Use this" (handled
   * in the click delegate above) does.
   *
   * The headline can come back changed as well as the body, because a
   * newsletter headline is often a sentence and a slide headline has to be
   * three or four words. Both are shown before either is used.
   */
  async function rewriteOnCard(i, opts) {
    const item = items[i];
    const card = cardAt(i);
    if (!item || !card) return;

    const btn = card.querySelector('[data-act="rewrite"]');
    const panel = card.querySelector('[data-tighten-panel]');
    if (!btn || !panel) return;

    const label = btn.innerHTML;
    btn.disabled = true;
    btn.classList.add('is-busy');
    btn.textContent = 'Working…';
    panel.hidden = true;

    try {
      const result = await global.Format.formatOne(item, null, opts);

      if (!result || !result.body) {
        toast('Nothing came back — try again in a moment.');
        return;
      }
      const same = result.body.trim() === String(item.body || '').trim() &&
                   result.title.trim() === String(item.title || '').trim();
      if (same) {
        toast('This one is already laid out as well as it can be.');
        return;
      }
      renderRewritePanel(panel, item, result);
    } catch (err) {
      console.error(err);
      toast(err.message || 'That did not work — try again, or lay it out by hand.');
    } finally {
      btn.disabled = false;
      btn.classList.remove('is-busy');
      btn.innerHTML = label;
    }
  }

  function renderRewritePanel(panel, item, result) {
    const titleChanged = result.title.trim() !== String(item.title || '').trim();
    panel.hidden = false;
    panel.dataset.newTitle = result.title;
    panel.innerHTML =
      '<p class="tighten-panel__source">' +
        '<span class="badge badge--ai">✨ AI</span> ' +
        'Laid out by Google’s Gemini, through the Sheet’s own script. ' +
        'Check it against the newsletter before using it — it is a suggestion, ' +
        'not a fact-checker.' +
      '</p>' +
      (titleChanged
        ? '<p class="tighten-panel__meta">Headline becomes <strong>' +
            esc(result.title) + '</strong></p>'
        : '') +
      '<p class="tighten-panel__meta">' + plural(result.body.length, 'character') +
        ', down from ' + String(item.body || '').length + '.</p>' +
      '<textarea class="tighten-panel__text" rows="6">' + esc(result.body) + '</textarea>' +
      '<div class="row">' +
        '<button class="btn btn--primary btn--sm" type="button" data-act="tighten-use">Use this</button>' +
        '<button class="btn btn--ghost btn--sm" type="button" data-act="rewrite-retry">Try again</button>' +
        '<button class="btn btn--ghost btn--sm" type="button" data-act="tighten-discard">Discard</button>' +
      '</div>';
  }

  function shortenOnCard(btn, i) {
    btn.disabled = true;
    btn.classList.add('is-busy');
    shortenItemLinks(items[i])
      .then(() => { renderAll(); toast('Shortened — the QR code will be much easier to scan'); })
      .catch(err => {
        console.error(err);
        btn.disabled = false;
        btn.classList.remove('is-busy');
        toast('Could not shorten that link — check the connection and try again');
      });
  }

  /**
   * Runs after every import, with no click needed: a dense QR code is a real
   * problem on the TV rather than an optional tidy-up. Anything that can't be
   * shortened keeps its warning and the manual button as a fallback.
   */
  function autoShortenAll(list) {
    list.forEach(item => {
      shortenItemLinks(item).then(changed => { if (changed) renderAll(); });
    });
  }

  /* ============================================================ importing == */

  importToggle.addEventListener('click', () => {
    importerEl.hidden = !importerEl.hidden;
    importToggle.textContent = importerEl.hidden
      ? 'Import the weekly email' : 'Close the importer';
    if (!importerEl.hidden) importerEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  function offerImport(found, label) {
    // Section headings are an artefact of reading the newsletter — a bold line
    // with nothing under it. They are not announcements, so they never reach
    // the list, where they would only have to be deleted by hand every week.
    const useful = found.filter(it => !it.isSection);

    if (!useful.length) {
      toast('Could not find any announcements in that');
      return;
    }

    const fresh = useful.map(it => Object.assign(blankItem(), {
      include: it.include !== false,
      title: it.title || '',
      body: it.body || '',
      link: it.link || '',
      linkLabel: it.linkLabel || '',
      end: it.end || '',
    }));

    autoShortenAll(fresh);

    if (!items.length) { applyImport(fresh, 'replace', label); return; }

    pendingImport = { list: fresh, label };
    landingTextEl.textContent =
      'Read ' + label + ' — found ' + plural(fresh.length, 'announcement') + '. ' +
      'There ' + (items.length === 1 ? 'is 1 announcement' : 'are ' + items.length + ' announcements') +
      ' here already. What should happen to ' + (items.length === 1 ? 'it' : 'them') + '?';
    landingEl.hidden = false;
    landingEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function applyImport(list, mode, label) {
    if (mode === 'replace') {
      items = list;
      selected = 0;
    } else {
      selected = items.length;
      items = items.concat(list);
    }
    landingEl.hidden = true;
    pendingImport = null;
    importerEl.hidden = true;
    importToggle.textContent = 'Import the weekly email';
    stopPlaying();
    renderAll();

    const off = list.filter(it => it.include === false).length;
    toast('Added ' + plural(list.length, 'announcement') + ' from ' + label +
      (off ? ' — ' + off + ' switched off for you to check' : ''));
    listEl.scrollIntoView({ behavior: 'smooth', block: 'start' });

    autoFormatImported(list);
  }

  /* ------------------------------------------------- laying out an import -- */

  let formatAbandoned = false;

  // Below this, an announcement is short enough that there is nothing for a
  // rewrite to do — a service time, a one-line notice, a "the office is shut
  // on Monday". Above it, prose with no shape to it is worth reshaping even
  // when it happens to fit.
  const SHORT_ENOUGH_CHARS = 320;

  /**
   * Is this announcement worth spending a request on?
   *
   * Three ways to qualify, and an announcement that qualifies on none of them
   * is left exactly as the newsletter wrote it:
   *
   *   - it does not fit, or only fits by shrinking below what reads across
   *     a hall — the measurement says so, having actually drawn it;
   *   - it is a long stretch of prose with no headings, bullets or contacts
   *     in it, which on a television is a grey wall however well it fits;
   *   - it still carries the newsletter's throat-clearing, which is worth
   *     removing on its own.
   */
  function needsLayout(item) {
    const body = String(item.body || '').trim();
    if (!body) return false;

    const level = meterFor(item).level;
    if (level === 'over' || level === 'tight') return true;

    if (body.length > SHORT_ENOUGH_CHARS && !global.Slide.hasStructure(body)) return true;

    return /\b(we are (pleased|excited|happy|delighted) to|please note that|as a reminder|stay tuned|click (on )?(this|the) link|more details (coming|will be))/i
      .test(body);
  }

  function showWorking(text) {
    workingTextEl.textContent = text;
    workingEl.hidden = false;
  }

  function hideWorking() { workingEl.hidden = true; }

  workingSkipEl.addEventListener('click', () => {
    formatAbandoned = true;
    hideWorking();
    toast('Left as imported — you can still tidy any announcement one at a time.');
  });

  /**
   * Lay the whole newsletter out for the screen, straight after importing it.
   *
   * This is the point of the feature: "import the weekly email" should end
   * with slides that are ready, not with twenty paragraphs of newsletter prose
   * to reshape by hand. It runs on its own, once, and only on the
   * announcements actually headed for the television — a switched-off row is
   * not going to be read by anybody, so it is not worth the wait.
   *
   * Every failure here is survivable and silent-ish by design: the imported
   * announcements are already in the list and already usable. Losing the
   * layout pass costs polish, not work.
   */
  async function autoFormatImported(list) {
    formatAbandoned = false;

    const state = await global.Format.available();
    if (!state.ready) {
      // Said once, quietly, rather than on every card: this is a setup step
      // somebody has to go and do, not something to nag about weekly.
      if (state.reason === 'no key') {
        toast('Tip: add a free Gemini key to the Sheet’s script and imports get ' +
              'laid out for the screen automatically. See sheet/Code.gs.');
      }
      return;
    }

    // Measure first, then send only what is actually not good enough.
    //
    // Sending the whole newsletter was wasteful and slow: two thirds of a
    // parish email is already short, already structured, and already reads
    // from across the hall, and asking a model to improve it spends Google's
    // free allowance to get the same words back. What is left — the long
    // ones, the walls of prose — is the part worth spending on.
    await measureUnmeasured();

    const targets = list.filter(it => it.include !== false && needsLayout(it));
    if (!targets.length) {
      toast('Those came in already fitting the screen — nothing needed changing.');
      return;
    }

    showWorking('Laying ' + plural(targets.length, 'announcement') + ' out for the screen…');

    // What was sent, remembered, so that anything typed into a card during the
    // fifteen seconds this takes is not silently overwritten when the answer
    // lands. Somebody's own words always win over a suggestion.
    const sentBodies = targets.map(it => it.body);

    try {
      const out = await global.Format.format(targets, msg => showWorking(msg));
      if (formatAbandoned) return;

      let changed = 0;
      let skipped = 0;
      targets.forEach((item, n) => {
        const r = out[n];
        if (!r || !r.body) return;
        if (item.body !== sentBodies[n]) { skipped++; return; }
        if (r.body.trim() === item.body.trim() && r.title.trim() === item.title.trim()) return;
        item.body = r.body;
        if (r.title) item.title = r.title;
        changed++;
      });

      renderAll();

      const stillLong = await tightenWhatDidNotFit(targets);

      hideWorking();
      renderAll();
      toast(changed
        ? plural(changed, 'announcement') + ' laid out for the screen — check them over before publishing.' +
          (skipped ? ' ' + skipped + ' left alone because you had edited ' +
                     (skipped === 1 ? 'it' : 'them') + '.' : '') +
          (stillLong ? ' ' + plural(stillLong, 'one') + ' still too long — those need a human cut.' : '')
        : 'Those were already in good shape for the screen.');
    } catch (err) {
      console.error(err);
      hideWorking();
      renderAll();
      if (!formatAbandoned) {
        // The import itself never depended on this. Every announcement is in
        // the list, split out of the newsletter, with its schedule and its
        // contacts already laid out by the importer's own rules — none of
        // which needs Google, a key or an allowance. What has been lost is
        // the shortening, so say that, and say where the tools are.
        const quota = /allowance/i.test(err.message);
        toast(quota
          ? 'Google’s free allowance is used up for today — it resets at midnight ' +
            'Pacific. Everything imported fine and is ready to edit by hand; use the ' +
            'B / Heading / List buttons and watch the Slide space bar.'
          : 'Could not shorten these automatically (' + err.message + '). They are ' +
            'all here and laid out — edit them by hand and watch the Slide space bar.');
      }
    }
  }

  /**
   * A second pass over whatever still does not fit.
   *
   * The first pass writes blind — it has never seen the slide. This one runs
   * after every announcement has been drawn at a real 1920x1080 and measured,
   * so it can hand back a number: this rendered at 30px, it needs to lose
   * about half its length. "Make it shorter" already produced something
   * shorter that still did not fit; a budget is the thing that was missing.
   *
   * It is also the only pass allowed to leave detail out. A notice that is all
   * dates, tuition tiers and instructor names cannot be compressed by better
   * writing — somebody has to decide what goes to the bulletin instead.
   *
   * Returns how many are still too long after it, which is an honest number
   * and sometimes not zero: some announcements genuinely need a person.
   */
  async function tightenWhatDidNotFit(candidates) {
    if (formatAbandoned) return 0;

    await measureUnmeasured();
    for (const item of candidates) await measureItem(items.indexOf(item));

    const tooLong = candidates.filter(it => meterFor(it).level === 'over');
    if (!tooLong.length) return 0;

    showWorking(plural(tooLong.length, 'announcement') + ' still too long — trimming ' +
                (tooLong.length === 1 ? 'it' : 'them') + ' to fit…');

    // How much has to go, from what the screen actually did. A slide that had
    // to shrink to 30px against a 46px floor is carrying roughly (30/46)^2 of
    // the text it has room for — area, not height, because narrower text also
    // reflows onto fewer lines. Floored well above nothing so the budget stays
    // a real announcement rather than a headline.
    const withBudgets = tooLong.map(it => {
      const fit = it._fit || {};
      const px = fit.px || SMALL_TEXT_PX;
      const ratio = fit.trimmed ? 0.55 : Math.min(0.9, Math.pow(px / COMFORTABLE_PX, 2));
      return Object.assign({}, it, {
        maxChars: Math.max(180, Math.round(String(it.body || '').length * ratio)),
      });
    });

    const sent = tooLong.map(it => it.body);

    try {
      const out = await global.Format.format(withBudgets, msg => showWorking(msg),
        { mode: 'tighten' });
      if (formatAbandoned) return 0;

      tooLong.forEach((item, n) => {
        const r = out[n];
        if (!r || !r.body || item.body !== sent[n]) return;
        item.body = r.body;
        if (r.title) item.title = r.title;
      });

      for (const item of tooLong) await measureItem(items.indexOf(item));
      return tooLong.filter(it => meterFor(it).level === 'over').length;
    } catch (err) {
      // The first pass already landed and is already an improvement. Losing
      // the second one leaves a few announcements flagged "Too long", which is
      // exactly what the editor is for.
      console.warn('[format] tightening pass did not run:', err.message);
      return tooLong.length;
    }
  }

  $('landing-replace').addEventListener('click', () => {
    if (pendingImport) applyImport(pendingImport.list, 'replace', pendingImport.label);
  });
  $('landing-append').addEventListener('click', () => {
    if (pendingImport) applyImport(pendingImport.list, 'append', pendingImport.label);
  });
  $('landing-cancel').addEventListener('click', () => {
    pendingImport = null;
    landingEl.hidden = true;
  });

  function handleFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        offerImport(global.Importer.splitEml(String(reader.result)), file.name);
      } catch (err) {
        console.error(err);
        toast('Could not read that file — is it a .eml?');
      }
    };
    reader.onerror = () => toast('Could not read that file');
    reader.readAsText(file);
  }

  fileEl.addEventListener('change', e => handleFile(e.target.files[0]));
  $('pick-btn').addEventListener('click', () => fileEl.click());

  ['dragenter', 'dragover'].forEach(ev =>
    dropEl.addEventListener(ev, e => { e.preventDefault(); dropEl.classList.add('is-over'); }));
  ['dragleave', 'drop'].forEach(ev =>
    dropEl.addEventListener(ev, e => { e.preventDefault(); dropEl.classList.remove('is-over'); }));
  dropEl.addEventListener('drop', e => handleFile(e.dataTransfer.files && e.dataTransfer.files[0]));

  $('split-btn').addEventListener('click', () => {
    const raw = pasteEl.value.trim();
    if (!raw) { toast('Paste the email first'); return; }
    offerImport(
      global.Importer.split(raw).map(it => Object.assign({ include: true, isSection: false }, it)),
      'the pasted text');
  });

  /* =============================================================== copying == */

  async function copy(includeHeader) {
    const tsv = global.Importer.toTsv(items, { includeHeader });
    const n = global.Importer.toMatrix(items).length;
    try {
      await navigator.clipboard.writeText(tsv);
      toast('Copied ' + plural(n, 'row') + ' — delete the old rows in the Sheet, then paste at A2');
    } catch (err) {
      const ta = document.createElement('textarea');
      ta.value = tsv;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      toast(ok
        ? 'Copied ' + plural(n, 'row') + ' — delete the old rows in the Sheet, then paste at A2'
        : 'Could not copy automatically');
    }
  }

  $('copy-btn').addEventListener('click', () => copy(false));
  $('copy-header-btn').addEventListener('click', () => copy(true));

  // A <details> menu left hanging open after you have clicked elsewhere looks
  // broken. Close it the way every other menu on a computer closes.
  document.addEventListener('click', e => {
    document.querySelectorAll('details.menu[open]').forEach(m => {
      if (!m.contains(e.target)) m.open = false;
    });
  });

  /* ============================================================ publishing == */

  /**
   * Send the draft to the Sheet.
   *
   * What comes back from Google is nothing at all — an Apps Script web app
   * cannot answer a browser in a way the browser is allowed to read. So this
   * does not claim success. It records what it sent, switches to "Publishing",
   * and then watches the published Sheet until those exact announcements turn
   * up in it. Only then does anything say "Live".
   */
  async function doPublish() {
    if (!global.Live.isConfigured()) {
      toast('One-click publishing is not set up — use ⋯ → Copy rows for the Sheet');
      return;
    }

    const matrix = global.Importer.toMatrix(items);
    const c = changeSummary();

    const question = 'Put this on the TV in the hall?\n\n' +
      changeSentence() + '\n\n' +
      'It replaces everything currently in the Sheet with these ' +
      plural(matrix.length, 'row') + '.';
    if (c && c.total && !global.confirm(question)) return;

    let who = editorName();
    if (!who) who = askEditorName();

    publishing = true;
    publishExpectSig = global.Live.confirmSig(global.Live.matrixToItems(matrix));
    publishStartedAt = Date.now();
    hideBanner();
    renderStatus();

    try {
      await global.Live.publish(matrix, who);
      toast('Sent to Google — watching the Sheet for it to appear');
      schedulePoll(3000);
    } catch (err) {
      // A genuine network failure. A wrong secret or a stale deployment URL
      // does NOT land here — Google answers happily either way — which is
      // exactly why the watching below exists.
      console.error(err);
      publishing = false;
      renderStatus();
      showBanner('publish-error',
        'Could not reach Google at all. Check the connection, or copy the rows ' +
        'into the Sheet by hand from the ⋯ menu.',
        [{ label: 'Dismiss', onClick: hideBanner }],
        true);
    }
  }

  publishBtn.addEventListener('click', doPublish);

  discardBtn.addEventListener('click', () => {
    if (!global.confirm('Throw away your changes and go back to what is on the TV?')) return;
    adoptLive();
    toast('Back to what is on the TV');
  });

  /* -------------------------------------------------- watching the Sheet -- */

  let pollTimer = null;

  function schedulePoll(ms) {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(poll, ms);
  }

  async function poll() {
    try {
      const live = await global.Live.fetchLive();
      online = true;
      offlineMessage = '';
      onLive(live);
    } catch (err) {
      online = false;
      offlineMessage = err.message;
      renderStatus();
    }
    schedulePoll(publishing ? 5000 : Math.max(15, CFG.pollSeconds || 120) * 1000);
  }

  function onLive(live) {
    const changedOnSheet = live.sig !== liveSig;
    const wasClean = liveItems !== null && !isDirty();

    liveStamp = live.stamp;

    if (!changedOnSheet) {
      // Still waiting on a publish that hasn't been republished by Google yet.
      if (publishing && Date.now() - publishStartedAt > PUBLISH_PATIENCE_MS) givePublishUp();
      renderStatus();
      return;
    }

    liveItems = live.items;
    liveSig = live.sig;

    if (publishing) {
      if (global.Live.confirmSig(live.items) === publishExpectSig) {
        publishing = false;
        hideBanner();
        adoptLive();
        toast('It’s live — the TV picks it up within a couple of minutes');
        return;
      }
      // The Sheet changed, but into something we didn't send: somebody else
      // published in the meantime and their version won.
      publishing = false;
      conflict = true;
      renderAll();
      return;
    }

    if (wasClean) {
      // Nothing of ours to lose — just follow along with whoever published.
      adoptLive();
      if (booted) toast('Someone else published — this page is now showing what is live');
      return;
    }

    conflict = true;
    renderAll();
  }

  function givePublishUp() {
    publishing = false;
    renderStatus();
    showBanner('publish-slow',
      'Google still hasn’t republished the Sheet with your changes. That is ' +
      'usually just slowness, but it can also mean the publish password in ' +
      'config.js no longer matches the Sheet’s script. Open the Sheet and see ' +
      'whether the rows are there.',
      [
        { label: 'Open the Sheet', onClick: () => { if (CFG.sheetEditUrl) global.open(CFG.sheetEditUrl, '_blank', 'noopener'); } },
        { label: 'Keep checking', primary: true, onClick: () => { publishing = true; publishStartedAt = Date.now(); hideBanner(); renderStatus(); schedulePoll(3000); } },
      ],
      true);
  }

  $('reload-btn').addEventListener('click', async () => {
    if (isDirty() && !global.confirm(
      'Reload from the Sheet? Your unpublished changes will be lost.')) return;
    try {
      const live = await global.Live.fetchLive();
      online = true;
      liveItems = live.items;
      liveSig = live.sig;
      liveStamp = live.stamp;
      conflict = false;
      adoptLive();
      toast('Loaded what is on the TV');
    } catch (err) {
      online = false;
      offlineMessage = err.message;
      renderStatus();
      toast('Could not reach the Sheet');
    }
  });

  /* ================================================================ sample == */

  const SAMPLE = [
    'View this email in your browser',
    '',
    'ST. ELIAS ORTHODOX CHURCH',
    'Weekly News — Sunday, September 6',
    '',
    'PARISH PICNIC',
    'Saturday, September 12 at noon in Riverside Park. Bring a dish to share.',
    'Games for the children, and the grill is already spoken for. Please let us',
    'know you are coming so we know how much to buy.',
    'Sign up here: https://forms.gle/stEliasPicnic',
    '',
    'CHURCH SCHOOL REGISTRATION',
    'Classes resume Sunday, September 7, right after Liturgy. Preschool through',
    '12th grade. Registration closes September 5.',
    'https://forms.gle/stEliasSchool',
    '',
    'Choir Rehearsal',
    'Thursdays at 7:00 pm in the nave. No audition and no experience needed —',
    'if you can carry a tune, Nadia will find a place for you.',
    '',
    'FOOD DRIVE FOR THE PANTRY',
    'Non-perishables in the narthex bin all month. Most needed right now: rice,',
    'dried beans, cooking oil, and canned fish.',
    '',
    '---',
    'Copyright © 2026 St. Elias Orthodox Church, All rights reserved.',
    'Unsubscribe',
  ].join('\n');

  $('sample-btn').addEventListener('click', () => {
    pasteEl.value = SAMPLE;
    toast('Sample loaded — now press “Read this text”');
  });

  /* ================================================================== boot == */

  editorChip.addEventListener('click', askEditorName);

  /**
   * The two sticky bars at the top decide where everything else below them
   * can stick. Their heights are not fixed — the status line wraps onto a
   * third row on a narrow screen — so they are measured rather than guessed,
   * otherwise the preview would tuck itself under the status bar exactly when
   * the screen is smallest and can least afford it.
   */
  function trackBarHeights() {
    const appbarEl = document.querySelector('.appbar');
    const set = () => {
      const root = document.documentElement.style;
      root.setProperty('--appbar-h', appbarEl.offsetHeight + 'px');
      root.setProperty('--statusbar-h', statusbarEl.offsetHeight + 'px');
    };
    set();
    if (global.ResizeObserver) {
      const ro = new ResizeObserver(set);
      ro.observe(appbarEl);
      ro.observe(statusbarEl);
    } else {
      global.addEventListener('resize', set);
    }
  }

  global.addEventListener('beforeunload', e => {
    if (!isDirty() || publishing) return;
    e.preventDefault();
    e.returnValue = '';
  });

  /**
   * Find out once, in the background, whether the Sheet's script can lay
   * announcements out — so the buttons that depend on it can say so up front
   * rather than the editor only learning it after clicking and waiting. Never
   * blocks boot; whatever answer comes back just updates the buttons next
   * time it's safe to redraw one.
   */
  function checkAiStatus() {
    global.Format.available().then(state => {
      aiStatus = state.ready ? 'ready' : 'unavailable';
      aiMessage = state.message || '';
      // Rebuilding the selected card's markup would blow away whatever
      // someone is mid-typing into it — safe to do only when nothing in it
      // currently has the keyboard's attention.
      const active = document.activeElement;
      if (!active || !listEl.contains(active)) renderList();
    });
  }

  async function boot() {
    trackBarHeights();
    renderEditorChip();
    checkAiStatus();

    if (CFG.sheetEditUrl) {
      sheetLink.href = CFG.sheetEditUrl;
      sheetLink.hidden = false;
    }

    renderStatus();

    let live = null;
    try {
      live = await global.Live.fetchLive();
      online = true;
    } catch (err) {
      online = false;
      offlineMessage = err.message;
      console.warn('[editor] could not read the Sheet:', err.message);
    }

    const draft = loadDraft();

    if (live) {
      liveItems = live.items;
      liveSig = live.sig;
      liveStamp = live.stamp;
      items = fromLive(live.items);

      if (draft && draft.liveSig === live.sig && global.Live.deckSig(draft.items) !== live.sig) {
        // Unpublished work from an earlier visit, made against this same
        // version of the Sheet. Nothing has moved underneath it, so it is
        // safe to offer back.
        items = draft.items;
        showBanner('restored-draft',
          'You have changes here from ' + timeAgo(draft.savedAt) +
          ' that were never made live.',
          [
            { label: 'Throw them away', onClick: () => { hideBanner(); adoptLive(); } },
            { label: 'Keep editing them', primary: true, onClick: hideBanner },
          ]);
      } else if (draft && draft.liveSig !== live.sig &&
                 global.Live.deckSig(draft.items) !== draft.liveSig) {
        // Unpublished work, but the Sheet has moved on since it was written.
        items = draft.items;
        conflict = true;
      } else if (draft) {
        clearDraft();
      }
    } else if (draft) {
      items = draft.items;
      liveSig = draft.liveSig;
      liveItems = null;
    }

    booted = true;
    renderAll();
    schedulePoll(Math.max(15, CFG.pollSeconds || 120) * 1000);
  }

  boot();

})(window);
