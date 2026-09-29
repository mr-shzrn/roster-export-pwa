/**
 * Roster format detection — JS analog of the desktop app's roster_format.py.
 * Returns 'calendar_grid', 'new' (Roster Report), or 'unknown'.
 */
window.RosterPWA = window.RosterPWA || {};

(function (ns) {
  function detectFormat(pages) {
    const page0 = pages[0];
    if (!page0) return 'unknown';
    const joined = page0.items.map((it) => it.str).join(' ');
    if (joined.includes('Roster Report') && joined.includes('Pairing/Activity')) return 'new';
    if (ns.calendarGridParser && ns.calendarGridParser.looksLikeCalendarGrid(pages)) return 'calendar_grid';
    return 'unknown';
  }

  ns.formatDetect = { detectFormat };
})(window.RosterPWA);
