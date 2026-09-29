/**
 * Column detection over a reconstructed header row — the x-coordinate
 * analog of new_roster_parser.py's _detect_columns()/_DEFAULT_COLS and
 * styled_roster_parser.py's _detect_extra_columns(). Ports the exact same
 * substring-matching rules, keyed to x-position instead of array index.
 *
 * cellAt() assigns by column RANGE (the midpoint between each pair of
 * adjacent registered anchors), not a small fixed tolerance around the
 * header label's own x — confirmed necessary against a second real roster
 * PDF where data values (e.g. a bare "D" day-off code) sit well to the left
 * of where its wide header label ("Pairing/Activity") starts, well outside
 * any small absolute tolerance, even though the first fixture happened to
 * have header labels and data share identical x exactly.
 */
window.RosterPWA = window.RosterPWA || {};

(function (ns) {

  // Fallback anchors from the real fixture's page 1, used only if a page has
  // no detectable header at all AND no earlier page's map can be reused.
  const DEFAULT_COL_MAP = {
    date: 30, pairing: 79.3, duty_report: 236.8, item: 279.7,
    overridden_rank: 322.7, work_type: 365.7, acy_rep: 408.6,
    dep: 605.2, arr: 648.2, acy_deb: 691.1, duty_debrief: 734.1,
    flying_hrs: 777.1, duty_hrs: 820, sdc: 863, ac_type: 906, hotel: 948.9,
  };

  function looksLikeHeaderRow(row) {
    const joined = row.raw.toLowerCase();
    return joined.includes('pairing') || joined.includes('work type');
  }

  /** Mirrors _detect_columns()/_detect_extra_columns()'s per-cell if/elif chain. */
  function detectColumnMap(headerRow) {
    const colMap = {};
    for (const item of headerRow.items) {
      const c = item.str.toLowerCase().trim();
      if (c.includes('date') && !c.includes('updated')) colMap.date = item.x;
      else if (c.includes('pairing') || c.includes('activity')) colMap.pairing = item.x;
      else if (c.includes('duty') && c.includes('report')) colMap.duty_report = item.x;
      else if (c === 'item') colMap.item = item.x;
      else if (c.includes('rank')) colMap.overridden_rank = item.x;
      else if (c.includes('work') && c.includes('type')) colMap.work_type = item.x;
      else if (c.includes('acy') && c.includes('rep')) colMap.acy_rep = item.x;
      else if (c.includes('dep') && c.includes('stn')) colMap.dep = item.x;
      else if (c.includes('arr') && (c.includes('stn') || c.includes('time'))) colMap.arr = item.x;
      else if (c.includes('debrief')) colMap.duty_debrief = item.x;
      else if (c.includes('acy') && c.includes('deb')) colMap.acy_deb = item.x;
      else if (c.includes('flying')) colMap.flying_hrs = item.x;
      else if (c.includes('duty') && c.includes('hrs')) colMap.duty_hrs = item.x;
      else if (c.includes('a/c')) colMap.ac_type = item.x;
      else if (c.includes('hotel')) colMap.hotel = item.x;
      else if (c === 'sdc') colMap.sdc = item.x;
      // Registered purely to give 'hotel' (the last column callers actually
      // read) a real right boundary — without these two, hotel's range runs
      // to +Infinity and swallows Updated By/Date whenever hotel is blank.
      else if (c.includes('updated') && c.includes('by')) colMap.updated_by = item.x;
      else if (c.includes('updated') && c.includes('date')) colMap.updated_date = item.x;
    }
    return colMap;
  }

  /** JS analog of new_roster_parser._cell(row, col_map, key), but range-based:
   * gathers every item between the midpoints to this column's neighboring
   * anchors, rather than requiring an exact/near-exact x match. This also
   * incidentally recovers cases where a wrapped multi-line value failed to
   * merge into one item at the table-reconstruction stage (both fall in the
   * same range, so both get joined here regardless). */
  function cellAt(row, colMap, key) {
    const anchor = colMap[key];
    if (anchor === undefined) return '';
    const sorted = Object.values(colMap).slice().sort((a, b) => a - b);
    const idx = sorted.indexOf(anchor);
    const lowerBound = idx > 0 ? (sorted[idx - 1] + anchor) / 2 : -Infinity;
    const upperBound = idx < sorted.length - 1 ? (anchor + sorted[idx + 1]) / 2 : Infinity;
    const matched = row.items.filter((it) => it.x >= lowerBound && it.x < upperBound);
    return matched.map((it) => it.str.trim()).filter(Boolean).join(' ');
  }

  ns.columns = { looksLikeHeaderRow, detectColumnMap, cellAt, DEFAULT_COL_MAP };
})(window.RosterPWA);
