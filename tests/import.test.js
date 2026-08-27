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
      try { t.fn(); passed++; report(true, t.name); }
      catch (err) { failures.push({ name: t.name, err: err }); report(false, t.name, err); }
    }
    return { passed: passed, failed: failures.length, failures: failures, items: items };
  }

  global.ImportTests = { run: run, get items() { return items; } };

})(window);
