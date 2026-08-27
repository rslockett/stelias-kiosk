/**
 * St. Elias Coffee Hour Kiosk — one-click publish
 * ---------------------------------------------------------------------------
 * Lets the importer page send announcements straight into this Sheet, instead
 * of copying rows to the clipboard and pasting them by hand.
 *
 * SETUP (once):
 *   1. Open the announcements Google Sheet.
 *   2. Extensions -> Apps Script.
 *   3. Delete whatever is in Code.gs and paste this whole file in its place.
 *   4. Change SHARED_SECRET below to a password you make up. Anyone who
 *      knows it can overwrite the announcements — treat it like a house key,
 *      not like a bank password. Share it with Ron, the office and Fr. Elias.
 *   5. Deploy -> New deployment -> type "Web app".
 *        Execute as:      Me
 *        Who has access:  Anyone
 *      (This has to be "Anyone" for the importer page to be able to reach
 *      it. The SHARED_SECRET below is what keeps it from being misused --
 *      nobody can write to the Sheet without knowing it.)
 *   6. Click Deploy, authorize it when Google asks, and copy the Web app URL.
 *   7. Paste that URL and your secret into assets/js/config.js on the
 *      publishUrl and publishSecret lines.
 *
 * If you ever change this file, you must deploy a new version for the change
 * to take effect: Deploy -> Manage deployments -> the pencil icon -> New
 * version -> Deploy. Editing the code alone does not update the live URL.
 *
 * This same endpoint also receives Coffee Hour and Holy Bread sign-ups from
 * signup.html — no extra setup needed for that, it uses the deployment
 * above. See SIGNUP_SHEETS below if you rename either tab.
 *
 * ONE MORE ONE-TIME STEP — the daily saints/readings slide:
 *   Add a tab named "Liturgical" to this Sheet (any content in it is fine,
 *   it gets overwritten). Then, in this Apps Script editor, choose
 *   installDailyLiturgicalTrigger from the function dropdown next to Run,
 *   and press Run. Google will ask to authorize a new permission (fetching
 *   an external page) — that's expected, approve it. This installs a
 *   trigger that refreshes the Liturgical tab once a day from GOARCH's
 *   public Online Chapel feed, and also fills it in immediately so you
 *   don't have to wait until tomorrow to see it working. Re-running that
 *   function later is harmless — it replaces the old trigger rather than
 *   adding a second one.
 *
 * OPTIONAL — LETTING THE EDITOR FORMAT ANNOUNCEMENTS FOR YOU:
 *   With a free Google AI Studio key, "Import the weekly email" also lays
 *   each announcement out for the screen: days become headings, services
 *   become bullets, staff lists become aligned contact blocks, and waffle
 *   gets cut so the text stays big enough to read from across the hall.
 *
 *   The key is free, needs no credit card, and — unlike SHARED_SECRET —
 *   never leaves this script. It is NOT put in config.js, because config.js
 *   is published on GitHub Pages where anybody can read it.
 *
 *     1. Go to https://aistudio.google.com/apikey and sign in with the
 *        parish Google account. Press "Create API key". Copy it.
 *     2. In this Apps Script editor: the gear icon (Project Settings) ->
 *        scroll to "Script properties" -> "Add script property".
 *          Property:  GEMINI_API_KEY
 *          Value:     the key you just copied
 *        Press "Save script properties".
 *     3. Deploy -> Manage deployments -> pencil -> New version -> Deploy.
 *
 *   That's it — the editor notices on its own. To turn it off again, delete
 *   the script property; the editor goes back to saying so plainly rather
 *   than pretending.
 * ---------------------------------------------------------------------------
 */

var SHARED_SECRET = 'change-me-first';   // <-- set this before deploying
var SHEET_NAME = '';                      // blank = the first tab in the file

var HEADERS = ['Show', 'Title', 'Body', 'Link', 'Link Label', 'Start', 'End', 'Image', 'Order'];

// Two extra columns, written after the announcements, recording who last put
// something on the screen and when. The television ignores columns it does not
// recognise; the editor reads these so that everybody working on the
// announcements can see whether somebody else got there first.
var STAMP_HEADERS = ['Published By', 'Published At'];
var TOTAL_WIDTH = HEADERS.length + STAMP_HEADERS.length;

