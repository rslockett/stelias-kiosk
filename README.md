# St. Elias Coffee Hour Kiosk

The screen in the hall, the editor anyone can open, and the spreadsheet in
between.

Announcements live in a Google Sheet. A web page reads that Sheet and shows one
announcement per slide, making a QR code for anything people can sign up for.
The Raspberry Pi opens that page and is otherwise left alone.

There is a second page — the **editor** — that reads the same Sheet, shows you
each announcement as it will actually look on the television, and writes your
changes back. It is a web page like any other: Ron, the church office and
Fr. Elias each open it in their own browser, on their own computer, and none of
them needs the others' machine switched on.

**Changing the TV means opening a web page.** That's the whole idea.

---

## Where things are

Once this is on GitHub Pages (see *Setting it up the first time*), there are two
addresses worth bookmarking:

| | |
|---|---|
| **The editor** | `https://yourname.github.io/repository-name/import.html` |
| **The TV screen** | `https://yourname.github.io/repository-name/` |

Send the editor link to everyone who looks after announcements. Nothing else is
installed, and it works on a laptop, a tablet or a phone.

---

## Who can change what

There are two different keys, and it is worth knowing which is which.

**To read the Sheet** — which the editor and the television both do — nothing is
needed. The Sheet is published to the web as a read-only CSV.

**To publish changes** you need the shared publish password, which lives in
[`assets/js/config.js`](assets/js/config.js). Because that file ships with the
web page, anyone who can open the editor can publish. That is deliberate: the
alternative is Google logins, and this is a noticeboard, not a bank. See
*One-click publish* below for what that does and doesn't protect.

**Nobody needs edit access to the Google Sheet itself** to use the editor. Give
that out only to the people who want to open the spreadsheet directly.

---

## The weekly routine

About a minute, once a week, from any computer.

1. In Gmail, open the newsletter. Click the **⋮** menu at the top right of the
   message and choose **Download message**. You get a `.eml` file.
2. Open the editor. It loads what is currently on the TV.
3. Press **Import the weekly email** and drop the file on it. It splits the
   newsletter into announcements and asks whether to **replace everything** or
   **add to the end**.
4. Go down the list. Switch off anything that doesn't belong on a coffee hour
   screen — most of a newsletter doesn't. Fix wording. Watch the preview.
5. Press **Make it live**.

The TV updates itself within a few minutes. Nobody goes near the Pi.

> You can paste the email text instead of using the file, but the file works far
> better — Gmail's copy-paste throws away the formatting that marks headings, so
> the importer has much less to go on.

---

## Working together on it

The Sheet is the one true copy. Not your browser, not your laptop — the Sheet.
Everything in the editor follows from that.

### The bar across the top

It never stops telling you where you stand.

| It says | It means |
|---|---|
| **Live** | Everything on your screen is what the hall is seeing. |
| **Not live yet** | You have changed something. The TV still shows the old version until you press **Make it live**. |
| **Publishing** | Your changes have gone to Google, and the editor is watching the published Sheet until they actually appear in it. |
| **Out of step** | Somebody else published while you were editing. |
| **No connection** | The Sheet can't be reached. Your edits are safe in your browser. |

When it says Live, it also says who published last and when — so you can tell at
a glance whether Fr. Elias got there before you.

### Your changes are yours until you publish them

Editing does not touch the TV. Nothing you type reaches the hall until you press
**Make it live**, and until you do, the status bar stays amber and counts what is
outstanding — "3 changes not on the TV yet: 1 new, 1 edit, 1 removal".

Unpublished work is kept in your browser, so closing the tab by accident doesn't
lose it. Next time you open the editor it offers it back.

**Undo my changes** throws your draft away and returns you to exactly what is on
the TV.

### If two people edit at once

The editor re-reads the Sheet every couple of minutes.

- If you have no unpublished changes, it quietly follows along — you'll see
  whatever the other person just published.
- If you *do* have unpublished changes, it stops and says so, and lets you
  either look at what's live or keep your own version and publish over it.

It cannot stop two people publishing over each other, because a Google Sheet
has no way to lock. What it can do is make sure neither of them is surprised,
and that is what it does.

### Why "Publishing" takes a moment

