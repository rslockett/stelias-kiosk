# St. Elias Coffee Hour Kiosk

The screen in the hall, and the spreadsheet behind it.

Announcements live in a Google Sheet that Ron, the church office and Fr. Elias
can all edit. A web page reads that Sheet and shows one announcement per slide,
making a QR code for anything people can sign up for. The Raspberry Pi opens
that page and is otherwise left alone.

**Changing the TV means editing a spreadsheet.** That's the whole idea.

---

## The weekly routine

About a minute, once a week.

1. In Gmail, open the newsletter. Click the **⋮** menu at the top right of the
   message and choose **Download message**. You get a `.eml` file.
2. Open the [importer](import.html) and drop that file on it.
3. It splits the newsletter into sections. **Untick anything that doesn't belong
   on a coffee hour screen** — most of a newsletter doesn't. Fix up wording,
   shorten anything flagged as too long.
4. Send it to the Sheet:
   - **If [one-click publish](#one-click-publish-skip-the-copy-paste-optional) is
     set up:** press **Publish to the Sheet**. Done.
   - **Otherwise:** press **Copy rows for the Sheet**, open the Sheet, delete the
     old rows, click cell **A2**, and paste.

The TV updates itself within a few minutes. Nobody goes near the Pi.

> You can paste the email text instead of using the file, but the file works far
> better — Gmail's copy-paste throws away the formatting that marks headings, so
> the importer has much less to go on.

---

## The Sheet

One row per announcement. Only **Title** and **Body** are required.

| Column | What it does |
|---|---|
| **Show** | Put `FALSE` to hide a row without deleting it. Blank means show it. |
| **Title** | The headline on the slide. |
| **Body** | The announcement. Line breaks and `-` bullet lists both work. |
| **Link** | A web address. **A QR code is generated from this automatically.** |
| **Link Label** | Caption under the QR code. Defaults to "Scan to sign up". |
| **Start** | Don't show the slide before this date. |
| **End** | **Stop showing it after this date.** |
| **Image** | Optional photo address. |
| **Order** | Lower numbers show first. Blank rows follow in Sheet order. |

Dates are forgiving — `2026-09-12`, `9/12/2026` and `September 12` all work.

### Use the End column

It's the difference between a screen that stays current and one that quietly
goes stale. An announcement with an End date takes itself down the day after the
event. Nobody has to remember, which is the point — remembering is exactly what
doesn't happen in a busy parish.

Standing items (service times, giving, welcome) just get an End date years out.

---

## Two things that decide whether this works

### Keep the links short

This is the one that will bite you. The newsletter's signup links come from
Breeze and look like this:

```
https://links.breezechms.com/ls/click?upn=u001.I1QWnEUjRQZmeILWJHEKPQjqNiWo-2FzZYmSy...
```

That's **over 500 characters**. A QR code has to get denser the more it carries,
and a code that dense becomes a grey smudge that only scans if you walk up and
put your phone against the television. Which nobody will do.

Put the plain address in the Link column instead:

| Instead of | Use |
|---|---|
| a 500-character tracking link | `sainteliaschurch.org/give` |
| a long Google Forms URL | the `forms.gle/…` short link Forms gives you |

The importer flags long links for you and says so in plain words. Don't ignore
it — it's the difference between a QR people scan from their table and one that
just sits there.

### Keep announcements short

Each announcement gets exactly one slide. It's never continued onto a second
one — people read a coffee hour screen in glances, and a "(2 of 3)" slide is a
slide nobody finishes.

So the text shrinks to fit. If it still doesn't fit at a size readable from
across the hall, it gets trimmed with a pointer to the bulletin. The importer's
length bar tells you before that happens:

- **green** — fits comfortably
- **amber** — fits, but small
- **red** — will be trimmed, shorten it

Aim for a headline and two or three sentences. Detail belongs in the bulletin;
the screen's job is to make somebody turn and ask a question.

---

## Setting it up the first time

Once, then never again.

### 1. The Sheet

Make a Google Sheet with these headers across row 1:

```
Show    Title    Body    Link    Link Label    Start    End    Image    Order
```

Share it with the office and Fr. Elias as **Editors**.

Then publish it so the TV can read it:

**File → Share → Publish to web → the Announcements tab → Comma-separated values (.csv) → Publish**

Copy the address it gives you. It looks like:

```
https://docs.google.com/spreadsheets/d/e/2PACX-1vXXXX/pub?gid=0&single=true&output=csv
```

> Publishing makes only this tab readable by anyone with that long address. It
> does **not** let anyone edit it, and it doesn't touch the rest of your Drive.
> Don't put anything in this Sheet you wouldn't pin to the noticeboard —
> parishioners' phone numbers, for instance.

### 2. Point the page at your Sheet

Open [`assets/js/config.js`](assets/js/config.js) and paste the address into
`sheetCsvUrl`. That file is commented throughout and is the only one you should
ever need to change — slide timing, the tagline and the clock are all in there.

### 3. One-click publish — skip the copy-paste (optional)

The importer's **Copy rows** button always works and needs nothing set up.
This section removes that last paste-into-cell-A2 step, so the weekly routine
becomes: drop the email, review it, click **Publish**. About five minutes, once.

1. Open the Sheet → **Extensions → Apps Script**.
2. Delete whatever is in `Code.gs` and paste in the contents of
   [`sheet/Code.gs`](sheet/Code.gs) from this project instead.
3. Near the top, change `SHARED_SECRET` to a password you make up.
   **Never reuse a real password here.** This value also gets pasted into
   `config.js` in the next step, and `config.js` is published on GitHub Pages
   along with everything else — so it's visible to anyone who looks at the
   page source of your kiosk. It's a speed bump against a stranger stumbling
   onto the address by accident, not real security. Treat it accordingly.
4. **Deploy → New deployment → type: Web app.**
   Set **Execute as: Me** and **Who has access: Anyone**, then **Deploy**.
   Google will ask you to authorize it — that's expected, since it's a script
   you're installing on your own Sheet.
5. Copy the **Web app URL** it gives you.
6. Back in [`assets/js/config.js`](assets/js/config.js), paste that URL into
   `publishUrl`, and your password into `publishSecret`. Optionally also paste
   the Sheet's own address into `sheetEditUrl`, so the importer can offer an
   "Open the Sheet" link to double-check a publish went through.

> **Why there's no "saved!" confirmation.** Google's Apps Script doesn't let a
> browser read back what happened after sending it data — that's a Google
> limitation, not something this project works around. So **Publish to the
> Sheet** can tell you the request reached Google, but not that your password
> was right or the Sheet actually changed. The first time you use it, open the
> Sheet afterward and check the rows landed. After that one check, it's safe to
> trust. **Copy rows** stays available underneath the Publish button the whole
> time, as a fallback that always tells the truth about what happened.

If you ever edit `Code.gs` again, you have to deploy a new version for the
change to reach the live URL: **Deploy → Manage deployments → pencil icon →
New version → Deploy.** Saving the file alone isn't enough.

### 4. Put it online

Create a GitHub repository, upload this folder, then **Settings → Pages →
Deploy from a branch → main → / (root)**.

A minute later it's live at `https://yourname.github.io/repository-name/`.
Free, and there's no server to maintain or pay for.

Open that address on your phone to check it before touching the Pi.

### 5. The Pi

Copy the `pi/` folder onto the Raspberry Pi, then:

```bash
chmod +x setup-pi.sh
./setup-pi.sh https://yourname.github.io/repository-name/
```

It installs Chromium, sets it to open full screen on boot, stops the screen
sleeping, and schedules a 4am reboot. It offers to install Tailscale too, which
lets you reach the Pi from home without any router configuration.

Reboot to confirm it comes up on its own.

---

## While it's running

- The page checks the Sheet every couple of minutes and swaps in changes
  **between slides**, so nothing jumps mid-sentence.
- If the hall wifi drops, it keeps showing the last announcements it saw rather
  than an error page. A small note appears in the corner.
- Plug in a keyboard to control it: **←** and **→** to move, **space** to hold a
  slide, **R** to re-check the Sheet now.

---

## When something's wrong

**The TV shows old announcements.**
Google's publishing has a few minutes' lag. Wait five, then press **R** on a
keyboard plugged into the Pi. Still stuck — check the Sheet is still published
(File → Share → Publish to web).

**"Welcome — there are no announcements posted."**
Every row is either hidden, past its End date, or not yet at its Start date.
Check the End column first; that's almost always it.

**The screen is blank or asleep.**
`sudo raspi-config` → Display Options → Screen Blanking → disable. Re-run
`setup-pi.sh` if that doesn't hold.

**It boots to the desktop instead of the announcements.**
Newer Pi OS uses Wayland, older uses X11, and they start programs differently.
`setup-pi.sh` detects which and writes the right file, but if it guessed wrong,
run it again and note the "Desktop session detected" line — then check that
`kiosk.sh` is mentioned in `~/.config/labwc/autostart` (Wayland) or
`~/.config/lxsession/LXDE-pi/autostart` (X11).

**A QR code won't scan.**
It's too long. See "Keep the links short" above.

**Text looks tiny on one slide.**
That announcement is too long. Shorten it in the Sheet.

**The edges are cut off.**
Some TVs crop the picture. Raise `safeAreaPercent` in `config.js`.

---

## What's in here

```
index.html          the screen in the hall
import.html         the weekly email → slides tool
assets/
  css/kiosk.css     how the screen looks
  css/admin.css     how the importer looks
  js/config.js      ← the settings, and the only file you need to edit
  js/csv.js         reads the Sheet's CSV
  js/deck.js        filters by date, polls for changes, caches offline
  js/slide.js       draws a slide, and guarantees it fits on one
  js/eml.js         reads downloaded .eml newsletters
  js/import.js      splits a newsletter into announcements
  js/import-ui.js   the importer's screen — cards, publish button, copy
  js/qrcode.js      QR code generator (Kazuhiko Arase, MIT)
  fonts/            EB Garamond + Montserrat
  img/              parish monogram and cross
pi/setup-pi.sh      one-time Raspberry Pi setup
sheet/Code.gs       optional one-click publish (see step 3 above)
sample/             example announcements, used when no Sheet is configured
```

Plain HTML, CSS and JavaScript — no build step, no frameworks, nothing to
install and nothing that needs updating. Whoever looks after this in ten years
can open these files and read them.

Colours and typefaces are taken from sainteliaschurch.org so the hall screen
looks like the rest of the parish: EB Garamond and Montserrat, on cream, with
the gold and oxblood from the site.

> **Note:** don't commit real newsletters to this repository. GitHub Pages is
> public, and the newsletters contain parishioners' names and staff email
> addresses. `.gitignore` already excludes `.eml` files for this reason.
