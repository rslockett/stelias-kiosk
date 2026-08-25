/* ============================================================================
   signup-ui.js — the page people land on after scanning a kiosk QR code
   ----------------------------------------------------------------------------
   Reads ?type=coffee or ?type=bread from the address, shows the upcoming
   Sundays for that sign-up, and lets someone claim an open one.

   The moment someone confirms a name, this shows it as taken immediately —
   it does not wait for Google to catch up. Google's published-CSV endpoint
   can take anywhere from a few seconds to over a minute to reflect a write
   that has already landed in the Sheet (the write itself, via sheet/Code.gs,
   is immediate and safe against two people claiming the same Sunday — see
   the LockService check there). Waiting on the network for that long before
   showing anything would just look broken and invite a second, redundant
   sign-up. So the claim is remembered locally the instant it's made, and the
   network poll afterward exists only to catch the rare real conflict: two
   people claiming the same Sunday within moments of each other, where the
   loser's optimistic checkmark has to be taken back.
   ========================================================================== */

(function () {
  'use strict';

  const CFG = window.KIOSK_CONFIG;

  const TYPES = {
    coffee: {
      csvUrl: CFG.coffeeHour.csvUrl,
      title: 'Coffee Hour Sign-Up',
      subtitle: 'Pick a Sunday to host — fasting Sundays are marked, so you know what to bring.',
      markFasting: true,
    },
    bread: {
      csvUrl: CFG.holyBread.csvUrl,
      title: 'Holy Bread Sign-Up',
      subtitle: 'Pick a Sunday to bake the prosphora for Liturgy.',
      markFasting: false,
    },
  };

  const typeKey = new URLSearchParams(location.search).get('type') === 'bread' ? 'bread' : 'coffee';
  const type = TYPES[typeKey];

  const titleEl = document.getElementById('page-title');
  const subtitleEl = document.getElementById('page-subtitle');
  const noticeEl = document.getElementById('notice');
  const listEl = document.getElementById('slots');

  document.getElementById('doc-title').textContent = 'St. Elias — ' + type.title;
  document.getElementById('church-name').textContent = CFG.churchName;
  titleEl.textContent = type.title;
  subtitleEl.textContent = type.subtitle;

  function showNotice(text, kind) {
    noticeEl.textContent = text;
    noticeEl.className = 'notice' + (kind ? ' notice--' + kind : '');
    noticeEl.hidden = !text;
  }

  if (!type.csvUrl) {
    showNotice('This sign-up isn’t set up yet — check back soon, or contact the church office.', 'error');
  } else if (!CFG.publishUrl) {
    // Unlike announcements, sign-ups have no "copy rows and paste them in
    // yourself" fallback — claiming a slot only means something if it can
    // actually be written to the Sheet. See sheet/Code.gs.
    showNotice('Sign-ups aren’t accepting entries yet — contact the church office to sign up directly.', 'error');
  }

  /* ------------------------------------------------------- this device's claims -- */

  // What this browser has claimed, so a slot it just confirmed reads as
  // taken immediately — and stays that way across a reload — without
  // waiting on Google's publish lag. Reconciled against the network in
  // reconcile() below; a genuine conflict (someone else's name lands in
  // the Sheet for the same date) clears the entry here.
  const STORAGE_KEY = 'stelias.signup.mine.' + typeKey;

  function loadMine() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }

  function saveMine() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(mine)); } catch (e) { /* storage full or disabled */ }
  }

  let mine = loadMine();   // { [iso]: name }

  /**
   * Layer this device's own claims on top of whatever the network currently
   * says, and drop any claim the network has since contradicted (someone
   * else's name landed for the same date — a genuine race, not just lag).
   * Returns the date label of a conflict found, or null.
   */
  function reconcile(slots) {
    let conflictLabel = null;
    let changed = false;

    for (const slot of slots) {
      const myName = mine[slot.iso];
      if (!myName) continue;

      if (slot.filled && slot.name !== myName) {
        delete mine[slot.iso];
        changed = true;
        conflictLabel = slot.label;
      } else if (!slot.filled) {
        // Network hasn't caught up yet — show my own claim in its place.
        slot.filled = true;
        slot.name = myName;
      }
    }

    if (changed) saveMine();
    return conflictLabel;
  }

  /* ------------------------------------------------------------ fetching -- */

  async function fetchSlots() {
    const url = type.csvUrl + (type.csvUrl.indexOf('?') === -1 ? '?' : '&') + '_ts=' + Date.now();
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error('responded ' + res.status);
    const text = await res.text();
    if (/^\s*</.test(text)) throw new Error('got a web page instead of CSV');
    const rows = window.CSV.parseObjects(text);
    return window.SignupData.buildSlots(rows, CFG.signupWeeksAhead || 6, { markFasting: type.markFasting });
  }

  /* -------------------------------------------------------------- render -- */

  // Tracks which slot (if any) has its sign-up form open, so a background
  // refresh doesn't yank the form shut out from under someone mid-type.
  let openDate = null;

  function render(slots) {
    listEl.innerHTML = slots.map(slotHtml).join('');
    slots.forEach(wireSlot);
  }

  function slotHtml(slot) {
    const fastBadge = slot.fastName
      ? '<div><span class="slot__fast">' + esc(slot.fastName) + '</span></div>' : '';

    let action;
    if (slot.filled) {
      action = '<p class="slot__filled">✓ ' + esc(slot.name) + '</p>';
    } else if (openDate === slot.iso) {
      action =
        '<form class="slot__form" data-date="' + slot.iso + '">' +
          '<input class="slot__input" type="text" placeholder="Your name" maxlength="80" required autofocus>' +
          '<button class="slot__confirm" type="submit">Confirm</button>' +
          '<button class="slot__cancel" type="button">Cancel</button>' +
        '</form>' +
        '<p class="slot__status" hidden></p>';
    } else {
      action = '<button class="slot__button" data-date="' + slot.iso + '">Sign up</button>';
    }

    return (
      '<li class="slot" id="slot-' + slot.iso + '">' +
        '<div class="slot__row">' +
          '<p class="slot__date">' + esc(slot.label) + '</p>' +
          (slot.filled ? action : '') +
        '</div>' +
        fastBadge +
        (slot.filled ? '' : action) +
      '</li>'
    );
  }

  function wireSlot(slot) {
    const li = document.getElementById('slot-' + slot.iso);
    if (!li) return;

    const openBtn = li.querySelector('.slot__button');
    if (openBtn) {
      openBtn.addEventListener('click', () => { openDate = slot.iso; render(lastSlots); });
    }

    const form = li.querySelector('.slot__form');
    if (form) {
      form.querySelector('.slot__cancel').addEventListener('click', () => {
        openDate = null;
        render(lastSlots);
      });
      form.addEventListener('submit', e => {
        e.preventDefault();
        const name = form.querySelector('.slot__input').value.trim();
        if (name) submitSignup(slot, name);
      });
    }
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* --------------------------------------------------------------- submit -- */

  function submitSignup(slot, name) {
    if (!CFG.publishUrl) {
      showNotice('Sign-ups aren’t accepting entries yet — contact the church office.', 'error');
      return;
    }

    // Claim it locally and show it as taken right away — no waiting on
    // Google's publish lag. See the big comment at the top of this file.
    mine[slot.iso] = name;
    saveMine();
    openDate = null;
    slot.filled = true;
    slot.name = name;
    render(lastSlots);
    showNotice('You’re signed up for ' + slot.label + '. Thank you!', 'good');

    fetch(CFG.publishUrl, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'signup', type: typeKey, date: slot.iso, name }),
    }).catch(() => { /* no-cors POSTs resolve even on most network errors */ });

    watchForConflict(slot.iso);
  }

  /**
   * Poll a little more eagerly right after a claim, purely to catch a real
   * race — someone else's name landing in the Sheet for the same Sunday —
   * rather than to confirm the claim itself (that already happened above).
   * Gives up after a couple of minutes; reconcile() on the normal 30-second
   * poll will still catch a late-arriving conflict after that.
   */
  function watchForConflict(iso) {
    const deadline = Date.now() + 2 * 60 * 1000;

    const tick = async () => {
      if (!mine[iso] || Date.now() > deadline) return;

      try {
        const slots = await fetchSlots();
        const conflictLabel = reconcile(slots);
        lastSlots = slots;
        if (conflictLabel) {
          if (openDate === null) render(lastSlots);
          showNotice('Someone else just took ' + conflictLabel + ' — your sign-up wasn’t saved. Please pick another Sunday.', 'error');
          return;
        }
      } catch (e) {
        /* the regular 30-second poll will keep trying */
      }

      setTimeout(tick, 5000);
    };

    setTimeout(tick, 5000);
  }

  /* ---------------------------------------------------------------- poll -- */

  let lastSlots = [];

  async function refresh() {
    try {
      const slots = await fetchSlots();
      const conflictLabel = reconcile(slots);
      lastSlots = slots;
      // Don't redraw out from under someone who has a sign-up form open.
      if (openDate === null) render(lastSlots);
      if (conflictLabel) {
        showNotice('Someone else just took ' + conflictLabel + ' — your sign-up wasn’t saved. Please pick another Sunday.', 'error');
      }
    } catch (e) {
      if (!lastSlots.length) {
        showNotice('Could not load the sign-up sheet. Check your connection and reload.', 'error');
      }
    }
  }

  if (type.csvUrl) {
    refresh();
    setInterval(refresh, 30 * 1000);
  }

})();