Google's Apps Script can't tell a browser whether a publish worked — a platform
limitation, not something this project works around. So the editor doesn't
believe its own send. It sends the rows, then re-reads the published Sheet
every few seconds until it sees those exact announcements in it, and only then
says **Live**.

That means the word Live is always earned. It also means there is a wait, of
usually well under a minute, while Google republishes. If five minutes pass
without the change appearing, the editor says so plainly and offers the Sheet
and the copy-and-paste fallback.

---

## The preview

The panel on the right is not a mock-up. It is the kiosk page itself, running at
a real 1920×1080 and scaled down to fit — the same fonts, the same QR codes, the
same shrink-to-fit, the same decisions about what to cut.

That matters because of the rule below: an announcement gets exactly one slide.
The preview is how you find out, before anybody in the hall does, that yours
didn't fit.

Under the screen it tells you which of three things happened:

- **Fits comfortably** — at a size that reads from across the hall.
- **Fits, but only at the smallest size allowed** — trim a sentence.
- **Too long. The TV cut this short** — the slide ends with a pointer to the
  bulletin instead of your last paragraph.

**Play all** runs through the announcements the way the television will, at the
same speed, so you can see the whole rotation before anyone else does.

If an announcement isn't on the TV today — switched off, or past its **Take it
down after** date — the preview greys out and says which.

### The Slide space bar

Under each announcement's text is a bar reading something like
**Slide space — 73% full — reads well from across the hall**.

It is the answer to "will this actually fit on the television?", and it is
measured rather than estimated: every announcement is drawn on a hidden copy
of the TV screen at full 1920×1080, and the bar reports the font size the
text had to shrink to in order to fit. Empty bar means a nearly bare slide;
full bar means the text is as small as it is allowed to get.

- **Green** (46px and up) — reads comfortably from across the hall.
- **Amber** (34–46px) — readable, but on the small side. Worth cutting a
  sentence.
- **Red** (under 34px, or cut short) — either the TV trimmed it, or it only
  fitted by shrinking the text below what anyone can read from a table. Both
  need shortening.

Those thresholds are about being *read from across a hall*, which is a much
higher bar than "fitted on the slide without being cut". A capital letter is
roughly 0.7 of the font size, and on a 55" 1080p screen a pixel is about
0.025 inches — so 34px of body text is a little under 0.6" of letter, which
signage practice puts at comfortable for about six feet. Six feet is standing
at the television, not sitting with a coffee.

Length in characters is a poor guide to this and is not used: a 1266-character
notice can fit comfortably while a shorter one with a QR code and a photo does
not, because a QR panel takes about a third of the width.

### Tighten it

When an announcement is amber or red, a **Tighten it** button appears beside
the bar. It suggests a shorter version — never applies one. It does not appear
on announcements that already fit, because there is nothing for it to do
there. You see the suggestion next to your own
words, in an editable box, and choose **Use this**, **Try again**, or
**Discard**. Nothing is written until you press Use this.

Where it comes from depends on the computer:

- **In an up-to-date Chrome or Edge with the on-device model already
  downloaded**, it uses that — genuinely free, runs on the machine in front of
  you, no account and no internet request involved. This is a young part of
  the browser; if it isn't ready there, nothing breaks.
- **Everywhere else**, it strips a fixed list of polite filler — "please note
  that", "we are pleased to announce that", "as a reminder" — that carries no
  facts, only tone. Works in any browser, always, for nothing.

Either way, no date, time, place, price, phone number or name is ever removed
by design — but you're shown the result and asked to check before it goes
anywhere near the Sheet, the same as everything else in this editor.

The wording rules also drop two things that are specifically wrong on a
television: "click on this link" (there is nothing to click, and the slide
already carries a QR code that says what it is for) and pure anticipation
like "more details coming soon" or "stay tuned".

If it reports finding nothing to trim on a red announcement, that is the
honest answer rather than a failure: a notice that is all dates, times, costs
and names has no filler in it, and shortening it means deciding what to leave
out — which is a judgement call, not a rule. Keep the date, the time and who
to contact, and send the rest to the bulletin.

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

Put the plain address in the Link field instead:

