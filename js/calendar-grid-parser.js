/**
 * Parser for the third roster PDF format: a one-page Monday-Sunday calendar
 * grid where each date cell holds that day's duty inline. JS port of
 * calendar_grid_parser.py's parse_calendar_grid_styled() — produces the
 * exact same duty_days/legs contract styled-roster-parser.js does, so
 * layout.js/render-pdf.js/render-png.js/allowance.js/editor.js all work
 * unmodified regardless of which format the roster came from.
 *
 * Unlike the Roster Report format (table cells reconstructed from
 * positioned characters needing word-merging), pdf.js's getTextContent()
 * gives this format's lines already complete and properly spaced
 * ("MH 125 KUL 08:55 - PER 14:50", "LO PER", the whole crew-info line as
 * one string) — confirmed directly against the real fixture. Reconstruction
 * here is about grid geometry (which of 7 weekday columns, which date-cell
 * within it), not character-level spacing.
 */
window.RosterPWA = window.RosterPWA || {};

(function (ns) {
  const MONTH_MAP = {
    jan: 'January', feb: 'February', mar: 'March', apr: 'April',
    may: 'May', jun: 'June', jul: 'July', aug: 'August',
    sep: 'September', oct: 'October', nov: 'November', dec: 'December',
  };
  const WEEKDAY_HEADER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday',
                           'Friday', 'Saturday', 'Sunday'];
  const WEEKDAY_ABBREV = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const DATE_CELL_RE = /^([A-Za-z]{3})\s+(\d{2})$/;
  const ACTIVITY_RE = /^(MH\s?\d+|[A-Z0-9]+)\s+([A-Z]{3})\s+(\d{2}:\d{2})\s*-\s*([A-Z]{3})\s+(\d{2}:\d{2})$/;
  const REPORT_RE = /^REPORT\s*:\s*(\d{2}:\d{2})$/;
  const DEBRIEF_RE = /^DEBRIEF\s*:\s*(\d{2}:\d{2})$/;
  const LAYOVER_RE = /^LO\s+([A-Z]{3})$/;
  const CREW_LINE_RE = /^([A-Z][A-Z\s]+?)\s*\|\s*(\d+)\s*\|\s*(\w+)\s+([A-Z]+)\s*\|\s*([A-Z]+)\s*\|?$/;
  const MONTH_YEAR_RE = /^([A-Za-z]+)\s+(\d{4})$/;

  const DAYOFF_CODES = ['D', 'DO1'];
  const LINE_Y_TOLERANCE = 1.0;

  function normalizeItem(str) {
    // "MH 125" -> "MH125"; leaves "738BLP21"/"OFF01" (already contiguous) alone.
    return str.replace(/^(MH)\s+(\d+)$/, '$1$2');
  }

  function groupIntoPhysicalLines(items) {
    const sorted = [...items].sort((a, b) => a.yTop - b.yTop || a.x - b.x);
    const lines = [];
    let current = null;
    for (const item of sorted) {
      if (current && Math.abs(item.yTop - current.yTop) <= LINE_Y_TOLERANCE) {
        current.items.push(item);
      } else {
        current = { yTop: item.yTop, items: [item] };
        lines.push(current);
      }
    }
    return lines;
  }

  /** Finds the Monday..Sunday header line, returns its 7 x-anchors (sorted
   * left to right) or null if this page doesn't look like a calendar grid. */
  function detectGridColumns(items) {
    const lines = groupIntoPhysicalLines(items);
    for (const line of lines) {
      const texts = line.items.map((it) => it.str.trim());
      const matchesAll = WEEKDAY_HEADER.every((day) => texts.includes(day));
      if (matchesAll && texts.length === 7) {
        return WEEKDAY_HEADER.map((day) => line.items.find((it) => it.str.trim() === day).x);
      }
    }
    return null;
  }

  function nearestColumn(x, anchors) {
    let best = 0;
    let bestDist = Infinity;
    anchors.forEach((a, i) => {
      const d = Math.abs(x - a);
      if (d < bestDist) { bestDist = d; best = i; }
    });
    return best;
  }

  /** True once `text` is a fully-formed cell fragment on its own (a whole
   * date cell, activity, REPORT/DEBRIEF/layover line, or day-off code) —
   * not just a prefix of one. */
  function isCompleteCellFragment(text) {
    return DAYOFF_CODES.includes(text) || DATE_CELL_RE.test(text) ||
      ACTIVITY_RE.test(text) || REPORT_RE.test(text) ||
      DEBRIEF_RE.test(text) || LAYOVER_RE.test(text);
  }

  /** Some exports pack a full flight line ("MH 125 KUL 08:55 - PER 14:50")
   * so tightly that its trailing tokens' x lands past the midpoint into
   * the next day's column, so per-glyph nearestColumn alone misassigns
   * them. Fix: walk each physical row left-to-right and only let a token
   * start a new column once the column being built so far already forms
   * a complete cell fragment — an in-progress ("dangling") one keeps
   * pulling in tokens regardless of their own nearest-column, since a
   * real cell boundary never falls mid-pattern. */
  function assignItemsToColumns(items, anchors) {
    const cellsByColumn = Array.from({ length: 7 }, () => []);
    for (const row of groupIntoPhysicalLines(items)) {
      const rowItems = row.items;
      if (!rowItems.length) continue;
      let currentCol = nearestColumn(rowItems[0].x, anchors);
      let acc = [rowItems[0]];
      for (let i = 1; i < rowItems.length; i++) {
        const accText = acc.map((it) => it.str.trim()).join(' ').trim();
        const nextCol = nearestColumn(rowItems[i].x, anchors);
        if (nextCol !== currentCol && isCompleteCellFragment(accText)) {
          cellsByColumn[currentCol].push(...acc);
          acc = [rowItems[i]];
          currentCol = nextCol;
        } else {
          acc.push(rowItems[i]);
        }
      }
      cellsByColumn[currentCol].push(...acc);
    }
    return cellsByColumn;
  }

  function parseHeader(items) {
    const result = { month: '', year: '', name: '', staff_number: '', fleet: '', rank: '', base: '' };
    // Some exports draw "October" and "2026" (or the crew line's words) as
    // separate text items on the same physical line rather than one
    // combined string, so match against each line's joined text — same
    // technique detectGridColumns()/buildCellsForColumn() already use.
    for (const line of groupIntoPhysicalLines(items)) {
      const text = line.items.map((it) => it.str.trim()).join(' ').trim();
      const my = MONTH_YEAR_RE.exec(text);
      if (my && MONTH_MAP[my[1].toLowerCase().slice(0, 3)]) {
        result.month = MONTH_MAP[my[1].toLowerCase().slice(0, 3)];
        result.year = my[2];
        continue;
      }
      const cm = CREW_LINE_RE.exec(text);
      if (cm) {
        result.name = cm[1].trim();
        result.staff_number = cm[2];
        result.fleet = cm[3];
        result.rank = cm[4];
        result.base = cm[5];
      }
    }
    return result;
  }

  function weekdayAbbrev(dateStr) {
    const m = /^(\d{2})-([A-Za-z]{3})-(\d{4})$/.exec(dateStr);
    if (!m) return '';
    const monthIdx = Object.values(MONTH_MAP).findIndex((full) => full.slice(0, 3).toLowerCase() === m[2].toLowerCase());
    if (monthIdx < 0) return '';
    const d = new Date(Date.UTC(parseInt(m[3], 10), monthIdx, parseInt(m[1], 10)));
    return WEEKDAY_ABBREV[d.getUTCDay()];
  }

  /** One column's physical lines -> array of cell dicts (mirrors
   * calendar_grid_parser.py's _parse_grid_cell, but input is already
   * properly-spaced whole lines, not raw characters). */
  function buildCellsForColumn(lines, year) {
    const cells = [];
    let current = null;

    for (const line of lines) {
      const text = line.items.map((it) => it.str.trim()).join(' ').trim();
      const dm = DATE_CELL_RE.exec(text);
      if (dm) {
        const monthFull = MONTH_MAP[dm[1].toLowerCase()];
        if (!monthFull) continue;
        const dateStr = `${dm[2]}-${monthFull.slice(0, 3)}-${year}`;
        current = {
          date: dateStr, day: weekdayAbbrev(dateStr), report: '', debrief: '',
          legs: [], dayoff_code: '', layover_markers: [], is_blank: true,
        };
        cells.push(current);
        continue;
      }
      if (!current) continue;
      current.is_blank = false;

      const rm = REPORT_RE.exec(text);
      if (rm) { current.report = rm[1]; continue; }
      const debm = DEBRIEF_RE.exec(text);
      if (debm) { current.debrief = debm[1]; continue; }
      const lm = LAYOVER_RE.exec(text);
      if (lm) { current.layover_markers.push(lm[1]); continue; }
      if (DAYOFF_CODES.includes(text)) { current.dayoff_code = text; continue; }
      const am = ACTIVITY_RE.exec(text);
      if (am) {
        current.legs.push({
          item: normalizeItem(am[1]),
          dep_stn: am[2], dep_time: am[3], arr_stn: am[4], arr_time: am[5],
        });
      }
    }
    return cells;
  }

  function hhmmToMinutes(t) {
    const m = /^(\d+):(\d{2})/.exec((t || '').trim());
    return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : 0;
  }

  function timeDiffHHMM(t1, t2) {
    const m1 = hhmmToMinutes(t1);
    const m2 = hhmmToMinutes(t2);
    let diff = m2 - m1;
    if (diff < 0) diff += 24 * 60;
    const h = Math.floor(diff / 60);
    const mm = diff % 60;
    return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }

  function acTypeFromTrainingItem(item) {
    const m = /^(738|73M|330|A33|A38)/.exec(item.toUpperCase());
    return m ? m[1] : '';
  }

  /** Mirrors calendar_grid_parser.py's _mark_grid_early_start_rest_days().
   * Rule per operational knowledge, not a cited regulation (see the
   * corresponding Python module's docstring/plan notes). */
  function markEarlyStartRestDays(dutyDays, legend) {
    const byDate = {};
    dutyDays.forEach((d) => { byDate[d.date] = d; });
    const dateKey = (s) => {
      const m = /^(\d{2})-([A-Za-z]{3})-(\d{4})$/.exec(s);
      const monthIdx = Object.values(MONTH_MAP).findIndex((full) => full.slice(0, 3).toLowerCase() === m[2].toLowerCase());
      return Date.UTC(parseInt(m[3], 10), monthIdx, parseInt(m[1], 10));
    };
    const datesSorted = Object.keys(byDate).sort((a, b) => dateKey(a) - dateKey(b));

    for (let i = 0; i < datesSorted.length - 1; i++) {
      const date = datesSorted[i];
      const day = byDate[date];
      const isDayoff = !!day.dayoff_code || day.is_blank || (!day.legs.length && DAYOFF_CODES.includes(day.item));
      if (!isDayoff) continue;
      const nextDate = datesSorted[i + 1];
      if ((dateKey(nextDate) - dateKey(date)) / 86400000 !== 1) continue;
      const nextDay = byDate[nextDate];
      if (!nextDay.duty_start) continue;
      const nextMins = hhmmToMinutes(nextDay.duty_start);
      if (nextMins < 480) { // before 08:00 — see plan notes on this threshold
        day.item = 'REST';
        legend.REST = legend.REST || 'Rest Day (Early Start)';
      }
    }
  }

  /** Mirrors calendar_grid_parser.py's _compute_grid_off_days_split(). */
  function computeOffDaysSplit(dutyDays, baseStation) {
    let atBase = 0, away = 0;
    let currentStation = (baseStation || '').toUpperCase();
    for (const day of dutyDays) {
      if (day.dayoff_code || day.is_blank) {
        if (currentStation && currentStation !== (baseStation || '').toUpperCase()) away++;
        else atBase++;
        continue;
      }
      if (day.legs.length) {
        const lastArr = day.legs[day.legs.length - 1].arr_stn;
        if (lastArr) currentStation = lastArr.toUpperCase();
      } else if (day.layover_markers.length) {
        currentStation = day.layover_markers[day.layover_markers.length - 1].toUpperCase();
      }
    }
    return [atBase, away];
  }

  /** pages: output of RosterPWA.pdfTextExtract.extractPages(). */
  function parseCalendarGridStyled(pages) {
    const page = pages[0];
    const colAnchors = detectGridColumns(page.items);
    if (!colAnchors) {
      throw new Error('Not a recognizable calendar-grid roster PDF (no Monday..Sunday header found).');
    }

    const header = parseHeader(page.items);
    const monthYear = `${header.month} ${header.year}`.trim();
    const cellsByColumn = assignItemsToColumns(page.items, colAnchors);

    let allCells = [];
    for (const colItems of cellsByColumn) {
      const lines = groupIntoPhysicalLines(colItems)
        .filter((line) => !line.items.some((it) => WEEKDAY_HEADER.includes(it.str.trim())));
      allCells = allCells.concat(buildCellsForColumn(lines, header.year));
    }

    const dateKey = (s) => {
      const m = /^(\d{2})-([A-Za-z]{3})-(\d{4})$/.exec(s);
      const monthIdx = Object.values(MONTH_MAP).findIndex((full) => full.slice(0, 3).toLowerCase() === m[2].toLowerCase());
      return Date.UTC(parseInt(m[3], 10), monthIdx, parseInt(m[1], 10));
    };
    allCells.sort((a, b) => dateKey(a.date) - dateKey(b.date));

    const dutyDays = allCells.map((cell) => {
      const legs = cell.legs.map((leg) => {
        const isFlight = /^MH\d+$/.test(leg.item);
        return {
          item: leg.item, dep_stn: leg.dep_stn, dep_time: leg.dep_time,
          arr_stn: leg.arr_stn, arr_time: leg.arr_time,
          // Blank for non-flights, matching the Roster Report format's
          // display convention (its source PDF leaves Work Type blank for
          // training/office rows — only flights print "OP" there).
          work_type: isFlight ? 'OP' : '',
          block_hours: (leg.dep_time && leg.arr_time) ? timeDiffHHMM(leg.dep_time, leg.arr_time) : '',
          duty_code: '', ac_type: isFlight ? '' : acTypeFromTrainingItem(leg.item),
          overridden_rank: '', hotel: '',
        };
      });

      let item = '';
      if (cell.dayoff_code) item = cell.dayoff_code;
      else if (cell.is_blank) item = 'D';
      else if (legs.length === 1 && !/^MH\d+$/.test(legs[0].item)) item = legs[0].item;

      const effectiveReport = cell.report || (legs[0] && legs[0].dep_time) || '';
      const effectiveDebrief = cell.debrief || (legs.length && legs[legs.length - 1].arr_time) || '';
      const dutyHours = (effectiveReport && effectiveDebrief) ? timeDiffHHMM(effectiveReport, effectiveDebrief) : '';
      const isDayoffItem = DAYOFF_CODES.includes(item);

      return {
        date: cell.date, day: cell.day, pairing_ref: '', pairing_embedded_date: '',
        duty_start: isDayoffItem ? '' : effectiveReport,
        duty_hours: isDayoffItem ? '' : dutyHours,
        duty_end: isDayoffItem ? '' : effectiveDebrief,
        item, legs,
        dayoff_code: cell.dayoff_code, is_blank: cell.is_blank,
        layover_markers: cell.layover_markers,
      };
    });

    const legend = {};
    markEarlyStartRestDays(dutyDays, legend);

    const baseStation = header.base || 'KUL';
    const [atBase, away] = computeOffDaysSplit(dutyDays, baseStation);

    let totalBlockMins = 0, totalDutyMins = 0;
    for (const day of dutyDays) {
      for (const leg of day.legs) {
        if (leg.block_hours) totalBlockMins += hhmmToMinutes(leg.block_hours);
      }
      if (day.duty_hours) totalDutyMins += hhmmToMinutes(day.duty_hours);
    }
    const fmt = (mins) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;

    return {
      crew_info: {
        name: header.name, staff_number: header.staff_number,
        fleet: header.fleet, base: header.base, rank: header.rank,
      },
      month_year: monthYear,
      header_totals: { fh: fmt(totalBlockMins), dh: fmt(totalDutyMins), at_base: atBase, away },
      duty_days: dutyDays,
      legend,
      warnings: [],
    };
  }

  function looksLikeCalendarGrid(pages) {
    return !!pages[0] && !!detectGridColumns(pages[0].items);
  }

  ns.calendarGridParser = { parseCalendarGridStyled, looksLikeCalendarGrid };
})(window.RosterPWA);
