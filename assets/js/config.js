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

  // NOTE — laying announcements out automatically:
  //
  // There is no setting here for that, and that is deliberate. It needs a
  // Gemini API key, which is a real credential, and THIS FILE IS PUBLIC —
  // GitHub Pages serves it to anyone who asks, so a key here could be lifted
  // by anybody who viewed the page source.
  //
  // The key goes in the Sheet's Apps Script instead, as a Script Property,
  // where it never leaves Google. It is free, and needs no credit card.
  // Setup is about two minutes and is written out at the top of sheet/Code.gs.
  // The editor works this out for itself — nothing to switch on here.


  /* --------------------------------------------------------------------------
     3. TODAY IN THE CHURCH  (saints, fasting rule, from GOARCH)
     --------------------------------------------------------------------------
     A "Liturgical" tab in the same Sheet, refreshed automatically once a day
     — nothing to type in by hand. See the note near the top of sheet/Code.gs
     for the one-time step that turns this on (installDailyLiturgicalTrigger).

     Publish that tab to the web the same way as the others (File -> Share ->
     Publish to web -> the Liturgical tab -> CSV), then paste the link below.

     Leave blank to leave this slide off the TV entirely.
  -------------------------------------------------------------------------- */
  liturgicalCsvUrl: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRKHWTgqqt76qjc_U3VU9xdNLUJpDKjnnl2o_Hm7g85vC_Zy8-Hhiir28naTV25GW98_PWvjHF26hj5/pub?gid=1667543254&single=true&output=csv',


  /* --------------------------------------------------------------------------
     4. SIGN-UPS  (Coffee Hour host, Holy Bread)
     --------------------------------------------------------------------------
     Two more tabs in the same Sheet, each published to the web exactly like
     the Announcements tab (File -> Share -> Publish to web -> that tab ->
     CSV). One row per person who has signed up: Date, Name, Signed Up At.
     A Sunday with no row for it is simply open.

     signupUrl is what people scan on the kiosk and land on: signup.html on
     this same site, with ?type=coffee or ?type=bread. If you would rather not
     have the GitHub Pages address on the QR code, point a domain you control
     at it — the kiosk displays whatever URL is entered here.

     image is optional — a photo shown on the TV slide, same as an
     announcement's Image column. Leave it blank for a words-and-QR-only
     slide.

     Leave a pair blank to leave that sign-up off the TV entirely.

     Put the real address here, never a tinyurl. A QR code has no trouble with
     a long address — it just draws a slightly denser square — and a shortener
     buys nothing while costing the visitor an advertising page and a countdown
     between scanning and arriving. Nobody standing in the hall with a paper
     cup waits that out twice.
  -------------------------------------------------------------------------- */

  coffeeHour: {
    csvUrl: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRKHWTgqqt76qjc_U3VU9xdNLUJpDKjnnl2o_Hm7g85vC_Zy8-Hhiir28naTV25GW98_PWvjHF26hj5/pub?gid=834317076&single=true&output=csv',
    signupUrl: 'https://rslockett.github.io/stelias-kiosk/signup.html?type=coffee',
    image: '',
  },

  holyBread: {
    csvUrl: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRKHWTgqqt76qjc_U3VU9xdNLUJpDKjnnl2o_Hm7g85vC_Zy8-Hhiir28naTV25GW98_PWvjHF26hj5/pub?gid=637926506&single=true&output=csv',
    signupUrl: 'https://rslockett.github.io/stelias-kiosk/signup.html?type=bread',
    image: '',
  },

  /* --------------------------------------------------------------------------
     WELCOME  — the slide for whoever is standing in the hall for the first time

     Coffee hour is where a visitor either meets somebody or quietly leaves.
     This slide is the parish saying hello when nobody happens to be free: the
     icon, a short greeting, and a code they can scan to leave their name.

     It points at the Inquirers Table rather than at a person. There are no
     name tags to look for, and the priest cannot be standing there every
     week — a table that is always in the same place can be.

     formUrl is the parish's welcome form. Put the real address here, not a
     shortened one — see the note above the sign-ups.

     image is the icon shown beside the greeting. Leave it blank and the slide
     still works, as words and a QR code. A .png is treated as a cut-out and
     shown without the white mount a photograph gets, so an icon on a
     transparent ground sits on the parchment rather than in a box.

     Leave formUrl blank to leave the welcome slide off the TV entirely.

     It sits near the front of the rotation, after the day's saints and before
     the announcements, so it comes round often enough that somebody who has
     just walked in will see it without waiting through the whole week's news.
  -------------------------------------------------------------------------- */

  welcome: {
    title: 'Welcome Visitors',
    body: 'If this is your first time with us, we are glad you are here.\n\n' +
      'Please stop by the Inquirers Table before you go. Someone is there to ' +
      'welcome you, answer any questions, and get to know you.',
    image: 'assets/img/welcome-prophet-elias.png',
    formUrl: 'https://steliasaustin.breezechms.com/form/welcome',
    qrLabel: 'Welcome Form',
  },


  // How many upcoming Sundays to show, both on the TV and on signup.html.
  // (The kiosk only ever shows the first 6 of these, however high this is
  // set — see KIOSK_ROW_CAP in signup-data.js.)
  signupWeeksAhead: 6,


  /* --------------------------------------------------------------------------
     5. TIMING
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

  // How often the TV checks whether a NEW VERSION OF THE KIOSK ITSELF has been
  // published, in minutes.
  //
  // This is separate from pollSeconds above, which keeps the announcements
  // current. This one keeps the program current: without it, a screen that has
  // been running for three weeks is still running the code it started with,
  // and a fix doesn't reach the hall until somebody restarts the Pi.
  //
  // When it finds a new version it reloads between slides, never mid-slide.
  // The check is one small file and costs nothing; ten minutes is unhurried.
  // Set to null to turn it off and update only by restarting the Pi (or by
  // pressing "u" on a keyboard plugged into it).
  updateCheckMinutes: 10,


  /* --------------------------------------------------------------------------
     6. WHAT THE SCREEN SAYS
  -------------------------------------------------------------------------- */

  churchName: 'St. Elias Orthodox Church',
  tagline: 'This Week in Our Parish',

  // Default caption under a QR code, when a row leaves "Link Label" empty.
  defaultQrLabel: 'Scan to sign up',

  // Show the clock and date in the top-right corner.
  showClock: true,

  // The current temperature, shown under the clock. Uses Open-Meteo — free,
  // no account, no API key.
  //
  // Find your coordinates: search "[your city] latitude longitude", or
  // right-click your location in Google Maps and copy the two numbers it
  // shows at the top of the menu.
  //
  // Set latitude to null to turn weather off entirely.
  weather: {
    latitude: 30.2672,
    longitude: -97.7431,
  },


  /* --------------------------------------------------------------------------
     7. FINE TUNING  (you can almost certainly ignore this section)
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
