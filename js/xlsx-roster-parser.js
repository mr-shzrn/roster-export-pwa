/**
 * Parses the XLSX "Roster Report" export — the exact same report
 * styled-roster-parser.js already reads as a PDF, just as a spreadsheet.
 * Mirrors that file's row-dispatch/day-leg-building logic closely, reusing
 * its pure helpers (parsePairingEmbeddedDate, weekdayAbbrev,
 * computeOffDaysSplit, parseStnTime, and the header-line regexes) via
 * RosterPWA.styledRosterParser — same source report, same conventions, no
 * PDF dependency in any of those.
 *
 * The one real difference from the PDF: the Date column is an Excel serial
 * number (date+time), present on every duty-block-starting row (rows where
 * Pairing/Activity is non-empty) — no per-page column-anchor detection is
 * needed at all, since XLSX cells are already cleanly delimited by column
 * letter. A duty reporting late at night can legitimately land on the
 * calendar day *before* its pairing reference's label (a normal overnight
 * report, not a bug) — styled-roster-parser.js already only *warns* about
 * that mismatch, never rejects on it, and this file does the same. What
 * *is* rejected: a gap of more than one calendar day between two
 * consecutive duty blocks with nothing filling it — confirmed (with a real
 * roster) to happen when an export's date-range filter runs against a UTC
 * day boundary instead of local time, silently dropping a day.
 */
window.RosterPWA = window.RosterPWA || {};

