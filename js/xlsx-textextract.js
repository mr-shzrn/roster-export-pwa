/**
 * Turns raw XLSX bytes into a plain sheet grid: { rowNum, cells: {colLetter: text} }.
 * XLSX is a ZIP of XML — no vendored library needed. A small hand-rolled ZIP
 * central-directory reader locates the worksheet (and sharedStrings.xml, if
 * present), the browser's native DecompressionStream('deflate-raw') handles
 * decompression, and the native DOMParser reads the resulting XML. Plain
 * classic script — nothing here needs an ES-module import.
 */
window.RosterPWA = window.RosterPWA || {};

(function (ns) {
  const ZIP_EOCD_SIG = 0x06054b50;
  const ZIP_CD_SIG = 0x02014b50;
  const ZIP_LOCAL_SIG = 0x04034b50;

  function findEndOfCentralDirectory(bytes) {
    const maxCommentLen = 65535;
    const minPos = Math.max(0, bytes.length - (22 + maxCommentLen));
    for (let i = bytes.length - 22; i >= minPos; i--) {
      if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) {
        return i;
      }
    }
    throw new Error('Not a valid Excel (.xlsx) file — no end-of-central-directory record found.');
  }

  function readCentralDirectory(bytes) {
    const eocdOffset = findEndOfCentralDirectory(bytes);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const cdOffset = view.getUint32(eocdOffset + 16, true);
    const cdSize = view.getUint32(eocdOffset + 12, true);
    const decoder = new TextDecoder('utf-8');
    const entries = {};
    let pos = cdOffset;
    const end = cdOffset + cdSize;
    while (pos < end) {
      if (view.getUint32(pos, true) !== ZIP_CD_SIG) break;
      const method = view.getUint16(pos + 10, true);
      const compressedSize = view.getUint32(pos + 20, true);
      const uncompressedSize = view.getUint32(pos + 24, true);
      const nameLen = view.getUint16(pos + 28, true);
      const extraLen = view.getUint16(pos + 30, true);
      const commentLen = view.getUint16(pos + 32, true);
      const localHeaderOffset = view.getUint32(pos + 42, true);
      const nameStart = pos + 46;
      const name = decoder.decode(bytes.subarray(nameStart, nameStart + nameLen));
      entries[name] = { method, compressedSize, uncompressedSize, localHeaderOffset };
      pos = nameStart + nameLen + extraLen + commentLen;
    }
    return entries;
  }

  async function inflateRaw(bytes) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error("Your browser doesn't support reading Excel files — try a recent Chrome, Safari, or Firefox, or use the PDF export instead.");
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    const buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
  }

  async function readEntry(bytes, entry) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const lh = entry.localHeaderOffset;
    if (view.getUint32(lh, true) !== ZIP_LOCAL_SIG) {
      throw new Error('Corrupt Excel file (bad ZIP local file header).');
    }
    const nameLen = view.getUint16(lh + 26, true);
    const extraLen = view.getUint16(lh + 28, true);
    const dataStart = lh + 30 + nameLen + extraLen;
    const compressed = bytes.subarray(dataStart, dataStart + entry.compressedSize);
    if (entry.method === 0) return compressed;
    if (entry.method === 8) return inflateRaw(compressed);
    throw new Error(`Unsupported compression method (${entry.method}) in this Excel file.`);
  }

  function textOfAllTags(el) {
    const tEls = el.getElementsByTagName('t');
    let text = '';
    for (let i = 0; i < tEls.length; i++) text += tEls[i].textContent;
    return text;
  }

  function parseSharedStrings(xmlText) {
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    const siEls = doc.getElementsByTagName('si');
    const strings = [];
    for (let i = 0; i < siEls.length; i++) strings.push(textOfAllTags(siEls[i]));
    return strings;
  }

  function parseSheetXml(xmlText, sharedStrings) {
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    const rowEls = doc.getElementsByTagName('row');
    const rows = [];
    for (let i = 0; i < rowEls.length; i++) {
      const rowEl = rowEls[i];
      const rowNum = parseInt(rowEl.getAttribute('r'), 10);
      const cells = {};
      const cEls = rowEl.getElementsByTagName('c');
      for (let j = 0; j < cEls.length; j++) {
        const cEl = cEls[j];
        const ref = cEl.getAttribute('r') || '';
        const colLetter = ref.replace(/\d+/g, '');
        if (!colLetter) continue;
        const type = cEl.getAttribute('t');
        let text = '';
        if (type === 's') {
          const vEl = cEl.getElementsByTagName('v')[0];
          const idx = vEl ? parseInt(vEl.textContent, 10) : -1;
          text = sharedStrings[idx] || '';
        } else if (type === 'inlineStr') {
          const isEl = cEl.getElementsByTagName('is')[0];
          text = isEl ? textOfAllTags(isEl) : '';
        } else {
          const vEl = cEl.getElementsByTagName('v')[0];
          text = vEl ? vEl.textContent : '';
        }
        text = text.trim();
        if (text) cells[colLetter] = text;
      }
      rows.push({ rowNum, cells });
    }
    return rows;
  }

  /** xlsxBytes: Uint8Array. Returns rows: [{ rowNum, cells: {colLetter: text} }]. */
  async function extractGrid(xlsxBytes) {
    const entries = readCentralDirectory(xlsxBytes);
    const sheetName = Object.keys(entries).find((n) => /^xl\/worksheets\/sheet1\.xml$/i.test(n))
      || Object.keys(entries).find((n) => /^xl\/worksheets\/[^/]+\.xml$/i.test(n));
    if (!sheetName) throw new Error('Could not find a worksheet inside this Excel file.');

    const decoder = new TextDecoder('utf-8');
    const sheetXml = decoder.decode(await readEntry(xlsxBytes, entries[sheetName]));

    let sharedStrings = [];
    const sstEntry = entries['xl/sharedStrings.xml'];
    if (sstEntry) {
      sharedStrings = parseSharedStrings(decoder.decode(await readEntry(xlsxBytes, sstEntry)));
    }

    return parseSheetXml(sheetXml, sharedStrings);
  }

  ns.xlsxTextExtract = { extractGrid };
})(window.RosterPWA);
