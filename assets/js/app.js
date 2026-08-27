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
  const stagewrapEl = document.getElementById('stagewrap');
  const railEl = document.getElementById('rail');
  const dotsEl = document.getElementById('dots');
  const progressEl = document.getElementById('progress');
  const clockTimeEl = document.getElementById('clock-time');
  const clockDateEl = document.getElementById('clock-date');
  const clockWeatherEl = document.getElementById('clock-weather');
  const offlineEl = document.getElementById('offline');
  const emptyEl = document.getElementById('empty');

  let deck = [];          // slides currently showing
  let pendingDeck = null; // new content, waiting for a clean moment to swap in
  let index = 0;
  let currentEl = null;
  let timer = null;
  let paused = false;

  // The announcement deck and the day's saints slide are two independent,
  // independently-polled sources. Whichever changes, the merged deck is
  // rebuilt and handed to onDeck exactly as if it were one source — today's
  // saints lead the rotation, the announcements follow.
  //
  // The two sign-ups are polled the same way but do not appear here at all.
  // They live in the rail instead — see onSignupCard.
  let announcementSlides = [];
  let liturgicalSlide = null;

  /**
   * The welcome slide, built once from config.js. Unlike everything else on
   * the screen it has no source to poll — it says the same thing every week,
   * which is the point of it. A visitor sees it whichever Sunday they walk in.
   */
  const welcomeSlide = (function () {
    const w = CFG.welcome || {};
    const url = String(w.formUrl || '').trim();
    if (!url) return null;
    return {
      title: w.title || 'Welcome',
      body: w.body || '',
      link: url,
      linkLabel: w.qrLabel || CFG.defaultQrLabel,
      image: String(w.image || '').trim(),
    };
  })();

  function mergedDeck() {
    return (liturgicalSlide ? [liturgicalSlide] : [])
      .concat(welcomeSlide ? [welcomeSlide] : [])
      .concat(announcementSlides);
  }

  /* ---------------------------------------------------------------- clock -- */

  function tickClock() {
    if (!CFG.showClock) return;
    const now = new Date();
    // hour12 is explicit rather than left to the locale default — some
    // devices (the Pi included, depending on its system locale) default
    // toLocaleTimeString to 24-hour time otherwise.
    clockTimeEl.textContent = now
      .toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })
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

  /**
   * How long a slide stays up, in seconds, before anything is added for its
   * length. The Sheet wins when it has an opinion, because the people who can
   * tell the hall is being rushed are standing in it — not editing config.js.
   */
  let publishedSlideSeconds = null;

  function baseSlideSeconds() {
    return publishedSlideSeconds != null ? publishedSlideSeconds : CFG.slideSeconds;
  }

  /** Longer announcements get more time on screen. */
  function dwellMs(slide) {
    const chars = (slide.title || '').length + (slide.body || '').length;
    const extra = (CFG.extraSecondsPerHundredChars || 0) * (chars / 100);
    return Math.round((baseSlideSeconds() + extra) * 1000);
  }

  /* --------------------------------------------------------------- render -- */

  function show(i) {
    if (!deck.length) return;

    // A slide boundary is the only moment the screen is allowed to reload onto
    // a new version of itself — see the note above applyUpdate(). Checked here
    // rather than on a timer so it can never happen mid-sentence.
    applyUpdateIfDue();

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
    // The hall now has something to look at, which is the precondition for
    // this file ever being allowed to reload the page. See "updating" below.
    renderedOnce = true;

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
      // Carry on from where the rotation had got to, rather than jumping back
      // to the top of the new deck — see Deck.keepPosition for why that
      // matters more than it sounds.
      const current = deck[index];
      deck = pendingDeck;
      pendingDeck = null;
      index = global.Deck.keepPosition(current, deck, index);
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

  function applyDeck(slides) {
    // Nothing goes on screen until every source has had its say — see
    // "the first slide" below.
    if (holdingFirstSlide) return;

    if (!currentEl) {
      deck = slides;
      updateEmptyState();
      if (deck.length) show(0);
      return;
    }
    // Already showing something — queue it for the next transition.
    pendingDeck = slides;
  }

  /* --------------------------------------------------- the first slide -- */

  /*
   * Why the screen waits a moment before showing anything at all.
   *
   * The four sources answer independently, and at start-up they land seconds
   * apart — the sign-ups usually first, the announcements last, because they
   * are the biggest read and they queue behind the fonts. Starting the
   * rotation on whichever answered first meant the hall watched a two- or
   * three-slide deck go round at full speed: welcome, a sign-up, welcome
   * again, the day's saints, welcome a third time — every slide that had
   * arrived repeating every thirty seconds until the rest caught up.
   *
   * Keeping our place in the deck (see Deck.keepPosition) fixed the jumping.
   * It cannot fix this, because there is nothing wrong with the position — a
   * four-slide deck played in perfect order still comes round four times as
   * often as a sixteen-slide one, and what somebody standing in the hall sees
   * is the same slide again.
   *
   * So: hold the first slide until all four have reported, or until the grace
   * period runs out, whichever comes first. The rotation then starts once, on
   * the whole deck, and every slide after that is genuinely the next one.
   *
   * The wait is invisible — the masthead and clock are already painted, and
   * this is a screen that has just been switched on. A source that is broken
   * or unreachable never reports at all, which is exactly what the grace
   * period is for: the hall gets whatever did arrive rather than a screen
   * that waits forever for a Sheet nobody published.
   */

  const FIRST_SLIDE_GRACE_MS = 10 * 1000;

  let holdingFirstSlide = true;
  let awaitedSources = null;

  function awaitSources(names) {
    awaitedSources = new Set(names);
    setTimeout(() => {
      if (holdingFirstSlide && awaitedSources.size) {
        console.warn('[kiosk] starting without ' +
          Array.from(awaitedSources).join(', ') + ' — nothing heard back in ' +
          Math.round(FIRST_SLIDE_GRACE_MS / 1000) + 's');
        startRotation();
      }
    }, FIRST_SLIDE_GRACE_MS);
  }

  /** One source has reported — its content, or that it has none. */
  function sourceReported(name) {
    if (!holdingFirstSlide || !awaitedSources) return;
    awaitedSources.delete(name);
    if (awaitedSources.size === 0) startRotation();
  }

  function startRotation() {
    if (!holdingFirstSlide) return;
    holdingFirstSlide = false;
    applyDeck(mergedDeck());
  }

  function onDeck(slides, meta) {
    console.log('[kiosk] deck updated:', slides.length, 'slides from', meta.source);
    announcementSlides = slides;
    if (meta && meta.stamp) publishStamp = meta.stamp;
    if (meta && meta.slideSeconds != null) {
      if (meta.slideSeconds !== publishedSlideSeconds) {
        console.log('[kiosk] each slide now stays up', meta.slideSeconds, 'seconds');
      }
      publishedSlideSeconds = meta.slideSeconds;
    }
    renderFreshness();
    applyDeck(mergedDeck());
    sourceReported('the announcements');
  }

  /* ----------------------------------------------------------- freshness -- */

  /*
   * The line in the bottom corner saying when these announcements were put up.
   *
   * It exists to answer one question, asked from inside the hall: "I published
   * ten minutes ago — is this screen showing it?" Nothing else in the system
   * can answer that. The editor verifies the Sheet and stops there; it never
   * hears from the Pi, so an unplugged television looks exactly like a working
   * one from a laptop in the office.
   *
   * The publish time comes from the Sheet's own "Published At" column, which
   * is the same value the editor displays. So the two show the same number,
   * and confirming the hall is current is a matter of reading it rather than
   * trusting anything.
   *
   * "Checked" is the second half, and answers the other failure: a screen
   * showing a perfectly good publish time from Tuesday because it stopped
   * being able to reach Google on Wednesday.
   */

  let publishStamp = null;
  let lastCheckedAt = null;

  function clockTime(d) {
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })
            .replace(/\s?([AP])M/i, (_, p) => ' ' + p.toLowerCase() + 'm');
  }

  /** "9:38 pm" today, "Sun 9:38 pm" earlier this week, "12 Aug" beyond that. */
  function when(d) {
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return clockTime(d);
    if (now - d < 6 * 24 * 3600 * 1000) {
      return d.toLocaleDateString([], { weekday: 'short' }) + ' ' + clockTime(d);
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  function renderFreshness() {
    const el = document.getElementById('freshness');
    if (!el) return;

    const parts = [];

    if (publishStamp && publishStamp.at) {
      const d = new Date(publishStamp.at);
      if (!isNaN(d)) {
        parts.push('Updated ' + when(d) +
          (publishStamp.by ? ' by ' + publishStamp.by : ''));
      }
    }

    if (lastCheckedAt) parts.push('checked ' + clockTime(new Date(lastCheckedAt)));

    el.textContent = parts.join(' · ');
    el.hidden = !parts.length;
  }

  /* ------------------------------------------------------------------ rail -- */

  /*
   * The two sign-ups, standing still beside the rotation.
   *
   * They used to ride at the end of the deck, which made somebody who had
   * just decided to host a Sunday wait out the rest of the week's news before
   * they could scan anything. A sign-up is acted on there and then, by a
   * person holding a phone; an announcement is read now and acted on later.
   * Only one of those can afford to be on a two-minute cycle.
   *
   * They are still awaited before the first slide goes up, though they no
   * longer put anything in the deck. The rail takes a quarter of the width,
   * and an announcement is fitted to the width it is given — so the rail has
   * to be there before the first slide is measured, or the first slide is
   * sized for a stage it is about to stop having.
   *
   * Redrawn whole on every change rather than patched. A card is a title, a
   * code and six rows; it changes when somebody claims a Sunday, which is a
   * few times a week, not a few times a minute.
   */

  const railCards = { coffee: null, bread: null };

  function onSignupCard(kind, card) {
    console.log('[kiosk] ' + kind + ' sign-up updated:',
      card ? card.entries.length + ' Sundays, ' + card.openCount + ' open' : 'not configured');
    railCards[kind] = card;
    renderRail();
    sourceReported(kind === 'coffee' ? 'the coffee sign-up' : 'the bread sign-up');
  }

  function renderRail() {
    if (!railEl || !stagewrapEl) return;

    // Coffee Hour above Holy Bread, always in that order, so the rail doesn't
    // reshuffle itself depending on which of the two answered first.
    const cards = [railCards.coffee, railCards.bread].filter(Boolean);

    railEl.hidden = cards.length === 0;
    // Neither one configured: the column goes away entirely and the
    // announcements have the full width back, exactly as they used to.
    stagewrapEl.classList.toggle('has-rail', cards.length > 0);
    railEl.classList.toggle('rail--one', cards.length === 1);

    railEl.innerHTML = '';
    cards.forEach(card => railEl.appendChild(global.Slide.buildSignupCardEl(card)));

    // The stage may have just changed width. Whatever is on it was fitted to
    // the old one.
    if (!holdingFirstSlide && deck.length && currentEl) show(index);
  }

  function onLiturgicalSlide(slide) {
    console.log('[kiosk] liturgical updated:', slide ? slide.title : 'not configured');
    liturgicalSlide = slide;
    applyDeck(mergedDeck());
    sourceReported("the day's saints");
  }

  function onStatus(status) {
    if (status.checkedAt) {
      lastCheckedAt = status.checkedAt;
      renderFreshness();
    }
    if (!CFG.showOfflineIndicator || !offlineEl) return;
    offlineEl.hidden = !!status.online;
    offlineEl.title = status.message || '';
  }

  function onWeather(w) {
    if (!clockWeatherEl) return;
    if (!w) { clockWeatherEl.hidden = true; return; }
    clockWeatherEl.textContent = w.tempF + '°F — ' + w.label;
    clockWeatherEl.hidden = false;
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
      global.liturgicalSource && global.liturgicalSource.refresh();
      global.coffeeSignupSource && global.coffeeSignupSource.refresh();
      global.breadSignupSource && global.breadSignupSource.refresh();
      global.weatherSource && global.weatherSource.refresh();
    } else if (e.key === 'u') {
      // Update to the newest version of the kiosk itself, now, without
      // waiting for the next check or the next slide. "r" fetches the words
      // again; this one fetches the program.
      applyUpdate();
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

  /* -------------------------------------------------------------- updating -- */

  /*
   * Picking up a new version of the kiosk itself.
   *
   * The Sheet polling above keeps the WORDS current. This keeps the PROGRAM
   * current, which is a different problem and used to need somebody to walk
   * into the hall with a keyboard: a television left running for weeks holds
   * on to the JavaScript it started with, so a fix pushed on Tuesday would not
   * reach the screen until the machine happened to restart.
   *
   * version.json is written by stamp-version.sh on every release. The page
   * knows which version it is running because that same script stamps it into
   * a meta tag. When the two disagree, there is new code on the server.
   *
   * The reload waits for a slide boundary. Everything else about this screen
   * changes between slides rather than under somebody's eyes mid-sentence, and
   * a page reload is the most abrupt change there is.
   */

  let runningVersion = '';
  let updatePending = false;
  let pendingVersion = '';

  /*
   * THE RULE THIS CODE EXISTS TO OBEY
   *
   * An announcement screen that is showing announcements must never be turned
   * into a blank one by this file. Updating is a convenience. Showing the
   * parish its notices is the entire job, and no amount of convenience is
   * worth a dark television in the hall.
   *
   * The first version of this broke that rule. The reload fired from the top
   * of show(), which is reached before the first slide is ever drawn — so a
   * screen that wanted an update reloaded, wanted it again, reloaded again,
   * and sat there showing nothing but the masthead. The header is static
   * markup and paints immediately, which made it look like a hung page rather
   * than a loop. It did exactly this on the Pi in the hall while working
   * perfectly on a laptop, because the laptop happened to already have the
   * version it was reaching for.
   *
   * Four rules now, and any one of them alone is enough to prevent that:
   *
   *   1. Nothing reloads until slides have actually been on screen. A blank
   *      kiosk therefore cannot be caused by this code — there is always
   *      something to go back to.
   *   2. The first check waits until the screen has been up a few minutes.
   *   3. A version we already reloaded for is never chased twice, and that is
   *      remembered in localStorage, which survives a session being wiped.
   *   4. At most one update reload in any half hour, however much changes.
   */

  const TRIED_KEY = 'stelias.kiosk.updateTried';
  const LAST_RELOAD_KEY = 'stelias.kiosk.updateReloadedAt';

  // Rule 2: let the screen settle and get slides up before thinking about it.
  const SETTLE_MS = 3 * 60 * 1000;
  // Rule 4: a ceiling on how often this can ever reload, whatever happens.
  const MIN_BETWEEN_RELOADS_MS = 30 * 60 * 1000;

  let renderedOnce = false;      // rule 1 — set the first time a slide is drawn

  function remembered(key) {
    try { return localStorage.getItem(key) || ''; } catch (e) { return ''; }
  }

  function remember(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* storage disabled */ }
  }

  function readRunningVersion() {
    const meta = document.querySelector('meta[name="kiosk-version"]');
    return meta ? String(meta.content || '').trim() : '';
  }

  async function checkForUpdate() {
    if (updatePending || !runningVersion) return;

    // Rule 1. Until the hall has seen a slide, there is nothing this can
    // safely do — reloading now risks replacing a screen that is still
    // starting up with one that starts up again.
    if (!renderedOnce) return;

    // Rule 4.
    const lastReload = parseInt(remembered(LAST_RELOAD_KEY), 10);
    if (lastReload && Date.now() - lastReload < MIN_BETWEEN_RELOADS_MS) return;

    try {
      const res = await fetch('version.json?_ts=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      const latest = String(data && data.version || '').trim();
      if (!latest || latest === runningVersion) return;

      // Rule 3.
      if (latest === remembered(TRIED_KEY)) {
        console.warn('[kiosk] already reloaded once for version ' + latest +
          ' and still running ' + runningVersion + ' — not trying again. ' +
          'Check that stamp-version.sh ran before the last push.');
        return;
      }

      console.info('[kiosk] new version ' + latest + ' (running ' + runningVersion + ')');
      pendingVersion = latest;
      updatePending = true;
    } catch (e) {
      // Offline, or the file isn't there. Neither is worth saying anything
      // about — the screen carries on showing announcements either way.
    }
  }

  /**
   * Reload onto the new version.
   *
   * The address carries the version so the browser has to go and fetch the
   * document rather than hand back the copy it already has — a plain reload
   * can be served entirely from cache, which would land us back on exactly
   * the code we are trying to leave.
   */
  function applyUpdate() {
    remember(LAST_RELOAD_KEY, String(Date.now()));
    const base = location.href.split('?')[0].split('#')[0];
    location.replace(base + '?v=' + Date.now());
  }

  /** Called at every slide change; the only moment a reload is allowed. */
  function applyUpdateIfDue() {
    if (!updatePending || !renderedOnce) return;
    // Recorded before leaving, so that if this reload does not actually get us
    // onto the new version, the check above refuses to try it a second time.
    remember(TRIED_KEY, pendingVersion);
    applyUpdate();
  }

  function scheduleUpdateChecks() {
    runningVersion = readRunningVersion();
    if (!runningVersion) return;                 // unstamped copy — nothing to compare
    const mins = CFG.updateCheckMinutes;
    if (mins === null || mins === undefined || mins <= 0) return;

    // No check at boot. The screen gets several minutes to fetch the Sheet,
    // draw a slide and be a working television before this is allowed to have
    // an opinion about reloading it.
    setTimeout(() => {
      checkForUpdate();
      setInterval(checkForUpdate, Math.max(1, mins) * 60 * 1000);
    }, SETTLE_MS);
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
    scheduleUpdateChecks();

    global.weatherSource = global.Weather.createWeatherSource().on(onWeather).start();

    // Measuring text before the real fonts land gives wrong answers, and every
    // slide would be sized for a fallback font it isn't going to use.
    if (document.fonts && document.fonts.ready) {
      try { await document.fonts.ready; } catch (e) { /* proceed anyway */ }
    }

    awaitSources([
      "the day's saints",
      'the coffee sign-up',
      'the bread sign-up',
      'the announcements',
    ]);

    global.liturgicalSource = global.LiturgicalData
      .createLiturgicalSource(CFG.liturgicalCsvUrl)
      .on(onLiturgicalSlide)
      .start();

    global.coffeeSignupSource = global.SignupData.createKioskSource({
      kind: 'coffee',
      title: 'Coffee Hour',
      csvUrl: CFG.coffeeHour.csvUrl,
      qrUrl: CFG.coffeeHour.signupUrl,
      qrLabel: 'Scan to host',
      markFasting: true,
    }).on(card => onSignupCard('coffee', card)).start();

    global.breadSignupSource = global.SignupData.createKioskSource({
      kind: 'bread',
      title: 'Holy Bread',
      csvUrl: CFG.holyBread.csvUrl,
      qrUrl: CFG.holyBread.signupUrl,
      qrLabel: 'Scan to bake',
      markFasting: false,
    }).on(card => onSignupCard('bread', card)).start();

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
