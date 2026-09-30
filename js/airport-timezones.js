/**
 * IATA station -> fixed UTC offset (hours, fractional for zones like
 * India/Myanmar/Nepal). Ported verbatim from the sibling desktop app's
 * roster_parser.py AIRPORT_TIMEZONES, the project's manual source of truth
 * for these offsets — not re-derived here, and deliberately not backed by
 * an external TZ library (these are fixed offsets; none of these stations
 * observe DST).
 */
window.RosterPWA = window.RosterPWA || {};

(function (ns) {
  const AIRPORT_TIMEZONES = {
    // Malaysia
    KUL: 8, BKI: 8, KCH: 8, JHB: 8, PEN: 8, LGK: 8, MYY: 8,
    KBR: 8, AOR: 8, TGG: 8, IPH: 8, SBW: 8, SDK: 8, KUA: 8, TWU: 8,
    // Southeast Asia
    SIN: 8, BKK: 7, DMK: 7, HKT: 7, CNX: 7, HAN: 7, SGN: 7,
    DAD: 7, CGK: 7, DPS: 8, SUB: 7, MES: 8, SRG: 7,
    MNL: 8, CEB: 8, HKG: 8, RGN: 6.5, BWN: 8,
    // East Asia
    ICN: 9, GMP: 9, NRT: 9, HND: 9, KIX: 9, TPE: 8, PVG: 8,
    PEK: 8, CAN: 8, SHA: 8, CTU: 8, KMG: 8, XIY: 8,
    CTS: 9, PKX: 8, TFU: 8, URC: 6,
    // South Asia
    DEL: 5.5, BOM: 5.5, BLR: 5.5, MAA: 5.5, HYD: 5.5, CCU: 5.5,
    CMB: 5.5, DAC: 6, KTM: 5.75, AMD: 5.5, ATQ: 5.5,
    MLE: 5,
    // Middle East
    DXB: 4, AUH: 4, DOH: 3, BAH: 3, KWI: 3, RUH: 3, JED: 3,
    AMM: 3, IST: 3, MCT: 4, MED: 3,
    // Oceania
    PER: 8, MEL: 10, SYD: 10, BNE: 10, ADL: 9.5, AKL: 12,
    CHC: 12, DRW: 9.5,
    // Europe
    LHR: 0, LGW: 0, CDG: 1, ORY: 1, AMS: 1, FRA: 1, MUC: 1,
    ZRH: 1, VIE: 1, CPH: 1, ARN: 1, OSL: 1, HEL: 2,
    // Americas
    LAX: -8, SFO: -8, SEA: -8, JFK: -5, EWR: -5, ORD: -6,
    DFW: -6, IAH: -6, YVR: -8, YYZ: -5,
  };

  /** Offset in hours for `code`, or `fallback` (default 8, KUL) with a
   * console warning if the station isn't in the table. */
  function offsetFor(code, fallback) {
    const key = (code || '').toUpperCase();
    if (Object.prototype.hasOwnProperty.call(AIRPORT_TIMEZONES, key)) {
      return AIRPORT_TIMEZONES[key];
    }
    const fb = fallback === undefined ? 8 : fallback;
    if (key) console.warn(`airport-timezones: unknown station "${key}", falling back to UTC+${fb}`);
    return fb;
  }

  ns.airportTimezones = { AIRPORT_TIMEZONES, offsetFor };
})(window.RosterPWA);
