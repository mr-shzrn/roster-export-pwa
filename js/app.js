// Loaded as an ES module — see pdf-textextract.js's header comment for why.
import * as pdfjsLib from '../vendor/pdf.min.mjs';

(function () {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.mjs';

  const fileInput = document.getElementById('file-input');
  const fileLabelText = document.getElementById('file-label-text');
  const statusEl = document.getElementById('status');
  const optionsSection = document.getElementById('options-section');
  const editorSection = document.getElementById('editor-section');
  const exportSection = document.getElementById('export-section');
  const editorEl = document.getElementById('editor');
  const showHotelEl = document.getElementById('show-hotel');
  const showDutyAcEl = document.getElementById('show-duty-ac');
  const rateInputEl = document.getElementById('rate-input');
  const exportPdfBtn = document.getElementById('export-pdf-btn');
  const exportPngBtn = document.getElementById('export-png-btn');
  const exportStatusEl = document.getElementById('export-status');
  const startOverBtn = document.getElementById('start-over-btn');

  let currentData = null;

  const MAX_FILE_BYTES = 20 * 1024 * 1024; // real rosters are tens of KB; generous headroom

  // --- Theme: auto (system) by default, explicit override persisted in localStorage ---
  const THEME_KEY = 'rosterPwaTheme';
  const themeToggleBtn = document.getElementById('theme-toggle');
  const prefersDarkQuery = window.matchMedia('(prefers-color-scheme: dark)');

  function getThemeOverride() {
    try {
      const v = localStorage.getItem(THEME_KEY);
      return v === 'light' || v === 'dark' ? v : null;
    } catch (err) {
      return null; // private browsing / storage disabled — fall back to auto
    }
  }

  function resolveTheme(override) {
    return override || (prefersDarkQuery.matches ? 'dark' : 'light');
  }

  function applyTheme() {
    const override = getThemeOverride();
    if (override) {
      document.documentElement.setAttribute('data-theme', override);
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
    const resolved = resolveTheme(override);
    document.documentElement.setAttribute('data-resolved-theme', resolved);
    themeToggleBtn.setAttribute('aria-label', `Switch to ${resolved === 'dark' ? 'light' : 'dark'} theme`);
  }

  themeToggleBtn.addEventListener('click', () => {
    const next = resolveTheme(getThemeOverride()) === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(THEME_KEY, next); } catch (err) { /* no persistence available; still apply for this view */ }
    applyTheme();
  });

  prefersDarkQuery.addEventListener('change', () => {
    if (!getThemeOverride()) applyTheme();
  });

  applyTheme();

  // --- Footer version indicator — read from version.js's single source of truth. ---
  const appVersionEl = document.getElementById('app-version');
  if (appVersionEl && window.APP_VERSION) {
    appVersionEl.textContent = window.APP_VERSION;
  }

  // --- Remember last-used options (per-device convenience only, no roster data). ---
  const PREF_RATE = 'rosterPwaRate';
  const PREF_SHOW_HOTEL = 'rosterPwaShowHotel';
  const PREF_SHOW_DUTY_AC = 'rosterPwaShowDutyAc';

  function loadPref(key) {
    try { return localStorage.getItem(key); } catch (err) { return null; }
  }
  function savePref(key, value) {
    try { localStorage.setItem(key, value); } catch (err) { /* no persistence available */ }
  }

  const savedRate = loadPref(PREF_RATE);
  if (savedRate !== null) rateInputEl.value = savedRate;
  const savedShowHotel = loadPref(PREF_SHOW_HOTEL);
  if (savedShowHotel !== null) showHotelEl.checked = savedShowHotel === '1';
  const savedShowDutyAc = loadPref(PREF_SHOW_DUTY_AC);
  if (savedShowDutyAc !== null) showDutyAcEl.checked = savedShowDutyAc === '1';

  rateInputEl.addEventListener('change', () => savePref(PREF_RATE, rateInputEl.value));
  showHotelEl.addEventListener('change', () => savePref(PREF_SHOW_HOTEL, showHotelEl.checked ? '1' : '0'));
  showDutyAcEl.addEventListener('change', () => savePref(PREF_SHOW_DUTY_AC, showDutyAcEl.checked ? '1' : '0'));

  function setStatus(el, text, isError) {
    el.textContent = text;
    el.hidden = !text;
    el.classList.toggle('error', !!isError);
  }

  function sanitizeForFilename(s) {
    return (s || '')
      .replace(/[\\/:*?"<>|]/g, '') // characters illegal in Windows/macOS filenames
      .replace(/\s+/g, ' ')          // collapse whitespace, keep spaces (no _ or -)
      .trim();
  }

  function fileNameFor(ext) {
    const parts = [
      currentData.crew_info && currentData.crew_info.rank,
      currentData.crew_info && currentData.crew_info.name,
      currentData.month_year,
    ].filter(Boolean);
    const base = sanitizeForFilename(parts.join(' ')) || 'Roster';
    return `${base}.${ext}`;
  }

  function buildLayoutFromCurrentOptions() {
    const rate = parseFloat(rateInputEl.value);
    const allowanceEstimate = Number.isFinite(rate) && rate > 0
      ? RosterPWA.allowance.calcAllowanceEstimate(currentData.duty_days, rate)
      : null;
    return RosterPWA.layout.buildLayout(currentData, {
      showHotel: showHotelEl.checked,
      showDutyAc: showDutyAcEl.checked,
      allowanceEstimate,
    });
  }

  function resetApp() {
    currentData = null;
    fileInput.value = '';
    fileLabelText.textContent = 'Choose roster file…';
    setStatus(statusEl, '');
    setStatus(exportStatusEl, '');
    optionsSection.hidden = true;
    editorSection.hidden = true;
    exportSection.hidden = true;
    startOverBtn.hidden = true;
    editorEl.innerHTML = '';
  }
  startOverBtn.addEventListener('click', resetApp);

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;

    fileLabelText.textContent = file.name;
    setStatus(statusEl, 'Parsing…');
    optionsSection.hidden = true;
    editorSection.hidden = true;
    exportSection.hidden = true;
    startOverBtn.hidden = true;

    if (file.size > MAX_FILE_BYTES) {
      setStatus(statusEl, `File is too large (${(file.size / 1024 / 1024).toFixed(1)}MB) — expected a roster file under 20MB.`, true);
      return;
    }

    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const isPdf = bytes.length >= 5
        && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d; // "%PDF-"
      const isZip = bytes.length >= 4
        && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04; // "PK\x03\x04" — xlsx is a ZIP

      if (isPdf) {
        const pages = await RosterPWA.pdfTextExtract.extractPages(bytes);
        const format = RosterPWA.formatDetect.detectFormat(pages);
        if (format === 'unknown') {
          setStatus(statusEl, 'Unrecognized roster format — this app reads the "Roster Report" tabular export or the Monday-Sunday calendar-grid export.', true);
          return;
        }
        currentData = format === 'calendar_grid'
          ? RosterPWA.calendarGridParser.parseCalendarGridStyled(pages)
          : RosterPWA.styledRosterParser.parseStyledRoster(pages);
      } else if (isZip) {
        const grid = await RosterPWA.xlsxTextExtract.extractGrid(bytes);
        currentData = RosterPWA.xlsxRosterParser.parseXlsxRoster(grid);
      } else {
        setStatus(statusEl, "That doesn't look like a PDF or Excel (.xlsx) roster file.", true);
        return;
      }

      if (!currentData.duty_days.length) {
        setStatus(statusEl, 'No duty days found in this roster file.', true);
        return;
      }

      setStatus(statusEl, `Parsed ${currentData.duty_days.length} days for ${currentData.crew_info.name || 'crew'}, ${currentData.month_year}.`);
      RosterPWA.editor.renderEditor(editorEl, currentData);
      optionsSection.hidden = false;
      editorSection.hidden = false;
      exportSection.hidden = false;
      startOverBtn.hidden = false;
    } catch (err) {
      console.error(err);
      setStatus(statusEl, `Could not parse this file: ${err.message}`, true);
    }
  });

  exportPdfBtn.addEventListener('click', () => {
    if (!currentData) return;
    setStatus(exportStatusEl, 'Building PDF…');
    try {
      const layout = buildLayoutFromCurrentOptions();
      const doc = RosterPWA.renderPdf.renderPdf(layout);
      doc.save(fileNameFor('pdf'));
      setStatus(exportStatusEl, 'PDF downloaded.');
    } catch (err) {
      console.error(err);
      setStatus(exportStatusEl, `Could not build PDF: ${err.message}`, true);
    }
  });

  exportPngBtn.addEventListener('click', async () => {
    if (!currentData) return;
    setStatus(exportStatusEl, 'Building image…');
    try {
      const layout = buildLayoutFromCurrentOptions();
      const doc = RosterPWA.renderPdf.renderPdf(layout);
      const blob = await RosterPWA.renderPng.renderPngFromPdf(doc);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileNameFor('png');
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setStatus(exportStatusEl, 'Image downloaded.');
    } catch (err) {
      console.error(err);
      setStatus(exportStatusEl, `Could not build image: ${err.message}`, true);
    }
  });

  // --- Service worker registration (offline capability) ---
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      // A page's very first-ever visit has no controller yet; the initial
      // install->activate->claim sequence fires 'controllerchange' too, not
      // just a real version update. Reloading unconditionally on that first
      // claim can race a user who starts using the app (e.g. uploads a
      // file) while the SW is still installing in the background — the
      // reload silently discards whatever they were doing. Only the
      // "was already controlled, now controlled by a NEWER worker" case is
      // an actual update worth reloading for.
      const hadController = !!navigator.serviceWorker.controller;

      navigator.serviceWorker.register('service-worker.js')
        .then((reg) => {
          setInterval(() => reg.update(), 60000);
          reg.addEventListener('updatefound', () => {
            const newWorker = reg.installing;
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                console.log('New version available — reload to update.');
              }
            });
          });
        })
        .catch((err) => console.log('Service worker registration failed:', err));

      let refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!hadController) return;
        if (refreshing) return;
        refreshing = true;
        window.location.reload();
      });
    });
  }

  const offlineIndicator = document.getElementById('offline-indicator');
  function updateOfflineIndicator() {
    offlineIndicator.textContent = navigator.onLine ? '' : 'Offline — fully functional, nothing needs the network.';
  }
  window.addEventListener('online', updateOfflineIndicator);
  window.addEventListener('offline', updateOfflineIndicator);
  updateOfflineIndicator();
})();