// Sign-up tabs: the name here has to match the actual Sheet tab name.
var SIGNUP_SHEETS = {
  coffee: 'Coffee Hour',
  bread: 'Holy Bread',
};
var SIGNUP_HEADERS = ['Date', 'Name', 'Signed Up At'];

// GOARCH's public Online Chapel feed — the same one a number of parish
// websites have pulled saints/readings from for years. Not an official,
// supported API, just a stable, publicly documented XML endpoint; if it
// ever moves, this is the only line that needs to change.
var LITURGICAL_FEED_URL = 'https://onlinechapel.goarch.org/daily.asp';
var LITURGICAL_SHEET_NAME = 'Liturgical';
var LITURGICAL_HEADERS = ['Date', 'Title', 'Saints', 'Fasting', 'Tone', 'Icon'];

function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents);

    if (payload.action === 'signup') {
      return handleSignup(payload);
    }

    if (payload.action === 'format') {
      if (payload.secret !== SHARED_SECRET) {
        return jsonOut({ ok: false, error: 'Wrong secret.' });
      }
      return handleFormat(payload);
    }

    if (payload.secret !== SHARED_SECRET) {
      return jsonOut({ ok: false, error: 'Wrong secret. Check config.js matches the Apps Script.' });
    }
    if (!Array.isArray(payload.rows)) {
      return jsonOut({ ok: false, error: 'No rows were sent.' });
    }

    var sheet = SHEET_NAME
      ? SpreadsheetApp.getActive().getSheetByName(SHEET_NAME)
      : SpreadsheetApp.getActive().getSheets()[0];

    if (!sheet) {
      return jsonOut({ ok: false, error: 'Could not find the sheet tab.' });
    }

    ensureHeaders(sheet);
    replaceRows(sheet, payload.rows);
    stampPublisher(sheet, payload.by);

    return jsonOut({ ok: true, rowsWritten: payload.rows.length });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err && err.message || err) });
  }
}

/**
 * Claim a Coffee Hour or Holy Bread Sunday. No secret is required — anyone
 * with the sign-up link can use this, the same as filling out a paper sheet
 * on the narthex table.
 *
 * The lock plus the "already taken" check inside it is what stops two people
 * who tap "Sign up" for the same Sunday within moments of each other from
 * both landing in the sheet: whoever's request gets the lock first wins, and
 * the second request is refused. Because this response travels back to the
 * browser over a no-cors request (see live.js), the browser can't actually
 * read this JSON — it finds out by re-polling the published sheet and seeing
 * whether its own name showed up for that date.
 */
function handleSignup(payload) {
  var kind = payload.type;
  var sheetName = SIGNUP_SHEETS[kind];
  if (!sheetName) {
    return jsonOut({ ok: false, error: 'Unknown sign-up type: ' + kind });
  }

  var date = String(payload.date || '').trim();
  var name = String(payload.name || '').trim().slice(0, 80);
  if (!date || !name) {
    return jsonOut({ ok: false, error: 'A date and a name are both required.' });
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = SpreadsheetApp.getActive().getSheetByName(sheetName);
    if (!sheet) {
      return jsonOut({ ok: false, error: 'Could not find the "' + sheetName + '" tab.' });
    }
    ensureSignupHeaders(sheet);

    var wantKey = dateKey(date);
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (dateKey(data[i][0]) === wantKey && String(data[i][1]).trim() !== '') {
        return jsonOut({ ok: false, error: 'That Sunday was just taken by someone else.' });
      }
    }

    sheet.appendRow([date, name, new Date().toISOString()]);
    return jsonOut({ ok: true });
  } finally {
    lock.releaseLock();
  }
}

/**
 * "2026-09-14", or a Date object read back out of a cell (Sheets silently
 * converts a typed date string to a real Date value) — both become the same
 * comparable key, the same problem live.js's dateKey() solves on the browser
 * side of this Sheet.
 */
function dateKey(v) {
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v)) {
    return v.getFullYear() + '-' + (v.getMonth() + 1) + '-' + v.getDate();
  }
  var s = String(v == null ? '' : v).trim();
  var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return m[1] + '-' + (+m[2]) + '-' + (+m[3]);
  var d = new Date(s);
  if (!isNaN(d)) return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  return s;
}

