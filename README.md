# Roster Export

Offline-first PWA that converts a Malaysia Airlines crew roster export (PDF
"Roster Report", PDF Calendar Grid, or Excel "Roster Report") into a styled
PDF/image export. Everything runs client-side — nothing is uploaded
anywhere.

## Run locally

No build step. Serve the folder and open it:

```bash
python3 -m http.server 8642
```

Then visit `http://localhost:8642/index.html`.

## Deploy

Hosted on Firebase Hosting.

```bash
firebase deploy --only hosting
```

Before deploying a change, bump the version in `js/version.js` — it's the
single source of truth for both the footer's version indicator and the
service worker's cache name, so bumping it is what makes sure returning
users actually get the update instead of a stale cached copy.

## Tests

No automated test runner — `tests/manual-parity-checklist.md` is a running
log of manual/scripted verification passes (real-Chrome checks via
Playwright, Node-based parser parity checks against the Python desktop app,
etc.).
