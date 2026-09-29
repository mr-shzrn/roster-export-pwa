/**
 * Reassembles pdf.js's flat, positioned text items into "logical rows" —
 * the JS analog of one row from pdfplumber's page.extract_tables().
 *
 * Grounded in the real fixture's coordinates (this roster PDF export is a
 * stable, generator-produced table, not free-form text):
 *   - Same-line items share yTop to within ~0.5pt.
 *   - Normal row-to-row pitch is ~18pt.
 *   - A wrapped cell (long header label, long hotel name) continues on the
 *     next physical line ~7pt below, at the SAME x as the cell it wraps.
 * A physical-line gap below ROW_GAP_THRESHOLD is therefore a continuation
 * of the current logical row (its words get merged into whichever existing
 * item is nearest in x); a gap at or above it starts a new logical row.
 * These constants are tuned to this specific report format/font size —
 * revisit if a differently-formatted roster ever needs to be supported.
 */
window.RosterPWA = window.RosterPWA || {};

(function (ns) {
  const LINE_Y_TOLERANCE = 1.0;   // items within this are "the same physical line"
  const ROW_GAP_THRESHOLD = 10;   // physical-line gap at/above this starts a new logical row
  // Wrap-continuation word merges into an item within this x. A second real
  // roster PDF showed up to ~7pt of drift between stacked header-label lines
  // (e.g. "Duty" / "Report") that share a column but aren't pixel-aligned —
  // still far below the smallest real inter-column gap seen (~30pt), so 10
  // has margin on both sides without risking merging across columns.
  const ITEM_X_MERGE_TOL = 10;

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

  function newLogicalRow(line) {
    const items = [...line.items].sort((a, b) => a.x - b.x);
    return { startY: line.yTop, lastY: line.yTop, items };
  }

  function mergeContinuation(row, line) {
    for (const item of line.items) {
      const existing = row.items.find((it) => Math.abs(it.x - item.x) <= ITEM_X_MERGE_TOL);
      if (existing) {
        existing.str = `${existing.str} ${item.str}`.trim();
      } else {
        row.items.push(item);
        row.items.sort((a, b) => a.x - b.x);
      }
    }
    row.lastY = line.yTop;
  }

  function finalizeRow(row) {
    row.cellsInOrder = row.items.map((it) => it.str.trim()).filter(Boolean);
    row.raw = row.cellsInOrder.join(' ');
    return row;
  }

  /** items: flat array of {str, x, yTop} for one page -> array of logical rows. */
  function buildLogicalRows(items) {
    const lines = groupIntoPhysicalLines(items);
    const rows = [];
    let current = null;

    for (const line of lines) {
      if (!current || line.yTop - current.lastY >= ROW_GAP_THRESHOLD) {
        if (current) rows.push(finalizeRow(current));
        current = newLogicalRow(line);
      } else {
        mergeContinuation(current, line);
      }
    }
    if (current) rows.push(finalizeRow(current));
    return rows;
  }

  ns.tableReconstruct = { buildLogicalRows };
})(window.RosterPWA);