function ensureSignupHeaders(sheet) {
  var firstRow = sheet.getRange(1, 1, 1, SIGNUP_HEADERS.length).getValues()[0];
  var changed = false;
  for (var i = 0; i < SIGNUP_HEADERS.length; i++) {
    if (String(firstRow[i]).trim() === '') { firstRow[i] = SIGNUP_HEADERS[i]; changed = true; }
  }
  if (changed) sheet.getRange(1, 1, 1, SIGNUP_HEADERS.length).setValues([firstRow]);
}

/* ===========================================================================
   Laying announcements out for the screen
   ---------------------------------------------------------------------------
   A newsletter is written to be read sitting down, one line after another. A
   coffee hour television is read standing up, in a glance, from thirty feet
   away. Those want different shapes on the page, and turning one into the
   other is the job nobody in a parish office has time to do twenty times every
   Monday morning.

   So the editor asks this script, and this script asks Google's Gemini model,
   which is free at the volume a parish newsletter uses — twenty or so
   announcements, once a week, against a daily allowance in the hundreds.

   WHY THIS LIVES HERE AND NOT IN THE BROWSER
   The API key is a real credential. config.js is served by GitHub Pages, so
   anything in it is public; a key there could be lifted by anyone who viewed
   the page source and used until Google shut the account. Kept as a Script
   Property it never leaves Google's servers, and the page only ever talks to
   this script — which already has a shared secret in front of it.

   WHY A JOB ID AND NOT JUST A REPLY
   Apps Script web apps don't return the CORS headers a browser needs in order
   to read a POST response, which is the same wall publishing hit (see the note
   above publish() in live.js). So this does what publishing does: the work is
   sent one way, and the answer is collected separately — here by a JSONP GET
   that a <script> tag can read, keyed by the job id the browser made up.
   =========================================================================== */

// Free tier, no credit card: https://aistudio.google.com/apikey
var GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions';

// Tried in order — SMALLEST FIRST, which is the opposite of the obvious.
//
// This started out newest-first, on the reasoning that the best writer should
// get first refusal. Two things proved that wrong within an hour of real use:
// the newest model was overloaded every single time it was asked, and the
// free allowance attached to it is the tightest of the lot — so leading with
// it was both the slowest route and the one that burned through the parish's
// daily quota fastest.
//
// Laying out a church announcement is not hard work for a language model. It
// is reformatting and trimming, against rules that are spelled out in the
// prompt. A lite model does it well, answers immediately, and has by far the
// most generous daily allowance. The bigger ones sit behind it for the rare
// announcement that defeats it.
var GEMINI_MODELS = [
  'gemini-3.5-flash-lite',
  'gemini-3.5-flash',
  'gemini-3.6-flash',
  'gemini-3.7-flash',
];

// One try each, then move on. Asking an overloaded model a second time mostly
// buys another thirty-second wait for the same refusal — with four models to
// work through, moving on is both faster and likelier to succeed. The backoff
// is a courtesy pause between models, not a retry delay.
var GEMINI_ATTEMPTS = 1;
var GEMINI_BACKOFF_MS = 1200;

// Results wait here for the browser to come and collect them. Twenty minutes
// is far longer than the few seconds it actually takes, and short enough that
// nothing accumulates.
var FORMAT_CACHE_SECONDS = 1200;

// CacheService refuses a value over 100KB. Long results are split across
// numbered keys and stitched back together on collection.
var CACHE_CHUNK = 90000;

function geminiKey() {
  return PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY') || '';
}

/**
 * What the model is told an announcement should look like on this television.
 *
 * The rules about never inventing and never dropping a date are the important
 * ones. Everything a parish puts on a screen is either an instruction ("bring
 * a dish", "sign up by the 4th") or a time and a place, and a rewrite that
 * loses one of those is worse than no rewrite at all — it is confidently
 * wrong, in the hall, all week, where nobody thinks to check it against the
 * newsletter.
 */
