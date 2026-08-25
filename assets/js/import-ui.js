/* ============================================================================
   import-ui.js — the screen around the importer
   ========================================================================== */

(function (global) {
  'use strict';

  const $ = id => document.getElementById(id);

  const pasteEl = $('paste');
  const cardsEl = $('cards');
  const emptyEl = $('cards-empty');
  const addBtn = $('add-btn');
  const toastEl = $('toast');
  const dropEl = $('drop');
  const fileEl = $('file');
  const bulkEl = $('bulk');
  const countEl = $('count');
  const sourceNoteEl = $('source-note');

  // Two places on the page offer "copy rows" — the primary spot when one-click
  // publish isn't configured, and a fallback tucked in a <details> when it is.
  // Both stay wired up, always, so copy-paste never stops being an option.
  const copyBtns = [$('copy-btn'), $('copy-btn-main')].filter(Boolean);
  const copyHeaderBtns = [$('copy-header-btn'), $('copy-header-btn-main')].filter(Boolean);

  const publishBlockEl = $('publish-block');
  const copyBlockEl = $('copy-block');
  const publishBtn = $('publish-btn');
  const publishStatusEl = $('publish-status');
  const openSheetLink = $('open-sheet-link');

  let items = [];

  /* ---------------------------------------------------------------- toast -- */

  let toastTimer;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('is-shown');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('is-shown'), 3000);
  }

  /* ---------------------------------------------------------------- meter -- */

  function meterFor(item) {
    const v = global.Slide.lengthVerdict(item.title, item.body, !!item.link);
    return {
      level: v.level,
      pct: Math.min(100, Math.round((v.chars / v.budget) * 100)),
      note: {
        good:  'Fits comfortably',
        tight: 'Fits, but it will be small',
        over:  'Too long — will be trimmed on the TV',
      }[v.level],
    };
  }

  function refreshMeter(card, item) {
    const m = meterFor(item);
    card.querySelector('.meter__fill').style.width = m.pct + '%';
    card.querySelector('.meter__note').textContent = m.note;
    card.classList.remove('is-good', 'is-tight', 'is-over', 'card--tight', 'card--over');
    card.classList.add('is-' + m.level);
    if (m.level !== 'good') card.classList.add('card--' + m.level);
  }

  /* ----------------------------------------------------------- link check -- */

  /**
   * Warn about links that will make a QR code nobody can scan. A long
   * tracking URL produces a very dense symbol, and dense symbols need the
   * viewer to walk right up to the television.
   */
  function linkWarning(item) {
    if (!item.link) return '';
    if (global.Eml && global.Eml.isTrackingUrl(item.link)) {
      return 'This is a click-tracking link, ' + item.link.length + ' characters long. ' +
             'Its QR code will be too dense to scan from across the hall — ' +
             'replace it with the plain web address it points to.';
    }
    const modules = global.Slide.qrDensity(item.link);
    if (modules >= 45) {
      return 'This link is long (' + item.link.length + ' characters), so the QR code ' +
             'will be dense. A shorter address scans from further away.';
    }
    return '';
  }

  /* ---------------------------------------------------------------- cards -- */

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function cardHtml(item, i, total) {
    const warn = linkWarning(item);
    return '' +
      '<div class="card__top">' +
        '<label class="tick">' +
          '<input type="checkbox" data-f="include"' + (item.include !== false ? ' checked' : '') + '>' +
          '<span>Show on the TV</span>' +
        '</label>' +
        (item.isSection ? '<span class="tag">section heading</span>' : '') +
        '<span class="card__tools">' +
          '<button class="btn btn--ghost btn--sm" data-act="up"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
          '<button class="btn btn--ghost btn--sm" data-act="down"' + (i === total - 1 ? ' disabled' : '') + '>↓</button>' +
          '<button class="btn btn--ghost btn--sm" data-act="del">Remove</button>' +
        '</span>' +
      '</div>' +

      '<div class="field">' +
        '<label class="field__label">Title</label>' +
        '<input type="text" data-f="title" value="' + esc(item.title) + '">' +
      '</div>' +

      '<div class="field">' +
        '<label class="field__label">Body</label>' +
        '<textarea data-f="body">' + esc(item.body) + '</textarea>' +
        '<div class="meter">' +
          '<span class="meter__track"><span class="meter__fill"></span></span>' +
          '<span class="meter__note"></span>' +
        '</div>' +
      '</div>' +

      '<div class="grid3">' +
        '<div class="field">' +
          '<label class="field__label">Signup link (becomes a QR code)</label>' +
          '<input type="text" data-f="link" value="' + esc(item.link) + '" placeholder="https://forms.gle/…">' +
        '</div>' +
        '<div class="field">' +
          '<label class="field__label">QR caption</label>' +
          '<input type="text" data-f="linkLabel" value="' + esc(item.linkLabel) + '" placeholder="Scan to sign up">' +
        '</div>' +
        '<div class="field">' +
          '<label class="field__label">Remove after</label>' +
          '<input type="text" data-f="end" value="' + esc(item.end || '') + '" placeholder="2026-09-12">' +
        '</div>' +
      '</div>' +

      (warn ? '<p class="linkwarn">⚠ ' + esc(warn) + '</p>' : '');
  }

  function render() {
    const total = items.length;
    const on = items.filter(it => it.include !== false).length;

    emptyEl.hidden = total > 0;
    addBtn.hidden = total === 0;
    bulkEl.hidden = total === 0;
    copyBtns.forEach(b => { b.disabled = on === 0; });
    copyHeaderBtns.forEach(b => { b.disabled = on === 0; });
    if (publishBtn) publishBtn.disabled = on === 0;
    countEl.textContent = total ? on + ' of ' + total + ' will go on the TV' : '';

    cardsEl.innerHTML = '';
    items.forEach((item, i) => {
      const card = document.createElement('article');
      card.className = 'card' + (item.include === false ? ' card--off' : '');
      card.dataset.i = i;
      card.innerHTML = cardHtml(item, i, total);
      cardsEl.appendChild(card);
      refreshMeter(card, item);
    });
  }

  /* --------------------------------------------------------------- events -- */

  cardsEl.addEventListener('input', e => {
    const field = e.target.dataset.f;
    if (!field || field === 'include') return;
    const card = e.target.closest('.card');
    const item = items[+card.dataset.i];
    item[field] = e.target.value;

    if (field === 'link' && e.target.value && !item.linkLabel) {
      item.linkLabel = global.KIOSK_CONFIG.defaultQrLabel;
      card.querySelector('[data-f="linkLabel"]').value = item.linkLabel;
    }
    refreshMeter(card, item);

    // The link warning has to be recomputed, but re-rendering everything would
    // steal focus mid-typing. Update just this card's warning line.
    if (field === 'link') {
      const warn = linkWarning(item);
      let el = card.querySelector('.linkwarn');
      if (warn && !el) {
        el = document.createElement('p');
        el.className = 'linkwarn';
        card.appendChild(el);
      }
      if (el) {
        if (warn) el.textContent = '⚠ ' + warn;
        else el.remove();
      }
    }
  });

  cardsEl.addEventListener('change', e => {
    if (e.target.dataset.f !== 'include') return;
    const card = e.target.closest('.card');
    items[+card.dataset.i].include = e.target.checked;
    card.classList.toggle('card--off', !e.target.checked);
    const on = items.filter(it => it.include !== false).length;
    countEl.textContent = on + ' of ' + items.length + ' will go on the TV';
    copyBtns.forEach(b => { b.disabled = on === 0; });
    copyHeaderBtns.forEach(b => { b.disabled = on === 0; });
    if (publishBtn) publishBtn.disabled = on === 0;
  });

  cardsEl.addEventListener('click', e => {
    const act = e.target.dataset.act;
    if (!act) return;
    const i = +e.target.closest('.card').dataset.i;
    if (act === 'del') items.splice(i, 1);
    else if (act === 'up' && i > 0) items.splice(i - 1, 0, items.splice(i, 1)[0]);
    else if (act === 'down' && i < items.length - 1) items.splice(i + 1, 0, items.splice(i, 1)[0]);
    render();
  });

  $('all-btn').addEventListener('click', () => {
    items.forEach(it => { it.include = true; });
    render();
  });
  $('none-btn').addEventListener('click', () => {
    items.forEach(it => { it.include = false; });
    render();
  });

  /* ---------------------------------------------------------------- input -- */

  function afterSplit(found, label) {
    items = found;
    render();
    if (!items.length) {
      toast('Could not find any announcements in that');
      return;
    }
    const on = items.filter(it => it.include !== false).length;
    sourceNoteEl.innerHTML =
      '<div class="note"><p>Read <strong>' + esc(label) + '</strong> — found ' +
      items.length + ' sections, ' + on + ' ticked for the TV. ' +
      'Have a look through them below.</p></div>';
    toast('Found ' + items.length + ' sections');
    document.getElementById('cards').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function handleFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        afterSplit(global.Importer.splitEml(String(reader.result)), file.name);
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
    dropEl.addEventListener(ev, e => {
      e.preventDefault();
      dropEl.classList.add('is-over');
    }));

  ['dragleave', 'drop'].forEach(ev =>
    dropEl.addEventListener(ev, e => {
      e.preventDefault();
      dropEl.classList.remove('is-over');
    }));

  dropEl.addEventListener('drop', e => {
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    handleFile(f);
  });

  $('split-btn').addEventListener('click', () => {
    const raw = pasteEl.value.trim();
    if (!raw) { toast('Paste the email first'); return; }
    const found = global.Importer.split(raw).map(it =>
      Object.assign({ include: true, isSection: false, tracking: false }, it));
    afterSplit(found, 'pasted text');
  });

  $('clear-btn').addEventListener('click', () => {
    pasteEl.value = '';
    items = [];
    sourceNoteEl.innerHTML = '';
    render();
  });

  addBtn.addEventListener('click', () => {
    items.push({ title: '', body: '', link: '', linkLabel: '', end: '', include: true });
    render();
    const last = cardsEl.lastElementChild;
    if (last) last.querySelector('[data-f="title"]').focus();
  });

  /* ----------------------------------------------------------------- copy -- */

  async function copy(includeHeader) {
    const tsv = global.Importer.toTsv(items, { includeHeader });
    const n = items.filter(it => it.include !== false).length;
    try {
      await navigator.clipboard.writeText(tsv);
      toast('Copied ' + n + ' rows — now paste into cell A2');
    } catch (err) {
      const ta = document.createElement('textarea');
      ta.value = tsv;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      toast(ok ? 'Copied ' + n + ' rows — now paste into cell A2'
               : 'Could not copy automatically');
    }
  }

  copyBtns.forEach(b => b.addEventListener('click', () => copy(false)));
  copyHeaderBtns.forEach(b => b.addEventListener('click', () => copy(true)));

  /* -------------------------------------------------------------- publish -- */

  /**
   * Send the ticked announcements straight to the Sheet via the Apps Script
   * in sheet/Code.gs, instead of copy-and-pasting them by hand.
   *
   * Google Apps Script web apps don't send back the CORS headers a browser
   * needs to read a normal fetch() response — that's a platform limitation,
   * not a bug here. The standard, documented workaround is to send the
   * request in "no-cors" mode: the browser still delivers it and the script
   * still runs, but JavaScript is not allowed to read anything back. So this
   * button can confirm the request went out, but not that it was saved.
   *
   * That's an honest gap, not swept under the rug: the status line says
   * exactly that, an "Open the Sheet" link is offered for a real check, and
   * the copy-and-paste fallback stays available underneath at all times.
   */
  async function publish() {
    const cfg = global.KIOSK_CONFIG;
    const rows = global.Importer.toMatrix(items);

    if (!rows.length) { toast('Nothing ticked to publish'); return; }

    publishBtn.disabled = true;
    publishBtn.textContent = 'Sending…';
    publishStatusEl.textContent = '';
    publishStatusEl.className = 'step__hint';

    try {
      await fetch(cfg.publishUrl, {
        method: 'POST',
        mode: 'no-cors',                                  // see comment above
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ secret: cfg.publishSecret, rows }),
      });

      // "Sent" means the request reached Google — not that the secret was
      // right or the Sheet actually changed, which no-cors mode has no way to
      // confirm. The first time this is ever used, check the Sheet by hand.
      publishStatusEl.textContent =
        '✓ Sent ' + rows.length + ' rows to Google. It can take a few minutes to ' +
        'reach the TV from there. The first time you use this, open the Sheet and ' +
        'check the rows actually landed' + (cfg.sheetEditUrl ? ' (link above)' : '') +
        ' — after that, publishing quietly should be safe to trust.';
      publishStatusEl.classList.add('is-ok');
      toast('Sent ' + rows.length + ' rows to the Sheet');
    } catch (err) {
      // A genuine network failure — no internet, or publishUrl doesn't resolve
      // at all. A wrong deployment ID or wrong secret will NOT show up here:
      // Google's own server is still reachable either way, so those failures
      // only ever show up by checking the Sheet itself.
      console.error(err);
      publishStatusEl.textContent =
        '⚠ Could not reach Google at all — check publishUrl in config.js, or ' +
        'use "Copy rows by hand instead" below.';
      publishStatusEl.classList.add('is-err');
      toast('Could not reach the Sheet');
    } finally {
      publishBtn.disabled = false;
      publishBtn.textContent = 'Publish to the Sheet';
    }
  }

  if (publishBtn) publishBtn.addEventListener('click', publish);

  function setupPublishUi() {
    const cfg = global.KIOSK_CONFIG;
    const configured = !!(cfg.publishUrl && cfg.publishSecret);
    if (publishBlockEl) publishBlockEl.hidden = !configured;
    if (copyBlockEl) copyBlockEl.hidden = configured;

    if (configured && openSheetLink) {
      if (cfg.sheetEditUrl) {
        openSheetLink.href = cfg.sheetEditUrl;
        openSheetLink.hidden = false;
      } else {
        openSheetLink.hidden = true;
      }
    }
  }

  /* --------------------------------------------------------------- sample -- */

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
    toast('Sample loaded — now press “Split pasted text”');
  });

  setupPublishUi();
  render();

})(window);
