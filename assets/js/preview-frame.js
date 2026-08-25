/* ============================================================================
   preview-frame.js — the inside of the preview window
   ----------------------------------------------------------------------------
   Runs inside preview.html, which the editor embeds in an iframe. Takes a
   slide from the editor, draws it with exactly the same code the television
   uses, and reports back what happened — in particular whether the text had
   to be trimmed, which is the one thing an editor most needs to know and
   cannot judge by eye from a spreadsheet row.
   ========================================================================== */

(function (global) {
  'use strict';

  const CFG = global.KIOSK_CONFIG;

  const stage = document.getElementById('stage');
  const emptyEl = document.getElementById('empty');
  const dotsEl = document.getElementById('dots');
  const progressEl = document.getElementById('progress');
  const clockEl = document.getElementById('clock');
  const clockTimeEl = document.getElementById('clock-time');
  const clockDateEl = document.getElementById('clock-date');

  let currentEl = null;
  let fontsReady = false;
  let queued = null;          // a render that arrived before the fonts landed

  /* ---------------------------------------------------------------- chrome -- */

  function tickClock() {
    if (!CFG.showClock) return;
    const now = new Date();
    clockTimeEl.textContent = now
      .toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
      .replace(/\s?([AP])M/i, (_, p) => ' ' + p.toLowerCase() + 'm');
    clockDateEl.textContent = now.toLocaleDateString([], {
      weekday: 'long', month: 'long', day: 'numeric',
    });
  }

  function setupChrome() {
    document.documentElement.style.setProperty(
      '--safe-area', (CFG.safeAreaPercent || 0) + '%');
    // Whatever the television is set to, so the preview keeps telling the
    // truth about what the hall will see.
    if (CFG.cornerOrnament !== undefined && CFG.cornerOrnament !== null) {
      document.documentElement.style.setProperty('--ornament', CFG.cornerOrnament);
    }
    // Slower than the TV's crossfade on purpose: in the editor these swap
    // every time a key is pressed, and a long fade would lag behind typing.
    document.documentElement.style.setProperty('--transition', '220ms');

    document.getElementById('church-name').textContent = CFG.churchName;
    document.getElementById('tagline').textContent = CFG.tagline;
    clockEl.hidden = !CFG.showClock;

    tickClock();
    setInterval(tickClock, 10 * 1000);
  }

  /* ----------------------------------------------------------------- dots -- */

  function renderDots(index, total) {
    if (!dotsEl) return;
    if (!total || total < 2 || total > 14) { dotsEl.innerHTML = ''; return; }
    let html = '';
    for (let i = 0; i < total; i++) {
      html += '<span class="dot' + (i === index ? ' is-current' : '') + '"></span>';
    }
    dotsEl.innerHTML = html;
  }

  /* --------------------------------------------------------------- render -- */

  function renderSlide(msg) {
    emptyEl.hidden = true;
    stage.hidden = false;

    // Anything other than the one slide mid-transition is a leftover.
    Array.from(stage.children).forEach(child => {
      if (child !== currentEl) child.remove();
    });

    const el = global.Slide.buildSlideEl(msg.slide);
    stage.appendChild(el);

    // Has to be in the document and laid out before it can be measured.
    const main = el.querySelector('.slide__main');
    const fit = el.querySelector('.slide__fit');
    const result = global.Slide.fitToBox(main, fit, {
      minPx: CFG.minBodyPx,
      maxPx: CFG.maxBodyPx,
    });

    void el.offsetWidth;      // force a reflow so the fade is a fade

    const outgoing = currentEl;
    el.classList.add('is-active');
    if (outgoing) {
      outgoing.classList.remove('is-active');
      outgoing.classList.add('is-leaving');
      setTimeout(() => outgoing.remove(), 400);
    }
    currentEl = el;

    renderDots(msg.index, msg.total);

    // The floor is scaled to the screen the same way fitToBox scales it, so
    // "as small as it is allowed to get" is comparable to the returned size.
    const floor = Math.max(11, CFG.minBodyPx * Math.min(1, main.clientHeight / (1080 * 0.62)));

    reply({
      type: 'rendered',
      token: msg.token,
      trimmed: result.trimmed,
      px: result.px,
      atFloor: result.px <= floor + 0.5,
    });
  }

  function renderEmpty(msg) {
    Array.from(stage.children).forEach(child => child.remove());
    currentEl = null;
    stage.hidden = true;
    emptyEl.hidden = false;
    renderDots(0, 0);
    reply({ type: 'rendered', token: msg.token, empty: true });
  }

  /* ------------------------------------------------------------- progress -- */

  function runProgress(ms) {
    if (!progressEl) return;
    progressEl.style.transition = 'none';
    progressEl.style.transform = 'scaleX(0)';
    void progressEl.offsetWidth;
    if (!ms) return;
    progressEl.style.transition = 'transform ' + ms + 'ms linear';
    progressEl.style.transform = 'scaleX(1)';
  }

  /* -------------------------------------------------------------- messages -- */

  function reply(payload) {
    if (global.parent && global.parent !== global) {
      global.parent.postMessage(payload, global.location.origin);
    }
  }

  function handle(msg) {
    if (!fontsReady) { queued = msg; return; }
    if (msg.type === 'render') renderSlide(msg);
    else if (msg.type === 'empty') renderEmpty(msg);
    else if (msg.type === 'progress') runProgress(msg.ms);
  }

  global.addEventListener('message', e => {
    // Both ends of this are pages from this same site; anything else talking
    // to the preview is not something to act on.
    if (e.origin !== global.location.origin) return;
    if (e.source !== global.parent) return;
    if (!e.data || typeof e.data !== 'object') return;
    handle(e.data);
  });

  /* ----------------------------------------------------------------- boot -- */

  async function boot() {
    setupChrome();

    // Measuring text before the real fonts arrive gives wrong answers, and
    // every slide would be sized for a font it is not going to use.
    if (document.fonts && document.fonts.ready) {
      try { await document.fonts.ready; } catch (e) { /* proceed anyway */ }
    }
    fontsReady = true;

    if (queued) { const m = queued; queued = null; handle(m); }
    reply({ type: 'ready' });
  }

  boot();

})(window);