(function (ns) {
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                   'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const DAYOFF_CODES = ['D', 'DO', 'DO1'];
  const PAIRING_RE = /^\d+-\d+\/\d{8}\/[A-Z]$/;
  const EXCEL_EPOCH_UNIX_DAYS = 25569; // days between Excel's day-0 (1899-12-30) and the Unix epoch

  const HEADER_COLUMN_NAMES = {
    date: 'Date', pairing: 'Pairing/Activity', dutyReport: 'Duty Report',
    item: 'Item', overriddenRank: 'Overridden Rank', workType: 'Work Type',
    dep: 'Dep Stn / Dep Time', arr: 'Arr. Stn / Arr. Time',
    dutyDebrief: 'Duty Debrief', flyingHrs: 'Flying Hrs', dutyHrs: 'Duty Hrs',
    sdc: 'SDC', acType: 'A/C Type', hotel: 'Hotel',
  };

  function excelSerialToDateParts(serial) {
    const ms = Math.round((parseFloat(serial) - EXCEL_EPOCH_UNIX_DAYS) * 86400000);
    const d = new Date(ms);
    return { year: d.getUTCFullYear(), monthIdx: d.getUTCMonth(), day: d.getUTCDate() };
  }

  function formatDateParts(parts) {
    return `${String(parts.day).padStart(2, '0')}-${MONTHS[parts.monthIdx]}-${parts.year}`;
  }

  function dayIndex(parts) {
    return Math.round(Date.UTC(parts.year, parts.monthIdx, parts.day) / 86400000);
  }

  function buildColumnMap(headerRow) {
    const map = {};
    for (const [key, name] of Object.entries(HEADER_COLUMN_NAMES)) {
      const col = Object.keys(headerRow.cells).find(
        (c) => (headerRow.cells[c] || '').trim().toLowerCase() === name.toLowerCase());
      if (col) map[key] = col;
    }
    return map;
  }

  function isHeaderRow(row, colMap) {
    const pairingCol = colMap.pairing;
    return !!pairingCol && (row.cells[pairingCol] || '').trim().toLowerCase() === 'pairing/activity';
  }

  function cell(row, colMap, key) {
    const col = colMap[key];
    return col ? (row.cells[col] || '') : '';
  }

  /** rows: RosterPWA.xlsxTextExtract.extractGrid()'s output. */
  function parseXlsxRoster(rows) {
    const sp = ns.styledRosterParser;
    const sorted = [...rows].sort((a, b) => a.rowNum - b.rowNum);
    if (!sorted.length) throw new Error('This Excel file has no rows.');

    // Row 1: crew_info / month_year / header_totals — identical header line
    // to the PDF export, so reuse its regexes exactly.
    const crewInfo = {};
    let monthYear = '';
    const headerTotals = {};
    const metaTexts = Object.values(sorted[0].cells || {});
    for (const text of metaTexts) {
      const dm = sp.DATE_RANGE_RE.exec(text);
      if (dm) {
        const startParts = /^(\d{2})-([A-Za-z]{3})-(\d{4})$/.exec(dm[1]);
        if (startParts) {
          const monthIdx = MONTHS.findIndex((m) => m.toLowerCase() === startParts[2].toLowerCase());
          if (monthIdx >= 0) monthYear = `${new Date(Date.UTC(+startParts[3], monthIdx, 1)).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' })} ${startParts[3]}`;
        }
      }
      const cm = sp.CREW_RE.exec(text);
      if (cm) {
        Object.assign(crewInfo, {
          name: cm[1].trim(), staff_number: cm[2], fleet: cm[3], base: cm[4], rank: cm[5],
        });
      }
      const tm = sp.TOTALS_RE.exec(text);
      if (tm) Object.assign(headerTotals, { fh: tm[1], dh: tm[2] });
    }

    // Row 2 (or wherever the header actually is) builds the column map;
    // any later repeated header row (printed on each page break) is
    // detected the same way and skipped.
    let colMap = null;
    const dutyDays = [];
    // Each block's [start, end] day-index range — end defaults to start, but
    // extends if a later row in the SAME block (a continuation leg reporting
    // the next morning, say) carries its own Date value. An overnight duty
    // reporting late at night legitimately "occupies" the day(s) its later
    // legs report on too, even though only its first row's date is what the
    // day gets filed under — comparing ranges (not just start dates) avoids
    // a false-positive gap for a duty that merely spans past midnight.
    const blockRanges = [];
    const warnings = [];
    let curDay = null;

    for (let i = 1; i < sorted.length; i++) {
      const row = sorted[i];
      if (!colMap) {
        if (Object.values(row.cells).some((v) => (v || '').trim().toLowerCase() === 'pairing/activity')) {
          colMap = buildColumnMap(row);
        }
        continue;
      }
      if (isHeaderRow(row, colMap)) continue;

      const dateCell = cell(row, colMap, 'date');
      const pairingCell = cell(row, colMap, 'pairing').trim();
      const itemCell = cell(row, colMap, 'item').trim();
      const isFlight = /^MH\d+/.test(itemCell);

      // A new block starts on Pairing/Activity being non-empty, not on the
      // Date cell being present — a continuation row can carry its own Date
      // value too (e.g. a leg reporting the next morning), so Date presence
      // alone isn't a reliable block boundary.
      const isNewBlock = pairingCell !== '';

      if (isNewBlock) {
        if (!/^\d+(\.\d+)?$/.test(dateCell)) {
          throw new Error(
            `Could not find a date for the duty starting with "${pairingCell}" `
            + '— this Excel file may be malformed or from an unsupported export.');
        }
        const parts = excelSerialToDateParts(dateCell);
        const curDateStr = formatDateParts(parts);
        const idx = dayIndex(parts);
        blockRanges.push({ start: idx, end: idx });

        const pairingRef = PAIRING_RE.test(pairingCell) ? pairingCell : '';
        const embeddedDate = pairingRef ? sp.parsePairingEmbeddedDate(pairingRef) : '';
        if (embeddedDate && embeddedDate !== curDateStr) {
          warnings.push(
            `${curDateStr}: pairing ref ${pairingRef} embeds date ${embeddedDate}, `
            + `but row is dated ${curDateStr} (a late-night report before the pairing's day is normal)`);
        }

        curDay = {
          date: curDateStr, day: sp.weekdayAbbrev(curDateStr),
          duty_start: cell(row, colMap, 'dutyReport'), duty_hours: cell(row, colMap, 'dutyHrs'),
          duty_end: '', item: '', legs: [],
        };
        dutyDays.push(curDay);

        if (DAYOFF_CODES.includes(pairingCell)) {
          curDay.item = pairingCell;
          curDay.duty_start = '';
          curDay.duty_hours = '';
          continue;
        }

        if (!isFlight) {
          const code = itemCell || pairingCell;
          if (code) {
            curDay.item = code;
            appendLeg(sp, curDay, row, colMap, code);
          }
          continue;
        }

        appendLeg(sp, curDay, row, colMap, itemCell);
        continue;
      }

      // A continuation row can carry its own Date value (e.g. a leg
      // reporting the next morning after an overnight report) — extend the
      // current block's occupied range so gap detection below doesn't
      // mistake a duty that merely spans past midnight for a missing day.
      if (blockRanges.length && /^\d+(\.\d+)?$/.test(dateCell)) {
        const idx = dayIndex(excelSerialToDateParts(dateCell));
        const range = blockRanges[blockRanges.length - 1];
        if (idx > range.end) range.end = idx;
      }

      // Continuation row — another leg of the current duty block.
      if (!curDay || !isFlight) continue;
      appendLeg(sp, curDay, row, colMap, itemCell);
    }

    // A gap of more than one calendar day between the end of one block's
    // occupied range and the start of the next, with no row filling it,
    // means a day silently vanished from the export — confirmed (against a
    // real roster) to happen when the export's date-range filter runs on a
    // UTC day boundary instead of local time. Fail loudly rather than
    // produce a roster with a missing day the user has no way to notice.
    for (let i = 1; i < blockRanges.length; i++) {
      const gap = blockRanges[i].start - blockRanges[i - 1].end;
      if (gap > 1) {
        throw new Error(
          "This roster's dates don't add up — it may have been exported in UTC "
          + `instead of local time (a ${gap - 1}-day gap between `
          + `${dutyDays[i - 1].date} and ${dutyDays[i].date}, with nothing in between). `
          + 'Re-export the roster in local time and try again.');
      }
    }

    const [atBase, away] = computeOffDaysSplitSafe(sp, dutyDays, crewInfo.base || 'KUL');
    headerTotals.at_base = atBase;
    headerTotals.away = away;

    return { crew_info: crewInfo, month_year: monthYear, header_totals: headerTotals, duty_days: dutyDays, legend: {}, warnings };
  }

  function appendLeg(sp, day, row, colMap, item) {
    const [depStn, depTime] = sp.parseStnTime(cell(row, colMap, 'dep'));
    const [arrStn, arrTime] = sp.parseStnTime(cell(row, colMap, 'arr'));
    const sdcCell = cell(row, colMap, 'sdc');
    const sdcMatch = /\b(TRAINER|TRI|TRE)\b/.exec(sdcCell.toUpperCase());
    const debriefCell = cell(row, colMap, 'dutyDebrief');
    day.legs.push({
      item, dep_stn: depStn, dep_time: depTime, arr_stn: arrStn, arr_time: arrTime,
      work_type: cell(row, colMap, 'workType').toUpperCase(),
      block_hours: cell(row, colMap, 'flyingHrs'),
      duty_code: sdcMatch ? sdcMatch[1] : '',
      ac_type: cell(row, colMap, 'acType'),
      overridden_rank: cell(row, colMap, 'overriddenRank'),
      hotel: cell(row, colMap, 'hotel').replace(/\n/g, ' ').trim(),
    });
    if (debriefCell) day.duty_end = debriefCell;
  }

  function computeOffDaysSplitSafe(sp, dutyDays, base) {
    return sp.computeOffDaysSplit ? sp.computeOffDaysSplit(dutyDays, base) : [0, 0];
  }

  ns.xlsxRosterParser = { parseXlsxRoster };
})(window.RosterPWA);
