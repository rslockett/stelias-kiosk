/* ============================================================================
   St. Elias Coffee Hour Kiosk — SETTINGS
   ----------------------------------------------------------------------------
   This is the only file you should ever need to edit.
   Everything else runs itself.
   ========================================================================== */

window.KIOSK_CONFIG = {

  /* --------------------------------------------------------------------------
     1. WHERE THE ANNOUNCEMENTS COME FROM
     --------------------------------------------------------------------------
     Paste the "Publish to web" CSV link for the announcements Google Sheet.

     To get it:  open the Sheet →  File →  Share →  Publish to web
                 →  choose the "Announcements" tab
                 →  choose "Comma-separated values (.csv)"
                 →  Publish  →  copy the link it gives you

     It should look like:
     https://docs.google.com/spreadsheets/d/e/2PACX-1vXXXXX/pub?gid=0&single=true&output=csv

     Leave this exactly as-is to run on the built-in sample announcements,
     which is handy for testing the TV before the real Sheet exists.
  -------------------------------------------------------------------------- */
  sheetCsvUrl: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRKHWTgqqt76qjc_U3VU9xdNLUJpDKjnnl2o_Hm7g85vC_Zy8-Hhiir28naTV25GW98_PWvjHF26hj5/pub?gid=0&single=true&output=csv',


  /* --------------------------------------------------------------------------
     2. ONE-CLICK PUBLISH FROM THE IMPORTER  (optional)
     --------------------------------------------------------------------------
     Without this section, the weekly routine is: import the email, review it,
     press "Copy rows", then paste into the Sheet by hand. That always works
     and needs no setup.

     Filling in the three lines below adds a "Publish to the Sheet" button to
     the importer, so that last paste step happens automatically instead.

     To set it up:
       1. Open sheet/Code.gs in this project.
       2. Follow the instructions written at the top of that file — it walks
          through pasting it into the Sheet's Apps Script editor and
          deploying it. Takes about five minutes, once, ever.
       3. Paste the three values it gives you below.

     Leave all three blank to skip this — "Copy rows" keeps working either way.
  -------------------------------------------------------------------------- */

  // The "Web app URL" from deploying sheet/Code.gs. Looks like:
  // https://script.google.com/macros/s/AKfycb.../exec
  publishUrl: 'https://script.google.com/macros/s/AKfycbysocswKg6tBYhBwOznPTzBBjWF4T11ib97pVw9TPdOWk71Cja83SHhZtBFeJbhkto2/exec',

  // The password you chose inside sheet/Code.gs (the SHARED_SECRET line).
  //
  // IMPORTANT: this file is published on GitHub Pages along with everything
  // else, which means this value is visible to anyone who looks — it is not
  // a secret in any real sense, just a check against random passers-by.
  // Never reuse an email or bank password here, and don't treat it as real
  // access control — only as a speed bump against a stranger stumbling onto
  // the publish address by accident.
  publishSecret: 'byzantine',

  // Optional: the Sheet's own address, so the importer can offer an
  // "Open the Sheet" link to double-check a publish went through. Just the
  // normal address from your browser's bar when the Sheet is open.
  sheetEditUrl: 'https://docs.google.com/spreadsheets/d/1bZeYRQh2ITbIIhzV1l-Fm6fUGmEPr29oeYc3U3Azc3o/edit?gid=0#gid=0',


  /* --------------------------------------------------------------------------
     3. SIGN-UPS  (Coffee Hour host, Holy Bread)
     --------------------------------------------------------------------------
     Two more tabs in the same Sheet, each published to the web exactly like
     the Announcements tab (File -> Share -> Publish to web -> that tab ->
     CSV). One row per person who has signed up: Date, Name, Signed Up At.
     A Sunday with no row for it is simply open.

     signupUrl is what people scan on the kiosk and land on: signup.html on
     this same site, with ?type=coffee or ?type=bread. If you don't want the
     GitHub Pages address showing up in print or on the QR code, put a short
     redirect link here instead (e.g. from tinyurl.com) that points at it —
     the kiosk only ever displays whatever URL is entered here.

     Leave a pair blank to leave that sign-up off the TV entirely.
  -------------------------------------------------------------------------- */

  coffeeHour: {
    csvUrl: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRKHWTgqqt76qjc_U3VU9xdNLUJpDKjnnl2o_Hm7g85vC_Zy8-Hhiir28naTV25GW98_PWvjHF26hj5/pub?gid=834317076&single=true&output=csv',
    signupUrl: '',
  },

  holyBread: {
    csvUrl: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRKHWTgqqt76qjc_U3VU9xdNLUJpDKjnnl2o_Hm7g85vC_Zy8-Hhiir28naTV25GW98_PWvjHF26hj5/pub?gid=637926506&single=true&output=csv',
    signupUrl: '',
  },

  // How many upcoming Sundays to show, both on the TV and on signup.html.
  // (The kiosk only ever shows the first 6 of these, however high this is
  // set — see KIOSK_ROW_CAP in signup-data.js.)
  signupWeeksAhead: 6,


  /* --------------------------------------------------------------------------
     4. TIMING
  -------------------------------------------------------------------------- */

  // How long each announcement stays on screen, in seconds.
  slideSeconds: 14,

  // Slides with more text get extra time so people can actually finish reading.
  // Set to 0 to give every slide exactly the same time.
  extraSecondsPerHundredChars: 1.5,

  // How often to check the Sheet for changes, in seconds.
  // New edits appear on the TV within about this long, plus Google's own
  // publishing delay (usually 1-5 minutes).
  pollSeconds: 120,

  // Reload the whole page once a day at this hour (24h clock) to keep the
  // browser tidy on a machine that never gets turned off. Use null to disable.
  dailyReloadHour: 3,


  /* --------------------------------------------------------------------------
     5. WHAT THE SCREEN SAYS
  -------------------------------------------------------------------------- */

  churchName: 'St. Elias Orthodox Church',
  tagline: 'This Week in Our Parish',

  // Default caption under a QR code, when a row leaves "Link Label" empty.
  defaultQrLabel: 'Scan to sign up',

  // Show the clock and date in the top-right corner.
  showClock: true,


  /* --------------------------------------------------------------------------
     6. FINE TUNING  (you can almost certainly ignore this section)
  -------------------------------------------------------------------------- */

  // Text auto-shrinks so every announcement fits on ONE slide and never runs
  // onto a second one. These are the limits of that shrinking, in pixels,
  // measured against a 1080p screen.
  //
  // minBodyPx is a readability floor: text is never shrunk below this. If an
  // announcement is so long it still doesn't fit at this size, it gets trimmed
  // and flagged rather than rendered too small to read from across the hall.
  minBodyPx: 26,
  maxBodyPx: 62,

  // Crossfade duration between slides, in milliseconds.
  transitionMs: 700,

  // Many TVs crop a little off every edge ("overscan"). This keeps content
  // safely inside the visible area. Increase if the edges look cut off.
  safeAreaPercent: 3.5,

  // How strongly the ornate parish cross shows in the four corners.
  //
  // Judge this on the television in the hall, not on a computer — they do not
  // agree, and the TV is the one that matters. A TV throws away colour detail,
  // sharpens edges and runs a bright backlight, all of which wash out fine
  // gold linework that looks perfectly clear on a laptop at arm's length.
  //
  // 0.17 is a visible-but-quiet frame. Raise toward 0.25 if the corners still
  // look bare from across the hall; drop toward 0.10 if they pull the eye away
  // from the announcement. 0 turns them off entirely.
  cornerOrnament: 0.17,

  // Show a small dot in the corner when the Sheet can't be reached and the
  // screen is running on its last saved copy.
  showOfflineIndicator: true,
};
