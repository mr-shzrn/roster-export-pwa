/**
 * Port of styled_roster_parser.py's parse_styled_roster() / _StyledRosterState.
 * Operates on the logical rows produced by table-reconstruct.js + columns.js
 * instead of pdfplumber table cells, but mirrors the Python state machine's
 * row dispatch, duty-day/leg grouping, and warnings exactly.
 */
window.RosterPWA = window.RosterPWA || {};

(function (ns) {
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                   'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const PAIRING_RE = /^\d+-\d+\/\d{8}\/[A-Z]$/;
  const PAIRING_DATE_RE = /^\d+-\d+\/(\d{8})\/[A-Z]$/;
  const DATE_RANGE_RE = /(\d{2}-[A-Za-z]{3}-\d{4})\s+to\s+(\d{2}-[A-Za-z]{3}-\d{4})/;
  const CREW_RE = /^([A-Z][A-Z\s]+?)\s*\|\s*(\d+)\s*\|\s*(\w+)\s*\|\s*([A-Z]+)\s*\|\s*([A-Z]+)$/;
  const TOTALS_RE = /FH\s*:\s*(\d+:\d{2})\s*\|\s*DH\s*:\s*(\d+:\d{2})/;
  const HEADER_MARKERS = ['pairing/activity', 'duty report', 'dep stn', 'arr. stn',
                           'work type', 'updated by', 'legend', 'day off'];

  const DAYOFF_CODES = ['D', 'DO', 'DO1'];

  function isNewDate(cell) {
    return /^\d{2}-[A-Za-z]{3}-\d{4}$/.test((cell || '').trim());
  }

  function isTableHeaderRow(row) {
    if (!row.cellsInOrder.length) return true;
    const joined = row.raw.toLowerCase();
    return HEADER_MARKERS.some((m) => joined.includes(m));
  }

  function parseDateParts(dateStr) {
    // 'DD-Mon-YYYY' -> {day, monthIdx, year}
    const m = /^(\d{2})-([A-Za-z]{3})-(\d{4})$/.exec(dateStr);
    if (!m) return null;
    const monthIdx = MONTHS.findIndex((mo) => mo.toLowerCase() === m[2].toLowerCase());
    if (monthIdx < 0) return null;
    return { day: parseInt(m[1], 10), monthIdx, year: parseInt(m[3], 10) };
  }

  function weekdayAbbrev(dateStr) {
    const parts = parseDateParts(dateStr);
    if (!parts) return '';
    const d = new Date(Date.UTC(parts.year, parts.monthIdx, parts.day));
    return WEEKDAYS[d.getUTCDay()];
  }

  function parsePairingEmbeddedDate(pairingRef) {
    const m = PAIRING_DATE_RE.exec(pairingRef);
    if (!m) return '';
    const ddmmyyyy = m[1];
    const day = parseInt(ddmmyyyy.slice(0, 2), 10);
    const month = parseInt(ddmmyyyy.slice(2, 4), 10);
    const year = parseInt(ddmmyyyy.slice(4, 8), 10);
    if (month < 1 || month > 12) return '';
    return `${String(day).padStart(2, '0')}-${MONTHS[month - 1]}-${year}`;
  }

  function parseStnTime(cell) {
    if (!cell) return ['', ''];
    const parts = cell.trim().split(/\s+/);
    if (parts.length >= 2 && /^\d{2}:\d{2}/.test(parts[parts.length - 1])) {
      return [parts[0].toUpperCase(), parts[parts.length - 1]];
    }
    return [parts.length ? parts[0].toUpperCase() : '', ''];
  }

  function computeOffDaysSplit(dutyDays, baseStation) {
    let atBase = 0;
    let away = 0;
    let currentStation = (baseStation || '').toUpperCase();
    for (const day of dutyDays) {
      if (DAYOFF_CODES.includes(day.item)) {
        if (currentStation && currentStation !== (baseStation || '').toUpperCase()) away++;
        else atBase++;
      }
      const flightLegs = day.legs.filter((leg) => /^MH\d+/.test(leg.item));
      if (flightLegs.length) {
        const lastArr = flightLegs[flightLegs.length - 1].arr_stn;
        if (lastArr) currentStation = lastArr.toUpperCase();
      }
    }
    return [atBase, away];
  }

  class StyledRosterState {
    constructor() {
      this.crewInfo = {};
      this.headerTotals = {};
      this.monthYear = '';
      this.dutyDays = [];
      this.legend = {};
      this.warnings = [];
      this._inLegend = false;
      this._curDutyDay = null;
    }

    handleRow(row, colMap) {
      if (!row.cellsInOrder.length) return;
      const joined = row.raw.trim();

      if (joined.toUpperCase() === 'LEGEND') { this._inLegend = true; return; }
      if (this._inLegend) { this._captureLegendRow(row); return; }
      if (joined.toLowerCase().includes('roster report')) { this._captureMetaRow(row); return; }
      if (isTableHeaderRow(row)) return;

      this._processDutyRow(row, colMap);
    }

    _captureLegendRow(row) {
      const nonEmpty = row.cellsInOrder;
      if (nonEmpty.length >= 2) this.legend[nonEmpty[0]] = nonEmpty[1];
    }

    _captureMetaRow(row) {
      for (const text of row.cellsInOrder) {
        const m = DATE_RANGE_RE.exec(text);
        if (m) {
          const parts = parseDateParts(m[1]);
          if (parts) {
            const monthName = new Date(Date.UTC(parts.year, parts.monthIdx, 1))
              .toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
            this.monthYear = `${monthName} ${parts.year}`;
          }
        }
        const cm = CREW_RE.exec(text);
        if (cm) {
          this.crewInfo = {
            name: cm[1].trim(), staff_number: cm[2], fleet: cm[3],
            base: cm[4], rank: cm[5],
          };
        }
        const tm = TOTALS_RE.exec(text);
        if (tm) this.headerTotals = { ...this.headerTotals, fh: tm[1], dh: tm[2] };
      }
    }

    _processDutyRow(row, colMap) {
      const c = ns.columns.cellAt;
      const dateCell = c(row, colMap, 'date');
      const pairingCell = c(row, colMap, 'pairing');
      const reportCell = c(row, colMap, 'duty_report');
      const itemCell = c(row, colMap, 'item');
      const rankCell = c(row, colMap, 'overridden_rank');
      const wtypeCell = c(row, colMap, 'work_type');
      const depCell = c(row, colMap, 'dep');
      const arrCell = c(row, colMap, 'arr');
      const debriefCell = c(row, colMap, 'duty_debrief');
      const dutyHrsCell = c(row, colMap, 'duty_hrs');
      const flyingHrsCell = c(row, colMap, 'flying_hrs');
      const acCell = c(row, colMap, 'ac_type');
      const sdcCell = c(row, colMap, 'sdc');
      const hotelCell = c(row, colMap, 'hotel').replace(/\n/g, ' ').trim();

      const sdcMatch = /\b(TRAINER|TRI|TRE)\b/.exec(sdcCell.toUpperCase());
      const sdcCode = sdcMatch ? sdcMatch[1] : '';

      if (isNewDate(dateCell)) {
        this._startNewDutyDay(dateCell, pairingCell, reportCell, dutyHrsCell);

        if (DAYOFF_CODES.includes(pairingCell)) {
          const day = this._curDutyDay;
          day.item = pairingCell;
          day.duty_start = '';
          day.duty_hours = '';
          return;
        }

        if (!/^MH\d+/.test(itemCell)) {
          const code = itemCell || pairingCell;
          if (code) {
            this._curDutyDay.item = code;
            this._curDutyDay.duty_end = debriefCell;
            this._appendLeg(code, depCell, arrCell, wtypeCell, flyingHrsCell,
              sdcCode, acCell, rankCell, hotelCell, debriefCell);
          }
          return;
        }

        this._appendLeg(itemCell, depCell, arrCell, wtypeCell, flyingHrsCell,
          sdcCode, acCell, rankCell, hotelCell, debriefCell);
        return;
      }

      // Continuation row (no new date) — another leg of the current duty-day.
      if (!this._curDutyDay || !/^MH\d+/.test(itemCell)) return;
      this._appendLeg(itemCell, depCell, arrCell, wtypeCell, flyingHrsCell,
        sdcCode, acCell, rankCell, hotelCell, debriefCell);
    }

    _startNewDutyDay(dateCell, pairingCell, reportCell, dutyHrsCell) {
      const curDate = dateCell.trim();
      const curDay = weekdayAbbrev(curDate);

      const pairingRef = PAIRING_RE.test(pairingCell) ? pairingCell : '';
      const embeddedDate = pairingRef ? parsePairingEmbeddedDate(pairingRef) : '';
      if (embeddedDate && embeddedDate !== curDate) {
        this.warnings.push(
          `${curDate}: pairing ref ${pairingRef} embeds date ${embeddedDate}, ` +
          `but row is printed under ${curDate}`
        );
      }

      const day = {
        date: curDate, day: curDay,
        pairing_ref: pairingRef, pairing_embedded_date: embeddedDate,
        duty_start: reportCell, duty_hours: dutyHrsCell, duty_end: '',
        item: '', legs: [],
      };
      this.dutyDays.push(day);
      this._curDutyDay = day;
    }

    _appendLeg(item, depCell, arrCell, wtypeCell, flyingHrsCell,
               sdcCode, acCell, rankCell, hotelCell, debriefCell) {
      const [depStn, depTime] = parseStnTime(depCell);
      const [arrStn, arrTime] = parseStnTime(arrCell);
      this._curDutyDay.legs.push({
        item, dep_stn: depStn, dep_time: depTime, arr_stn: arrStn, arr_time: arrTime,
        work_type: wtypeCell.toUpperCase(), block_hours: flyingHrsCell,
        duty_code: sdcCode, ac_type: acCell, overridden_rank: rankCell, hotel: hotelCell,
      });
      if (debriefCell) this._curDutyDay.duty_end = debriefCell;
    }
  }

  /** pages: output of RosterPWA.pdfTextExtract.extractPages() */
  function parseStyledRoster(pages) {
    const state = new StyledRosterState();
    let prevColMap = null;

    for (const page of pages) {
      const rows = ns.tableReconstruct.buildLogicalRows(page.items);

      let colMap = prevColMap;
      for (let i = 0; i < Math.min(5, rows.length); i++) {
        if (ns.columns.looksLikeHeaderRow(rows[i])) {
          colMap = ns.columns.detectColumnMap(rows[i]);
          break;
        }
      }
      if (!colMap) colMap = ns.columns.DEFAULT_COL_MAP;
      prevColMap = colMap;

      for (const row of rows) state.handleRow(row, colMap);
    }

    const [atBase, away] = computeOffDaysSplit(state.dutyDays, state.crewInfo.base || 'KUL');
    state.headerTotals.at_base = atBase;
    state.headerTotals.away = away;

    return {
      crew_info: state.crewInfo,
      month_year: state.monthYear,
      header_totals: state.headerTotals,
      duty_days: state.dutyDays,
      legend: state.legend,
      warnings: state.warnings,
    };
  }

  ns.styledRosterParser = {
    parseStyledRoster, parseStnTime,
    // Pure helpers reused by xlsx-roster-parser.js — same source report,
    // same header line / pairing-reference conventions, no PDF dependency.
    parsePairingEmbeddedDate, weekdayAbbrev, computeOffDaysSplit,
    DATE_RANGE_RE, CREW_RE, TOTALS_RE,
  };
})(window.RosterPWA);
