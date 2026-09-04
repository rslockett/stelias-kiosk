/* ============================================================================
   import.test.js — what the importer has to keep getting right
   ----------------------------------------------------------------------------
   Open test.html to run these. There is no build step and no test framework:
   it is a page that loads the same files import.html loads, runs them against
   a fixture newsletter, and says what broke.

   WHY THIS EXISTS

   The importer reads a newsletter written in Word, pasted into Outlook and
   sent through a mailing service. Nothing about that markup is a contract —
   a heading that was bold last week arrives as a table cell this week — so
   every rule in here was learned from a real newsletter that came out wrong
   in the hall. Each case below is a mistake this thing has actually made.

   The fixture is invented. Real newsletters carry parishioner names, home
   emails and phone numbers, and this repository is published to GitHub Pages,
   so no real one is ever committed here. See .gitignore.
   ========================================================================== */

(function (global) {
  'use strict';

  const T = [];
  const test = (name, fn) => T.push({ name, fn });

  function assert(cond, msg) {
    if (!cond) throw new Error(msg || 'expected true');
  }

  function has(haystack, needle, msg) {
    assert(String(haystack).indexOf(needle) !== -1,
      (msg || 'missing') + ': expected to find ' + JSON.stringify(needle) +
      '\n   in: ' + JSON.stringify(String(haystack).slice(0, 400)));
  }

  function lacks(haystack, needle, msg) {
    assert(String(haystack).indexOf(needle) === -1,
      (msg || 'unexpected') + ': did not expect ' + JSON.stringify(needle) +
      '\n   in: ' + JSON.stringify(String(haystack).slice(0, 400)));
  }

  /** The announcement whose title contains `s`. Fails loudly if there isn't one. */
  function find(items, s) {
    const hit = items.filter(it => it.title.toLowerCase().indexOf(s.toLowerCase()) !== -1);
    assert(hit.length, 'no announcement titled like ' + JSON.stringify(s) +
      '\n   titles: ' + JSON.stringify(items.map(i => i.title)));
    return hit[0];
  }

  /* ---------------------------------------------------- the whole pipeline -- */

  let items = null;

  test('the fixture newsletter parses at all', () => {
    assert(items && items.length, 'no announcements came out of the fixture');
  });

  // A newsletter that bolds each day turned the week into seven near-empty
  // slides. The week's services are one thing and belong on one slide.
  test('a week of services stays on one slide', () => {
    const svc = find(items, 'Services for this Week');
    has(svc.body, '## Tuesday, Sept. 1', 'day kept as a sub-heading');
    has(svc.body, '## Sunday, Sept. 6', 'every day, not just the first');
    has(svc.body, '- Divine Liturgy 9:30 AM', 'services bulleted under their day');
    lacks(svc.body, '## Tuesday, Sept. 1 -', 'trailing dash trimmed off the day');

    const strays = items.filter(it => /^(mon|tues|wednes|thurs|fri|satur|sun)day/i.test(it.title));
    assert(!strays.length, 'a day became its own announcement: ' +
      JSON.stringify(strays.map(s => s.title)));
  });

  test('the note after the schedule stays prose, not a service', () => {
    const svc = find(items, 'Services for this Week');
    has(svc.body, 'Please note:');
    lacks(svc.body, '- Please note:', 'a line with no clock time is not a service');
  });

  // Word writes a line break as <br>. Those newlines used to be dropped,
  // which fused the end of one sentence to the start of the next.
  test('line breaks survive, so sentences do not fuse', () => {
    const choir = find(items, 'Concert Choir');
    lacks(choir.body, 'chant.Audition', 'a <br> between two sentences was lost');
    has(choir.body, 'Audition deadline: September 11.');
    lacks(choir.body, '11.Church', 'the space between two spans was lost');

    const note = find(items, 'Note on Announcements');
    lacks(note.body, '11am.Thank', 'the space between two spans was lost');
  });

  // "Hotel: Avid Hotel" is a label inside an announcement. "Basketball
  // Tournament" is an announcement. Both are bold; only one starts a slide.
  test('a label inside a paragraph does not start a new announcement', () => {
    const bball = find(items, 'Basketball Tournament');
    has(bball.body, 'Friday, October 2nd', 'the dates stayed with the tournament');
    has(bball.body, '7th graders and older', 'so did the rest of it');

    ['Dates', 'Place', 'Who', 'Hotel'].forEach(label => {
      assert(!items.some(it => it.title === label),
        JSON.stringify(label) + ' became an announcement of its own');
    });
    assert(!items.some(it => /^2700 NW/.test(it.title)),
      'a street address became an announcement title');
  });

  test('a bold title sharing a paragraph with its text is still a title', () => {
    const orth = find(items, 'Becoming Orthodox');
    has(orth.body, 'let Fr. Test know', 'the body stayed with its title');
    assert(!/Becoming Orthodox/.test(find(items, 'Parish News').body || ''),
      'a real title was demoted into the section heading above it');
  });

  test('a stray colon does not lead the body', () => {
    items.forEach(it => assert(!/^\s*[:–—-]/.test(it.body),
      JSON.stringify(it.title) + ' starts its body with punctuation: ' +
      JSON.stringify(it.body.slice(0, 40))));
  });

  // Names with an email after them are contact details, not announcements.
  test('contact names stay inside the announcement that needs them', () => {
    assert(!items.some(it => it.title === 'Ada Lovelace' || it.title === 'Grace Hopper'),
      'a person became an announcement');
    const withContacts = items.filter(it => /ada@example\.org/.test(it.body + it.link));
    assert(withContacts.length, 'the contact email vanished entirely');
  });

  // A two-column table is a table of facts. Read cell by cell the pairing is lost.
  test('a sponsor table keeps its pairs together', () => {
    const sponsors = find(items, 'COFFEE HOUR SPONSORS');
    has(sponsors.body, 'Aug 30 — Dickinson', 'the date and the name on one line');
    has(sponsors.body, 'Sept 13 — TBD');
    lacks(sponsors.body, 'SUNDAY — SPONSOR', 'column headers are scaffolding');
    assert(!items.some(it => it.title === 'SPONSOR' || it.title === 'SUNDAY'),
      'a column header became an announcement');
  });

  // The QR code carries the URL now, so the URL comes out of the sentence —
  // and must not leave its brackets standing empty.
  test('a link lifted out of a sentence leaves no litter', () => {
    const give = find(items, 'Online Donations');
    lacks(give.body, '()', 'empty brackets left where the URL was');
    lacks(give.body, 'https://', 'a raw URL on a TV slide helps nobody');
    has(give.link, 'example.org/give', 'the URL still went to the QR code');
  });

  /* ---------------------------------------------------------- shortened -- */

  // A shortener scans fine and then parks the visitor on an advertising page
  // with a countdown. From across the hall that reads as the parish's screen
  // being broken, and there is nothing gained: a QR code does not care how
  // long the address is.
  test('link shorteners are recognised for what they are', () => {
    const short = global.Eml.isShortenedUrl;
    ['https://tinyurl.com/abc123', 'https://bit.ly/xyz', 'http://www.ow.ly/q',
     'https://rb.gy/abc'].forEach(u =>
      assert(short(u), u + ' should be seen as a shortened link'));

    ['https://sainteliaschurch.org/give', 'mailto:office@example.org',
     'https://steliasaustin.breezechms.com/form/welcome',
     ''].forEach(u =>
      assert(!short(u), JSON.stringify(u) + ' is not a shortener'));
  });

  test('the real address is taken over the shortener when the email shows it', () => {
    const retreat = find(items, 'Parish Retreat');
    lacks(retreat.link, 'tinyurl', 'the shortener was kept over the real address');
    has(retreat.link, 'example.org/retreat', 'the address the newsletter printed');
  });

  test('a shortener with nothing to recover is kept, and reported', () => {
    const choirs = items.filter(it => /Choir Practice/.test(it.title));
    assert(choirs.length, 'the announcement went missing');
    // Nothing to recover: the link text is the shortener too. Keeping it beats
    // dropping the only address there is — the editor is told about it instead.
    has(choirs[0].link, 'tinyurl.com/xyz789');
    assert(global.Eml.isShortenedUrl(choirs[0].link),
      'the editor has to be able to tell that this one needs replacing');
  });

  test('none of the parish\'s own sign-up links go through a shortener', () => {
    const cfg = global.KIOSK_CONFIG;
    [['coffee hour', cfg.coffeeHour && cfg.coffeeHour.signupUrl],
     ['holy bread', cfg.holyBread && cfg.holyBread.signupUrl],
     ['welcome', cfg.welcome && cfg.welcome.formUrl]].forEach(pair => {
      if (!pair[1]) return;
      assert(!global.Eml.isShortenedUrl(pair[1]),
        'the ' + pair[0] + ' QR code points at a shortener: ' + pair[1]);
    });
  });

  // The editor used to shorten links through TinyURL automatically, on every
  // import, which is how tinyurls got onto the wall in the first place. No
  // path through this code may hand a parish address to a shortener again.
  test('nothing in the editor sends links away to be shortened', async () => {
    const src = await fetch('assets/js/import-ui.js').then(r => r.text());
    lacks(src, 'api-create.php', 'the TinyURL endpoint is back');
    lacks(src, 'tinyurl.com/api', 'something is calling a shortener');
  });

  test('campaign tracking comes off a link, and nothing else does', () => {
    const cases = [
      ['https://example.org/form?utm_source=newsletter&utm_medium=email',
       'https://example.org/form'],
      ['https://example.org/f?id=7&utm_campaign=fall&mc_eid=abc',
       'https://example.org/f?id=7'],
      ['https://example.org/give', 'https://example.org/give'],
      ['https://example.org/a?fbclid=xyz#section', 'https://example.org/a#section'],
      ['mailto:office@example.org', 'mailto:office@example.org'],
    ];
    cases.forEach(pair => {
      const got = global.Importer.tidyUrl(pair[0]);
      assert(got === pair[1], JSON.stringify(pair[0]) + '\n   became ' +
        JSON.stringify(got) + '\n   wanted ' + JSON.stringify(pair[1]));
    });
  });

  // Breeze wraps every newsletter link in ~1000 characters of click tracking.
  // A QR code of that is unscannable, which is the whole reason the editor
  // used to reach for a shortener. The address behind it is asked for instead.
  test('the links worth unwrapping are the wrapped ones, and only those', () => {
    const needs = global.Unwrap.needsUnwrapping;
    assert(needs('https://links.breezechms.com/ls/click?upn=' + 'x'.repeat(900)),
      'a Breeze click wrapper has to be unwrapped');
    assert(needs('https://tinyurl.com/abc123'), 'so does a shortener');

    ['https://sainteliaschurch.org/give', 'mailto:office@example.org',
     'https://steliasaustin.breezechms.com/form/welcome', '', 'not a url']
      .forEach(u => assert(!needs(u),
        JSON.stringify(u) + ' should be left alone'));
  });

  test('the welcome slide is configured well enough to build', () => {
    const w = global.KIOSK_CONFIG.welcome || {};
    assert(String(w.formUrl || '').trim(), 'no welcome form to scan');
    assert(String(w.title || '').trim(), 'the welcome slide needs a heading');
    assert(/^https?:\/\//.test(w.formUrl), 'the form address needs its https://');
  });

  test('office housekeeping arrives switched off, not deleted', () => {
    const note = find(items, 'Note on Announcements');
    assert(note.include === false, 'should be off by default');
    assert(note.body.trim().length, 'but still there for whoever wants it');
  });

  test('a heading with nothing under it is a section, not a slide', () => {
    const news = find(items, 'Parish News');
    assert(news.isSection, 'Parish News should be marked as a section heading');
    assert(news.include === false, 'and not go to the TV on its own');
  });

  /* ------------------------------------------------- keeping your place -- */

  // Four sources each rebuild the whole deck when their own content changes,
  // and at start-up they all land within seconds of each other. Restarting the
  // rotation at slide 0 each time played the day's saints three times over
  // before the hall saw anything else.
  test('a rebuilt deck carries on from the slide on screen', () => {
    const K = global.Deck.keepPosition;
    const s = t => ({ title: t, body: t + ' body' });
    const a = s('Saints'), b = s('Services'), c = s('Church School'), d = s('Holy Bread');

    // The day's saints arrive and are inserted at the front while "Services"
    // is on screen. The rotation must stay on Services, not jump back.
    assert(K(b, [a, b, c], 0) === 1,
      'the slide on screen moved but the rotation did not follow it');

    // Same deck, nothing changed: stay put.
    assert(K(c, [a, b, c], 2) === 2, 'a no-op rebuild moved the rotation');

    // The slide on screen was deleted — hold the position, clamped.
    assert(K(s('Deleted'), [a, b], 5) === 1, 'position not clamped to the new length');
    assert(K(s('Deleted'), [a, b, c, d], 2) === 2, 'position not held');

    // Nothing to show, and nothing to divide by.
    assert(K(a, [], 3) === 0, 'an empty deck has no position but 0');
    assert(K(null, [a, b], 1) === 1, 'no current slide should hold the position');
  });

  test('two slides that read the same are treated as the same slide', () => {
    const K = global.Deck.keepPosition;
    const key = global.Deck.slideKey;
    const a = { title: 'Holy Bread', body: 'We are always in need of holy bread.' };
    const same = { title: 'Holy Bread', body: 'We are always in need of holy bread.' };
    const edited = { title: 'Holy Bread', body: 'Completely different words here.' };

    assert(key(a) === key(same), 'an identical slide should match itself');
    assert(key(a) !== key(edited), 'an edited body should not match');

    // A sign-up slide has no body at all — it must still be recognisable.
    const sign = { kind: 'signup', title: 'Coffee Hour Sign-Up', entries: [1, 2] };
    const signLater = { kind: 'signup', title: 'Coffee Hour Sign-Up', entries: [1, 2, 3] };
    assert(key(sign) === key(signLater),
      'a sign-up slide gaining a Sunday is still the same slide');
    assert(K(sign, [a, signLater], 1) === 1, 'the sign-up slide lost its place');
  });

  /* --------------------------------------------------------- how it looks -- */

  const buildOneOfEach = () => [
    { what: 'words only', slide: { title: 'Text only', body: 'No link, no picture.' } },
    { what: 'words and a code', slide: { title: 'With a QR', body: 'Words and a code.',
        link: 'https://example.org', linkLabel: 'Scan' } },
    { what: 'words, picture and a code', slide: { title: 'With a photo', body: 'All three.',
        link: 'https://example.org', linkLabel: 'Scan', image: 'assets/img/photo.jpg' } },
  ];

  test('every kind of slide gets the ornament under its title', () => {
    buildOneOfEach().forEach(c => {
      const el = global.Slide.buildSlideEl(c.slide);
      const rule = el.querySelector('.slide__rule');
      assert(rule, c.what + ': no ornament under the title');
      assert(rule.tagName.toLowerCase() === 'svg',
        c.what + ': the ornament should be drawn, not a styled div');
      assert(el.querySelectorAll('.rule__cross').length === 1,
        c.what + ': the cross is missing from the ornament');
    });
  });

  /* ---------------------------------------------------- nothing runs over -- */

  /*
   * The screen is no longer all stage. A sign-up rail takes a quarter of the
   * width and a welcome band takes a slice of the height, and what is left is
   * what every slide has to fit inside.
   *
   * fitToBox has always shrunk the words. Nothing ever shrank the codes: they
   * are sized in vh, a fraction of the height of the SCREEN, not of the box
   * they stand in. A staff directory carrying three or four of them ran them
   * straight off the bottom of the stage and printed them over the sign-ups
   * underneath. This is that case.
   */

  const manyLinks = (n) => ({
    title: 'Parish Staff',
    body: 'Reach any of us directly.',
    link: Array.from({ length: n }, (_, i) => 'https://example.org/person' + i).join('\n'),
    linkLabel: Array.from({ length: n }, (_, i) => 'Person Number ' + i).join('\n'),
  });

  /*
   * This page has no stylesheet — it is a test report, and loading the kiosk's
   * own would hide its results behind `overflow: hidden`. So the fixture is
   * given the handful of rules the measurement actually depends on, copied
   * from kiosk.css: a stage that clips, a slide filling it, and codes that
   * start at the size the stylesheet starts them at. If those rules change
   * over there, change them here too — or this passes while the hall breaks.
   */
  const STAGE_CSS =
    '.t-stage { position: relative; overflow: hidden; }' +
    '.t-stage .slide { position: absolute; inset: 0; display: grid; gap: 0 4vw;' +
      ' align-items: center; padding: 2.2vh 0 1.4vh; }' +
    '.t-stage .slide--qr { grid-template-columns: 1fr auto; }' +
    '.t-stage .slide__main { min-width: 0; min-height: 0; height: 100%; overflow: hidden; }' +
    '.t-stage .slide__qr { justify-self: center; }' +
    '.t-stage .qr { display: flex; flex-direction: column; align-items: center; gap: 1.3vh; }' +
    '.t-stage .qr-group { display: flex; flex-direction: column; align-items: center;' +
      ' gap: 1.6vh; }' +
    '.t-stage .qr__frame { width: 194px; padding: 1.5vh; box-sizing: border-box;' +
      ' line-height: 0; }' +
    '.t-stage .qr__svg { width: 100%; height: auto; display: block; }' +
    '.t-stage .qr__label { margin: 0; max-width: 194px; font-size: 14px; }';

  let stageCssEl = null;
  function ensureStageCss() {
    if (stageCssEl) return;
    stageCssEl = document.createElement('style');
    stageCssEl.textContent = STAGE_CSS;
    document.head.appendChild(stageCssEl);
  }

  /*
   * The rules above are stage geometry only — enough to hang a slide in a box
   * of a known size. Anything measuring how *tall* words come out needs the
   * parish's real typography, because that is what decides it: the line
   * height, the space between paragraphs, and the column rules the fitter
   * falls back on. Loaded from the stylesheet the TV uses rather than copied,
   * so these checks cannot quietly drift away from what is on the wall.
   *
   * Scoped under .t-stage so the report page keeps its own plain styling; the
   * kiosk's own selectors are all more specific than the bare element rules
   * it also carries, which is why the scoping holds.
   */
  let kioskCssEl = null;
  function ensureKioskCss() {
    ensureStageCss();
    if (kioskCssEl) return Promise.resolve();
    return fetch('assets/css/kiosk.css')
      .then(r => r.text())
      .then(css => {
        kioskCssEl = document.createElement('style');
        kioskCssEl.textContent = scopeToStage(css);
        document.head.appendChild(kioskCssEl);
      });
  }

  function scopeToStage(css) {
    return css.replace(/(^|\})([^@{}]+)\{/g, (whole, brace, selectors) => {
      if (/^\s*$/.test(selectors) || /^\s*(from|to|\d)/.test(selectors)) return whole;
      const scoped = selectors.split(',')
        .map(sel => '.t-stage ' + sel.trim())
        .join(', ');
      return brace + scoped + '{';
    });
  }

  /** Put a slide in a stage of a given size, fit it, and measure the damage. */
  function fitInBox(slide, width, height) {
    ensureStageCss();

    const box = document.createElement('div');
    box.className = 't-stage';
    box.style.cssText = 'width:' + width + 'px;height:' + height + 'px';
    document.body.appendChild(box);

    const el = global.Slide.buildSlideEl(slide);
    box.appendChild(el);

    const before = el.scrollHeight - el.clientHeight;
    const qr = global.Slide.fitQrColumn(el);
    const after = el.scrollHeight - el.clientHeight;
    const frame = el.querySelector('.qr__frame');
    const frameWidth = frame ? frame.getBoundingClientRect().width : 0;

    box.remove();
    return { before, after, qr, frameWidth };
  }

  test('a slide carrying several codes does not run off a short stage', () => {
    const r = fitInBox(manyLinks(3), 1275, 610);
    assert(r.before > 0,
      'the fixture is meant to overflow before it is fitted — it did not, so this ' +
      'check is no longer testing anything');
    assert(r.after <= 0,
      'three codes still overflow the stage by ' + r.after + 'px — on the TV they ' +
      'would be drawn over the sign-ups underneath');
  });

  test('the codes are what shrink, and only as far as they have to', () => {
    const roomy = fitInBox(manyLinks(3), 1275, 1000);
    const tight = fitInBox(manyLinks(3), 1275, 560);
    assert(tight.frameWidth < roomy.frameWidth,
      'a shorter stage should have produced smaller codes (' +
      Math.round(tight.frameWidth) + 'px vs ' + Math.round(roomy.frameWidth) + 'px)');
    assert(tight.frameWidth >= 84,
      'shrunk past what a phone can read: ' + Math.round(tight.frameWidth) + 'px');
  });

  /*
   * A schedule too long for one screen gets trimmed. The trim used to cut
   * wherever the words ran out, which on a real "Services This Week" row
   * landed inside "**Saturday, Sept. 12**" and put "**Saturday, Sept." on the
   * TV \u2014 asterisks and all, with nothing underneath it. Where exactly the
   * cut falls depends on the screen, so every cut is checked rather than the
   * one that happened to be reported.
   */
  const WEEK_OF_SERVICES = [
    '**Sunday, Sept. 6**',
    'Orthros - 8:30 AM',
    'Divine Liturgy - 9:30 AM (Miracle of the Archangel Michael in Colossae)',
    '',
    '**Monday, Sept. 7**',
    'Great Vespers - 6:00 PM \u2013 Romanian Orthodox Church, Cedar Park',
    '',
    '**Tuesday, Sept. 8**',
    'Divine Liturgy - 10:00 AM (Nativity of the Theotokos) \u2013 Romanian Orthodox Church, Cedar Park',
    '',
    '**Wednesday, Sept. 9**',
    'Vespers - 6:00 PM',
    '',
    '**Saturday, Sept. 12**',
    'Great Vespers - 5:00pm',
    '',
    '**Sunday, Sept. 13**',
    'Orthros - 8:30 AM',
    'Divine Liturgy - 9:30 AM (Sunday Before the Cross)',
  ].join('\n');

  const BARE_DAY = /^(sun|mon|tues?|wed(nes)?|thur?s?|fri|sat(ur)?)day\b.{0,24}$/i;

  test('no cut of a schedule ends on raw asterisks or an empty day', () => {
    const h = global.Slide.trimHelpers;
    for (let n = 0; n <= WEEK_OF_SERVICES.length; n++) {
      const cut = h.dropDanglingHeading(
        h.balanceEmphasis(h.preferSentenceBoundary(h.cutAtWord(WEEK_OF_SERVICES, n))),
        WEEK_OF_SERVICES);
      const rendered = renderToDiv(cut);
      const shown = rendered.textContent;
      const lastBlock = rendered.lastElementChild;
      const tail = lastBlock ? lastBlock.textContent.trim() : '';

      assert(!/\*/.test(shown),
        'cut at ' + n + ' left markup on the screen: ' + JSON.stringify(shown.slice(-50)));
      assert(!(lastBlock && lastBlock.tagName === 'H3'),
        'cut at ' + n + ' ends on a heading with nothing under it: ' + JSON.stringify(tail));
      assert(!BARE_DAY.test(tail),
        'cut at ' + n + ' ends on a day with no services under it: ' + JSON.stringify(tail));
    }
  });

  function renderToDiv(body) {
    const d = document.createElement('div');
    d.innerHTML = global.Slide.renderBody(body);
    return d;
  }

  /*
   * A week of services is a dozen short lines down the middle of a screen
   * twice as wide as they need. It used to be cut in half with a pointer to
   * the bulletin; it is now set in two columns instead, and only cut if even
   * that will not hold it.
   */
  /*
   * The stage the announcements actually get: a 1920x1080 screen, less the
   * topbar, the sign-up rail, the welcome band and the footer. Measured off
   * index.html rather than guessed, because the whole question here is
   * whether a week of services fits in it.
   */
  const STAGE_W = 1786, STAGE_H = 619;

  function fitBodyInBox(slide, width, height) {
    const box = document.createElement('div');
    box.className = 't-stage';
    box.style.cssText = 'width:' + width + 'px;height:' + height + 'px';
    document.body.appendChild(box);

    const el = global.Slide.buildSlideEl(slide);
    box.appendChild(el);
    const result = global.Slide.fitToBox(el.querySelector('.slide__main'),
                                         el.querySelector('.slide__fit'),
                                         { minPx: 26, maxPx: 62 });
    const bodyEl = el.querySelector('.slide__body');
    const out = {
      result,
      text: bodyEl.textContent,
      groups: Array.from(el.querySelectorAll('.slide__group'))
                   .map(g => g.textContent.trim()),
      // Heights in reading order, and how many groups each column took, so a
      // check can work out for itself whether a better split was available.
      heights: Array.from(el.querySelectorAll('.slide__group'))
                    .map(g => g.getBoundingClientRect().height),
      perColumn: Array.from(el.querySelectorAll('.slide__col'))
                      .map(c => c.children.length),
      columnHeights: Array.from(el.querySelectorAll('.slide__col'))
                          .map(c => c.getBoundingClientRect().height),
      // The space a column puts between one day and the next, which any
      // arithmetic about column heights has to include.
      gap: (() => {
        const col = el.querySelector('.slide__col');
        return col ? parseFloat(getComputedStyle(col).rowGap) || 0 : 0;
      })(),
    };
    box.remove();
    return out;
  }

  /** The shortest possible tallest column, over every way of cutting in two. */
  function bestPossibleTallest(heights, gap) {
    const run = part => part.reduce((a, b) => a + b, 0) + (part.length - 1) * gap;
    let best = Infinity;
    for (let cut = 1; cut < heights.length; cut++) {
      best = Math.min(best, Math.max(run(heights.slice(0, cut)),
                                     run(heights.slice(cut))));
    }
    return best;
  }

  test('a week of services is set in columns rather than cut', async () => {
    await ensureKioskCss();
    const r = fitBodyInBox({ title: 'Services This Week', body: WEEK_OF_SERVICES },
                           STAGE_W, STAGE_H);
    assert(r.result.columns >= 2,
      'the schedule was not divided into columns \u2014 it fitted in one at ' +
      Math.round(r.result.px) + 'px, so this check is no longer testing anything');
    assert(r.result.trimmed === false,
      'the schedule was still cut short even in ' + r.result.columns + ' columns');

    const tallest = Math.max.apply(null, r.columnHeights);
    assert(tallest <= bestPossibleTallest(r.heights, r.gap) + 2,
      'the columns were split ' + r.perColumn.join('/') + ', which is not the ' +
      'evenest split the days allow');

    // Every day in the Sheet reaches the screen, which is the whole point.
    ['Sept. 6', 'Sept. 7', 'Sept. 8', 'Sept. 9', 'Sept. 12', 'Sept. 13'].forEach(day => {
      assert(r.text.indexOf(day) !== -1, day + ' never made it onto the slide');
    });
  });

  test('a day and its services stay in the same column', async () => {
    await ensureKioskCss();
    const r = fitBodyInBox({ title: 'Services This Week', body: WEEK_OF_SERVICES },
                           STAGE_W, STAGE_H);
    assert(r.groups.length > 0, 'nothing was grouped, so nothing was holding the days together');
    r.groups.forEach(g => {
      assert(!BARE_DAY.test(g),
        'a day heading was left as a group of its own \u2014 its services can now ' +
        'fall into the next column: ' + JSON.stringify(g));
    });
  });

  /*
   * A parish week is not six days of the same size — the Sunday carries half
   * the services in it. Giving each column the same *number* of days therefore
   * gives them very different heights, which is exactly what CSS multi-column
   * does and what this fixture is shaped to catch: three days a side would
   * leave one column towering over the other, and two-and-four does not.
   */
  const LOPSIDED_WEEK = [
    ['Sunday, Sept. 6', 'Orthros - 8:30 AM', 'Divine Liturgy - 9:30 AM',
     'Church School - 11:15 AM', 'Catechism - 12:30 PM', 'Paraklesis - 5:00 PM',
     'Great Vespers - 6:30 PM'],
    ['Monday, Sept. 7', 'Vespers - 6:00 PM'],
    ['Tuesday, Sept. 8', 'Divine Liturgy - 10:00 AM'],
    ['Wednesday, Sept. 9', 'Vespers - 6:00 PM'],
    ['Thursday, Sept. 10', 'Paraklesis - 6:00 PM'],
    ['Friday, Sept. 11', 'Akathist - 6:00 PM'],
  ].map(([day, ...services]) => ['**' + day + '**'].concat(services).join('\n'))
   .join('\n\n');

  test('the columns are divided as evenly as the days allow', async () => {
    await ensureKioskCss();
    const r = fitBodyInBox({ title: 'Services This Week', body: LOPSIDED_WEEK },
                           STAGE_W, STAGE_H);
    assert(r.result.columns === 2,
      'expected two columns, got ' + (r.result.columns || 'one'));

    // No other way of cutting this week in two would have left a shorter
    // tallest column. That is the promise the balancing makes.
    const tallest = Math.max.apply(null, r.columnHeights);
    const best = bestPossibleTallest(r.heights, r.gap);
    assert(tallest <= best + 2,
      'the columns were split ' + r.perColumn.join('/') + ', leaving a ' +
      Math.round(tallest) + 'px column where ' + Math.round(best) +
      'px was available');

    // And specifically not down the middle, which is what it looks like when
    // the split is counting days instead of measuring them.
    assert(r.perColumn[0] !== r.perColumn[1],
      'this week is lopsided on purpose; an even split of it means the ' +
      'heights are not being measured at all');
  });

  test('a full Holy Week still fits without being cut', async () => {
    await ensureKioskCss();
    const holyWeek = [
      ['Palm Sunday, April 12', 'Orthros - 8:30 AM', 'Divine Liturgy - 9:30 AM',
       'Bridegroom Matins - 6:30 PM'],
      ['Holy Monday, April 13', 'Presanctified Liturgy - 9:00 AM',
       'Bridegroom Matins - 6:30 PM'],
      ['Holy Tuesday, April 14', 'Presanctified Liturgy - 9:00 AM',
       'Bridegroom Matins - 6:30 PM'],
      ['Holy Wednesday, April 15', 'Presanctified Liturgy - 9:00 AM',
       'Holy Unction - 6:30 PM'],
      ['Holy Thursday, April 16', 'Vesperal Liturgy - 9:00 AM',
       'The Twelve Gospels - 6:30 PM'],
      ['Holy Friday, April 17', 'Royal Hours - 9:00 AM', 'Apokathelosis - 3:00 PM',
       'Lamentations - 6:30 PM'],
      ['Holy Saturday, April 18', 'Vesperal Liturgy - 9:00 AM',
       'Resurrection Service - 11:30 PM'],
      ['Pascha, April 19', 'Agape Vespers - 12:00 PM'],
    ].map(([day, ...services]) => ['**' + day + '**'].concat(services).join('\n'))
     .join('\n\n');

    const r = fitBodyInBox({ title: 'Services This Week', body: holyWeek },
                           STAGE_W, STAGE_H);
    assert(r.result.trimmed === false, 'Holy Week was cut short');
    assert(r.text.indexOf('Pascha') !== -1, 'Pascha never made it onto the slide');
  });

  test('an ordinary announcement is not turned into a newspaper', async () => {
    await ensureKioskCss();
    const prose = 'Coffee hour follows the Divine Liturgy this Sunday in the hall. ' +
      'Everyone is welcome, and there is no need to bring anything. ' +
      'Please stay a while and meet somebody you have not met.';
    const r = fitBodyInBox({ title: 'Coffee Hour', body: prose }, STAGE_W, STAGE_H);
    assert(!r.result.columns, 'prose was split into columns, which reads as a newspaper');
  });

  test('a slide that already fits is left alone', () => {
    const r = fitInBox({ title: 'One code', body: 'Short.', link: 'https://example.org',
      linkLabel: 'Scan' }, 1275, 1000);
    assert(r.qr.shrunk === false, 'nothing needed shrinking, but something was shrunk');
  });

  /* ------------------------------------------------------- the sign-up rail -- */

  /*
   * Coffee Hour and Holy Bread do not rotate. They stand in a column of their
   * own, and the whole point of that column is that somebody can see who has
   * which Sunday, and which are still free, at any moment rather than once
   * every two minutes. These check that the column actually says both.
   */

  const aCard = (over) => Object.assign({
    kind: 'signup',
    title: 'Coffee Hour',
    entries: [
      { shortLabel: 'Aug 30', label: 'Sunday, August 30', filled: true, name: 'Marina Haddad' },
      { shortLabel: 'Sep 6', label: 'Sunday, September 6', filled: false, name: null },
      { shortLabel: 'Sep 13', label: 'Sunday, September 13', filled: false, name: null,
        fastName: 'Fast' },
    ],
    openCount: 2,
    qrUrl: 'https://example.org/signup',
    qrLabel: 'Scan to host',
  }, over || {});

  test('a sign-up card names who has each Sunday and marks the open ones', () => {
    const el = global.Slide.buildSignupCardEl(aCard());
    const rows = el.querySelectorAll('.card__row');
    assert(rows.length === 3, 'every Sunday should get a row, got ' + rows.length);

    assert(rows[0].classList.contains('is-filled'), 'a claimed Sunday reads as filled');
    assert(/Marina Haddad/.test(rows[0].textContent),
      'the person who signed up should be named on the row');

    assert(rows[1].classList.contains('is-open'), 'an unclaimed Sunday reads as open');
    assert(/Open/.test(rows[1].textContent), 'an unclaimed Sunday should say so');

    assert(el.querySelector('.card__fast'), 'the fasting badge went missing');
    assert(el.querySelector('.qr__frame svg'), 'the card should carry a scannable code');
  });

  test('a sign-up card uses the short date, which is all the row has room for', () => {
    const el = global.Slide.buildSignupCardEl(aCard());
    const first = el.querySelector('.card__date').textContent;
    assert(/Aug 30/.test(first), 'expected the short date, got: ' + first);
    assert(!/Sunday/.test(first),
      'every date in this list is a Sunday — the word only costs the name room');
  });

  test('a full sign-up sheet says so in words', () => {
    const full = global.Slide.buildSignupCardEl(aCard({ openCount: 0 }));
    assert(/spoken for/.test(full.querySelector('.card__count').textContent),
      '"0 of the next 3 Sundays open" is not a sentence anybody should have to parse');

    const some = global.Slide.buildSignupCardEl(aCard());
    assert(/2 of the next 3/.test(some.querySelector('.card__count').textContent),
      'the count line should say how many Sundays are going begging');
  });

  // A photograph gets a white mount and a drop shadow, which is what makes it
  // look like a print on the wall. Around a cut-out — an icon on a transparent
  // ground — that mount is just a box drawn in mid-air.
  test('a transparent picture is shown without a photo mount', () => {
    const cut = global.Slide.buildSlideEl({ title: 'Welcome', body: 'Hello.',
      image: 'assets/img/welcome-prophet-elias.png' });
    assert(cut.querySelector('.slide__image--plain'),
      'a .png should be treated as a cut-out');

    const photo = global.Slide.buildSlideEl({ title: 'Festival', body: 'Come along.',
      image: 'assets/img/photo.jpg' });
    assert(photo.querySelector('.slide__image'), 'the photo went missing');
    assert(!photo.querySelector('.slide__image--plain'),
      'a .jpg is a photograph and keeps its mount');
  });

  test('the welcome slide points at a picture that exists', async () => {
    const src = global.KIOSK_CONFIG.welcome && global.KIOSK_CONFIG.welcome.image;
    if (!src) return;                       // configured without one: fine
    const res = await fetch(src, { method: 'GET' });
    assert(res.ok, 'the welcome slide names ' + src + ' but it is not there (' +
      res.status + '). The slide still renders, without it.');
  });

  /* -------------------------------------------------- how fast it goes -- */

  // The speed lives in the Sheet so it can be changed by whoever is standing
  // in the hall finding the slides too quick, rather than by editing a file.
  test('the slide speed is read from the Sheet, and nonsense is ignored', () => {
    const S = global.Deck.secondsFrom;
    const rows = v => [{ title: 'A', secondsperslide: '' }, { title: 'B', secondsperslide: v }];

    assert(S(rows('20')) === 20, 'a plain number should be read');
    assert(S(rows(18)) === 18, 'so should one the CSV parsed as a number');
    assert(S(rows('12.6')) === 13, 'a decimal should round');

    // Nothing to say: the television falls back to config.js rather than
    // taking a guess or stopping on one slide forever.
    assert(S([{ title: 'A' }]) === null, 'a Sheet without the column says nothing');
    assert(S([{ title: 'A', publishedby: 'X' }]) === null, 'nor does an older Sheet');
    assert(S(rows('')) === null, 'an empty cell says nothing');
    assert(S(rows('soon')) === null, 'and neither does a word');
    assert(S(rows('0')) === null, 'zero would stop the rotation dead');
    assert(S(rows('-5')) === null, 'so would a negative');

    // A typo in a spreadsheet cell should not leave the hall on one slide for
    // three hours, nor flicker past unreadably.
    assert(S(rows('9999')) === 120, 'an absurd number is clamped down');
    assert(S(rows('1')) === 4, 'and a too-quick one is clamped up');
  });

  /* ------------------------------------------------ shapes, without a file -- */

  test('one day over one paragraph is still an ordinary announcement', () => {
    const B = (text, bold) => ({ text: text, bold: !!bold, link: '', linkLabel: '' });
    const out = global.Importer.splitBlocks([
      B('Parish Picnic', true),
      B('Sunday, Sept. 6 -', true),
      B('Join us at noon in the hall for the picnic, rain or shine.'),
    ]);
    assert(out.some(it => /Sunday, Sept\. 6/.test(it.title)),
      'a lone day was folded into a schedule that does not exist');
  });

  test('the pasted-text route folds the schedule the same way', () => {
    const out = global.Importer.split(
      'Service Schedule\n\nTuesday, Sept. 1 -\nVespers 6:00 PM\n\n' +
      'Sunday, Sept. 6 -\nOrthros 8:30 AM\n\nChurch School\n' +
      'We are excited to welcome our children back to Church School this September.');
    const svc = out.filter(it => /Service Schedule|Services This Week/i.test(it.title))[0];
    assert(svc, 'no schedule came out of the pasted text: ' +
      JSON.stringify(out.map(o => o.title)));
    has(svc.body, '## Tuesday, Sept. 1');
    has(svc.body, '## Sunday, Sept. 6');
  });

  test('an empty upload is reported, never silently ignored', () => {
    // The UI's own guard is a toast; here we only check the parser does not
    // pretend an empty file was a newsletter.
    assert(global.Importer.splitEml('').length === 0,
      'empty input produced announcements out of nowhere');
  });

  /* ------------------------------------------------------------- running -- */

  async function run(report) {
    const raw = await fetch('sample/newsletter-fixture.eml.txt').then(r => r.text());
    items = global.Importer.splitEml(raw);

    let passed = 0;
    const failures = [];
    for (const t of T) {
      // Awaited, because several of these checks fetch a file before they can
      // say anything. Without the await an async check hands back a promise,
      // the promise is counted as a pass, and whatever it went on to find is
      // reported to nobody -- a green page that has not checked anything.
      try { await t.fn(); passed++; report(true, t.name); }
      catch (err) { failures.push({ name: t.name, err: err }); report(false, t.name, err); }
    }
    return { passed: passed, failed: failures.length, failures: failures, items: items };
  }

  global.ImportTests = { run: run, get items() { return items; } };

})(window);
