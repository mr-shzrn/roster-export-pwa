importScripts('./js/version.js');
const CACHE_NAME = 'roster-export-pwa-' + self.APP_VERSION;
const urlsToCache = [
  './',
  './index.html',
  './styles.css',
  './manifest.json',
  './js/version.js',
  './vendor/pdf.min.mjs',
  './vendor/pdf.worker.min.mjs',
  './vendor/jspdf.umd.min.js',
  // pdf.js needs these to rasterize non-embedded standard fonts (jsPDF's
  // default Helvetica) when render-png.js renders a page to canvas — without
  // them cached, the PNG export would silently come out with blank text the
  // first time a user is offline (confirmed: this was blank in testing
  // before these were vendored at all).
  './vendor/standard_fonts/FoxitDingbats.pfb',
  './vendor/standard_fonts/FoxitFixed.pfb',
  './vendor/standard_fonts/FoxitFixedBold.pfb',
  './vendor/standard_fonts/FoxitFixedBoldItalic.pfb',
  './vendor/standard_fonts/FoxitFixedItalic.pfb',
  './vendor/standard_fonts/FoxitSerif.pfb',
  './vendor/standard_fonts/FoxitSerifBold.pfb',
  './vendor/standard_fonts/FoxitSerifBoldItalic.pfb',
  './vendor/standard_fonts/FoxitSerifItalic.pfb',
  './vendor/standard_fonts/FoxitSymbol.pfb',
  './vendor/standard_fonts/LiberationSans-Bold.ttf',
  './vendor/standard_fonts/LiberationSans-BoldItalic.ttf',
  './vendor/standard_fonts/LiberationSans-Italic.ttf',
  './vendor/standard_fonts/LiberationSans-Regular.ttf',
  './js/pdf-textextract.js',
  './js/table-reconstruct.js',
  './js/columns.js',
  './js/airport-timezones.js',
  './js/styled-roster-parser.js',
  './js/calendar-grid-parser.js',
  './js/xlsx-textextract.js',
  './js/xlsx-roster-parser.js',
  './js/format-detect.js',
  './js/allowance.js',
  './js/editor.js',
  './js/layout.js',
  './js/render-pdf.js',
  './js/render-png.js',
  './js/app.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

// Install service worker and cache every file needed for fully offline use.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(urlsToCache))
      // Activate a new version as soon as it's installed rather than waiting
      // for every open tab to close first — this app is under active
      // iteration, and app.js updating while its dependency modules stay on
      // a stale cached version (until a full tab close/reopen) produces
      // confusing "why isn't my fix here" failures. clients.claim() in
      // 'activate' (below) completes the handoff for already-open tabs.
      .then(() => self.skipWaiting())
  );
});

// Listen for skipWaiting message
self.addEventListener('message', (event) => {
  if (event.data && event.data.action === 'skipWaiting') {
    self.skipWaiting();
  }
});

// Cache-first, network fallback — nothing here ever needs connectivity once installed.
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => response || fetch(event.request))
  );
});

// Clean up old caches and take control immediately.
self.addEventListener('activate', (event) => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then((cacheNames) => Promise.all(
      cacheNames.map((cacheName) => {
        if (cacheWhitelist.indexOf(cacheName) === -1) return caches.delete(cacheName);
      })
    )).then(() => self.clients.claim())
  );
});
