/**
 * Thin wrapper around pdf.js: PDF bytes -> per-page arrays of positioned
 * text items {str, x, yTop}. yTop is measured from the TOP of the page
 * (pdfplumber convention).
 *
 * getTextContent()'s item.transform is in raw PDF user space, NOT rendered
 * viewport space — for an unrotated page a simple "height - y" flip happens
 * to match, but a page with a /Rotate entry (confirmed real: a roster PDF
 * with page.rotate === 90) needs the actual viewport transform applied, or
 * x/y come out swapped/rotated and every downstream row/column reconstruction
 * silently produces garbage. Util.applyTransform(point, viewport.transform)
 * is the same transform pdf.js's own text layer uses internally, so this
 * always lands in correctly oriented top-down viewport coordinates
 * regardless of page rotation.
 *
 * Loaded as an ES module (pdf.js 4.x dropped its classic-script build —
 * only .mjs builds are published from 4.2.67 onward), so pdfjsLib comes
 * from an explicit import rather than a global set by a <script> tag.
 */
import * as pdfjsLib from '../vendor/pdf.min.mjs';

window.RosterPWA = window.RosterPWA || {};

(function (ns) {
  async function extractPages(pdfBytes) {
    const loadingTask = pdfjsLib.getDocument({ data: pdfBytes });
    const doc = await loadingTask.promise;
    const pages = [];

    for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
      const page = await doc.getPage(pageNum);
      const viewport = page.getViewport({ scale: 1 });
      const textContent = await page.getTextContent();

      const items = textContent.items
        .filter((it) => it.str && it.str.trim() !== '')
        .map((it) => {
          const [x, yTop] = pdfjsLib.Util.applyTransform(
            [it.transform[4], it.transform[5]], viewport.transform);
          return { str: it.str, x, yTop };
        });

      pages.push({ pageNum, width: viewport.width, height: viewport.height, items });
    }

    return pages;
  }

  ns.pdfTextExtract = { extractPages };
})(window.RosterPWA);
