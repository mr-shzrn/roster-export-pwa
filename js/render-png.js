/**
 * Rasterizes the just-generated PDF (from render-pdf.js) to a PNG via
 * pdf.js + an offscreen canvas — guarantees PDF/PNG pixel parity with no
 * duplicate layout logic and no third rendering library.
 *
 * Loaded as an ES module — see pdf-textextract.js's header comment.
 */
import * as pdfjsLib from '../vendor/pdf.min.mjs';

window.RosterPWA = window.RosterPWA || {};

(function (ns) {
  const SCALE = 3; // crisp output for sharing/zooming on a phone

  /** doc: a jsPDF document (from render-pdf.js). Returns a PNG Blob. */
  async function renderPngFromPdf(doc) {
    const bytes = doc.output('arraybuffer');
    // jsPDF's default text uses the standard (non-embedded) Helvetica font —
    // pdf.js needs its own standard-font glyph data to rasterize that to a
    // canvas at all; without standardFontDataUrl the page renders with every
    // fill/line but completely blank text (confirmed: caught this testing
    // against a real Canvas implementation, not visible in text-extraction
    // testing since that path never rasterizes anything).
    const pdf = await pdfjsLib.getDocument({
      data: bytes,
      standardFontDataUrl: 'vendor/standard_fonts/',
    }).promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: SCALE });

    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({ canvasContext: ctx, viewport }).promise;

    return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  }

  ns.renderPng = { renderPngFromPdf };
})(window.RosterPWA);
