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

### When the import comes out wrong

It will, eventually. The newsletter is written in Word, pasted into Outlook and
sent through a mailing service, and none of that markup is a contract: a heading
that was bold last week can arrive as a table cell this week. The importer reads
the shape of the newsletter, so a change in shape is a change in the result.

Everything the importer has ever got wrong is written down as a check. Open
**`test.html`** in a browser — no install, no build step, it just loads the same
files the editor loads and runs them against a made-up newsletter that has every
awkward shape in it. Green means the known mistakes are all still fixed.

Run it after touching `eml.js`, `import.js` or `import-ui.js`. When a new kind of
mangling turns up, add the shape to `sample/newsletter-fixture.eml.txt` and the
check to `tests/import.test.js`, then fix it — that way it can only happen once.

Never commit a real newsletter to try something out. They carry parishioner
names, home emails and phone numbers, and this repository is published to GitHub
Pages. `.gitignore` blocks `.eml` files for exactly that reason; keep the fixture
invented.

---

## Working together on it

The Sheet is the one true copy. Not your browser, not your laptop — the Sheet.
Everything in the editor follows from that.

### How long each slide stays up

In the editor's toolbar: **Each slide stays up [ 14 ] seconds**. Change it and
press **Make it live**, the same as any other change — it counts as a change,
shows up in the status bar, and lands on the television with everything else.

It lives in the Sheet rather than in `config.js`, because the person who can
tell the hall is being rushed is standing in the hall, not editing JavaScript.
The Sheet grows a **Seconds Per Slide** column next to the two publish-stamp
columns; the television reads it every couple of minutes along with the
announcements.

A few things it deliberately does:

- **Longer announcements still get more time.** This is the base figure, and
  `extraSecondsPerHundredChars` in `config.js` is added on top per slide. A
  wordy notice was never going to be readable in the same time as three words.
- **Nothing in the Sheet, nothing changes.** A Sheet that has never had the
  column — or an older `Code.gs` — leaves the television on the `slideSeconds`
  figure in `config.js`. Same for a blank cell, a word, or a zero.
- **A typo cannot strand the hall.** Anything outside 4–120 seconds is clamped,
  so a stray `9999` does not leave one slide up for three hours.
- **Publishing from an older tab will not reset it.** A publish that says
  nothing about the speed leaves whatever the Sheet already had.

> The first time you change it, `Code.gs` must be the version that knows about
> the column — redeploy it if you have not since this was added.

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

---

## Laying announcements out for the screen

A newsletter is written to be read sitting down. A coffee hour television is
read standing up, in a glance, from thirty feet away. Those want different
shapes on the page.

**Import the weekly email, and the editor does that reshaping for you** — days
in a service schedule become headings with the services bulleted under each
one, a staff list becomes an aligned block of names and addresses, and waffle
gets cut so the text stays big enough to read from across the hall. It runs
once, on its own, straight after the import, on the announcements actually
headed for the TV. A strip across the top says what it's doing, the list stays
usable underneath it, and **Skip this** stops it.

Nothing is published without you seeing it. The announcements land in the list
first and the layout arrives a few seconds later, so you read it over the same
as anything else here. Anything you'd already started typing into is left
alone.

Each announcement also has its own button beside the length bar — **Tidy it
up**, or **Shorten & tidy** on one that's too long. That one shows you the
result next to your own words and writes nothing until you press **Use this**.

> **It is a suggestion, not a fact-checker.** It's told never to change or
> drop a date, time, place, price or name, and in practice it doesn't — but
> a screen in the hall is read by people who won't think to check it against
> the newsletter, so you should.

### Setting it up

It uses Google's Gemini, which is **free at this volume** — a parish
newsletter is around twenty announcements once a week, against a daily
allowance in the hundreds. No credit card, no subscription, no bill.

The API key goes in the Sheet's Apps Script, **not** in `config.js` — that
file is served by GitHub Pages and anything in it is public. As a Script
Property the key never leaves Google.