/**
 * The second pass, for announcements that came back from the first one still
 * too long to read from across the hall.
 *
 * The editor measures every announcement by actually drawing it at 1920x1080,
 * so by the time this runs we are not guessing — we know the text had to be
 * shrunk below what anyone can read from a table, and roughly by how much.
 * That number is handed over, because "make it shorter" produced text that
 * was shorter and still did not fit.
 *
 * This pass is allowed to do the one thing the first pass is forbidden: leave
 * detail out. It is still forbidden to change a fact or make one up. A parish
 * notice that is all dates, tuition tiers and instructor names cannot be
 * compressed by better writing — somebody has to decide what goes to the
 * bulletin instead, and the rule for that is the obvious one: keep what a
 * person needs in order to act, move the rest.
 */
function tightenSystemPrompt() {
  return [
    'You are shortening announcements for a television screen in an Orthodox',
    'parish hall. Each one below was already rewritten once and STILL does not',
    'fit — it had to be shrunk smaller than anyone can read from across a room.',
    '',
    'Each announcement gives you a CHARACTER BUDGET. Get under it.',
    '',
    'Absolute rules:',
    '1. Never change a date, time, place, price, name or address. Never invent one.',
    '2. Keep the single action the reader is meant to take, and whoever they',
    '   contact to take it.',
    '',
    'To get under the budget, in this order:',
    '3. Cut every remaining word that carries no information.',
    '4. Merge list items and collapse repetition.',
    '5. Then — and this is allowed here — LEAVE DETAIL OUT. Keep what somebody',
    '   standing with a coffee needs in order to act on this: what it is, when',
    '   it starts, and who to ask. Drop the rest and end with a short line',
    '   pointing them onward, such as "Full details in the bulletin." or',
    '   "Ask Anca in the office for the full schedule."',
    '6. Prefer keeping the FIRST date and dropping later ones, keeping a price',
    '   RANGE over a list of tiers, and naming one contact rather than four.',
    '',
    'Markup, same as before: "## Sub-heading", "- Bullet", "**bold**", and one',
    'contact per line as "Name – address".',
    '',
    'Return JSON only: {"items":[{"title":"...","body":"..."}]} with exactly',
    'one entry per announcement given, in the same order.',
  ].join('\n');
}

function formatSystemPrompt() {
  return [
    'You lay out announcements for a television screen in an Orthodox parish hall.',
    'People read it standing, in a glance, from across the room.',
    '',
    'For each announcement you are given, return a cleaned-up TITLE and BODY.',
    '',
    'The BODY may use exactly this markup and nothing else:',
    '  ## Sub-heading      a day or a section within the announcement',
    '  - Bullet            one item in a list',
    '  **bold**            for emphasis, used sparingly',
    '  Name – name@example.org   put each contact on its own line, one per line',
    '',
    'Rules, in order of importance:',
    '1. NEVER invent, guess or add a fact. No date, time, place, price, phone',
    '   number, address or name may be changed, and none may be dropped.',
    '2. Keep every action the reader is asked to take.',
    '3. A service schedule becomes "## Day" headings with the services as',
    '   bullets under each day.',
    '4. A list of people and email addresses becomes one line per person,',
    '   "Name, role – address". Never bullet these.',
    '5. Cut words that carry no information: "we are pleased to announce",',
    '   "please note that", "as a reminder", "stay tuned", "more details',
    '   coming soon". Cut "click the link" and "scan the QR code" entirely —',
    '   the slide already shows a QR code with its own caption.',
    '6. Aim for a headline and two or three short sentences, or a short list.',
    '   Under 400 characters of body where the content allows it. If cutting',
    '   further would lose a fact, stop cutting and leave it longer.',
    '7. Plain, warm, unfussy language. No markdown headings other than ##.',
    '   No quotation marks around the whole thing. No commentary about what',
    '   you did.',
    '8. Titles are short — under 50 characters, no trailing colon, no ALL CAPS.',
    '',
    'Return JSON only: {"items":[{"title":"...","body":"..."}]} with exactly',
    'one entry per announcement given, in the same order.',
  ].join('\n');
}

