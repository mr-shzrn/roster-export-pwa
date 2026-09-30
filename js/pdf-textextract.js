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
 * A second, different kind of rotation exists too (confirmed real: a
 * calendar-grid export with page.rotate === 0, but every single text glyph
 * individually drawn with a 90°-family rotation baked into its own text
 * matrix — landscape-designed content pasted onto a portrait page without
 * ever setting the page's own /Rotate flag). The page-level fix above does
 * nothing for this, since pdf.js's viewport only ever reflects page.rotate.
 * Detected by sampling each item's own transform (its [a,b] components —
 * upright text always has b≈0 regardless of a's scale; rotated text doesn't)
 * and, when a consistent non-zero rotation dominates the sample, asking
 * pdf.js for a viewport as if the page itself had that rotation
 * (`getViewport({rotation})` accepts an override, the same mechanism
 * already proven correct for real page.rotate values) — same fix,
 * discovered from content instead of from the page dictionary.
 *
 * Loaded as an ES module (pdf.js 4.x dropped its classic-script build —
 * only .mjs builds are published from 4.2.67 onward), so pdfjsLib comes
 * from an explicit import rather than a global set by a <script> tag.
 */
import * as pdfjsLib from '../vendor/pdf.min.mjs';

window.RosterPWA = window.RosterPWA || {};

(function (ns) {
  const RIGHT_ANGLES = [0, 90, 180, 270];
  const ANGLE_TOLERANCE_DEG = 3;
  const MIN_SAMPLE = 10;
  const DOMINANCE_THRESHOLD = 0.7;

  /**
   * Sample non-whitespace items' text matrices and return the dominant
   * baked-in rotation (0/90/180/270), or 0 if the page looks normal or
   * there isn't a clear, confident majority — never second-guess a normal
   * upright page from a little noise or a handful of decorative glyphs.
   */
  function detectContentRotation(items) {
    const counts = { 0: 0, 90: 0, 180: 0, 270: 0 };
    let sampled = 0;
    for (const it of items) {
      if (!it.str || !it.str.trim()) continue;
      const a = it.transform[0];
      const b = it.transform[1];
      if (a === 0 && b === 0) continue; // degenerate matrix, skip
      let deg = (Math.atan2(b, a) * 180) / Math.PI;
      if (deg < 0) deg += 360;
      const snapped = RIGHT_ANGLES.find(
        (r) => Math.abs(deg - r) < ANGLE_TOLERANCE_DEG || Math.abs(deg - r) > 360 - ANGLE_TOLERANCE_DEG);
      if (snapped !== undefined) counts[snapped]++;
      sampled += 1;
      if (sampled >= 40) break;
    }
    const total = counts[0] + counts[90] + counts[180] + counts[270];
    if (total < MIN_SAMPLE) return 0;
    let best = 0;
    for (const angle of [90, 180, 270]) {
      if (counts[angle] > counts[best]) best = angle;
    }
    return best !== 0 && counts[best] / total > DOMINANCE_THRESHOLD ? best : 0;
  }

  async function extractPages(pdfBytes) {
    const loadingTask = pdfjsLib.getDocument({ data: pdfBytes });
    const doc = await loadingTask.promise;
    const pages = [];

    for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
      const page = await doc.getPage(pageNum);
      const textContent = await page.getTextContent();
      const contentRotation = detectContentRotation(textContent.items);
      const viewport = contentRotation
        ? page.getViewport({ scale: 1, rotation: contentRotation })
        : page.getViewport({ scale: 1 });

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
