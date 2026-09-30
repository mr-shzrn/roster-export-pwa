/**
 * Port of styled_roster_renderer.py's _build_* functions as pure data —
 * no drawing calls. render-pdf.js/render-png.js turn this into pixels.
 * Extends the original with two new Monthly-Statistics rows (Payable Duty
 * Hours, Estimated Allowance) and optional per-day/month notes rows.
 */
window.RosterPWA = window.RosterPWA || {};

(function (ns) {
  const DAYOFF_CODES = ['D', 'DO', 'DO1'];

  const BASE_COLUMNS = [
    ['Date', 22], ['Day', 11], ['Duty Start', 15], ['Item', 20],
    ['Overd Rank', 14], ['Dep/Start', 22], ['Arr/End', 22],
    ['Duty End', 15], ['Work Type', 14], ['Actual Block Hours', 24],
    ['Duty Hours', 16],
  ];
  const DUTY_AC_COLUMNS = [['DutyCode', 22], ['Ac Type', 18]];
  const HOTEL_COLUMN = ['Hotel', 40];

  function stnTime(stn, time) {
    if (!stn) return '';
    return `${stn} ${time}`.trim();
  }

  function activeColumns(showHotel, showDutyAc) {
    let cols = [...BASE_COLUMNS];
    if (showDutyAc) cols = cols.concat(DUTY_AC_COLUMNS);
    if (showHotel) cols = cols.concat([HOTEL_COLUMN]);
    return cols;
  }

  function legRow(day, leg, first, last, showHotel, showDutyAc) {
    const row = [
      first ? day.date : '', first ? day.day : '', first ? day.duty_start : '',
      leg.item, leg.overridden_rank,
      stnTime(leg.dep_stn, leg.dep_time), stnTime(leg.arr_stn, leg.arr_time),
      last ? day.duty_end : '', leg.work_type, leg.block_hours || '00:00',
      first ? day.duty_hours : '',
    ];
    if (showDutyAc) row.push(leg.duty_code, leg.ac_type);
    if (showHotel) row.push(leg.hotel);
    return row;
  }

  function dayoffRow(day, nCols) {
    const row = new Array(nCols).fill('');
    row[0] = day.date; row[1] = day.day; row[3] = day.item;
    return row;
  }

  /** Returns { rows, dayEndIndices } — rows may include {isNote:true,text} entries. */
  function buildTableRows(dutyDays, showHotel, showDutyAc) {
    const nCols = activeColumns(showHotel, showDutyAc).length;
    const rows = [];
    const dayEndIndices = [];

    for (const day of dutyDays) {
      if (!day.legs.length) {
        rows.push(dayoffRow(day, nCols));
      } else {
        const n = day.legs.length;
        day.legs.forEach((leg, i) => {
          rows.push(legRow(day, leg, i === 0, i === n - 1, showHotel, showDutyAc));
        });
      }
      dayEndIndices.push(rows.length - 1);
      if (day.notes) rows.push({ isNote: true, text: day.notes });
    }
    return { rows, dayEndIndices };
  }

  function buildHeaderBlock(crewInfo, monthYear) {
    return {
      title: `Roster Report — ${monthYear}`,
      rows: [
        ['Name', crewInfo.name || '', 'Staff Number', crewInfo.staff_number || ''],
        ['Rank', crewInfo.rank || '', 'Fleet', crewInfo.fleet || ''],
        ['Base', crewInfo.base || '', '', ''],
      ],
    };
  }

  function buildDutyTable(dutyDays, showHotel, showDutyAc) {
    const columns = activeColumns(showHotel, showDutyAc);
    const { rows, dayEndIndices } = buildTableRows(dutyDays, showHotel, showDutyAc);
    return { columns, headerRow: columns.map((c) => c[0]), rows, dayEndIndices };
  }

  function buildStatsSection(headerTotals, allowanceEstimate) {
    const rows = [
      ['Actual Block Hours', headerTotals.fh || ''],
      ['Duty Hours', headerTotals.dh || ''],
      ['OFF Days At Base', String(headerTotals.at_base ?? '')],
      ['OFF Days Away From Base', String(headerTotals.away ?? '')],
    ];
    if (headerTotals.rest_days !== undefined) {
      rows.push(['Rest Days', String(headerTotals.rest_days)]);
    }
    if (allowanceEstimate) {
      rows.push(['Payable Duty Hours', allowanceEstimate.payable_duty_hours.toFixed(2)]);
      rows.push(['Estimated Allowance (RM)', allowanceEstimate.total_payment.toFixed(2)]);
    }
    return { title: 'Monthly Statistics', rows };
  }

  function buildLegendSection(legend) {
    const entries = Object.entries(legend || {});
    if (!entries.length) return null;
    return {
      title: 'Code / Code Description',
      rows: [['Code', 'Code Description'], ...entries],
    };
  }

  /**
   * data: parse_styled_roster() output, optionally with duty_days[].notes
   * and a top-level data.month_notes string (added by editor.js).
   */
  function buildLayout(data, options) {
    const opts = options || {};
    const showHotel = !!opts.showHotel;
    const showDutyAc = !!opts.showDutyAc;

    const layout = {
      headerBlock: buildHeaderBlock(data.crew_info, data.month_year),
      dutyTable: buildDutyTable(data.duty_days, showHotel, showDutyAc),
      statsSection: buildStatsSection(data.header_totals, opts.allowanceEstimate || null),
      legendSection: buildLegendSection(data.legend),
      monthNotes: data.month_notes || null,
    };
    return layout;
  }

  ns.layout = { buildLayout, activeColumns };
})(window.RosterPWA);