| Instead of | Use |
|---|---|
| a 500-character tracking link | `sainteliaschurch.org/give` |
| a long Google Forms URL | the `forms.gle/…` short link Forms gives you |

The editor shortens the worst offenders automatically when it reads a
newsletter, and flags anything left over with a **Shorten it** button.

### Keep announcements short

Each announcement gets exactly one slide. It's never continued onto a second
one — people read a coffee hour screen in glances, and a "(2 of 3)" slide is a
slide nobody finishes.

So the text shrinks to fit. If it still doesn't fit at a size readable from
across the hall, it gets trimmed with a pointer to the bulletin. Aim for a
headline and two or three sentences. Detail belongs in the bulletin; the
screen's job is to make somebody turn and ask a question.

---

## The Sheet

You do not have to open it. But it is a plain spreadsheet, and editing it
directly still works — the editor will pick up whatever you do there.

One row per announcement. Only **Title** and **Body** are required.

| Column | What it does |
|---|---|
| **Show** | `FALSE` hides a row without deleting it. Blank means show it. This is what the editor's on/off switch writes. |
| **Title** | The headline on the slide. |
| **Body** | The announcement. Line breaks and `-` bullet lists both work. |
| **Link** | A web address. **A QR code is generated from this automatically.** One per line for several codes. |
| **Link Label** | Caption under the QR code. One line per link. |
| **Start** | Don't show the slide before this date. |
| **End** | **Stop showing it after this date.** |
| **Image** | Optional photo address. |
| **Order** | Lower numbers show first. |
| **Published By / At** | Written by the editor. Don't type in these. |

Dates are forgiving — `2026-09-12`, `9/12/2026` and `September 12` all work.

### Use the End column

It's the difference between a screen that stays current and one that quietly
goes stale. An announcement with an End date takes itself down the day after the
event. Nobody has to remember, which is the point — remembering is exactly what
doesn't happen in a busy parish.

Standing items (service times, giving, welcome) just get an End date years out.

---

## Setting it up the first time

Once, then never again.

### 1. The Sheet

Make a Google Sheet with these headers across row 1:

```
Show  Title  Body  Link  Link Label  Start  End  Image  Order  Published By  Published At
```

Then publish it so the TV and the editor can read it:

**File → Share → Publish to web → the Announcements tab → Comma-separated values (.csv) → Publish**

Copy the address it gives you. It looks like:

```
https://docs.google.com/spreadsheets/d/e/2PACX-1vXXXX/pub?gid=0&single=true&output=csv
```

> Publishing makes only this tab readable by anyone with that long address. It
> does **not** let anyone edit it, and it doesn't touch the rest of your Drive.
> Don't put anything in this Sheet you wouldn't pin to the noticeboard —
> parishioners' phone numbers, for instance.

### 2. Point the pages at your Sheet

Open [`assets/js/config.js`](assets/js/config.js) and paste the address into
`sheetCsvUrl`. That file is commented throughout and is the only one you should
ever need to change — slide timing, the tagline and the clock are all in there.

### 3. One-click publish

Without this, the editor can still show you everything and still preview
everything, but **Make it live** has nothing to send to. Its fallback — the
**⋯** menu's *Copy rows for the Sheet* — always works and needs no setup.

Doing this once, though, is what makes the weekly routine a single button, and
what lets people who have no access to the Sheet still update the screen.

1. Open the Sheet → **Extensions → Apps Script**.
2. Delete whatever is in `Code.gs` and paste in the contents of
   [`sheet/Code.gs`](sheet/Code.gs) from this project instead.
3. Near the top, change `SHARED_SECRET` to a password you make up.
   **Never reuse a real password here.** This value also gets pasted into
   `config.js` in the next step, and `config.js` is published on GitHub Pages
   along with everything else — so it's visible to anyone who looks at the
   page source. It's a speed bump against a stranger stumbling onto the
   address by accident, not real security. Treat it accordingly.
4. **Deploy → New deployment → type: Web app.**
   Set **Execute as: Me** and **Who has access: Anyone**, then **Deploy**.
   Google will ask you to authorize it — that's expected, since it's a script
   you're installing on your own Sheet.
