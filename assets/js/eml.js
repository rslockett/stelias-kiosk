/* ============================================================================
   eml.js — reading a downloaded newsletter file
   ----------------------------------------------------------------------------
   Save the weekly email as a .eml file and drop it on the import page. Working
   from the file rather than a copy-paste is a lot more reliable, because we get
   the original HTML — and the HTML tells us which lines are headings.

   The parish newsletter is composed in Word and pasted into Breeze, so it has
   no <h1>-<h6> tags at all. What it does have is blocks whose text is entirely
   bold. That turns out to be a dependable marker for "this is an announcement
   title", which is what the whole splitter hangs on.
   ========================================================================== */

(function (global) {
  'use strict';

  /* ----------------------------------------------------------- MIME bits -- */

  /** Decode quoted-printable into a raw byte-ish string. */
  function decodeQuotedPrintable(s) {
    return s
      .replace(/=\r?\n/g, '')                                     // soft line breaks
      .replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  }

  function decodeBase64(s) {
    try {
      return atob(s.replace(/\s+/g, ''));
    } catch (e) {
      return '';
    }
  }

  /** Reinterpret a latin1-ish string as text in the given charset. */
  function toText(binary, charset) {
    try {
      const bytes = Uint8Array.from(binary, c => c.charCodeAt(0) & 0xff);
      return new TextDecoder(charset || 'utf-8', { fatal: false }).decode(bytes);
    } catch (e) {
      return binary;
    }
  }

  function splitHeadersBody(chunk) {
    const m = chunk.match(/\r?\n\r?\n/);
    if (!m) return { headers: chunk, body: '' };
    return {
      headers: chunk.slice(0, m.index),
      body: chunk.slice(m.index + m[0].length),
    };
  }

  function parseHeaders(raw) {
    // Unfold continuation lines, then split on the first colon.
    const unfolded = raw.replace(/\r?\n[ \t]+/g, ' ');
    const out = {};
    for (const line of unfolded.split(/\r?\n/)) {
      const i = line.indexOf(':');
      if (i > 0) out[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
    }
    return out;
  }

  function headerParam(value, name) {
    if (!value) return '';
    const re = new RegExp(name + '\\s*=\\s*(?:"([^"]*)"|([^;\\s]+))', 'i');
    const m = value.match(re);
    return m ? (m[1] || m[2] || '') : '';
  }

  /**
   * Walk a MIME part, collecting the best text/html and text/plain bodies.
   */
  function walkPart(chunk, found) {
    const { headers: rawH, body } = splitHeadersBody(chunk);
    const h = parseHeaders(rawH);
    const ctype = (h['content-type'] || 'text/plain').toLowerCase();
    const encoding = (h['content-transfer-encoding'] || '7bit').toLowerCase();

    if (ctype.indexOf('multipart/') === 0) {
      const boundary = headerParam(h['content-type'], 'boundary');
      if (!boundary) return;
      const marker = '--' + boundary;
      const segments = body.split(marker);
      // First segment is the preamble, last is the closing "--"; skip both.
      for (let i = 1; i < segments.length; i++) {
        const seg = segments[i];
        if (/^--/.test(seg)) break;
        walkPart(seg.replace(/^\r?\n/, ''), found);
      }
      return;
    }

    let decoded = body;
    if (encoding === 'quoted-printable') decoded = decodeQuotedPrintable(body);
    else if (encoding === 'base64') decoded = decodeBase64(body);

    const text = toText(decoded, headerParam(h['content-type'], 'charset'));

    if (ctype.indexOf('text/html') === 0 && text.length > (found.html || '').length) {
      found.html = text;
    } else if (ctype.indexOf('text/plain') === 0 && text.length > (found.plain || '').length) {
      found.plain = text;
    }
  }

  function parseEml(raw) {
    const found = { html: '', plain: '' };
    walkPart(String(raw).replace(/\r\n/g, '\n'), found);

    const { headers } = splitHeadersBody(String(raw).replace(/\r\n/g, '\n'));
    const h = parseHeaders(headers);

    return {
      subject: h.subject || '',
      from: h.from || '',
      date: h.date || '',
      html: found.html,
      plain: found.plain,
    };
  }

  /* -------------------------------------------------------------- links -- */

  // Click-tracking wrappers. The href is a 400-character redirect blob, which
  // makes a QR code so dense nobody can scan it from across the hall.
  const TRACKER_HOSTS = [
    'links.breezechms.com', 'list-manage.com', 'sendgrid.net', 'mailchi.mp',
    'click.', 'track.', 'links.', 'email.', 'clicks.', 'sendible',
    't.co', 'bit.ly/r', 'awstrack.me', 'mandrillapp.com',
  ];

  function isTrackingUrl(url) {
    if (!url) return false;
    if (/^mailto:/i.test(url)) return false;   // always short, never a tracking wrapper
    if (url.length > 150) return true;
    try {
      const host = new URL(url).hostname.toLowerCase();
      return TRACKER_HOSTS.some(t => host.indexOf(t) !== -1);
    } catch (e) {
      return false;
    }
  }

  // A bare domain or URL sitting in the visible link text, e.g.
  // "Visit ceceyentzen.com/teaching" or "(https://www.sainteliaschurch.org/give)".
  const VISIBLE_URL = /(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/[^\s,)"']*)?)/i;

  /**
   * Given an anchor's href and its visible text, work out the best URL to put
   * behind a QR code. Tracking wrappers frequently show the real address in the
   * link text, so prefer that when we can find it.
   */
  function bestUrl(href, linkText) {
    const tracking = isTrackingUrl(href);
    if (!tracking) return { url: href || '', tracking: false, recovered: false };

    const m = String(linkText || '').match(VISIBLE_URL);
    if (m && m[1] && m[1].indexOf('.') !== -1) {
      const rebuilt = /^https?:\/\//i.test(m[0]) ? m[0] : 'https://' + m[1];
      if (!isTrackingUrl(rebuilt)) {
        return { url: rebuilt.replace(/[.,)]+$/, ''), tracking: false, recovered: true };
      }
    }
    return { url: href || '', tracking: true, recovered: false };
  }

  /* ------------------------------------------------------------ HTML -> blocks */

  const BLOCK_SEL = 'p,li,h1,h2,h3,h4,h5,h6,td,div,blockquote,tr';

  function isBoldish(el, stopAt) {
    let node = el;
    while (node && node.nodeType === 1) {
      const tag = node.tagName.toLowerCase();
      if (tag === 'strong' || tag === 'b' || /^h[1-4]$/.test(tag)) return true;
      const fw = node.style && node.style.fontWeight;
      if (fw) {
        if (fw === 'bold' || fw === 'bolder') return true;
        const n = parseInt(fw, 10);
        if (!isNaN(n) && n >= 600) return true;
      }
      if (node === stopAt) break;
      node = node.parentElement;
    }
    return false;
  }

  /** True when every visible word in the block is bold. */
  function blockIsBold(block) {
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, null);
    let sawText = false;
    while (walker.nextNode()) {
      const t = walker.currentNode;
      if (!t.nodeValue.trim()) continue;
      sawText = true;
      if (!isBoldish(t.parentElement, block)) return false;
    }
    return sawText;
  }

  /**
   * Collapse a block's text nodes into runs of consecutive same-boldness text,
   * e.g. ["Men's Book Study:" (bold), " continues with session 5..." (plain)].
   * Newsletters composed in Word routinely bold just the sub-heading and leave
   * the rest of the same paragraph plain, so a whole-block bold test alone
   * mislabels the paragraph as "not a heading" and it gets swallowed into
   * whatever announcement came before it.
   */
  function textRuns(block) {
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, null);
    const runs = [];
    let node;
    while ((node = walker.nextNode())) {
      const v = node.nodeValue;
      if (!v || !v.trim()) continue;
      const bold = isBoldish(node.parentElement, block);
      const last = runs[runs.length - 1];
      if (last && last.bold === bold) last.text += v;
      else runs.push({ bold, text: v });
    }
    return runs;
  }

  function cleanText(s) {
    return String(s)
      .replace(/ /g, ' ')
      .replace(/[​-‍﻿]/g, '')
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /**
   * Flatten the newsletter HTML into an ordered list of
   * { text, bold, link } blocks.
   */
  function htmlToBlocks(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('style,script,head,title,meta,link').forEach(n => n.remove());

    // A <br> is a real line break and frequently the only thing separating a
    // sub-heading from the paragraph beneath it. Turn it into a newline now,
    // before textContent throws the distinction away.
    doc.querySelectorAll('br').forEach(br => {
      br.replaceWith(doc.createTextNode('\n'));
    });

    // Only leaf-level blocks, so text isn't counted once per nesting level.
    const all = Array.from(doc.body ? doc.body.querySelectorAll(BLOCK_SEL) : []);
    const leaves = all.filter(el => !el.querySelector(BLOCK_SEL));

    // "Fr. Elias Murphy, Pastor – fr.elias@..." -> "Fr. Elias Murphy". Used so
    // a card naming several people can label each QR code with whose it is,
    // instead of one anonymous code nobody can tell apart from another.
    function personLabel(text) {
      const t = String(text || '').trim().replace(/[\s([]+$/, '');
      const beforeDash = t.split(/\s[–—-]\s/)[0];
      const name = beforeDash.split(',')[0].trim();
      return name && name.length <= 40 ? name : '';
    }

    // The name in front of a mailto is almost never inside the <a> itself —
    // the link text is usually just the address. Walk the block's text in
    // document order and record, for each anchor, whatever text came right
    // before it since the last line break — that's the "Fr. Elias Murphy,
    // Pastor – " part a naive a.textContent read would miss entirely.
    function anchorLineText(block) {
      const walker = document.createTreeWalker(
        block,
        NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
        { acceptNode: n => (n.nodeType === 3 || n.tagName === 'A') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP }
      );
      const map = new Map();
      let buf = '';
      let node;
      while ((node = walker.nextNode())) {
        if (node.nodeType === 3) {
          const v = node.nodeValue;
          const nl = v.lastIndexOf('\n');
          buf = nl !== -1 ? v.slice(nl + 1) : buf + v;
        } else if (!map.has(node)) {
          map.set(node, buf);
        }
      }
      return map;
    }

    // A block can name more than one person — a staff directory line, or
    // "Contact Linda (...) or Yara (...)" in running prose. There's no
    // single right QR code for that, so every link found is kept, each
    // labelled with whose it is; the caller joins them with '\n' when
    // there's more than one (deck.js/slide.js render one QR per line).
    const linkIn = el => {
      const anchors = Array.from(el.querySelectorAll('a[href^="http"], a[href^="mailto:"]'));
      const lineOf = anchorLineText(el);
      const seen = new Map();
      for (const a of anchors) {
        const href = a.getAttribute('href');
        if (seen.has(href)) continue;
        const lead = personLabel(lineOf.get(a)) || personLabel(a.textContent);
        if (/^mailto:/i.test(href)) {
          const label = lead || href.replace(/^mailto:/i, '').split('?')[0];
          seen.set(href, { url: href, label, tracking: false });
        } else {
          const picked = bestUrl(href, a.textContent + ' ' + el.textContent);
          let label = lead;
          if (!label) {
            try { label = new URL(picked.url).hostname.replace(/^www\./, ''); }
            catch (e) { label = ''; }
          }
          seen.set(href, { url: picked.url, label, tracking: picked.tracking });
        }
      }
      const links = Array.from(seen.values());
      if (!links.length) return { link: '', linkLabel: '', tracking: false };
      if (links.length === 1) return { link: links[0].url, linkLabel: links[0].label, tracking: links[0].tracking };
      return {
        link: links.map(l => l.url).join('\n'),
        linkLabel: links.map(l => l.label).join('\n'),
        tracking: false,
      };
    };

    const blocks = [];
    for (const el of leaves) {
      const text = cleanText(el.textContent);
      if (!text) continue;

      if (blockIsBold(el)) {
        const { link, linkLabel, tracking } = linkIn(el);
        blocks.push({ text, bold: true, link, linkLabel, tracking });
        continue;
      }

      // Not fully bold — check for a bold sub-heading fused into the same
      // paragraph as its body text ("**Title:** the rest of the sentence..."),
      // and split it into a heading block plus a body block.
      const runs = textRuns(el);
      const lead = runs[0];
      const leadTitle = lead && lead.bold ? cleanText(lead.text) : '';
      const rest = runs.length > 1 ? cleanText(runs.slice(1).map(r => r.text).join('')) : '';

      if (leadTitle && leadTitle.length >= 2 && leadTitle.length <= 90 && rest) {
        blocks.push({ text: leadTitle, bold: true, link: '', linkLabel: '', tracking: false });
        const { link, linkLabel, tracking } = linkIn(el);
        blocks.push({ text: rest, bold: false, link, linkLabel, tracking });
        continue;
      }

      const { link, linkLabel, tracking } = linkIn(el);
      blocks.push({ text, bold: false, link, linkLabel, tracking });
    }

    // Collapse consecutive duplicates, which Word-pasted markup produces a lot of.
    return blocks.filter((b, i) => i === 0 || b.text !== blocks[i - 1].text);
  }

  global.Eml = {
    parseEml,
    htmlToBlocks,
    isTrackingUrl,
    bestUrl,
    cleanText,
    _internals: { decodeQuotedPrintable, decodeBase64, parseHeaders, headerParam, blockIsBold },
  };

})(window);
