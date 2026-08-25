/* ============================================================================
   orthodox-calendar.js — which Sundays fall in a fasting period
   ----------------------------------------------------------------------------
   Used by the Coffee Hour sign-up so hosts know to bring fasting-friendly
   food. Everything here follows the Revised Julian ("New") calendar, which is
   what most Greek Orthodox parishes in America use for fixed feasts — the
   same calendar sainteliaschurch.org's own bulletin follows. If this parish
   ever moves to the Old Calendar, only fixedFasts() below needs new dates;
   Pascha itself is unaffected, since every Orthodox calendar agrees on it.
   ========================================================================== */

(function (global) {
  'use strict';

  /* ---------------------------------------------------------- pascha date -- */

  /**
   * Orthodox Pascha (Easter) for a given year, as a Gregorian-calendar Date.
   *
   * Two steps: Meeus's "Julian" algorithm gives the month/day of Pascha *in
   * the Julian calendar* (the calendar the Church has always dated Pascha
   * by), then that date is converted to its Gregorian-calendar equivalent
   * through a Julian Day Number — not by adding a fixed 13 days, which is
   * only correct for 1900–2099 and would quietly drift wrong afterward.
   */
  function orthodoxPascha(year) {
    const a = year % 4;
    const b = year % 7;
    const c = year % 19;
    const d = (19 * c + 15) % 30;
    const e = (2 * a + 4 * b - d + 34) % 7;
    const month = Math.floor((d + e + 114) / 31);   // Julian-calendar month
    const day = ((d + e + 114) % 31) + 1;            // Julian-calendar day

    const jdn = julianCalendarToJDN(year, month, day);
    return jdnToGregorianDate(jdn);
  }

  function julianCalendarToJDN(y, m, d) {
    const a = Math.floor((14 - m) / 12);
    const y2 = y + 4800 - a;
    const m2 = m + 12 * a - 3;
    return d + Math.floor((153 * m2 + 2) / 5) + 365 * y2 + Math.floor(y2 / 4) - 32083;
  }

  function jdnToGregorianDate(jdn) {
    const a = jdn + 32044;
    const b = Math.floor((4 * a + 3) / 146097);
    const c = a - Math.floor((146097 * b) / 4);
    const d = Math.floor((4 * c + 3) / 1461);
    const e = c - Math.floor((1461 * d) / 4);
    const m = Math.floor((5 * e + 2) / 153);
    const day = e - Math.floor((153 * m + 2) / 5) + 1;
    const month = m + 3 - 12 * Math.floor(m / 10);
    const year = 100 * b + d - 4800 + Math.floor(m / 10);
    return new Date(year, month - 1, day);
  }

  function addDays(date, n) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);
  }

  /* ------------------------------------------------------------- fasts -- */

  /**
   * Every fasting period that can land on a Sunday, for the year a given
   * date falls in (plus the tail of the previous year's Nativity Fast,
   * which runs into late December and can matter for an early-January
   * lookup window).
   */
  function fastsForYear(year) {
    const pascha = orthodoxPascha(year);

    const fasts = [
      // Great Lent: Clean Monday through Palm Sunday, inclusive.
      { name: 'Great Lent', start: addDays(pascha, -48), end: addDays(pascha, -7) },

      // Nativity Fast: fixed dates, Revised Julian / New calendar.
      { name: 'Nativity Fast', start: new Date(year, 10, 15), end: new Date(year, 11, 24) },

      // Dormition Fast: fixed dates.
      { name: 'Dormition Fast', start: new Date(year, 7, 1), end: new Date(year, 7, 14) },
    ];

    // Apostles' Fast: starts the Monday after All Saints Sunday (Pentecost +
    // 7, i.e. Pascha + 56, so the Monday is Pascha + 57) and runs through
    // June 28. In years Pascha falls very late, that start can land after
    // June 28 — meaning there is no Apostles' Fast that year at all.
    const apostlesStart = addDays(pascha, 57);
    const apostlesEnd = new Date(year, 5, 28);
    if (apostlesStart <= apostlesEnd) {
      fasts.push({ name: "Apostles' Fast", start: apostlesStart, end: apostlesEnd });
    }

    return fasts;
  }

  /**
   * Is this date (any day, not just a Sunday) inside a fasting period?
   * Returns the fast's name, or null.
   */
  function fastingInfo(date) {
    const midnight = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const years = [midnight.getFullYear() - 1, midnight.getFullYear(), midnight.getFullYear() + 1];

    for (const y of years) {
      for (const fast of fastsForYear(y)) {
        if (midnight >= fast.start && midnight <= fast.end) return fast.name;
      }
    }
    return null;
  }

  global.OrthodoxCalendar = { orthodoxPascha, fastingInfo };

})(window);