function formatUserInput(items) {
  var parts = [];
  for (var i = 0; i < items.length; i++) {
    var head = 'ANNOUNCEMENT ' + (i + 1) + '\n';
    // Only present on the second pass, where the editor has measured the slide
    // and knows what it actually has room for.
    if (items[i].maxChars) {
      head += 'CHARACTER BUDGET: ' + items[i].maxChars + '\n';
    }
    parts.push(
      head +
      'TITLE: ' + String(items[i].title || '') + '\n' +
      'BODY:\n' + String(items[i].body || '')
    );
  }
  return parts.join('\n\n---\n\n');
}

/**
 * One call to Gemini for the whole batch.
 *
 * Batching matters: the free tier is generous on tokens per day and stingy on
 * requests per minute, so twenty separate calls would be throttled into a
 * two-minute wait while one call for twenty announcements goes straight
 * through.
 */
function callGemini(items, mode) {
  var key = geminiKey();
  if (!key) throw new Error('No GEMINI_API_KEY script property is set.');

  var lastError = null;

  for (var m = 0; m < GEMINI_MODELS.length; m++) {
    for (var attempt = 0; attempt < GEMINI_ATTEMPTS; attempt++) {
      if (m > 0 || attempt > 0) Utilities.sleep(GEMINI_BACKOFF_MS);

      var outcome = tryGemini(GEMINI_MODELS[m], key, items, mode);
      if (outcome.ok) return outcome.items;

      lastError = outcome.error;
      // A quota refusal is the one failure that trying again cannot fix, and
      // a different model shares the same allowance — so stop immediately
      // rather than spending a minute proving it three more times.
      if (outcome.fatal) throw new Error(lastError);
      // Anything else — overloaded, a blip, a malformed reply — is worth
      // another go, and then worth a quieter model.
    }
  }

  throw new Error('All ' + GEMINI_MODELS.length + ' models were busy or ' +
    'unreachable. Last reply — ' + (lastError || 'no answer at all') +
    '. Nothing was changed; try again in a few minutes.');
}

/**
 * One attempt at one model. Returns an outcome rather than throwing, so the
 * loop above can tell "try again" apart from "stop".
 */
function tryGemini(model, key, items, mode) {
  var body = {
    model: model,
    system_instruction: mode === 'tighten' ? tightenSystemPrompt() : formatSystemPrompt(),
    input: formatUserInput(items),
    generation_config: { max_output_tokens: 8192 },
  };

  var res;
  try {
    res = UrlFetchApp.fetch(GEMINI_ENDPOINT, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-goog-api-key': key },
      payload: JSON.stringify(body),
      muteHttpExceptions: true,
    });
  } catch (err) {
    return { ok: false, fatal: false, error: 'Could not reach Gemini: ' + err };
  }

  var code = res.getResponseCode();
  var text = res.getContentText();

  if (code === 429) {
    return {
      ok: false,
      fatal: true,
      error: 'Google’s free allowance is used up for now. It resets on its own ' +
             'at midnight Pacific time — nothing was changed, and everything ' +
             'imported is still here exactly as the newsletter wrote it. ' +
             'Check the live cap for this key at aistudio.google.com.',
    };
  }
  if (code === 400 && /API key/i.test(text)) {
    return {
      ok: false,
      fatal: true,
      error: 'Google rejected the API key. Check the GEMINI_API_KEY script ' +
             'property in this Sheet’s Apps Script project settings.',
    };
  }
  if (code !== 200) {
    return { ok: false, fatal: false, error: model + ' replied ' + code + ': ' + shortError(text) };
  }

  try {
    return { ok: true, items: parseFormatted(extractText(JSON.parse(text)), items) };
  } catch (err) {
    // A reply that arrived but could not be used. Worth one more try — models
    // do occasionally return prose where JSON was asked for.
    return { ok: false, fatal: false, error: String(err && err.message || err) };
  }
}

/** Google's error bodies are JSON; show the sentence, not the envelope. */
function shortError(text) {
  try {
    var parsed = JSON.parse(text);
    if (parsed && parsed.error && parsed.error.message) return parsed.error.message;
  } catch (e) { /* not JSON — fall through to the raw text */ }
  return String(text).slice(0, 200);
}

/**
 * Find the model's words in the reply.
 *
 * Two shapes are accepted because Google has two APIs in the field: the
 * Interactions API used above, and the older generateContent one that a lot of
 * documentation still shows. Reading both costs four lines and means this
 * keeps working if the endpoint is ever switched back.
 */
