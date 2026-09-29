/**
 * Draws a layout.js document with jsPDF's vector primitives, using the same
 * two-pass "measure content, then build the doc at the exact page size" idea
 * as styled_roster_renderer.py's _measure_total_height()/render_styled_roster()
 * (ReportLab's Paragraph.wrap() -> jsPDF's splitTextToSize()/getTextDimensions()).
 * Not a pixel-identical port of the ReportLab output — a structurally
 * equivalent, readable PDF (same sections/columns/fills), verified by eye
 * against the Python renderer's output rather than pixel diffing.
 */
window.RosterPWA = window.RosterPWA || {};

(function (ns) {
  const MARGIN = 10;
  const FONT_SIZE = 8;
  const HEADER_ROW_H = 6.5;   // floor height for a single-line header row
  const HEADER_LINE_H = 3.2;  // per-line height when a header label wraps
  const DATA_ROW_H = 5.5;
  const NOTE_LINE_H = 3.6;
  const SECTION_GAP = 3;
  const SECTION_TITLE_H = 7;
  const BLOCK_ROW_H = 6;
  const TITLE_H = 9;

  const SECTION_FILL = [242, 232, 199];    // cream/beige
  const HEADER_BLOCK_FILL = [232, 234, 246]; // pale lavender
  const LINE_COLOR = [204, 204, 204];
  const TEXT_COLOR = [0, 0, 0];

  function noteLineCount(doc, text, widthMm) {
    return doc.splitTextToSize(text, widthMm - 4).length;
  }

  /** Some column labels ("Overd Rank", "Actual Block Hours") wrap onto a
   * second line at their fixed column width — the header row must be tall
   * enough for the widest wrap, or the second line spills into the first
   * data row. Measured with the same bold font used when actually drawing
   * it, since bold glyphs are wider and wrap differently than normal. */
  function headerRowHeight(doc, columns) {
    doc.setFont(undefined, 'bold');
    let maxLines = 1;
    for (const [name, w] of columns) {
      maxLines = Math.max(maxLines, doc.splitTextToSize(name, w - 1).length);
    }
    doc.setFont(undefined, 'normal');
    return Math.max(HEADER_ROW_H, maxLines * HEADER_LINE_H + 2);
  }

  function measure(doc, layout, contentWidthMm) {
    let h = TITLE_H + 2 + 3 * BLOCK_ROW_H + SECTION_GAP; // header block

    h += headerRowHeight(doc, layout.dutyTable.columns);
    for (const row of layout.dutyTable.rows) {
      h += row.isNote ? noteLineCount(doc, row.text, contentWidthMm) * NOTE_LINE_H : DATA_ROW_H;
    }
    h += SECTION_GAP;

    h += SECTION_TITLE_H + layout.statsSection.rows.length * DATA_ROW_H + SECTION_GAP;

    if (layout.legendSection) {
      h += SECTION_TITLE_H;
      for (const [, desc] of layout.legendSection.rows.slice(1)) {
        h += noteLineCount(doc, desc, contentWidthMm * 0.8) * NOTE_LINE_H + 1;
      }
      h += SECTION_GAP;
    }

    if (layout.monthNotes) {
      h += SECTION_TITLE_H + noteLineCount(doc, layout.monthNotes, contentWidthMm) * NOTE_LINE_H;
    }

    return h;
  }

  function drawHeaderBlock(doc, layout, x, y, width) {
    doc.setFont(undefined, 'bold');
    doc.setFontSize(FONT_SIZE + 6);
    doc.text(layout.headerBlock.title, x, y + 6);
    doc.setFont(undefined, 'normal');
    doc.setFontSize(FONT_SIZE);
    let cy = y + TITLE_H + 2;

    const colW = [width * 0.14, width * 0.36, width * 0.14, width * 0.36];
    layout.headerBlock.rows.forEach((row, i) => {
      if (i === 0 || i === 2) {
        doc.setFillColor(...HEADER_BLOCK_FILL);
        doc.rect(x, cy, width, BLOCK_ROW_H, 'F');
      }
      let cx = x;
      row.forEach((cell, ci) => {
        const isLabel = ci % 2 === 0;
        doc.setFont(undefined, isLabel ? 'bold' : 'normal');
        const text = isLabel ? cell : (cell ? `: ${cell}` : '');
        doc.text(text, cx + 2, cy + BLOCK_ROW_H / 2 + 1.2);
        cx += colW[ci];
      });
      cy += BLOCK_ROW_H;
    });
    doc.setFont(undefined, 'normal');
    doc.setDrawColor(...LINE_COLOR);
    doc.line(x, cy, x + width, cy);
    return cy + SECTION_GAP;
  }

  function drawDutyTable(doc, layout, x, y, contentWidthMm) {
    const cols = layout.dutyTable.columns;
    let cy = y;

    // Header row — sized to fit whichever column label wraps to the most
    // lines, so a two-line label like "Overd Rank" never spills into the
    // first data row below it.
    const headerH = headerRowHeight(doc, cols);
    doc.setFillColor(...SECTION_FILL);
    doc.rect(x, cy, contentWidthMm, headerH, 'F');
    doc.setFont(undefined, 'bold');
    let cx = x;
    cols.forEach(([name, w]) => {
      const lines = doc.splitTextToSize(name, w - 1);
      const blockH = lines.length * HEADER_LINE_H;
      const firstBaseline = cy + (headerH - blockH) / 2 + HEADER_LINE_H * 0.75;
      lines.forEach((line, li) => {
        doc.text(line, cx + w / 2, firstBaseline + li * HEADER_LINE_H, { align: 'center' });
      });
      cx += w;
    });
    doc.setFont(undefined, 'normal');
    doc.setDrawColor(...LINE_COLOR);
    doc.line(x, cy + headerH, x + contentWidthMm, cy + headerH);
    cy += headerH;

    const dayEnd = new Set(layout.dutyTable.dayEndIndices);
    layout.dutyTable.rows.forEach((row, i) => {
      if (row.isNote) {
        const lines = doc.splitTextToSize(row.text, contentWidthMm - 4);
        doc.setFont(undefined, 'italic');
        doc.setFontSize(FONT_SIZE - 1);
        lines.forEach((line, li) => {
          doc.text(line, x + 2, cy + (li + 1) * NOTE_LINE_H - 0.8);
        });
        doc.setFont(undefined, 'normal');
        doc.setFontSize(FONT_SIZE);
        cy += lines.length * NOTE_LINE_H;
        return;
      }

      cx = x;
      cols.forEach(([, w], ci) => {
        const val = row[ci] || '';
        if (val) doc.text(String(val), cx + w / 2, cy + DATA_ROW_H / 2 + 1.2, { align: 'center', maxWidth: w - 1 });
        cx += w;
      });
      cy += DATA_ROW_H;

      if (dayEnd.has(i)) {
        doc.setDrawColor(...LINE_COLOR);
        doc.setLineWidth(0.1);
        doc.line(x, cy, x + contentWidthMm, cy);
      }
    });

    return cy + SECTION_GAP;
  }

  function drawSectionTitle(doc, text, x, y, width) {
    doc.setFillColor(...SECTION_FILL);
    doc.rect(x, y, width, SECTION_TITLE_H, 'F');
    doc.setFont(undefined, 'bold');
    doc.text(text, x + 2, y + SECTION_TITLE_H / 2 + 1.2);
    doc.setFont(undefined, 'normal');
    return y + SECTION_TITLE_H;
  }

  function drawStatsSection(doc, layout, x, y, width) {
    let cy = drawSectionTitle(doc, layout.statsSection.title, x, y, width);
    for (const [label, value] of layout.statsSection.rows) {
      doc.text(label, x + 2, cy + DATA_ROW_H / 2 + 1.2);
      doc.text(String(value), x + width * 0.5 + 2, cy + DATA_ROW_H / 2 + 1.2);
      cy += DATA_ROW_H;
    }
    return cy + SECTION_GAP;
  }

  function drawLegendSection(doc, layout, x, y, width) {
    if (!layout.legendSection) return y;
    let cy = drawSectionTitle(doc, layout.legendSection.title, x, y, width);
    const codeW = width * 0.2;
    const descW = width * 0.8;
    const [, ...dataRows] = layout.legendSection.rows;
    doc.setFont(undefined, 'bold');
    doc.text('Code', x + 2, cy + DATA_ROW_H / 2 + 1.2);
    doc.text('Code Description', x + codeW + 2, cy + DATA_ROW_H / 2 + 1.2);
    doc.setFont(undefined, 'normal');
    cy += DATA_ROW_H;
    for (const [code, desc] of dataRows) {
      const lines = doc.splitTextToSize(desc, descW - 4);
      doc.text(code, x + 2, cy + NOTE_LINE_H);
      lines.forEach((line, li) => doc.text(line, x + codeW + 2, cy + (li + 1) * NOTE_LINE_H));
      cy += lines.length * NOTE_LINE_H + 1;
    }
    return cy + SECTION_GAP;
  }

  function drawMonthNotes(doc, layout, x, y, width) {
    if (!layout.monthNotes) return y;
    let cy = drawSectionTitle(doc, 'Notes', x, y, width);
    const lines = doc.splitTextToSize(layout.monthNotes, width - 4);
    doc.setFont(undefined, 'italic');
    lines.forEach((line, li) => doc.text(line, x + 2, cy + (li + 1) * NOTE_LINE_H - 0.8));
    doc.setFont(undefined, 'normal');
    return cy + lines.length * NOTE_LINE_H;
  }

  /** Returns a jsPDF document sized exactly to its content, one page. */
  function renderPdf(layout) {
    const { jsPDF } = window.jspdf;
    const contentWidthMm = layout.dutyTable.columns.reduce((s, [, w]) => s + w, 0);

    const probe = new jsPDF({ unit: 'mm', format: [1000, 1000] });
    probe.setFontSize(FONT_SIZE);
    const contentHeight = measure(probe, layout, contentWidthMm);

    const pageWidth = contentWidthMm + 2 * MARGIN;
    const pageHeight = contentHeight + 2 * MARGIN + 4;

    const doc = new jsPDF({ unit: 'mm', format: [pageWidth, pageHeight] });
    doc.setFontSize(FONT_SIZE);
    doc.setTextColor(...TEXT_COLOR);

    let y = MARGIN;
    y = drawHeaderBlock(doc, layout, MARGIN, y, contentWidthMm);
    y = drawDutyTable(doc, layout, MARGIN, y, contentWidthMm);
    y = drawStatsSection(doc, layout, MARGIN, y, contentWidthMm);
    y = drawLegendSection(doc, layout, MARGIN, y, contentWidthMm);
    drawMonthNotes(doc, layout, MARGIN, y, contentWidthMm);

    return doc;
  }

  ns.renderPdf = { renderPdf };
})(window.RosterPWA);
