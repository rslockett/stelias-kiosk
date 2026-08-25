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
        items, liveSig, savedAt: Date.now(),
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

  const METER_NOTES = {
    good: 'Comfortable length',
    tight: 'Fits, but the text will be small',
    over: 'Too long — the TV will cut it short',
  };

  /**
   * How full this slide is.
   *
   * The bar comes from counting characters, which is an estimate but is cheap
   * enough to run on every announcement in the list. The verdict is upgraded
   * to the truth once the preview has actually drawn the slide and reported
   * what it had to do to make it fit — a guess and a measurement disagreeing
   * on screen is worse than either one alone.
   */
  function meterFor(item) {
    const v = global.Slide.lengthVerdict(item.title, item.body, !!item.link);
    const level = item._fit
      ? (item._fit.trimmed ? 'over' : (item._fit.atFloor ? 'tight' : 'good'))
      : v.level;
    return {
      level,
      pct: Math.min(100, Math.round((v.chars / v.budget) * 100)),
      note: METER_NOTES[level],
    };
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

  function editHtml(item) {
    const warn = linkWarning(item);
    return '' +
      '<div class="item__edit">' +

        '<div class="field">' +
          '<label class="field__label">Headline</label>' +
          '<input type="text" data-f="title" value="' + esc(item.title) + '">' +
        '</div>' +

        '<div class="field">' +
          '<label class="field__label">Announcement ' +
            '<small>— a line starting with “-” becomes a bullet</small></label>' +
          '<textarea data-f="body">' + esc(item.body) + '</textarea>' +
          '<div class="meter">' +
            '<span class="meter__track"><span class="meter__fill"></span></span>' +
            '<span class="meter__note"></span>' +
            '<button class="btn btn--ghost btn--sm meter__tighten" type="button" data-act="tighten">' +
              'Tighten it' +
            '</button>' +
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
    const fill = card.querySelector('.meter__fill');
    if (!fill) return;
    const m = meterFor(item);
    fill.style.width = m.pct + '%';
    card.querySelector('.meter__note').textContent = m.note;
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
      slide: {
        title: item.title,
        body: item.body,
        link: item.link,
        linkLabel: item.linkLabel,
        image: item.image,
      },
    });
  }

  const pushPreviewSoon = debounce(pushPreview, 260);

  /**
   * The preview reports back what it had to do to make the text fit. This is
   * the honest answer — it comes from the same measuring code the television
   * runs — where the length meter on the card is only an estimate.
   */
  function onRendered(msg) {
    if (msg.token !== previewToken) return;      // a stale reply; ignore it
    if (msg.empty) return;                       // the welcome screen; nothing to judge

    const item = items[selected];
    if (!item) return;

    // The measured answer, kept on the announcement so its card in the list
    // stops estimating and starts reporting.
    item._fit = { trimmed: !!msg.trimmed, atFloor: !!msg.atFloor };
    patchCard(selected);

    if (msg.trimmed) {
      verdictEl.className = 'verdict is-over';
      verdictEl.textContent =
        'Too long. The TV cut this short and pointed people at the bulletin — ' +
        'shorten it here and the whole thing will show.';
    } else if (msg.atFloor) {
      verdictEl.className = 'verdict is-tight';
      verdictEl.textContent =
        'This fits, but only at the smallest size allowed. Trimming a sentence ' +
        'would make it easier to read from across the hall.';
    } else {
      verdictEl.className = 'verdict is-good';
      verdictEl.textContent = 'Fits comfortably, at a size that reads from across the hall.';
    }
  }

  global.addEventListener('message', e => {
    if (e.origin !== global.location.origin) return;
    if (e.source !== frameEl.contentWindow) return;
    if (!e.data || typeof e.data !== 'object') return;

    if (e.data.type === 'ready') {
      frameReady = true;
      scaleFrame();
      if (pendingPreview) { const m = pendingPreview; pendingPreview = null; send(m); }
      else pushPreview();
    } else if (e.data.type === 'rendered') {
      onRendered(e.data);
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
      line = 'Everything here is on the TV.';
      sub = liveStamp && liveStamp.at
        ? 'Last published' + (liveStamp.by ? ' by ' + liveStamp.by : '') + ' ' + timeAgo(liveStamp.at) + '.'
        : '';
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
    if (act === 'tighten' || act === 'tighten-retry') { tightenOnCard(i); return; }

    if (act === 'tighten-use') {
      const panel = btn.closest('[data-tighten-panel]');
      const text = panel.querySelector('.tighten-panel__text').value;
      items[i].body = text;
      panel.hidden = true;
      panel.innerHTML = '';
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

  /* --------------------------------------------------------------- tighten -- */

  /**
   * Ask for a shorter version of one announcement's body, then show it next
   * to the original for the editor to accept or discard. See tighten.js for
   * how the suggestion itself is produced — on-device AI where the browser
   * has it ready, wording rules everywhere else. Nothing here writes to the
   * announcement; "Use this" (handled in the click delegate above) does.
   */
  async function tightenOnCard(i) {
    const item = items[i];
    const card = cardAt(i);
    if (!item || !card) return;

    const btn = card.querySelector('[data-act="tighten"]');
    const panel = card.querySelector('[data-tighten-panel]');
    if (!btn || !panel) return;

    btn.disabled = true;
    btn.classList.add('is-busy');
    panel.hidden = true;

    try {
      const v = global.Slide.lengthVerdict(item.title, item.body, !!item.link);
      const result = await global.Tighten.suggest(item, v.budget);

      if (!result || !result.text || result.text.trim() === String(item.body || '').trim()) {
        toast('Could not find anything to trim there');
        return;
      }
      renderTightenPanel(panel, result);
    } catch (err) {
      console.error(err);
      toast('Could not tighten that just now');
    } finally {
      btn.disabled = false;
      btn.classList.remove('is-busy');
    }
  }

  function renderTightenPanel(panel, result) {
    const isAi = result.engine !== 'rules';
    panel.hidden = false;
    panel.innerHTML =
      '<p class="tighten-panel__source">' +
        '<span class="badge ' + (isAi ? 'badge--ai' : 'badge--rules') + '">' +
          (isAi ? 'AI' : 'No AI') +
        '</span> ' +
        (isAi
          ? 'Written by Chrome’s on-device AI, running on this computer — nothing was sent anywhere.'
          : 'Shortened by removing filler phrases, not by AI — the same everywhere, every time.') +
      '</p>' +
      '<p class="tighten-panel__meta">' + plural(result.text.length, 'character') +
        ' — read it over before using it, the same as anything else here.</p>' +
      '<textarea class="tighten-panel__text" rows="4">' + esc(result.text) + '</textarea>' +
      '<div class="row">' +
        '<button class="btn btn--primary btn--sm" type="button" data-act="tighten-use">Use this</button>' +
        '<button class="btn btn--ghost btn--sm" type="button" data-act="tighten-retry">Try again</button>' +
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

  async function boot() {
    trackBarHeights();
    renderEditorChip();

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
