/* ============================================================================
   weather.js — the temperature next to the clock
   ----------------------------------------------------------------------------
   Open-Meteo: free, no account, no API key, and answers a plain cross-origin
   fetch — the same reason it was picked over anything requiring a signup.
   Weather doesn't need to be fresher than a coffee hour screen actually
   needs it, so this polls far less often than the Sheet does.
   ========================================================================== */

(function (global) {
  'use strict';

  const CFG = global.KIOSK_CONFIG;

  // WMO weather codes, as Open-Meteo reports them — condensed to what reads
  // well in a couple of words on a TV, not the full official wording.
  const CODES = {
    0: 'Clear', 1: 'Mostly Clear', 2: 'Partly Cloudy', 3: 'Overcast',
    45: 'Fog', 48: 'Fog',
    51: 'Light Drizzle', 53: 'Drizzle', 55: 'Heavy Drizzle',
    56: 'Freezing Drizzle', 57: 'Freezing Drizzle',
    61: 'Light Rain', 63: 'Rain', 65: 'Heavy Rain',
    66: 'Freezing Rain', 67: 'Freezing Rain',
    71: 'Light Snow', 73: 'Snow', 75: 'Heavy Snow', 77: 'Snow',
    80: 'Rain Showers', 81: 'Rain Showers', 82: 'Heavy Showers',
    85: 'Snow Showers', 86: 'Snow Showers',
    95: 'Thunderstorm', 96: 'Thunderstorm', 99: 'Thunderstorm',
  };

  function label(code) {
    return CODES[code] || 'Weather';
  }

  async function fetchWeather() {
    const w = CFG.weather;
    const url = 'https://api.open-meteo.com/v1/forecast' +
      '?latitude=' + w.latitude + '&longitude=' + w.longitude +
      '&current=temperature_2m,weather_code' +
      '&temperature_unit=fahrenheit&timezone=auto';
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error('responded ' + res.status);
    const data = await res.json();
    return { tempF: Math.round(data.current.temperature_2m), label: label(data.current.weather_code) };
  }

  /** Emits 'weather' with {tempF, label}, or null if not configured. */
  function createWeatherSource() {
    const listeners = [];
    const configured = !!(CFG.weather && CFG.weather.latitude != null && CFG.weather.longitude != null);

    async function refresh() {
      if (!configured) return;
      try {
        const w = await fetchWeather();
        listeners.forEach(fn => fn(w));
      } catch (err) {
        console.warn('[kiosk] could not reach the weather service:', err.message);
      }
    }

    return {
      on(fn) { listeners.push(fn); return this; },
      start() {
        if (!configured) { listeners.forEach(fn => fn(null)); return this; }
        refresh();
        setInterval(refresh, 15 * 60 * 1000);
        return this;
      },
      refresh,
    };
  }

  global.Weather = { createWeatherSource };

})(window);
