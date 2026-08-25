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
  sheetCsvUrl: 'sample/announcements.csv',


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
  publishUrl: '',

  // The password you chose inside sheet/Code.gs (the SHARED_SECRET line).
  //
  // IMPORTANT: this file is published on GitHub Pages along with everything
  // else, which means this value is visible to anyone who looks — it is not
  // a secret in any real sense, just a check against random passers-by.
  // Never reuse an email or bank password here, and don't treat it as real
  // access control — only as a speed bump against a stranger stumbling onto
  // the publish address by accident.
  publishSecret: '',

  // Optional: the Sheet's own address, so the importer can offer an
  // "Open the Sheet" link to double-check a publish went through. Just the
  // normal address from your browser's bar when the Sheet is open.
  sheetEditUrl: '',


  /* --------------------------------------------------------------------------
     3. TIMING
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
     4. WHAT THE SCREEN SAYS
  -------------------------------------------------------------------------- */

  churchName: 'St. Elias Orthodox Church',
  tagline: 'This Week in Our Parish',

  // Default caption under a QR code, when a row leaves "Link Label" empty.
  defaultQrLabel: 'Scan to sign up',

  // Show the clock and date in the top-right corner.
  showClock: true,


  /* --------------------------------------------------------------------------
     5. FINE TUNING  (you can almost certainly ignore this section)
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

  // Show a small dot in the corner when the Sheet can't be reached and the
  // screen is running on its last saved copy.
  showOfflineIndicator: true,
};