1. Go to [aistudio.google.com/apikey](https://aistudio.google.com/apikey),
   sign in with the parish Google account, and press **Create API key**.
2. In the Sheet: **Extensions → Apps Script → the gear icon (Project
   Settings) → Script properties → Add script property**.
   Property `GEMINI_API_KEY`, value the key. **Save script properties**.
3. **Deploy → Manage deployments → pencil → New version → Deploy.**

The editor notices on its own — there's nothing to switch on. Skip this
entirely and everything else still works; the importer's own formatting
(below) runs regardless, and the buttons that need a key simply don't appear
rather than appearing and apologising.

> Google's free tier may use what's sent to improve its products. Everything
> here is going on a screen in a public hall anyway, but it does include the
> staff email addresses in the newsletter — which are already published to the
> whole parish, in a Gmail message, on Google's servers. If that isn't a
> trade you want to make, leave the key out.

### What it does without a key

The importer knows two shapes on its own, with no account and no internet:

- **Service schedules.** A line that is a day — "Saturday", "Sunday, August
  23" — becomes a heading, and the lines under it with clock times in them
  become bullets. A line without a time ends the schedule, so the paragraph
  after it stays a paragraph.
- **Contact lists.** Two or more lines that each end in an email address are
  left as they are rather than bulleted, and the screen lays them out as a
  proper directory.

### Writing it by hand

The box has **B**, *I*, **Heading** and **• List** buttons over it, and they
type the same plain markers you can type yourself:

| Type this | Get |
|---|---|
| `## Saturday` | a sub-heading — a day, or a section within one announcement |
| `- Vespers 5pm` | a bullet |
| `**bold**` | **bold** |
| `*italic*` | *italic* |
| `Anca Green – anca@…` on consecutive lines | an aligned contact block |

That's the whole format. The Sheet holds plain text either way, so a row typed
directly into the spreadsheet works exactly the same.

---

## Two things that decide whether this works

### Never use a link shortener

Put the real address on the slide. A QR code does not care how long it is — it
just draws a slightly denser square — and every shortener now shows an
advertising page with a countdown before it forwards. Somebody standing in the
hall scans the parish's screen and gets an advert and a wait. That reads as the
screen being broken, and they are not wrong.

The editor used to shorten links automatically, through TinyURL, on every
import. That is gone. In its place:

- Campaign tracking (`utm_source`, `mc_eid` and the rest) is stripped on
  import. Nothing leaves the building to make that happen.
- Breeze rewrites every newsletter link into a thousand characters of click
  tracking, which really would make an unscannable code. Only the wrapper knows
  the address behind it and a browser is not allowed to look, so the editor
  asks the Sheet's own script, which is allowed to. This needs Code.gs
  redeployed — see below.
- Anything still going through a shortener says so on the card, and tells you
  to paste the address it actually leads to.

> **After updating Code.gs**, redeploy it: Apps Script → Deploy → Manage
> deployments → the pencil → New version → Deploy. Without that the editor
> falls back to leaving the tracking links exactly as they arrived, with their
> warning showing — the import still works, the QR codes are just dense.

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

Standing items (service times, giving) just get an End date years out.

---

## Today in the Church

The day, its fasting rule and the tone of the week, shown in the masthead
beside the parish name — pulled automatically from
[GOARCH's public Online Chapel feed](https://onlinechapel.goarch.org/daily.asp),
the same data source a number of parish websites have quietly relied on for
years. Nothing to type in, nothing to remember: it refreshes itself once a
day.

This used to be a slide, and it opened the rotation every time — which meant
the one thing on the screen that is the same all day was also the thing the
hall saw most often, ahead of the parish's actual news. It is a line in the
masthead now, where a fixed slogan used to sit. That costs no room on the
screen at all, and it is on it permanently rather than once a cycle.

The masthead has room for the day, the fast and the tone. The saints
themselves are fetched and stored, but not displayed — the list runs to a
paragraph on some days, which is a slide's worth of words in a place that has
one line.

### Setting it up

1. Add a tab named **Liturgical** to the Sheet. Whatever's in it gets
   overwritten automatically — no headers to set up by hand.
2. In the Sheet's **Extensions → Apps Script** editor, choose
   `installDailyLiturgicalTrigger` from the function dropdown (next to the
   Run button) and press **Run**. Google will ask to authorize a new
   permission — fetching an outside page — since `Code.gs` hasn't needed that
   before; approve it. This installs the daily trigger and also fills in the
   tab immediately, so you're not waiting until tomorrow to see it work.
3. Publish the Liturgical tab to the web the same way as the others: **File →
   Share → Publish to web** → the Liturgical tab → **CSV** → **Publish**.
4. Paste that link into `liturgicalCsvUrl` in
   [`assets/js/config.js`](assets/js/config.js).

Leave `liturgicalCsvUrl` blank and the masthead keeps the fixed `tagline` from
config.js instead. If the feed can't be reached on a given night, the tab is
simply left as it was rather than wiped — yesterday's commemoration staying up
one extra day beats the line going blank.

> This uses a real, stable, publicly documented GOARCH feed — the same one a
> long-standing WordPress plugin has pulled from for parish websites — but it
> isn't an official supported API with an SLA. If GOARCH ever moves it,
> `LITURGICAL_FEED_URL` near the top of `sheet/Code.gs` is the only line that
> needs to change.

---

## The welcome band

A visitor deciding whether to leave their name is deciding it now, standing in
the hall with a cup in one hand. When the welcome was a slide in the rotation
they had to wait for it to come round again before they could scan anything,
and by then they have usually gone.

So it stands in a band under the announcements, permanently: the parish's
welcome form as a code, the sentence a visitor should read, and nothing else.
It is set in [`assets/js/config.js`](assets/js/config.js) under `welcome` —
`title`, `body`, `formUrl` and `qrLabel`. There is no Sheet tab behind it,
because it says the same thing every week, which is the point of it.

Keep `body` to a sentence or two. It is shown in full, and the band is one
line of the screen rather than a slide — every line it takes is a line the
announcements above it do not get. Leave `formUrl` blank to leave the welcome
off the screen entirely.

---

### The cross in the middle

The parish cross is echoed once in the centre of the announcements as well as
in the four corners, at about half the corners' strength — `centreOrnament` in
[`assets/js/config.js`](assets/js/config.js), or 0 to turn it off.

It is centred in the announcements rather than in the screen, because the
screen's own centre now falls under the sign-up rail and would be half-covered
by it.

If you ever change the strength, judge it in the hall rather than at a desk,
and behind the busiest slide you have rather than a short one. A television
halves colour detail and chews thin strokes, so a watermark that looks
perfectly judged on a laptop can vanish on the wall — the same reason the
corner artwork is drawn far larger than it looks like it needs to be.

---

## Coffee Hour and Holy Bread sign-ups

These two don't rotate. They stand in a column of their own down the
right-hand side of the screen, permanently — every upcoming Sunday, who has
it, which are still open, and a code to scan — while the announcements come
and go on the left.

That's deliberate. An announcement is read now and acted on later; a sign-up
is acted on there and then, by somebody holding a phone who has just decided
to host a Sunday. When these were slides in the rotation, that person had to
wait out the rest of the week's news before they could scan anything, which
is how a sign-up sheet goes unfilled.

Otherwise they're built the same way as everything else here: a Sheet tab is
the one true copy, a page reads it, and a QR code is how people get there. There's no separate service to pay for or manage — the sign-up
page (`signup.html`) is part of this same site, and it writes back to the
Sheet through the same Apps Script that "Make it live" already uses.

Each is a tab in the Sheet — **Coffee Hour** and **Holy Bread** — with three
columns: **Date**, **Name**, **Signed Up At**. One row per person who has
claimed a Sunday. A Sunday with no row is simply open; nobody has to
pre-fill weeks nobody has signed up for yet. As with announcements, you can
edit these tabs by hand instead of through the sign-up page, and the TV will
still pick it up.

Someone scans the QR code on the TV, lands on `signup.html`, taps an open
Sunday, types their name, and it appears on the TV within a couple of
minutes — the same publish lag as everything else in this project, not
because sign-ups are somehow slower.

### Setting it up

1. In the same Google Sheet the announcements live in, add two tabs named
   exactly **Coffee Hour** and **Holy Bread**, each with the header row
   `Date  Name  Signed Up At`.
2. Publish each one to the web as CSV, the same way you did for
   Announcements: **File → Share → Publish to web** → choose that tab →
   **Comma-separated values (.csv)** → **Publish**. Copy each address.
3. In [`assets/js/config.js`](assets/js/config.js), paste those two
   addresses into `coffeeHour.csvUrl` and `holyBread.csvUrl`.
4. Sign-ups only work if **one-click publish** (`sheet/Code.gs`) is already
   set up — see *One-click publish* above. Unlike announcements, there's no
   manual fallback for sign-ups; if `publishUrl` is blank, the sign-up page
   says so plainly rather than pretending to work. If you set up `Code.gs`
   after it was first deployed, redeploy it (**Deploy → Manage deployments →
   pencil icon → New version → Deploy**) so the new sign-up handling is live.
5. Set `coffeeHour.signupUrl` and `holyBread.signupUrl` to the address people
   should land on — `signup.html?type=coffee` and `signup.html?type=bread`
   on wherever this site ends up hosted. **This is the one place your site's
   real address becomes visible to a stranger** — it's what's encoded in the
   QR code and printed on screen. If you'd rather it not show your GitHub
   Pages address (or just want something shorter to say out loud), make a
   free short link at [tinyurl.com](https://tinyurl.com) for each one and
   put that here instead — the kiosk only ever displays whatever URL is
   entered in these two fields.

Leave either pair blank to leave that sign-up off the TV entirely — the
column then shows just the one, with a larger code. Leave both blank and the
column disappears, and announcements have the full width of the screen back.

### Fasting Sundays

The Coffee Hour sign-up marks any Sunday that falls in Great Lent, the
Apostles' Fast, the Dormition Fast, or the Nativity Fast, so whoever signs up
knows to bring fasting-friendly food. This is worked out in
[`assets/js/orthodox-calendar.js`](assets/js/orthodox-calendar.js) from the
date alone — nothing to maintain, no calendar to update every year. It
follows the Revised Julian ("New") calendar most Greek Orthodox parishes in
America use for fixed feasts, the same one sainteliaschurch.org's own
bulletin follows; Pascha itself is the same date on every Orthodox calendar,
so only the three fixed-date fasts would need changing for a parish on the
Old Calendar.

### The TV only shows so much

However many weeks ahead `signupWeeksAhead` in config.js is set to show —
useful for the sign-up page itself, where people might want to plan further
out — the television only ever displays the first 6. Two sign-ups, six
Sundays each, and a code big enough to scan come to within a few pixels of
the full height of that column at 1080p; a seventh row only fits by shrinking
the type past what somebody holding a phone can read. `signup.html` always
shows the full list.

The dates in that column are shortened — "Sep 14", not "Sunday, September
14". Every date in these lists is a Sunday, so the word distinguishes
nothing, and it costs the room a long name needs. A name too long for its row
is trimmed with an ellipsis rather than pushing the date off the end; if
that starts happening often, shorten the names in the Sheet.

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
  slide, **R** to re-check the Sheet now, **U** to update to the newest version
  of the kiosk itself.

### It updates itself

Two different things go stale on a screen left running for weeks, and they are
fixed in two different ways.

**The words** come from the Sheet, which is re-read every couple of minutes.
That has always worked.

**The program** — the code that draws the slides — used to be whatever the
browser downloaded the day the Pi was last restarted. A fix pushed on Tuesday
would not reach the hall until somebody power-cycled the machine.

Now the screen checks every ten minutes for a newer version and, if there is
one, reloads itself **between slides**. Nothing to press, nobody in the hall,
and no walking over with a keyboard. Change `updateCheckMinutes` in
[`config.js`](assets/js/config.js) to adjust it, or set it to `null` to turn it
off.

If a reload doesn't actually land on the new version, it gives up after one
attempt and says so in the browser console rather than reloading forever — a
screen that restarts every fourteen seconds is far worse than one running last
week's code.

### Releasing a change

Run this before pushing, and commit what it changes:

```bash
./stamp-version.sh && git add -A && git commit -m "..." && git push
```

It stamps every stylesheet and script with a release number and writes
`version.json`, which is what the television compares itself against.

Skipping it doesn't break anything, but the screen won't notice the change,
and browsers may serve a mix of old and new files for ten minutes — which is
how `##` and `**` once ended up visible on the preview instead of being
rendered.

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

**Sign-ups say "aren't accepting entries yet".**
`coffeeHour.csvUrl`/`holyBread.csvUrl` are set, but `publishUrl` in
config.js is blank — one-click publish (`sheet/Code.gs`) has to be set up
before people can actually claim a Sunday. See *One-click publish* and
*Coffee Hour and Holy Bread sign-ups* above.

**Someone signed up but the TV still says Open.**
Give it a few minutes — the same publish lag "Make it live" has. If it's
been longer than five, check the Coffee Hour/Holy Bread tab directly; the
row is either missing (the sign-up didn't save — check `Code.gs` is
deployed with the latest version) or present but the CSV publish is stale
(re-publish that tab to the web).

**The edges are cut off.**
Some TVs crop the picture. Raise `safeAreaPercent` in `config.js`.

**The corner crosses look washed out on the TV.**
They will always look fainter there than on a computer — a television throws
away colour detail, sharpens edges and runs a bright backlight, all of which
flatten fine gold linework. Raise `cornerOrnament` in `config.js` (0.17 by
default, up to about 0.25) and judge it standing where people actually sit.
Lower it, or set it to 0, if it pulls attention off the announcement.

---

## What's in here

```
index.html          the screen in the hall
import.html         the editor — the page everyone opens
signup.html         Coffee Hour / Holy Bread sign-up — ?type=coffee or ?type=bread
preview.html        one slide, drawn as the TV draws it; used twice by the
                    editor — once visibly, once hidden off-screen to measure
                    every announcement's true fit
assets/
  css/kiosk.css     how the screen looks
  css/admin.css     how the editor looks
  css/signup.css    how signup.html looks
  js/config.js      ← the settings, and the only file you need to edit
  js/csv.js         reads the Sheet's CSV
  js/deck.js        filters by date, polls for changes, caches offline
  js/slide.js       draws a slide, and guarantees it fits on one
  js/live.js        reads and writes the Sheet; decides what "live" means
  js/format.js      asks the Sheet's script to lay announcements out
  js/eml.js         reads downloaded .eml newsletters
  js/import.js      splits a newsletter into announcements
  js/import-ui.js   the editor itself — list, preview, publishing
  js/preview-frame.js  the inside of the preview window
  js/orthodox-calendar.js  which Sundays fall in a fasting period
  js/signup-data.js    turns a sign-up Sheet tab into a list of Sundays
  js/signup-ui.js   signup.html itself — claiming a Sunday
  js/liturgical-data.js  turns the Liturgical Sheet tab into today's line
  js/qrcode.js      QR code generator (Kazuhiko Arase, MIT)
  fonts/            EB Garamond + Montserrat
  img/              parish monogram and cross
version.json        the published release number; the TV watches this and
                    reloads itself when it changes
stamp-version.sh    run before pushing — stamps the release and writes the above
pi/setup-pi.sh      one-time Raspberry Pi setup
sheet/Code.gs       the Apps Script that receives "Make it live", sign-ups,
                    and the daily liturgical fetch
sample/             example announcements, sign-ups and liturgical data,
                    used when nothing is configured
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
