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

  function dateStrToDayIndex(dateStr) {
    const p = parseDateParts(dateStr);
    if (!p) return null;
    return Math.round(Date.UTC(p.year, p.monthIdx, p.day) / 86400000);
  }

  function dayIndexToDateStr(idx) {
    const d = new Date(idx * 86400000);
    return `${String(d.getUTCDate()).padStart(2, '0')}-${MONTHS[d.getUTCMonth()]}-${d.getUTCFullYear()}`;
  }

  function hhmmToMinutes(t) {
    const m = /^(\d{1,2}):(\d{2})/.exec((t || '').trim());
    return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
  }

  function minutesToHHMM(mins) {
    return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  }

  /** "06:50(+1)" -> { mins: 410, delta: 1 }; "06:50" -> { mins: 410, delta: 0 }. */
  function parseTimeWithAnnotation(raw) {
    const m = /^(\d{1,2}:\d{2})(?:\((\+|-)(\d+)\))?/.exec((raw || '').trim());
    if (!m) return null;
    const mins = hhmmToMinutes(m[1]);
    const delta = m[2] ? (m[2] === '+' ? 1 : -1) * parseInt(m[3], 10) : 0;
    return { mins, delta };
  }

  function formatTimeWithAnnotation(mins, delta) {
    const hhmm = minutesToHHMM(mins);
    return delta === 0 ? hhmm : `${hhmm}(${delta > 0 ? '+' : ''}${delta})`;
  }

  /** Shift one absolute cell (possibly carrying its own "(+1)"-style
   * annotation relative to the row's OLD date) by a station's UTC offset,
   * then re-express its day-rollover relative to the row's NEW
   * (already-corrected) date. */
  function shiftAbsoluteCell(raw, oldRowDayIdx, offsetHours, newRowDayIdx) {
    const parsed = parseTimeWithAnnotation(raw);
    if (!parsed) return raw;
    const absMinutes = (oldRowDayIdx + parsed.delta) * 1440 + parsed.mins;
    const shiftedAbs = absMinutes + Math.round(offsetHours * 60);
    const newDayIdx = Math.floor(shiftedAbs / 1440);
    const newMins = ((shiftedAbs % 1440) + 1440) % 1440;
    return formatTimeWithAnnotation(newMins, newDayIdx - newRowDayIdx);
  }

  /** Look at a handful of raw signals collected while parsing (day-off
   * Report times, OFF01 ground-duty Dep times) — both are fixed-time
   * activities with a well-known LT value (00:00, 08:30 respectively) per
   * this roster system's convention — to tell a genuine LT export apart
   * from a raw-UTC one, without any explicit label in the file. */
  function detectSourceTimezone(signals, homeBaseOffset) {
    for (const sig of signals) {
      const expectLT = sig.kind === 'dayoff' ? 0 : 510; // 00:00 or 08:30
      const raw = sig.kind === 'dayoff' ? sig.reportRaw : sig.depRaw;
      const mins = hhmmToMinutes(raw);
      if (mins === null) continue;
      if (mins === expectLT) return { tz: 'LT', uncertain: false };
      const expectUtc = ((expectLT - Math.round(homeBaseOffset * 60)) % 1440 + 1440) % 1440;
      if (mins === expectUtc) return { tz: 'UTC', uncertain: false };
    }
    return { tz: 'LT', uncertain: true };
  }

  /** Convert one duty-day's absolute times from raw UTC to LT, each cell
   * using its own station's offset (Report/Debrief use the first leg's
   * departure / last leg's arrival station, or home base for a
   * station-less ground activity). Mutates and returns `day`. Durations
   * (duty_hours, block_hours) are left untouched — already-elapsed times,
   * invariant under relabeling. */
  function convertDutyDayToLT(day, homeBaseOffset, offsetForFn) {
    const rowDayIdx = dateStrToDayIndex(day.date);
    if (rowDayIdx === null) { delete day._rawReport; return day; }

    const reportStn = day.legs.length ? day.legs[0].dep_stn : '';
    const reportOffset = reportStn ? offsetForFn(reportStn, homeBaseOffset) : homeBaseOffset;

    let newRowDayIdx = rowDayIdx;
    const reportRaw = day._rawReport;
    if (reportRaw) {
      const parsed = parseTimeWithAnnotation(reportRaw); // Report never carries its own annotation
      if (parsed) {
        const shiftedAbs = rowDayIdx * 1440 + parsed.mins + Math.round(reportOffset * 60);
        newRowDayIdx = Math.floor(shiftedAbs / 1440);
        if (day.duty_start) day.duty_start = minutesToHHMM(((shiftedAbs % 1440) + 1440) % 1440);
      }
    }

    if (day.duty_end) {
      const arrStn = day.legs.length ? day.legs[day.legs.length - 1].arr_stn : '';
      const arrOffset = arrStn ? offsetForFn(arrStn, homeBaseOffset) : homeBaseOffset;
      day.duty_end = shiftAbsoluteCell(day.duty_end, rowDayIdx, arrOffset, newRowDayIdx);
    }

    for (const leg of day.legs) {
      if (leg.dep_time) leg.dep_time = shiftAbsoluteCell(leg.dep_time, rowDayIdx, offsetForFn(leg.dep_stn, homeBaseOffset), newRowDayIdx);
      if (leg.arr_time) leg.arr_time = shiftAbsoluteCell(leg.arr_time, rowDayIdx, offsetForFn(leg.arr_stn, homeBaseOffset), newRowDayIdx);
    }

    day.date = dayIndexToDateStr(newRowDayIdx);
    day.day = weekdayAbbrev(day.date);
    delete day._rawReport;
    return day;
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
      this._tzSignals = [];
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
          this._tzSignals.push({ kind: 'dayoff', reportRaw: reportCell });
          const day = this._curDutyDay;
          day.item = pairingCell;
          day.duty_start = '';
          day.duty_hours = '';
          return;
        }

        if (!/^MH\d+/.test(itemCell)) {
          const code = itemCell || pairingCell;
          if (code) {
            if (code === 'OFF01') {
              this._tzSignals.push({ kind: 'off01', depRaw: parseStnTime(depCell)[1] });
            }
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
        // Kept only for UTC/LT detection + conversion — deleted before the
        // parser returns. Needed because a day-off's own duty_start gets
        // cleared to '' below, but its Report time (always home-base LT
        // 00:00, or UTC-shifted otherwise) is the only signal that survives
        // for that row.
        _rawReport: reportCell,
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

    const homeBaseOffset = ns.airportTimezones.offsetFor(state.crewInfo.base || 'KUL', 8);
    const tzResult = detectSourceTimezone(state._tzSignals, homeBaseOffset);
    if (tzResult.tz === 'UTC') {
      for (const day of state.dutyDays) convertDutyDayToLT(day, homeBaseOffset, ns.airportTimezones.offsetFor);
      state.dutyDays.sort((a, b) => dateStrToDayIndex(a.date) - dateStrToDayIndex(b.date));
      state.headerTotals.source_timezone = 'UTC (converted to LT)';
    } else {
      for (const day of state.dutyDays) delete day._rawReport;
      state.headerTotals.source_timezone = 'LT';
      if (tzResult.uncertain) state.headerTotals.source_timezone_uncertain = true;
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
    // UTC/LT detection + conversion — also reused by xlsx-roster-parser.js.
    dateStrToDayIndex, dayIndexToDateStr, detectSourceTimezone, convertDutyDayToLT,
  };
})(window.RosterPWA);
