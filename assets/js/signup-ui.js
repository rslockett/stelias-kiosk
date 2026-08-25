/* ============================================================================
   signup-ui.js — the page people land on after scanning a kiosk QR code
   ----------------------------------------------------------------------------
   Reads ?type=coffee or ?type=bread from the address, shows the upcoming
   Sundays for that sign-up, and lets someone claim an open one. The claim
   itself works exactly like the importer's "Make it live" (see live.js):
   send it, then watch the published Sheet until it shows up, because Apps
   Script cannot tell this page whether the write actually landed.
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
        if (name) submitSignup(slot, name, li);
      });
    }
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* --------------------------------------------------------------- submit -- */

  async function submitSignup(slot, name, li) {
    const statusEl = li.querySelector('.slot__status');

    if (!CFG.publishUrl) {
      statusEl.hidden = false;
      statusEl.className = 'slot__status is-error';
      statusEl.textContent = 'Sign-ups aren’t accepting entries yet — contact the church office.';
      return;
    }

    li.setAttribute('disabled', 'disabled');
    statusEl.hidden = false;
    statusEl.className = 'slot__status';
    statusEl.textContent = 'Saving … this can take up to a minute.';

    try {
      await fetch(CFG.publishUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'signup', type: typeKey, date: slot.iso, name }),
      });
    } catch (e) {
      // A no-cors POST resolves even on most network errors; if it truly
      // couldn't be sent, the watch loop below will just time out.
    }

    watchForConfirmation(slot.iso, name, li, statusEl);
  }

  /**
   * Re-read the published Sheet until this exact sign-up shows up — or until
   * someone else's name shows up for the same Sunday first, or five minutes
   * pass. Same "don't claim it worked until we've seen it" rule live.js
   * uses for the importer's "Make it live".
   */
  function watchForConfirmation(iso, name, li, statusEl) {
    const deadline = Date.now() + 5 * 60 * 1000;

    const tick = async () => {
      let slots;
      try {
        slots = await fetchSlots();
      } catch (e) {
        slots = null;
      }

      if (slots) {
        lastSlots = slots;
        const match = slots.find(s => s.iso === iso);

        if (match && match.filled && match.name === name) {
          openDate = null;
          render(lastSlots);
          showNotice('You’re signed up for ' + match.label + '. Thank you!', 'good');
          return;
        }
        if (match && match.filled && match.name !== name) {
          li.removeAttribute('disabled');
          openDate = null;
          render(lastSlots);
          showNotice('Someone else just took that Sunday — pick another.', 'error');
          return;
        }
      }

      if (Date.now() > deadline) {
        li.removeAttribute('disabled');
        statusEl.className = 'slot__status is-error';
        statusEl.textContent = 'This is taking longer than usual. If it doesn’t appear on the hall screen soon, let the church office know.';
        return;
      }

      setTimeout(tick, 3000);
    };

    setTimeout(tick, 3000);
  }

  /* ---------------------------------------------------------------- poll -- */

  let lastSlots = [];

  async function refresh() {
    try {
      lastSlots = await fetchSlots();
      // Don't redraw out from under someone who has a sign-up form open.
      if (openDate === null) render(lastSlots);
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