function extractText(data) {
  var steps = data && data.steps;
  if (steps && steps.length) {
    for (var i = steps.length - 1; i >= 0; i--) {
      var content = steps[i] && steps[i].content;
      if (!content) continue;
      for (var j = 0; j < content.length; j++) {
        if (content[j] && content[j].type === 'text' && content[j].text) {
          return content[j].text;
        }
      }
    }
  }
  var cand = data && data.candidates && data.candidates[0];
  var parts = cand && cand.content && cand.content.parts;
  if (parts && parts.length && parts[0].text) return parts[0].text;
  throw new Error('Could not find any text in Gemini’s reply.');
}

/**
 * The model was asked for JSON and usually obliges, but sometimes wraps it in
 * a ```json fence. Pull the object out either way, and refuse anything whose
 * shape doesn't match what was sent — a reply with a different number of
 * announcements in it would silently reassign bodies to the wrong titles.
 */
function parseFormatted(text, items) {
  var raw = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  var start = raw.indexOf('{');
  var end = raw.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('Gemini did not return JSON.');

  var parsed = JSON.parse(raw.slice(start, end + 1));
  var out = parsed && parsed.items;
  if (!out || !out.length) throw new Error('Gemini returned no announcements.');
  if (out.length !== items.length) {
    throw new Error('Gemini returned ' + out.length + ' announcements for ' +
      items.length + ' sent — ignoring the result rather than mismatching them.');
  }

  var clean = [];
  for (var i = 0; i < out.length; i++) {
    clean.push({
      title: String(out[i].title || items[i].title || '').trim(),
      body: String(out[i].body || '').trim(),
    });
  }
  return clean;
}

/**
 * Take the job, do the work, leave the answer where the browser can fetch it.
 * Failures are cached too — an error the editor can read and show beats a
 * spinner that never stops.
 */
function handleFormat(payload) {
  var jobId = String(payload.jobId || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 60);
  if (!jobId) return jsonOut({ ok: false, error: 'No job id.' });

  var items = payload.items;
  if (!items || !items.length) return jsonOut({ ok: false, error: 'Nothing to format.' });

  try {
    putJob(jobId, { ok: true, done: true, items: callGemini(items, payload.mode) });
  } catch (err) {
    putJob(jobId, { ok: false, done: true, error: String(err && err.message || err) });
  }
  return jsonOut({ ok: true });
}

function putJob(jobId, value) {
  var cache = CacheService.getScriptCache();
  var json = JSON.stringify(value);
  var chunks = Math.ceil(json.length / CACHE_CHUNK) || 1;
  var map = {};
  for (var i = 0; i < chunks; i++) {
    map['fmt_' + jobId + '_' + i] = json.substr(i * CACHE_CHUNK, CACHE_CHUNK);
  }
  map['fmt_' + jobId + '_n'] = String(chunks);
  cache.putAll(map, FORMAT_CACHE_SECONDS);
}

function getJob(jobId) {
  var cache = CacheService.getScriptCache();
  var count = cache.get('fmt_' + jobId + '_n');
  if (!count) return null;
  var json = '';
  for (var i = 0; i < +count; i++) {
    var part = cache.get('fmt_' + jobId + '_' + i);
    if (part == null) return null;   // expired mid-read; treat as not ready
    json += part;
  }
  try { return JSON.parse(json); } catch (e) { return null; }
}

/* ============================================================== unwrapping ==
 *
 * The newsletter goes out through Breeze, which rewrites every link into
 * links.breezechms.com/ls/click?upn=… — routinely over a thousand characters.
 * A QR code carrying that is a dense grey mush nobody can scan from a table,
 * which is why the editor used to run those addresses through TinyURL. That
 * traded one problem for a worse one: TinyURL now shows an advertising page
 * with a countdown, so every scan in the hall landed on an advert.
 *
 * The address behind the wrapper is short and works perfectly. Only the
 * wrapper knows it, and a browser cannot ask — the cross-origin rule stops
 * it reading the redirect. This script can, and this is the only reason it
 * is here.
 *
 * The host list is a deliberate allow-list. Without it this endpoint would
 * fetch any address anybody handed it, from inside the parish's Google
 * account, which is not something to leave lying open on the internet.
 * ========================================================================== */

