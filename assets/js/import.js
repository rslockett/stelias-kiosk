/* ============================================================================
   import.js — turning the weekly email into slide rows
   ----------------------------------------------------------------------------
   Paste the announcements email, get back one editable card per announcement,
   then copy them as spreadsheet rows.

   The splitting is a best guess, not magic. That is on purpose: the editor sees
   and corrects everything before it reaches the Sheet, so a surprising email
   format produces an awkward first draft rather than a wrong TV screen.
   ========================================================================== */

(function (global) {
  'use strict';

  /* ------------------------------------------------------- email cleanup -- */

  // Lines that are email plumbing rather than parish news.
  const CHROME = [
    /^view (this )?(email|message) in (your )?browser/i,
    /^having trouble (viewing|reading)/i,
    /^unsubscribe\b/i,
    /^you (are|'re) receiving this/i,
    /^this email was sent to/i,
    /^update (your )?(subscription|preferences)/i,
    /^manage (your )?(subscription|preferences)/i,
    /^add us to your address book/i,
    /^forward (this )?(email )?to a friend/i,
    /^copyright\b/i,
    /^\(c\)\s*20\d{2}/i,
    /^©/,
    /^all rights reserved/i,
    /^sent (from|via)\b/i,
    /^click here to/i,
    /^\**\s*$/,
    /^[-=_*~—]{3,}$/,            // divider rules
    /^\|?\s*$/,
  ];

  function isChrome(line) {
    const l = line.trim();
    if (!l) return false;
    return CHROME.some(re => re.test(l));
  }

  /** Strip HTML tags in case someone pastes rich text into the box. */
  function stripTags(s) {
    if (!/<[a-z!/]/i.test(s)) return s;
    const d = document.createElement('div');
    d.innerHTML = s;
    return d.textContent || '';
  }

  function cleanup(raw) {
    let text = stripTags(String(raw));

    text = text
      .replace(/\r\n?/g, '\n')
      .replace(/ /g, ' ')                    // non-breaking spaces
      .replace(/[​-‍﻿]/g, '')      // zero-width junk
      .replace(/[ \t]+$/gm, '');

    const lines = text.split('\n').filter(l => !isChrome(l));

    // Everything after a footer marker is almost never an announcement.
    const cutIdx = lines.findIndex(l =>
      /^(unsubscribe|our mailing address|St\.? Elias Orthodox Church\s*$)/i.test(l.trim()));
    const kept = cutIdx > 3 ? lines.slice(0, cutIdx) : lines;

    return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  /* --------------------------------------------------------- heading test -- */

  const HEADINGish = /^[\s]*(?:[►▶•*\-–—]|\d+[.)])?\s*(.{2,80}?)\s*:?\s*$/;

  /**
   * Does this line look like the title of an announcement rather than a
   * sentence inside one?
   */
  function looksLikeHeading(line, next) {
    const l = line.trim();
    if (!l) return false;
    if (l.length > 80) return false;

    // Markdown-ish or decorated headings people actually use in newsletters.
    if (/^#{1,4}\s+\S/.test(l)) return true;
    if (/^\*\*[^*]+\*\*:?$/.test(l)) return true;

    const words = l.split(/\s+/);
    if (words.length > 12) return false;

    const letters = l.replace(/[^A-Za-z]/g, '');
    if (!letters) return false;

    // SHOUTED HEADINGS
    const upperRatio = (l.replace(/[^A-Z]/g, '').length) / letters.length;
    if (upperRatio > 0.7 && letters.length > 3) return true;

    // Ends with a colon -> "Parish Picnic:"
    if (/:$/.test(l) && words.length <= 10) return true;

    // Title Case, no ending punctuation, and followed by actual body text.
    // "!" is allowed: parish headings really do end that way
    // ("Mediterranean Festival 2026 – Save the Date!").
    const endsClean = !/[.?,;]$/.test(l);
    const capsWords = words.filter(w => /^[A-Z0-9"'(]/.test(w)).length;
    const titleCase = capsWords / words.length >= 0.6;
    if (endsClean && titleCase && next && next.trim()) return true;

    return false;
  }

  function cleanHeading(line) {
    return line
      .replace(/^#{1,4}\s+/, '')
      .replace(/^\*\*|\*\*$/g, '')
      .replace(HEADINGish, '$1')
      .replace(/\s*:$/, '')
      .trim();
  }

  /* ------------------------------------------------------------- dates -- */

  const MONTH_RE = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';

  /** Pull the most likely "this happens on" date out of an announcement. */
  function findDate(text) {
    const patterns = [
      new RegExp('\\b' + MONTH_RE + '\\s+\\d{1,2}(?:\\s*,\\s*(?:20\\d{2}))?\\b', 'i'),
      /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/,
      new RegExp('\\b\\d{1,2}\\s+' + MONTH_RE + '(?:\\s+20\\d{2})?\\b', 'i'),
    ];
    for (const re of patterns) {
      const m = text.match(re);
      if (m) {
        const d = global.Deck.parseDate(m[0]);
        if (d) return toISO(d);
      }
    }
    return '';
  }

  function toISO(d) {
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  /* -------------------------------------------------------------- links -- */

  const URL_RE = /\bhttps?:\/\/[^\s<>()\[\]"']+/i;

  function extractLink(text) {
    const m = text.match(URL_RE);
    if (!m) return { link: '', body: text };

    let link = m[0].replace(/[.,;:]+$/, '');   // trailing sentence punctuation

    // Take the URL out of the readable text — the QR code carries it now, and a
    // raw link on a TV slide is noise nobody can act on.
    let body = text.replace(m[0], '').replace(/[ \t]{2,}/g, ' ');
    body = body
      .replace(/\b(sign up|register|rsvp|more info(rmation)?|details|link)\s*(here)?\s*[:\-–]?\s*$/gim, '')
      .replace(/^\s*[:\-–]\s*/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    return { link, body };
  }

  /**
   * "Scan to sign up" makes no sense next to an email QR code, and a bare
   * default gives no hint *whose* email it is when a card only has one.
   * Put the address right in the caption instead.
   */
  function defaultLabelFor(link) {
    if (/^mailto:/i.test(link)) {
      return 'Scan to email ' + link.replace(/^mailto:/i, '').split('?')[0];
    }
    return global.KIOSK_CONFIG.defaultQrLabel || 'Scan to sign up';
  }

  /* ------------------------------------------------------------- unwrap -- */

  /**
   * Email bodies arrive hard-wrapped at roughly 75 characters. Left alone,
   * every one of those wrapped lines becomes its own paragraph on the slide,
   * which looks like broken poetry. Rejoin them into real paragraphs, keeping
   * blank-line breaks and bullet lists intact.
   */
  // Roughly where an email client wraps a line. A line at least this long was
  // almost certainly broken by the wrapper rather than by the author.
  const WRAP_WIDTH = 62;

  function unwrapParagraphs(text, opts) {
    // Text pasted out of an email client arrives hard-wrapped and needs
    // rejoining. Text read from a .eml is already split on real block and <br>
    // boundaries, where a short line is a deliberate one — a service time, a
    // name, an address — so joining those would produce run-on nonsense.
    const rejoin = !opts || opts.rejoinWrapped !== false;

    const isBullet = l => /^\s*(?:[-•*·▪▸]|\d+[.)])\s+/.test(l);

    const out = [];
    let buf = '';
    let lastLen = 0;
    const flush = () => { if (buf.trim()) out.push(buf.trim()); buf = ''; };

    for (const raw of String(text).split('\n')) {
      const line = raw.trim();
      if (!line) { flush(); continue; }          // blank line = real paragraph break
      if (isBullet(line)) { flush(); out.push(line); lastLen = 0; continue; }

      if (!buf) { buf = line; }
      else if (rejoin && lastLen >= WRAP_WIDTH) { buf += ' ' + line; }
      else { flush(); buf = line; }

      lastLen = line.length;
    }
    flush();

    return out.join('\n');
  }

  const BULLET_RE = /^\s*(?:[-•*·]|\d+[.)])\s+/;
  // "Fr. Elias Murphy, Pastor – fr.elias@..." / "Cost: $125" — a separator
  // partway through the line, the shape of one entry in a directory or list.
  const LISTY_SEP = /\s[–—-]\s|:\s+\S/;

  // A line that is somebody and their address, with nothing after it. slide.js
  // lays a run of these out as a proper contact block — names aligned, every
  // row the same shape — so they must NOT be turned into bullets on the way in.
  // Bulleting them was what produced the ragged directory: one entry fitting
  // on its line and the next two wrapping, all three differently.
  const CONTACT_LINE =
    /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}[).,\s]*$/;

  function looksLikeContactRun(lines) {
    return lines.length >= 2 && lines.every(l => CONTACT_LINE.test(l.trim()));
  }

  /* --------------------------------------------------------- day headings -- */

  const DAY_NAME = '(?:sun|mon|tues?|wed(?:nes)?|thur?s?|fri|sat(?:ur)?)(?:day)?';

  // "Saturday" / "Sunday, August 23" / "Friday 10/16" — a day, optionally
  // carrying its date. The date part is spelled out rather than left as a
  // wildcard so that "Sunday school resumes in September" stays a sentence.
  const DAY_HEADING_RE = new RegExp(
    '^' + DAY_NAME +
    '(?:\\s*,?\\s*(?:' + MONTH_RE + '\\s+\\d{1,2}|\\d{1,2}\\s*[/-]\\s*\\d{1,2}))?' +
    '(?:\\s*,?\\s*20\\d{2})?$', 'i');

  // "10am", "5 pm", "8:30am", "noon". The presence of a clock time is what
  // separates one of a day's services from the paragraph that follows the
  // schedule — "Please note:" is short and looks like everything else, but it
  // has no time in it, and nothing on a service schedule doesn't.
  const TIME_RE = /\b(?:\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)|noon|midnight)\b/i;

  /**
   * Is this line a day, standing on its own — "Saturday", "Sunday, August 23"?
   *
   * A service schedule is the one announcement shape that is genuinely a
   * table: days, and what happens on each. Left as plain lines every one of
   * them renders identically, so the reader has to work out from the words
   * alone which events belong to which day. Marking the days as sub-headings
   * and the events as bullets is the whole difference between a list and a
   * paragraph that happens to contain times.
   */
  function isDayHeading(line) {
    const l = line.trim().replace(/[:•]\s*$/, '');
    return l.length <= 42 && DAY_HEADING_RE.test(l);
  }

  /**
   * Turn a run of "day, then the things happening that day" into sub-headings
   * and bullets. Only fires when at least one day line has events under it —
   * a single date mentioned in a sentence is not a schedule.
   */
  function structureSchedule(text) {
    const lines = String(text).split('\n');
    if (!lines.some(l => l.trim() && isDayHeading(l))) return text;

    const out = [];
    let underDay = false;
    let events = 0;

    for (const raw of lines) {
      const line = raw.trim();
      if (!line) { out.push(''); continue; }

      if (isDayHeading(line)) {
        out.push('## ' + line.replace(/[:•]\s*$/, '').trim());
        underDay = true;
        continue;
      }

      // Beneath a day, a line with a clock time in it is one of that day's
      // services. Anything else — a note, a caveat, a paragraph — means the
      // schedule has ended and ordinary prose has resumed.
      if (underDay && !BULLET_RE.test(line)) {
        if (TIME_RE.test(line) && line.length <= 90) {
          out.push('- ' + line);
          events++;
          continue;
        }
        underDay = false;
      }

      out.push(line);
    }

    if (!events) return text;
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  /**
   * A run of short "deliberate" lines (see unwrapParagraphs above) that each
   * look like one entry in a list — names and emails, line items, and the
   * like — reads as a jumble stacked into plain paragraphs. Turn it into a
   * real bullet list instead, the same as if someone had typed "-" by hand.
   * Only fires when *every* line in the run matches, so ordinary short
   * paragraphs (a service time, a one-line notice) are left alone.
   */
  function autoBulletize(text) {
    const paragraphs = String(text).split(/\n\s*\n/);
    return paragraphs.map(p => {
      const lines = p.split('\n').filter(l => l.trim());
      if (lines.length < 2) return p;
      if (lines.some(l => BULLET_RE.test(l))) return p;
      // A staff directory is a contact block, not a bullet list — see
      // CONTACT_LINE above. Leave it alone and slide.js will align it.
      if (looksLikeContactRun(lines)) return p;
      // A real directory/list entry reads in one glance. A heading line
      // followed by a full descriptive paragraph can also match the
      // separator test below, so rule those out by length first.
      if (lines.some(l => l.length > 100)) return p;
      if (!lines.every(l => LISTY_SEP.test(l))) return p;
      return lines.map(l => '- ' + l.trim()).join('\n');
    }).join('\n\n');
  }

  /* ----------------------------------------------------------- masthead -- */

  const letters = s => String(s).toLowerCase().replace(/[^a-z]/g, '');

  /**
   * The top of every newsletter is the parish name and a dateline. That's a
   * letterhead, not an announcement, and it shouldn't get its own slide.
   */
  function looksLikeMasthead(item) {
    const t = letters(item.title);
    const church = letters(global.KIOSK_CONFIG.churchName || 'St. Elias Orthodox Church');
    if (t && church && (church.indexOf(t) !== -1 || t.indexOf(church) !== -1)) return true;
    if (/^(weekly\s+news|news|newsletter|announcements?|this\s+week)\b/i.test(item.title.trim())) return true;
    if (/^(weekly\s+news|newsletter|announcements?\s+for)\b/i.test(item.body.trim())) return true;
    return false;
  }

  /* -------------------------------------------------------------- split -- */

  /**
   * Split cleaned email text into announcement objects.
   */
  function split(raw) {
    const text = cleanup(raw);
    if (!text) return [];

    const lines = text.split('\n');

    // Pass 1: find heading positions.
    const headingIdx = [];
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const prevBlank = i === 0 || !lines[i - 1].trim();
      const next = lines.slice(i + 1).find(l => l.trim());
      // A heading normally starts a block.
      if (prevBlank && looksLikeHeading(lines[i], next)) headingIdx.push(i);
    }

    let blocks;

    if (headingIdx.length >= 2) {
      // Group each heading with the lines beneath it.
      blocks = headingIdx.map((start, n) => {
        const end = n + 1 < headingIdx.length ? headingIdx[n + 1] : lines.length;
        return {
          title: cleanHeading(lines[start]),
          body: lines.slice(start + 1, end).join('\n').trim(),
        };
      });
    } else {
      // No usable headings — fall back to paragraph blocks, first line as title.
      blocks = text.split(/\n\s*\n/).map(chunk => {
        const ls = chunk.split('\n').filter(l => l.trim());
        if (!ls.length) return null;
        const first = ls[0].trim();
        const rest = ls.slice(1).join('\n').trim();
        if (rest) return { title: cleanHeading(first), body: rest };
        // Single-line block: use a trimmed first sentence as the title.
        const sentence = first.split(/(?<=[.!?])\s/)[0];
        return sentence.length < first.length
          ? { title: cleanHeading(sentence), body: first.slice(sentence.length).trim() }
          : { title: cleanHeading(first), body: '' };
      }).filter(Boolean);
    }

    const items = blocks
      .filter(b => (b.title + b.body).trim().length > 12)   // drop scraps
      .map(b => {
        // Pull the URL out first: while it is still on its own line, removing
        // it also cleanly removes the "Sign up here:" that introduced it.
        const { link, body } = extractLink(b.body);
        const text = structureSchedule(autoBulletize(unwrapParagraphs(body)));
        return {
          title: b.title,
          body: text,
          link: link,
          linkLabel: link ? defaultLabelFor(link) : '',
          end: findDate(b.title + '\n' + text),
        };
      });

    // Drop the letterhead if that's what the first block turned out to be.
    if (items.length > 1 && looksLikeMasthead(items[0])) items.shift();

    return items;
  }

  /* ------------------------------------------------- split from .eml blocks -- */

  // Things that are newsletter plumbing or office housekeeping rather than
  // something a parishioner standing with a coffee needs to read.
  const SKIP_BY_DEFAULT = [
    /manage email preferences/i,
    /^unsubscribe/i,
    /note on announcements/i,
    /^\*?\s*indicates a fasting day/i,
    /helpful links and resources/i,
    /^(sunday|sponsor|tbd)$/i,
    /^how to give/i,
    /commemorations/i,
    /need to reach a priest/i,
  ];

  function skipByDefault(title, body) {
    const t = (title + ' ' + body).slice(0, 200);
    return SKIP_BY_DEFAULT.some(re => re.test(t));
  }

  /**
   * "url1\nurl2" / "label1\nlabel2" -> [{url,label}, ...]. The Sheet's Link
   * and Link Label columns hold one QR code per line — this is the one
   * place that pairs them back up, shared by every path that builds or
   * reads a multi-link card.
   */
  function linkPairs(link, label) {
    const urls = String(link || '').split('\n').map(s => s.trim()).filter(Boolean);
    const labels = String(label || '').split('\n');
    return urls.map((u, i) => ({ url: u, label: (labels[i] || '').trim() }));
  }

  /**
   * Turn the ordered {text, bold, link} blocks from a .eml into announcements.
   * A bold block is a title; everything after it until the next bold block is
   * that announcement's body.
   */
  function splitBlocks(blocks) {
    const groups = [];
    let cur = null;

    const flush = () => {
      if (cur && (cur.title + cur.lines.join('')).trim()) groups.push(cur);
      cur = null;
    };

    for (const b of blocks) {
      if (b.bold) {
        flush();
        cur = { title: b.text, lines: [], links: [] };
        linkPairs(b.link, b.linkLabel).forEach(p => cur.links.push(p));
      } else {
        if (!cur) cur = { title: '', lines: [], links: [] };
        // A block can hold several lines once <br>s have been honoured; each
        // one needs to stand alone so sub-headings stay findable.
        b.text.split('\n').forEach(line => {
          if (line.trim()) cur.lines.push(line.trim());
        });
        // A group built from several small blocks — a staff directory where
        // each name is its own line with its own mailto — collects one QR
        // per person rather than picking just one and dropping the rest.
        linkPairs(b.link, b.linkLabel).forEach(p => {
          if (!cur.links.some(x => x.url === p.url)) cur.links.push(p);
        });
      }
    }
    flush();

    for (const g of groups) {
      g.link = g.links.map(l => l.url).join('\n');
      g.linkLabel = g.links.map(l => l.label).join('\n');
      delete g.links;
    }

    // Not every sub-heading in the newsletter is bold. "Sacred Music
    // Opportunities" is bold, but the three separate opportunities underneath it
    // are not, so they arrive as one enormous blob. Where a group is far too
    // long for a slide, look inside it for lines that read like titles and
    // break it up.
    const subdivided = [];
    for (const g of groups) {
      const size = g.title.length + g.lines.join(' ').length;
      if (size < 700 || g.lines.length < 3) { subdivided.push(g); continue; }

      const cuts = [];
      for (let i = 0; i < g.lines.length; i++) {
        const line = g.lines[i];
        const next = g.lines[i + 1];
        if (line.length <= 70 && next && next.length > 60 &&
            looksLikeHeading(line, next)) {
          cuts.push(i);
        }
      }

      if (!cuts.length) { subdivided.push(g); continue; }

      // Text above the first sub-heading stays with the original title.
      const head = g.lines.slice(0, cuts[0]);
      if (head.length || g.title) {
        subdivided.push({ title: g.title, lines: head, link: '', linkLabel: '' });
      }
      cuts.forEach((start, n) => {
        const end = n + 1 < cuts.length ? cuts[n + 1] : g.lines.length;
        subdivided.push({
          title: cleanHeading(g.lines[start]),
          lines: g.lines.slice(start + 1, end),
          link: '',
          linkLabel: '',
        });
      });
      // The group's link belongs to whichever piece kept the text around it.
      if (g.link && subdivided.length) {
        const last = subdivided[subdivided.length - 1];
        if (!last.link) { last.link = g.link; last.linkLabel = g.linkLabel; }
      }
    }

    const items = subdivided.map(g => {
      const joined = g.lines.join('\n').trim();
      const { link, body } = extractLink(joined);
      const finalLink = g.link || link;
      const finalLabel = g.link && finalLink === g.link
        ? linkPairs(g.link, g.linkLabel).map(p => p.label || defaultLabelFor(p.url)).join('\n')
        : (finalLink ? defaultLabelFor(finalLink) : '');
      return {
        title: g.title,
        // No rejoining here: these lines came from real block and <br>
        // boundaries in the HTML, so a short line is a deliberate one — a
        // service time, a name, an address — not an accident of wrapping.
        body: structureSchedule(
          autoBulletize(unwrapParagraphs(body, { rejoinWrapped: false }))),
        link: finalLink,
        linkLabel: finalLabel,
        end: findDate(g.title + '\n' + body),
        include: true,
        isSection: false,
      };
    }).filter(it => (it.title + it.body).trim().length > 3);

    // A title with no body, followed by another titled item, is a section
    // heading ("Parish News", "Sacred Music Opportunities") rather than an
    // announcement of its own.
    items.forEach((it, i) => {
      const next = items[i + 1];
      if (!it.body.trim() && !it.link && next && next.title) {
        it.isSection = true;
        it.include = false;
      }
      if (skipByDefault(it.title, it.body)) it.include = false;
    });

    if (items.length > 1 && looksLikeMasthead(items[0])) items.shift();

    return items;
  }

  /**
   * Whole-file entry point: raw .eml text in, announcements out.
   */
  function splitEml(rawEml) {
    const parsed = global.Eml.parseEml(rawEml);
    if (parsed.html) {
      return splitBlocks(global.Eml.htmlToBlocks(parsed.html));
    }
    // No HTML part — fall back to the plain-text splitter.
    return split(parsed.plain || '').map(it =>
      Object.assign({ include: true, isSection: false }, it));
  }

  /* ---------------------------------------------------------------- tsv -- */

  const COLUMNS = ['Show', 'Title', 'Body', 'Link', 'Link Label', 'Start', 'End', 'Image', 'Order'];

  /** Quote a value only when it needs it, the way spreadsheets expect. */
  function tsvCell(v) {
    const s = String(v == null ? '' : v);
    return /[\t\n"]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  /**
   * The announcements as a grid of plain values, one row each, in the Sheet's
   * column order. Both the clipboard copy and the direct publish work from
   * this, so the two routes can never drift apart.
   *
   * Switched-off announcements are written out too, with FALSE in the Show
   * column, rather than being dropped. The Sheet is what every editor sees,
   * so it has to carry the whole picture: an announcement somebody decided
   * not to run is a decision, and deleting it silently would hide that
   * decision from the next person and lose the text they would need to undo
   * it. Blank rows are still dropped — those are nothing at all.
   */
  function toMatrix(items) {
    return items
      .filter(it => String(it.title || '').trim() || String(it.body || '').trim())
      .map((it, i) => [
        it.include === false ? 'FALSE' : '',   // Show — blank means show it
        it.title,
        it.body,
        it.link,
        it.link ? it.linkLabel : '',
        it.start || '',
        it.end || '',
        it.image || '',
        String(i + 1),      // Order
      ]);
  }

  function toTsv(items, opts) {
    opts = opts || {};
    const rows = toMatrix(items).map(r => r.map(tsvCell).join('\t'));
    return (opts.includeHeader ? COLUMNS.join('\t') + '\n' : '') + rows.join('\n');
  }

  global.Importer = {
    split, splitEml, splitBlocks, cleanup, toTsv, toMatrix, findDate, extractLink,
    looksLikeHeading, cleanHeading, unwrapParagraphs, autoBulletize, defaultLabelFor,
    structureSchedule, isDayHeading, linkPairs, COLUMNS,
  };

})(window);
