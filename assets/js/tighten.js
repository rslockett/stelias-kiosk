/* ============================================================================
   tighten.js — shortening an announcement without losing what it says
   ----------------------------------------------------------------------------
   "Too long" on the length meter has one honest fix: say the same thing in
   fewer words. This file only ever proposes that — it never rewrites an
   announcement on its own. The editor sees the suggestion next to the
   original and decides.

   Two ways to get there, tried in this order:

     1. Chrome's on-device AI (the Prompt API / Summarizer API, running on
        Gemini Nano). This executes entirely on the visitor's own machine —
        no network call, no account, no API key, no bill, ever. It is only
        used when the model is already downloaded and ready; nothing here
        triggers that download. A parish office on Safari or Firefox, or a
        Chrome that hasn't fetched the model, simply gets step 2 instead.

     2. A short, fixed list of wording rules — stripping hedges and filler
        phrases ("please note that", "we are pleased to announce that") that
        carry no information, only politeness. Works in every browser,
        forever, for nothing.

   Neither path removes a date, a time, a place, a price or a name. The AI
   path is explicitly told not to; the rule-based path only ever deletes
   phrases from a fixed list that were written to contain no facts.
   ========================================================================== */

(function (global) {
  'use strict';

  /**
   * Race a promise against a clock. If it doesn't settle in time, this
   * rejects on its own so the caller can move on.
   *
   * The on-device AI checks below are new browser APIs, still settling, and
   * this file has already seen one settle by simply never resolving —
   * `availability()` can hang indefinitely rather than answer, and so can a
   * browser extension that happens to define its own `window.ai` the
   * built-in check stumbles into. Either way, nothing here should be able to
   * leave the "Tighten it" button spinning forever.
   */
  function withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out after ' + ms + 'ms')), ms);
      promise.then(
        v => { clearTimeout(timer); resolve(v); },
        e => { clearTimeout(timer); reject(e); }
      );
    });
  }

  /* ---------------------------------------------------------- rule-based -- */

  // Each of these is a hedge or a politeness formula, never a fact. Removing
  // it changes tone, not meaning. Order matters a little — a longer phrase is
  // listed before a shorter one it contains, so it is removed whole rather
  // than left partly behind.
  //
  // Every entry ends its wording BEFORE any trailing punctuation, then
  // matches an optional comma outside the \b. Putting the comma inside
  // `,?\b` looks natural but is wrong: if the comma is followed by a space,
  // there's no word/non-word transition right after it for \b to hold at, so
  // the engine backtracks to a zero-width match and leaves the comma stranded
  // — "As a reminder, please" would lose the words but keep a dangling ", ".
  const FILLERS = [
    /\bwe are (?:so |very )?(?:pleased|excited|happy|delighted) to (?:announce|share|invite you)(?: that)?\b,?\s*/gi,
    /\bwe would like to (?:announce|invite you|remind everyone|let you know)(?: that)?\b,?\s*/gi,
    /\bplease be advised that\b\s*/gi,
    /\bplease note that\b\s*/gi,
    /\bplease note\b,?\s*/gi,
    /\bit is important to (?:note|remember) that\b\s*/gi,
    /\bas (?:a )?(?:friendly )?reminder\b,?\s*/gi,
    // "to" stays glued to what follows it — dropping "don't forget" but
    // leaving "to RSVP by..." behind is a sentence fragment, not a shorter
    // sentence. Removing "to" as well leaves a clean imperative: "RSVP by...".
    /\bdon'?t forget to\b\s*/gi,
    /\bdon'?t forget that\b\s*/gi,
    /\bdon'?t forget\b,?\s*/gi,
    /\bas always\b,?\s*/gi,
    /\bat this time\b\s*/gi,
    /\bwe hope (?:you can|to see you)(?: there)?\b,?\s*/gi,
    /\bin order to\b/gi,
    /\bkindly\b\s*/gi,
    /\bsimply\b\s*/gi,
  ];

  function ruleTighten(text) {
    let out = String(text || '');
    FILLERS.forEach(re => { out = out.replace(re, ''); });

    // Cleanup, in order: collapse the doubled spaces a removal leaves behind,
    // pull any stray space back off a punctuation mark, then re-capitalise
    // wherever a sentence now starts — either after the '. ' that used to sit
    // in front of a removed phrase, or at the start of a line, since a
    // bulleted body can carry short lines with no punctuation before them at
    // all.
    out = out
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/[ \t]+([.,!?])/g, '$1')
      // A removed phrase can leave its own closing "!" or "." stranded right
      // after the period that already ended the previous sentence — "to
      // buy. !" collapses via the rule above to "buy.!". One end mark wins.
      .replace(/([.!?])[.!?]+/g, '$1')
      .replace(/(^|[.!?]\s+)([a-z])/g, (m, pre, ch) => pre + ch.toUpperCase())
      .replace(/\n([a-z])/g, (m, ch) => '\n' + ch.toUpperCase())
      .trim();
    return out;
  }

  /* -------------------------------------------------------- on-device AI -- */

  function buildPrompt(title, body, targetChars) {
    return (
      'You shorten parish bulletin-board announcements to fit on a television slide.\n' +
      'Rewrite the ANNOUNCEMENT below to about ' + targetChars + ' characters or fewer.\n\n' +
      'Rules:\n' +
      '- Keep every date, day, time, place, price, phone number and name exactly as given.\n' +
      '- Keep every action the reader is asked to take.\n' +
      '- Do not invent anything. Do not add a title, a greeting, or commentary.\n' +
      '- Plain, warm language, like a parish newsletter. No bullet points, no markdown, no quotation marks.\n' +
      '- Output only the rewritten announcement text.\n\n' +
      'HEADLINE: ' + title + '\n' +
      'ANNOUNCEMENT: ' + body
    );
  }

  /**
   * Is Chrome's on-device model ready to use right now?
   *
   * Deliberately does not ask it to download — "downloadable" and
   * "downloading" both count as "no" here. Fetching the model is a few
   * hundred megabytes, and nobody should get that pushed onto their
   * connection because they clicked a button on the weekly announcements.
   * If it's already there from something else the browser did, it's used;
   * otherwise this quietly steps aside for the rule-based fallback below.
   *
   * Checked defensively because this corner of the web platform is new and
   * still settling: two different global names have been used for the same
   * capability as it moved from origin trial toward a standard shape.
   */
  // A plain availability check should answer in a few milliseconds. Five
  // seconds is already generous slack for a slow machine — well short of
  // making anyone wonder if the button is broken.
  const CHECK_TIMEOUT_MS = 5000;

  async function readyEngine() {
    try {
      if (global.LanguageModel && global.LanguageModel.availability) {
        const a = await withTimeout(global.LanguageModel.availability(), CHECK_TIMEOUT_MS);
        if (a === 'available' || a === 'readily') return 'prompt';
      }
    } catch (e) { /* present but unhappy, or didn't answer — fall through */ }

    try {
      if (global.ai && global.ai.languageModel && global.ai.languageModel.capabilities) {
        const c = await withTimeout(global.ai.languageModel.capabilities(), CHECK_TIMEOUT_MS);
        if (c.available === 'readily') return 'prompt-legacy';
      }
    } catch (e) { /* ignore */ }

    try {
      if (global.Summarizer && global.Summarizer.availability) {
        const a = await withTimeout(global.Summarizer.availability(), CHECK_TIMEOUT_MS);
        if (a === 'available' || a === 'readily') return 'summarizer';
      }
    } catch (e) { /* ignore */ }

    try {
      if (global.ai && global.ai.summarizer && global.ai.summarizer.capabilities) {
        const c = await withTimeout(global.ai.summarizer.capabilities(), CHECK_TIMEOUT_MS);
        if (c.available === 'readily') return 'summarizer-legacy';
      }
    } catch (e) { /* ignore */ }

    return null;
  }

  async function runEngine(engine, title, body, targetChars) {
    if (engine === 'prompt' || engine === 'prompt-legacy') {
      const factory = engine === 'prompt' ? global.LanguageModel : global.ai.languageModel;
      const session = await factory.create();
      try {
        const out = await session.prompt(buildPrompt(title, body, targetChars));
        return String(out).trim();
      } finally {
        session.destroy && session.destroy();
      }
    }

    if (engine === 'summarizer' || engine === 'summarizer-legacy') {
      const factory = engine === 'summarizer' ? global.Summarizer : global.ai.summarizer;
      const summarizer = await factory.create({
        type: 'tldr',
        length: 'short',
        format: 'plain-text',
        sharedContext:
          'A parish bulletin-board announcement. Preserve every date, time, place, ' +
          'price, phone number, name and requested action exactly as given. Invent nothing.',
      });
      try {
        const out = await summarizer.summarize(body, { context: 'Headline: ' + title });
        return String(out).trim();
      } finally {
        summarizer.destroy && summarizer.destroy();
      }
    }

    throw new Error('unknown engine: ' + engine);
  }

  const ENGINE_LABEL = {
    'prompt': 'Suggested by Chrome’s on-device AI',
    'prompt-legacy': 'Suggested by Chrome’s on-device AI',
    'summarizer': 'Suggested by Chrome’s on-device AI',
    'summarizer-legacy': 'Suggested by Chrome’s on-device AI',
    'rules': 'Suggested by trimming polite filler wording',
  };

  /**
   * The one thing the rest of the app calls. Tries the on-device model if
   * it's already downloaded and ready; otherwise falls back to the wording
   * rules, which always work, in every browser, for nothing.
   *
   * Always returns a suggestion — this never writes to the announcement
   * itself. That happens only if the editor presses "Use this".
   */
  async function suggest(item, budgetChars) {
    const title = String(item.title || '');
    const body = String(item.body || '');
    const targetChars = Math.max(120, budgetChars - title.length - 10);

    const engine = await readyEngine();
    if (engine) {
      try {
        // Generation gets much more slack than a bare availability check —
        // an on-device model genuinely takes a few seconds to write a few
        // sentences — but it is still bounded, for the same reason as above.
        const text = await withTimeout(runEngine(engine, title, body, targetChars), 20000);
        if (text && text.length < body.length) {
          return { engine, engineLabel: ENGINE_LABEL[engine], text };
        }
        // The model ran but didn't actually shorten it — not useful, and
        // rather than hand back a same-length "rewrite" the rules below at
        // least guarantee some reduction.
      } catch (e) {
        console.warn('[tighten] on-device AI did not work, falling back to wording rules:', e.message);
      }
    }

    return { engine: 'rules', engineLabel: ENGINE_LABEL.rules, text: ruleTighten(body) };
  }

  global.Tighten = { suggest, ruleTighten, readyEngine };

})(window);