var UNWRAPPABLE_HOSTS = [
  'links.breezechms.com',
  'tinyurl.com',
  'bit.ly',
  'ow.ly',
  'buff.ly',
  'is.gd',
  'rebrand.ly',
  'cutt.ly',
  'lnkd.in',
  'mailchi.mp',
  'list-manage.com',
  'sendgrid.net',
  'awstrack.me',
  'mandrillapp.com',
  't.co',
];

function hostOf_(url) {
  var m = String(url || '').match(/^https?:\/\/([^\/?#]+)/i);
  return m ? m[1].toLowerCase().replace(/^www\./, '').split(':')[0] : '';
}

function isUnwrappable_(url) {
  var host = hostOf_(url);
  if (!host) return false;
  for (var i = 0; i < UNWRAPPABLE_HOSTS.length; i++) {
    var h = UNWRAPPABLE_HOSTS[i];
    if (host === h || host.slice(-(h.length + 1)) === '.' + h) return true;
  }
  return false;
}

/**
 * Follow a wrapper to the page it actually leads to.
 *
 * Redirects are followed one at a time rather than by letting UrlFetchApp
 * chase them, because a shortener pointing at a Breeze wrapper pointing at
 * the real page is two hops and we want to stop the moment we are somewhere
 * ordinary. Everything is best-effort: if anything at all goes wrong the
 * original address comes back unchanged, which is exactly as good as not
 * having asked.
 */
function unwrapUrl_(url) {
  var current = String(url);
  var seen = {};

  for (var hop = 0; hop < 5; hop++) {
    if (!isUnwrappable_(current) || seen[current]) break;
    seen[current] = true;

    var res;
    try {
      res = UrlFetchApp.fetch(current, {
        method: 'get',
        followRedirects: false,
        muteHttpExceptions: true,
      });
    } catch (err) {
      break;
    }

    var code = res.getResponseCode();
    if (code < 300 || code > 399) break;

    var headers = res.getAllHeaders();
    var next = headers.Location || headers.location;
    if (!next) break;
    next = String(next);
    if (!/^https?:\/\//i.test(next)) break;   // relative hop: not worth chasing

    current = next;
  }

  return current;
}

/**
 * GET is how the browser reads anything back, because a <script> tag is not
 * subject to the cross-origin rule that blocks reading a POST reply.
 *
 *   ?action=result&jobId=…&callback=…   collect a finished formatting job
 *   ?action=ai&callback=…               is an API key configured at all?
 *   ?action=unwrap&url=…&callback=…     what does this tracking link lead to?
 *   (no action)                         a plain "yes, I'm here" for humans
 */
function doGet(e) {
  var params = (e && e.parameter) || {};
  var callback = String(params.callback || '').replace(/[^A-Za-z0-9_$.]/g, '').slice(0, 60);

  if (params.action === 'ai') {
    return maybeJsonp(callback, { ok: true, configured: !!geminiKey() });
  }

  if (params.action === 'unwrap') {
    var wrapped = String(params.url || '');
    if (!isUnwrappable_(wrapped)) {
      // Not a wrapper we know, so there is nothing to unwrap and no reason to
      // go fetching it. Hand it straight back.
      return maybeJsonp(callback, { ok: true, url: wrapped, unwrapped: false });
    }
    var real = unwrapUrl_(wrapped);
    return maybeJsonp(callback, {
      ok: true,
      url: real,
      unwrapped: real !== wrapped,
    });
  }

  if (params.action === 'result') {
    var jobId = String(params.jobId || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 60);
    var job = getJob(jobId);
    return maybeJsonp(callback, job || { ok: true, done: false });
  }

  return jsonOut({ ok: true, message: 'St. Elias kiosk publish endpoint is running.' });
}

function maybeJsonp(callback, obj) {
  if (!callback) return jsonOut(obj);
  return ContentService
    .createTextOutput(callback + '(' + JSON.stringify(obj) + ');')
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function ensureHeaders(sheet) {
  var all = HEADERS.concat(STAMP_HEADERS);
  var firstRow = sheet.getRange(1, 1, 1, TOTAL_WIDTH).getValues()[0];

  // Only fill in what is missing, so a Sheet somebody has already renamed a
  // column in is not quietly overwritten. The two stamp columns are new, and
  // will be blank on a Sheet set up before this feature existed.
  var changed = false;
  for (var i = 0; i < all.length; i++) {
    if (String(firstRow[i]).trim() === '') { firstRow[i] = all[i]; changed = true; }
  }
  if (changed) sheet.getRange(1, 1, 1, TOTAL_WIDTH).setValues([firstRow]);
}

/**
 * Wipe every announcement row and write the new ones in their place, leaving
 * row 1 (the headers) untouched. This mirrors exactly what the manual
 * "delete the old rows, paste at A2" instructions did by hand.
 */
function replaceRows(sheet, rows) {
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, TOTAL_WIDTH).clearContent();
  }
  if (rows.length > 0) {
    var width = HEADERS.length;
    var normalized = rows.map(function (row) {
      var out = row.slice(0, width);
      while (out.length < width) out.push('');
      return out;
    });
    sheet.getRange(2, 1, normalized.length, width).setValues(normalized);
  }
}

/**
 * Record who published, in the first data row of the two stamp columns.
 *
 * This is the only thing in the whole system that says which of the three
 * people editing announcements acted last, and it is what lets the editor
 * tell somebody "Fr. Elias published twenty minutes ago" instead of leaving
 * them guessing whether their copy is current.
 *
 * The name is whatever the person typed into the editor. It identifies a
 * colleague to colleagues; it is not a login and does not pretend to be.
 */
function stampPublisher(sheet, name) {
  var who = String(name == null ? '' : name).slice(0, 60);
  sheet.getRange(2, HEADERS.length + 1, 1, STAMP_HEADERS.length)
       .setValues([[who, new Date().toISOString()]]);
}

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Pull today's saints, readings and fasting rule from GOARCH's public
 * Online Chapel feed and write them into the Liturgical tab. Called once a
 * day by the trigger installDailyLiturgicalTrigger sets up — see the note
 * at the top of this file.
 *
 * If the feed can't be reached, the Liturgical tab is left exactly as it
 * was — yesterday's slide staying up one extra day beats the slide going
 * blank because of a network hiccup at 1am.
 */
function fetchDailyLiturgical() {
  var response = UrlFetchApp.fetch(LITURGICAL_FEED_URL, { muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) return;

  var root = XmlService.parse(response.getContentText()).getRootElement();

  var title = childText(root, 'lectionarytitle');
  if (!title) return; // an empty or malformed feed — don't overwrite good data with nothing

  var fasting = childText(root, 'fasting') || 'No Fast';
  var tone = childText(root, 'tone');
  var icon = childText(root, 'icon').replace(/^http:/, 'https:');

  var others = [];
  var saintsEl = root.getChild('saintsfeasts');
  if (saintsEl) {
    var feasts = saintsEl.getChildren('saintfeast');
    for (var i = 0; i < feasts.length; i++) {
      var t = childText(feasts[i], 'title');
      if (t && t !== title) others.push(t);
    }
  }

  var sheet = SpreadsheetApp.getActive().getSheetByName(LITURGICAL_SHEET_NAME);
  if (!sheet) sheet = SpreadsheetApp.getActive().insertSheet(LITURGICAL_SHEET_NAME);

  sheet.clearContents();
  sheet.getRange(1, 1, 1, LITURGICAL_HEADERS.length).setValues([LITURGICAL_HEADERS]);
  sheet.getRange(2, 1, 1, LITURGICAL_HEADERS.length).setValues([[
    childText(root, 'formatteddate'), title, others.join('; '), fasting, tone, icon,
  ]]);
}

function childText(parent, name) {
  var el = parent.getChild(name);
  return el ? el.getText().trim() : '';
}

/**
 * Run this once, manually — select it in the function dropdown next to
 * Run, then press Run — to start the daily refresh. See the note at the
 * top of this file. Safe to run again later: it replaces any existing
 * trigger for this function rather than adding a second one.
 */
function installDailyLiturgicalTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'fetchDailyLiturgical') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger('fetchDailyLiturgical').timeBased().everyDays(1).atHour(1).create();
  fetchDailyLiturgical(); // and populate it right now, rather than waiting until 1am
}