5. Copy the **Web app URL** it gives you.
6. Back in [`assets/js/config.js`](assets/js/config.js), paste that URL into
   `publishUrl`, and your password into `publishSecret`. Also paste the Sheet's
   own address into `sheetEditUrl`, so the editor can offer a link to it.

If you ever edit `Code.gs` again, you have to deploy a new version for the
change to reach the live URL: **Deploy → Manage deployments → pencil icon →
New version → Deploy.** Saving the file alone isn't enough.

> **Already had this set up before the editor existed?** Re-paste `Code.gs` and
> deploy a new version. The current one adds the two **Published By / At**
> columns, which is how everybody sees who published last. Everything works
> without it; that one line in the status bar is just blank.

### 4. Put it online

Create a GitHub repository, upload this folder, then **Settings → Pages →
Deploy from a branch → main → / (root)**.

A minute later it's live at `https://yourname.github.io/repository-name/`, with
the editor at `.../import.html`. Free, and there's no server to maintain or
pay for.

Open both on your phone to check them before touching the Pi.

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

**The editor says "Publishing" and stays there.**
Google's publishing has a few minutes' lag; under a minute is normal. After five
it will tell you and offer the Sheet. If the rows aren't there either, the
publish password in `config.js` no longer matches the one in the Sheet's Apps
Script — or `Code.gs` was edited without deploying a new version.

**The editor says "Out of step".**
Somebody else published while you had unsaved changes. Nothing is lost: choose
whether to look at theirs or publish yours over it.

**"Make it live" is greyed out.**
Either nothing has changed, or one-click publish isn't set up. Hover it and it
will say which.

**The TV shows old announcements.**
Give it five minutes. Still stuck — press **R** on a keyboard plugged into the
Pi, and check the Sheet is still published (File → Share → Publish to web).

**"Welcome — there are no announcements posted."**
Every row is either switched off, past its End date, or not yet at its Start
date. The editor shows all of those, greyed, with the reason on the preview.

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

**The edges are cut off.**
Some TVs crop the picture. Raise `safeAreaPercent` in `config.js`.

---

## What's in here

```
index.html          the screen in the hall
import.html         the editor — the page everyone opens
preview.html        one slide, drawn as the TV draws it; used twice by the
                    editor — once visibly, once hidden off-screen to measure
                    every announcement's true fit
assets/
  css/kiosk.css     how the screen looks
  css/admin.css     how the editor looks
  js/config.js      ← the settings, and the only file you need to edit
  js/csv.js         reads the Sheet's CSV
  js/deck.js        filters by date, polls for changes, caches offline
  js/slide.js       draws a slide, and guarantees it fits on one
  js/live.js        reads and writes the Sheet; decides what "live" means
  js/tighten.js     suggests a shorter version of an announcement
  js/eml.js         reads downloaded .eml newsletters
  js/import.js      splits a newsletter into announcements
  js/import-ui.js   the editor itself — list, preview, publishing
  js/preview-frame.js  the inside of the preview window
  js/qrcode.js      QR code generator (Kazuhiko Arase, MIT)
  fonts/            EB Garamond + Montserrat
  img/              parish monogram and cross
pi/setup-pi.sh      one-time Raspberry Pi setup
sheet/Code.gs       the Apps Script that receives "Make it live"
sample/             example announcements, used when no Sheet is configured
```

Plain HTML, CSS and JavaScript — no build step, no frameworks, nothing to
install and nothing that needs updating. Whoever looks after this in ten years
can open these files and read them.

Colours and typefaces are taken from sainteliaschurch.org so the hall screen
looks like the rest of the parish: EB Garamond and Montserrat, on cream, with
the gold and oxblood from the site. The masthead borrows the website's
signature device — pale gold type on a deep navy panel, with the same inset
gold rule the QR frames use.

> **If you change the masthead, watch the length bars.** The screen gives
> whatever height the masthead does not use to the announcement, and the
> fitting code answers a shorter stage by shrinking the text. A roomier
> header is therefore paid for by the people furthest from the screen. When
> the masthead grew, two announcements dropped a readability band; the space
> was taken back out of padding rather than out of the words.

> **Note:** don't commit real newsletters to this repository. GitHub Pages is
> public, and the newsletters contain parishioners' names and staff email
> addresses. `.gitignore` already excludes `.eml` files for this reason.
