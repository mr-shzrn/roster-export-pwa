/**
 * "Estimate Allowance" — mirrors allowance_calculator.py's Pass 1/Pass 2
 * shapes, but with a single user-entered RM/hour rate in place of a grade
 * lookup, and creditRate = userRate * 0.5 (matching the corrected
 * relationship fixed in allowance_calculator.py on 2026-09-27).
 *
 * Deliberately out of scope (needs data this PWA doesn't collect):
 * FDP-extension pay (needs actual vs scheduled arrival times) and the
 * >80h excess-block-hours bonus (needs a grade-specific excess rate).
 *
 * Input: duty_days from styled-roster-parser.js (date/day/duty_start/
 * duty_hours/duty_end/item/legs[]), not the flat `duties` list
 * allowance_calculator.py takes — so duty-type/leg shape is adapted here
 * rather than reusing that list directly.
 */
window.RosterPWA = window.RosterPWA || {};

(function (ns) {
  const DAYOFF_CODES = ['D', 'DO', 'DO1'];

  function hhmmToMinutes(t) {
    if (!t) return 0;
    const m = /^(\d+):(\d{2})/.exec(t.trim());
    if (!m) return 0;
    return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  }

  function isOffice(item) {
    return (item || '').toUpperCase().startsWith('OFF01');
  }

  function isTrainingItem(item) {
    // CRM and TDC are ground-class TRAINING items, not office — despite
    // being listed in roster_parser.py's OFFICE_CODES class var, the
    // parser's actual _parse_duty_line forces work_type='TRAINING' for any
    // CRM/TDC/IOC/AVSEC item (roster_parser.py:519-528, checked *before*
    // its own OFFICE_CODES fallback, which is why 'CRM'/'TDC' in that class
    // var are effectively dead for this purpose — only OFF01/LDP actually
    // reach it). Whether a CRM/TDC day is *paid* still depends entirely on
    // duty_code: trainingAllowance() below already only pays when duty_code
    // is TRI/TRE/TRAINER (the facilitator/instructor), same as
    // calc_training_allowance() in allowance_calculator.py — a plain
    // attendee still shows up here (matching "training" dtype) but with
    // credit_hrs/payment 0 ("(trainee — unpaid)"). LDP and C17 are the only
    // OFFICE_CODES entries that genuinely resolve to 'office' with no
    // training override, so they stay out of this list; isOffice() below
    // only pays OFF01 specifically, matching calc_allowances().
    const u = (item || '').toUpperCase();
    return u.startsWith('738') || u.startsWith('73M') || u === 'IOC' || u.startsWith('AVSEC')
      || u.startsWith('CRM') || u.startsWith('TDC');
  }

  function isSimulator(item) {
    const u = (item || '').toUpperCase();
    return u.startsWith('738') || u.startsWith('73M');
  }

  function dutyCodeFromDay(day) {
    // First leg carrying a duty_code (TRI/TRE/TRAINER) represents the day's role.
    const leg = day.legs.find((l) => l.duty_code);
    return (leg ? leg.duty_code : '').toUpperCase();
  }

  function trainingAllowance(day, dutyCode, creditRate) {
    if (!['TRI', 'TRE', 'TRAINER'].includes(dutyCode)) {
      return { credit_hrs: 0, payment: 0, notes: '' };
    }
    const durMins = hhmmToMinutes(day.duty_hours || '00:00');
    if (isSimulator(day.item)) {
      const creditH = 6.0;
      const simFee = dutyCode === 'TRE' ? 1100 : 950;
      return {
        credit_hrs: creditH, payment: round2(creditH * creditRate + simFee),
        notes: `SIM 6h @ RM${creditRate.toFixed(2)} + RM${simFee} (${dutyCode})`,
      };
    }
    const creditH = durMins < 360 ? 4.0 : 8.0;
    return {
      credit_hrs: creditH, payment: round2(creditH * creditRate + 600),
      notes: `CLASS ${creditH.toFixed(0)}h @ RM${creditRate.toFixed(2)} + RM600 (${dutyCode})`,
    };
  }

  function officeAllowance(creditRate) {
    const creditH = 8.0;
    return {
      credit_hrs: creditH, payment: round2(creditH * creditRate + 400),
      notes: `8h @ RM${creditRate.toFixed(2)} + RM400 assignment`,
    };
  }

  function round2(n) { return Math.round(n * 100) / 100; }

  /**
   * duty_days: parse_styled_roster()'s duty_days array.
   * userRate: RM per flying duty hour, typed in by the pilot.
   * Returns { breakdown, total_payment, total_credit_hrs, payable_duty_hours }.
   */
  function calcAllowanceEstimate(dutyDays, userRate) {
    const creditRate = userRate * 0.5;
    const breakdown = [];
    let totalPay = 0;
    let payableMinutes = 0;

    for (const day of dutyDays) {
      if (DAYOFF_CODES.includes(day.item)) continue;

      const hasFlightLeg = day.legs.some((l) => /^MH\d+/.test(l.item));
      const dutyCode = dutyCodeFromDay(day);
      const dutyMins = hhmmToMinutes(day.duty_hours);

      if (hasFlightLeg) {
        const pay = round2((dutyMins / 60) * userRate);
        if (dutyMins > 0) {
          totalPay += pay;
          payableMinutes += dutyMins;
          breakdown.push({
            date: day.date, type: 'flight', item: day.legs.map((l) => l.item).join('/'),
            duty_hrs: day.duty_hours, payment: pay, credit_hrs: 0,
            notes: `${(dutyMins / 60).toFixed(2)}h × RM${userRate.toFixed(2)}/hr`,
          });
        }
        if (['TRI', 'TRE'].includes(dutyCode)) {
          totalPay += 400;
          breakdown.push({
            date: day.date, type: 'line_training', item: `LINE ${dutyCode}`,
            duty_hrs: day.duty_hours, payment: 400, credit_hrs: 0,
            notes: 'Line Training/Check assignment',
          });
        }
        continue;
      }

      if (isOffice(day.item)) {
        const r = officeAllowance(creditRate);
        totalPay += r.payment;
        payableMinutes += r.credit_hrs * 60;
        breakdown.push({
          date: day.date, type: 'office', item: day.item, duty_hrs: day.duty_hours,
          payment: r.payment, credit_hrs: r.credit_hrs, notes: r.notes,
        });
        continue;
      }

      if (isTrainingItem(day.item)) {
        const r = trainingAllowance(day, dutyCode, creditRate);
        totalPay += r.payment;
        payableMinutes += r.credit_hrs * 60;
        breakdown.push({
          date: day.date, type: 'training', item: day.item, duty_hrs: day.duty_hours,
          payment: r.payment, credit_hrs: r.credit_hrs,
          notes: r.notes || '(trainee — unpaid)',
        });
      }
    }

    breakdown.sort((a, b) => (a.date > b.date ? 1 : a.date < b.date ? -1 : 0));

    return {
      breakdown,
      total_payment: round2(totalPay),
      total_credit_hrs: round2(payableMinutes / 60),
      payable_duty_hours: round2(payableMinutes / 60),
    };
  }

  ns.allowance = { calcAllowanceEstimate };
})(window.RosterPWA);
