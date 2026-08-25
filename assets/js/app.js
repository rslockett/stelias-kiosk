/* ============================================================================
   app.js — running the show
   ----------------------------------------------------------------------------
   Holds the current deck, advances through it, crossfades between slides, and
   quietly swaps in new content from the Sheet without anyone in the hall
   noticing a reload.
   ========================================================================== */

(function (global) {
  'use strict';

  const CFG = global.KIOSK_CONFIG;

  const stage = document.getElementById('stage');
  const dotsEl = document.getElementById('dots');
  const progressEl = document.getElementById('progress');
  const clockTimeEl = document.getElementById('clock-time');
  const clockDateEl = document.getElementById('clock-date');
  const offlineEl = document.getElementById('offline');
  const emptyEl = document.getElementById('empty');

  let deck = [];          // slides currently showing
  let pendingDeck = null; // new content, waiting for a clean moment to swap in
  let index = 0;
  let currentEl = null;
  let timer = null;
  let paused = false;

  /* ---------------------------------------------------------------- clock -- */

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

  /* ----------------------------------------------------------------- dots -- */

  function renderDots() {
    if (!dotsEl) return;
    // More than ~14 dots turns into visual noise from across a room.
    if (deck.length < 2 || deck.length > 14) { dotsEl.innerHTML = ''; return; }
    dotsEl.innerHTML = deck
      .map((_, i) => '<span class="dot' + (i === index ? ' is-current' : '') + '"></span>')
      .join('');
  }

  /* ---------------------------------------------------------------- dwell -- */

  /** Longer announcements get more time on screen. */
  function dwellMs(slide) {
    const chars = (slide.title || '').length + (slide.body || '').length;
    const extra = (CFG.extraSecondsPerHundredChars || 0) * (chars / 100);
    return Math.round((CFG.slideSeconds + extra) * 1000);
  }

  /* --------------------------------------------------------------- render -- */

  function show(i) {
    if (!deck.length) return;
    index = ((i % deck.length) + deck.length) % deck.length;
    const slide = deck[index];

    // Normally there's at most one outgoing element mid-transition, tracked
    // by currentEl below. But if a resize fires while fonts/layout are still
    // settling right after boot, it can trigger a second show() for the same
    // slide before the first outgoing element's removal timer has run --
    // clear anything stray now rather than let it sit stacked underneath.
    Array.from(stage.children).forEach(child => {
      if (child !== currentEl) child.remove();
    });

    const el = global.Slide.buildSlideEl(slide);
    el.classList.add('is-entering');
    stage.appendChild(el);

    // Element must be in the document (and laid out) before we can measure it.
    const main = el.querySelector('.slide__main');
    const fit = el.querySelector('.slide__fit');
    const result = global.Slide.fitToBox(main, fit, {
      minPx: CFG.minBodyPx,
      maxPx: CFG.maxBodyPx,
    });
    if (result.trimmed) {
      console.warn('[kiosk] too long for one slide, trimmed:', slide.title);
    }

    // Force a reflow so the browser treats the class change below as a
    // transition rather than an instant jump.
    void el.offsetWidth;

    const outgoing = currentEl;
    el.classList.remove('is-entering');
    el.classList.add('is-active');

    if (outgoing) {
      outgoing.classList.remove('is-active');
      outgoing.classList.add('is-leaving');
      setTimeout(() => outgoing.remove(), CFG.transitionMs + 100);
    }
    currentEl = el;

    renderDots();
    startProgress(dwellMs(slide));
    preloadNextImage();
  }

  function preloadNextImage() {
    const next = deck[(index + 1) % deck.length];
    if (next && next.image) new Image().src = next.image;
  }

  function startProgress(ms) {
    if (!progressEl) return;
    progressEl.style.transition = 'none';
    progressEl.style.transform = 'scaleX(0)';
    void progressEl.offsetWidth;
    progressEl.style.transition = 'transform ' + ms + 'ms linear';
    progressEl.style.transform = 'scaleX(1)';

    clearTimeout(timer);
    if (!paused) timer = setTimeout(advance, ms);
  }

  function advance() {
    // A clean moment to swap in new content: between slides, not mid-slide.
    if (pendingDeck) {
      deck = pendingDeck;
      pendingDeck = null;
      index = -1; // so the ++ below lands on 0 and we restart the new deck
      updateEmptyState();
    }
    show(index + 1);
  }

  /* ---------------------------------------------------------------- state -- */

  function updateEmptyState() {
    const empty = deck.length === 0;
    emptyEl.hidden = !empty;
    stage.hidden = empty;
    if (empty) { clearTimeout(timer); }
  }

  function onDeck(slides, meta) {
    console.log('[kiosk] deck updated:', slides.length, 'slides from', meta.source);

    if (!currentEl) {
      deck = slides;
      updateEmptyState();
      if (deck.length) show(0);
      return;
    }
    // Already showing something — queue it for the next transition.
    pendingDeck = slides;
  }

  function onStatus(status) {
    if (!CFG.showOfflineIndicator || !offlineEl) return;
    offlineEl.hidden = !!status.online;
    offlineEl.title = status.message || '';
  }

  /* ------------------------------------------------------------ controls -- */

  // Handy when setting the TV up, or when someone wants to hold a slide.
  function onKey(e) {
    if (e.key === 'ArrowRight') { clearTimeout(timer); show(index + 1); }
    else if (e.key === 'ArrowLeft') { clearTimeout(timer); show(index - 1); }
    else if (e.key === ' ') {
      e.preventDefault();
      paused = !paused;
      document.body.classList.toggle('is-paused', paused);
      if (paused) clearTimeout(timer);
      else startProgress(dwellMs(deck[index]));
    } else if (e.key === 'r') {
      global.kioskSource && global.kioskSource.refresh();
    }
  }

  /* --------------------------------------------------------------- reload -- */

  function scheduleDailyReload() {
    if (CFG.dailyReloadHour === null || CFG.dailyReloadHour === undefined) return;
    setInterval(() => {
      const now = new Date();
      if (now.getHours() === CFG.dailyReloadHour && now.getMinutes() === 0) {
        location.reload();
      }
    }, 60 * 1000);
  }

  /* ----------------------------------------------------------------- boot -- */

  async function boot() {
    document.documentElement.style.setProperty(
      '--safe-area', (CFG.safeAreaPercent || 0) + '%');
    document.documentElement.style.setProperty(
      '--transition', (CFG.transitionMs || 700) + 'ms');
    if (CFG.cornerOrnament !== undefined && CFG.cornerOrnament !== null) {
      document.documentElement.style.setProperty('--ornament', CFG.cornerOrnament);
    }

    document.getElementById('church-name').textContent = CFG.churchName;
    document.getElementById('tagline').textContent = CFG.tagline;
    document.getElementById('clock').hidden = !CFG.showClock;

    tickClock();
    setInterval(tickClock, 10 * 1000);
    scheduleDailyReload();

    // Measuring text before the real fonts land gives wrong answers, and every
    // slide would be sized for a fallback font it isn't going to use.
    if (document.fonts && document.fonts.ready) {
      try { await document.fonts.ready; } catch (e) { /* proceed anyway */ }
    }

    global.kioskSource = global.Deck
      .createDeckSource(CFG.sheetCsvUrl)
      .on('deck', onDeck)
      .on('status', onStatus)
      .start();

    window.addEventListener('keydown', onKey);

    // Re-fit the current slide if the window changes size.
    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => { if (deck.length) show(index); }, 250);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})(window);
