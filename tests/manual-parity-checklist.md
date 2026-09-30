# Manual verification checklist

## Already verified (2026-09-29/30, automated/scripted — see session notes)

- [x] **XLSX ("Roster Report" spreadsheet export) support added**: two new
      files, `js/xlsx-textextract.js` (hand-rolled ZIP central-directory
      reader + native `DecompressionStream('deflate-raw')` + native
      `DOMParser` — zero vendored dependency) and `js/xlsx-roster-parser.js`
      (grid → the exact same `crew_info`/`month_year`/`header_totals`/
      `duty_days[].legs[]` shape `parseStyledRoster()` already produces, so
      `layout.js`/`render-pdf.js`/`render-png.js`/`editor.js`/`allowance.js`
      needed zero changes). `js/styled-roster-parser.js` had
      `parsePairingEmbeddedDate`/`weekdayAbbrev`/`computeOffDaysSplit`/the
      header-line regexes widened onto its export object for reuse (same
      source report, same conventions, no PDF dependency in any of them).
      `app.js`'s upload handler now branches on magic bytes (`%PDF-` vs the
      ZIP signature `PK\x03\x04`) before choosing a parser path.
      **Investigation correction, caught mid-implementation**: the first
      pass at reading the real sample file (`cwpCrewRosterReport...xlsx`)
      concluded the Date column was blank — wrong; that pass only read
      `<t>` text tags and missed numeric `<v>` cells (Excel stores dates as
      serial numbers). Re-checked properly: every duty-block's first row
      has a real Date value, reliable and local (matches its own Duty
      Report time exactly) — no pairing-anchor/sequential-day-counting
      inference needed at all, far simpler than first planned. A late-night
      report legitimately lands one calendar day before its pairing
      reference's label (normal overnight behavior, not a bug — confirmed
      by testing that a naive per-row fix broke everything else). What
      *is* real: a confirmed gap in the actual sample (`03-Oct` straight to
      `05-Oct`, `04-Oct` missing entirely) that persists even with correct
      date reading — consistent with an export whose date-range filter
      runs on a UTC day boundary against a stated local range. Per Shaz's
      explicit request, this **rejects the file outright** (not a soft
      warning) with a clear UTC/local-time message, computed by comparing
      each duty block's day-index **range** (start day through the latest
      date any of its own continuation rows carry) to the next block's
      start — comparing bare start-to-start dates first produced a false
      positive on a legitimate overnight duty that spans past midnight.
      Verified in real Chrome: the actual broken sample file is rejected
      with the exact UTC message and the Review section stays hidden; a
      synthetic hand-built valid `.xlsx` (DEFLATE-compressed, to also prove
      the decompression path, not just stored/uncompressed) parses to 4
      correct duty days, right crew-info summary, and a correctly-named
      PDF export; the existing Roster Report PDF format re-tested with zero
      regression. Zero unexpected console errors throughout.
      `service-worker.js` precache updated with both new files;
      `js/version.js` bumped to `v17`.

## Already verified (2026-09-29, automated/scripted — see session notes)

- [x] **2026-09-29, item 5 (Export Both) rolled back per Shaz — reduce
      clutter, keep exports independent**: removed `#export-both-btn` from
      `index.html` and its handler from `app.js` (the now-single-caller
      `downloadPngBlob` helper was inlined back into `#export-png-btn`'s
      handler rather than kept as an abstraction for one caller). Also
      renamed the PNG button and its status text to "Image" — "Download
      PNG" → **"Download Image"**, "Building PNG…" → "Building image…",
      "PNG downloaded." → "Image downloaded." (the actual file still saves
      with a `.png` extension — only the user-facing wording changed, to
      read as plain English instead of a file-format acronym). Removed the
      now-dead `.secondary-btn` CSS selector. `js/version.js` bumped to
      `v16`. Verified in real Chrome: `#export-both-btn` no longer exists,
      `.export-buttons` shows exactly `["Download PDF", "Download Image"]`,
      clicking "Download Image" downloads `...August 2026.png` with status
      text "Image downloaded.", PDF export unaffected, zero console errors.

## Already verified (2026-09-28, automated/scripted — see session notes)

- [x] **2026-09-28, 7 improvement ideas implemented** (item 0, the
      opt-in editable-corrections feature, stays deferred per its own
      "highly suggested, not building now" framing):
      1. **Version indicator**: new `js/version.js` (`self.APP_VERSION`)
         is the single source of truth, loaded as a classic script by both
         `index.html` (footer display) and `service-worker.js` (via
         `importScripts`, derives `CACHE_NAME`) — one number to bump per
         deploy instead of two.
      2. **Persisted rate/column toggles**: `app.js` saves
         `rate-input`/`show-hotel`/`show-duty-ac` to `localStorage` on
         `change` and restores them on load (wrapped in try/catch, same
         pattern as the theme override).
      3. **Collapsible day rows**: `editor.js`'s `dayBlock()` now returns a
         native `<details>`/`<summary>` for any day with legs (collapsed by
         default), keyboard-accessible with zero extra JS; a day with no
         legs (day off, etc.) stays a plain non-collapsible row since
         there's nothing to expand.
      4. **Start over button**: resets `currentData`, the file input, all
         section visibility, and the editor's contents without a page
         reload; shown only after a successful parse.
      5. **Export Both button**: builds the PDF once, reuses the same
         `jsPDF` doc for the PNG render, triggers both downloads from one
         click.
      6. **Privacy + legitimacy caveat**: added to the Export section per
         Shaz's explicit wording direction — *"Nothing leaves your device
         — parsing and export happen entirely locally. This export is
         generated automatically and may contain errors; you're
         responsible for checking it against the original roster before
         relying on it."*
      7. **Quick-glance summary**: `editor.js` now renders rank+name and
         "<Month Year> · N duty days" above the day list, before the
         warnings/table content.
      Verified end-to-end in real Chrome (`playwright-core` driving system
      Chrome, same technique as prior passes): footer shows `v15`; summary
      reads `"CAPT AHMAD BIN TESTING"` / `"August 2026 · 28 duty days"`;
      18 `<details>` elements present, all closed by default, first one
      opens on click; the export-section privacy/caveat text matches
      exactly; Start Over correctly shows/hides every section and resets
      the file label; rate `250` and an unchecked `show-hotel` both
      survived a full page reload while the untouched `show-duty-ac`
      stayed at its own saved value; Export Both fired exactly 2 downloads
      with the correct PDF/PNG filenames. Zero console errors across both
      test passes. All 35 service-worker precache entries (34 + the new
      `version.js`) confirmed to exist on disk.

## Already verified (2026-09-27, automated/scripted — see session notes)

- [x] **2026-09-27, custom export file name + allowance duty-code fix**:
      `fileNameFor()` in `js/app.js` now builds `"<Rank> <Name> <Month
      Year>.<ext>"` from `crew_info.rank`/`crew_info.name`/`month_year`
      (space-separated, illegal filesystem characters stripped, no
      underscores/hyphens), replacing the generic
      `styled_roster_August_2026.pdf`. Degrades gracefully via
      `.filter(Boolean)` if rank/name are missing. Verified in real Chrome:
      `download.suggestedFilename()` returned exactly
      `"CAPT AHMAD BIN TESTING August 2026.pdf"` /`.png` for the real
      fixture, zero console errors.
      Also audited `js/allowance.js`'s duty-code classification against
      the authoritative `roster_parser.py:56` (`OFFICE_CODES = ['OFF01',
      'LDP', 'CRM', 'C17', 'TDC']`) per Shaz's request — found
      `isTrainingItem()` incorrectly treated CRM/C17/TDC/LDP (office codes)
      as training items, producing a spurious `"(trainee — unpaid)"`
      breakdown row for what are actually unpaid office admin days
      (payment amount was already correctly $0 either way — this was a
      **display/classification** bug, not a payment-amount bug). Fixed to
      match `allowance_calculator.py`'s own silent-skip behavior for any
      office code other than OFF01. Verified with a synthetic
      `duty_days` fixture (CRM day + a real 738/TRI training day + a
      flight day): CRM day now produces no breakdown entry at all, while
      the training day (RM1550) and flight day (RM2036.67) are still
      correctly paid — confirms the fix is classification-only and didn't
      touch payment amounts for any legitimately paid day.
      `service-worker.js` `CACHE_NAME` bumped to `v13`.
- [x] **2026-09-27, allowance fix CORRECTED — CRM/TDC restored to training**:
      Shaz caught this immediately: "I still get paid when I conduct CRM."
      The `v13` fix above was **wrong for CRM and TDC specifically** —
      re-reading `roster_parser.py:519-528` (`_parse_duty_line`) shows CRM/
      TDC/IOC/AVSEC items are forced to `work_type='TRAINING'`
      *unconditionally on item text alone*, checked **before** the
      function's own `OFFICE_CODES` fallback — meaning `'CRM'`/`'TDC'` in
      that class var are dead for this purpose; only `OFF01`/`LDP` actually
      reach the office branch. Whether a CRM/TDC day gets *paid* is decided
      separately, downstream, by `duty_code` (TRI/TRE/TRAINER = the
      facilitator, paid via the classroom formula; no duty_code = trainee,
      shown but unpaid) — exactly what `trainingAllowance()`/
      `calc_training_allowance()` already implement. So CRM and TDC were
      restored to `isTrainingItem()` (LDP and C17 stay excluded — those
      never get the training override). Re-verified with a synthetic test:
      a CRM day with `duty_code: 'TRI'` now correctly pays RM1400 (CLASS 8h
      @ half-rate + RM600), a CRM day with no duty_code shows as an unpaid
      training row, and an LDP day still produces no entry.
      `service-worker.js` `CACHE_NAME` bumped to `v14`.
- [x] **2026-09-27, desktop app fix — new_roster_parser.py CRM/TDC
      classification**: the flagged bug above (new-format parser's
      `_classify_item_type()` classifying CRM/TDC as `'office'`
      unconditionally, with no `duty_code` awareness at all) was fixed in
      the desktop app, per Shaz confirming CRM/TDC facilitation is recorded
      with duty_code `'TRAINER'` specifically (not TRI/TRE, which are
      flight/sim-only). Moved CRM/TDC into the training branch of
      `_classify_item_type()`, matching `roster_parser.py`'s legacy
      behavior exactly — no `duty_code` parameter needed in the classifier
      itself, since the type is item-based; payment still correctly gates
      on `duty_code` downstream in `calc_training_allowance()`, which
      already accepts `TRAINER` as a valid instructor code. Bonus find
      while checking this: `roster_parser.py`'s own
      `_build_training_description()` already had an `is_ground_class`
      check expecting CRM/TDC to arrive as `type='training'` — so this fix
      also corrects the new-format calendar-event *description* for
      CRM/TDC (was silently using the wrong office template), not just the
      allowance payment. Added `tests/test_new_roster_parser.py` (6 tests:
      classification for CRM/TDC/office-codes/existing-training-codes, plus
      end-to-end `calc_allowances()` checks that a TRAINER-coded CRM day is
      paid and a plain-attendance CRM day is not). Full desktop suite
      re-run: **87/87 passed** (was 81; `pytest` had to be installed into
      the project's existing `venv` first — it wasn't present).

- [x] JS table-reconstruction + parser produce an **exact structural match**
      against the real Python `parse_styled_roster()` output on
      `tests/fixtures/roster_report_aug2026.pdf` (crew info, month/year,
      header totals, all 27 duty days, every leg, wrapped hotel names,
      the pairing/date-mismatch warning) — verified in Node with pdfjs-dist.
- [x] `allowance.js` math sanity-checked against hand computation (payable
      hours vs. header duty-hours delta matches the expected fixed-credit
      shortfall on office days).
- [x] `render-pdf.js` produces a valid, well-formed PDF from the real
      fixture (header block, duty table incl. multi-leg days/day-offs/
      wrapped hotels, notes row, Monthly Statistics incl. the two new rows,
      Legend, month notes) — visually inspected via a rendered thumbnail.
- [x] All JS files pass `node --check` (syntax valid).
- [x] Service worker's precache list matches files that actually exist on disk.
- [x] **2026-09-27, real-world regression**: a second real roster PDF
      (`cwpCrewRosterReport*.pdf`, rotated page — `page.rotate === 90`, real
      overnight `(+1)` time annotations, and header labels offset from
      their data columns by up to ~17pt) initially failed to parse at all —
      found and fixed two real bugs:
      1. `pdf-textextract.js` read `item.transform[4]/[5]` directly as
         viewport x/y with a naive height-flip, which only happens to work
         for an unrotated page. Fixed to use
         `pdfjsLib.Util.applyTransform(point, viewport.transform)`, the
         same transform pdf.js's own text layer uses — correct regardless
         of page rotation.
      2. `columns.js`'s `cellAt()` matched data to a column by a small fixed
         tolerance (±3) around the *header label's* x — broke when a wide
         header (e.g. "Pairing/Activity") sat well to the right of where
         its actual data values (e.g. a bare "D") start. Rewrote to
         range-based assignment: the midpoint between each pair of adjacent
         registered column anchors defines that column's boundary. Also
         needed `ITEM_X_MERGE_TOL` raised 3→10 (stacked header sub-labels
         like "Duty"/"Report" had ~7pt of drift on this file) and
         `updated_by`/`updated_date` registered as inert boundary-only
         columns so `hotel`'s range didn't run unbounded and swallow them.
      Re-verified **exact match** against the Python reference parser on
      both this file and the original fixture (no regression) after the fix.
- [x] **2026-09-27, calendar-grid format added**: new `calendar-grid-parser.js`
      + `format-detect.js` (JS port of the desktop app's
      `calendar_grid_parser.py`/`roster_format.py`). Verified **exact match**
      against `parse_calendar_grid_styled()`'s Python output on the real
      October 2026 calendar-grid PDF (31 duty days, LOPER layover pair,
      multi-fleet 738/330 sim sessions, the Oct24-stays-D/Oct25-becomes-REST
      early-start-rest edge case, computed FH/DH totals, LOPER-based
      at-base/away split) — including its own page rotation (`270°`, a third
      distinct rotation value seen across the three real fixtures so far,
      confirming the `Util.applyTransform` fix generalizes). Full render
      (PDF) visually confirmed. `app.js` now auto-detects format and
      dispatches to the correct parser; unrecognized formats get a clear
      error instead of a silent empty result.

- [x] **2026-09-27, work_type shortened for calendar-grid non-flight legs**:
      matched the Roster Report format's display convention (blank Work Type
      for training/office rows, "OP" only for flights) instead of the
      synthetic "TRAINING"/"OFFICE" strings that wrapped awkwardly in the
      narrow column. Fixed in both `calendar-grid-parser.js` and the desktop
      app's `calendar_grid_parser.py` (styled-export path only — the
      calendar-event path's `work_type`, which real classification logic
      depends on, was left untouched). Re-verified exact match + visual render.
- [x] **2026-09-27, render-pdf.js header-wrap overlap fixed**: column labels
      that wrap to 2 lines at their fixed width (e.g. "Overd Rank", "Actual
      Block Hours") were spilling into the first data row because the header
      row height was a fixed constant that didn't account for wrapping.
      `headerRowHeight()` now measures the tallest wrapped label (using the
      same bold font that's actually drawn) and sizes the row to fit.
- [x] **2026-09-27, render-png.js finally tested — real bug found and fixed**:
      installed the native `canvas` npm package (one-off, dev-only, not a
      PWA dependency) to actually exercise `page.render()` to a real Canvas
      implementation in Node, closing the gap noted below. Found the PNG
      rendered every fill/line correctly but with **all text completely
      blank** — pdf.js needs its own standard-font glyph data
      (`standardFontDataUrl`) to rasterize a non-embedded standard font
      (jsPDF's default Helvetica) to a canvas, and the PWA never vendored
      it. This would have silently produced blank-text PNGs for every user,
      not just a Node-testing artifact. Fixed: vendored pdf.js's
      `standard_fonts/` (14 files, ~800KB, same 3.11.174 version already
      vendored) into `vendor/standard_fonts/`, pointed `render-png.js`'s
      `getDocument()` call at it via `standardFontDataUrl`, and added all 14
      files to the service worker's precache list. Re-rendered and confirmed
      the PNG now matches the PDF exactly (text, fills, layout all correct).
- [x] **2026-09-27, blank source cells stay blank (not "D"/"REST" text)**:
      Oct10/Oct13 were genuinely blank in the source PDF (no code printed at
      all) — previously the app invented `item='D'` for them, then relabeled
      to `'REST'` when the early-start rule fired, so the output never
      showed blank even though that's the source's own convention for this
      case. Fixed in both `calendar_grid_parser.py` and
      `calendar-grid-parser.js`: a cell with `is_blank=True` keeps
      `item=''` unconditionally. A cell the source explicitly coded (`D`/
      `DO1`, e.g. Oct25 in the other file) still gets visibly relabeled to
      `'REST'` when the rule fires, since silently blanking a printed code
      would hide that a correction happened. `is_blank`/`dayoff_code` flags
      (not the `item` string) already drove the at-base/away count, so
      nothing else needed to change — re-verified 13/0 unchanged. Added
      `test_styled_export_blank_source_cells_stay_blank` to lock this in;
      re-verified exact match (JS vs Python) and a clean render.
- [x] **2026-09-27, pre-deployment pass**: reverted Oct10/13-style blank
      cells back to visible "REST" text (uniform with Oct25's case, per
      final decision); removed the diagnostic `console.log` block from
      `app.js` that leaked crew name/staff number/full schedule to the
      console; upgraded both vendored libraries off known-CVE versions —
      jsPDF 2.5.1→4.2.0 (drop-in, verified via direct API smoke test) and
      pdf.js 3.11.174→4.2.67 (CVE-2024-4367, CVSS 8.7). The pdf.js upgrade
      required a real architecture change since 4.x ships ES-module-only
      builds: `pdf-textextract.js`, `render-png.js`, and `app.js` (the only
      three files touching `pdfjsLib` directly) converted to
      `type="module"` with explicit `import * as pdfjsLib from
      '../vendor/pdf.min.mjs'`; everything else stays a plain classic
      script. Verified pdf.js 4.2.67's module worker spawns correctly
      (confirmed by reading its source: `new Worker(workerSrc, {type:
      "module"})` when given an `.mjs` worker) and `.mjs` serves with
      correct `text/javascript` MIME type locally. Re-ran the full
      exact-match suite (JS vs Python) on all three real fixtures — Roster
      Report, rotated CWP file, rotated calendar-grid file — all exact
      matches through the complete new pdf.js 4.2.67 + jsPDF 4.2.0 stack,
      plus a clean visual render. Also added upload validation (magic-byte
      `%PDF-` check + 20MB size cap) and confirmed zero
      Malaysia-Airlines/MAB/MAS references anywhere in the codebase (the
      one real airline coupling — hardcoded "MH" flight-prefix detection —
      is intentional, confirmed fine to keep for a same-airline crew
      audience).
      **Not yet verified (still needs a real browser)**: that
      `<script type="module" src="...">` actually loads/executes
      correctly end-to-end — jsdom (the only tool available here) does not
      execute module scripts at all, so this was validated instead via
      Node's native ES module loader directly importing the real project
      files (a faithful test of the JS logic itself, but not of the
      browser's script-tag-based module-loading mechanics). Also unverified:
      whether the actual hosting provider (Firebase Hosting/GitHub Pages)
      serves `.mjs` with a correct MIME type — only confirmed locally.
- [x] **2026-09-27, interface redesign — light/dark "friendly enterprise"
      theme + read-only review**: `styles.css` fully rewritten to a
      light/navy/pastel token system (`:root` light defaults,
      `@media (prefers-color-scheme: dark)` guarded by
      `:root:not([data-theme="light"])`, explicit `:root[data-theme="light"|
      "dark"]` overrides); `index.html` gained a fixed navy top bar with a
      theme-toggle button, numbered step badges on the 4 sections, and a
      plain-text format hint ("PDF only — Roster Report or Calendar Grid
      export"); `app.js` gained the toggle logic (localStorage override,
      else follows system, live-updates on system-preference change).
      **Real behavior change, not just a re-skin**: per explicit
      instruction, the app must be a strict pass-through of the parsed
      PDF — `editor.js`'s per-field `<input>`s and the day/month notes
      `<textarea>`s were removed entirely (was: mutated the parsed data
      object in place before export); the "Review & edit" step is now
      "Review", read-only. `layout.js`/`render-pdf.js` keep their
      `day.notes`/`month_notes` rendering code paths intact but dormant —
      nothing upstream ever sets those fields now, so they simply never
      fire (kept deliberately so the deferred "highly suggested" opt-in
      corrections feature can re-enable them later without touching the
      export layer). Verified via a Node-native-ESM-import harness (the
      jsdom `<script type="module">` limitation noted above meant
      `pdf-textextract.js`/`render-png.js` had to be loaded with Node's own
      `import()` rather than jsdom script tags) against the real Roster
      Report fixture: 28 duty days parsed correctly, crew name intact,
      **0** `<input>`/`<textarea>`/`[contenteditable]` elements anywhere in
      the rendered Review DOM, PDF exported at the expected byte size —
      full pipeline unaffected end to end. Also bumped
      `service-worker.js`'s `CACHE_NAME` to `v11` (styles/index/app/editor
      all changed — returning offline users need the new cache generation)
      and confirmed all 34 precache entries still exist on disk.
      **Not yet verified (still needs a real browser)**: the actual visual
      appearance in both themes, the auto/override toggle behaved as
      intended when clicked, and a full keyboard-only tab pass — none of
      that renders or receives clicks under jsdom/Node.

## Verified in a real browser (2026-09-27)

Actually opened the app in real Google Chrome (via `playwright-core`
driving the system-installed Chrome binary — a genuine browser engine, not
jsdom) against the local `python3 -m http.server 8642`, since this
environment has no interactive display to look at a browser directly.
- [x] Full upload → parse → Review (read-only) → export flow works
      end-to-end through the real UI, not just the underlying functions:
      uploaded the real fixture, got "Parsed 28 days for AHMAD BIN TESTING,
      August 2026.", heading reads "Review", **0**
      `<input>`/`<textarea>`/`[contenteditable]` anywhere inside `#editor`,
      clicked "Download PDF" and a real 47KB one-page PDF download fired
      and saved correctly.
- [x] Console: zero `console.error`/`pageerror` events through the whole
      flow — confirms the three `type="module"` script tags
      (`pdf-textextract.js`, `render-png.js`, `app.js`) genuinely load and
      execute in a real browser (jsdom cannot exercise this at all).
- [x] Theme: system dark → resolves to dark automatically; clicking the
      toggle overrides to light (persisted in `localStorage`); override
      survives a full page reload even though the OS preference is still
      dark. Visual screenshots confirm both palettes render as designed
      (navy top bar, pastel warning box, rounded cards, correct icon swap).
- [x] Keyboard-only pass caught and fixed a real accessibility bug: the
      file `<input>` was `display: none`, which drops an element from the
      tab order entirely — the upload control was unreachable without a
      mouse. Fixed by switching to a visually-hidden-but-focusable pattern
      (absolutely positioned, clipped to 1px, not `display:none`) plus a
      `.file-label:focus-within` outline so the whole drop-zone shows focus.
      Re-verified: Tab now reaches the file input with a visible 2px
      outline. Also found and fixed a cosmetic `/favicon.ico` 404 (browsers
      request it automatically; added a plain `<link rel="icon">` pointing
      at the existing app icon).
- [x] Service worker cache bumped again to `v12` for these two follow-up
      fixes.

## Verified against the real live deployment (2026-09-30)

Deployed to Firebase Hosting (`https://roster-export-pwa.web.app`, project
`roster-export-pwa`) and re-ran the real-Chrome checks against the actual
live URL instead of `localhost` — this unblocked every item that was
previously marked "needs a real device":

- [x] `vendor/pdf.min.mjs` and `vendor/pdf.worker.min.mjs` serve as
      `Content-Type: text/javascript` over real Firebase Hosting (`curl -I`
      against the live URL); `service-worker.js` correctly gets
      `Cache-Control: no-cache` while `.js`/`.mjs`/`.css` get a one-year
      `max-age` (the custom `firebase.json` header rules); `tests/**` is
      correctly excluded from the live deploy (404 on
      `manual-parity-checklist.md`).
- [x] Manifest linked, service worker registers — confirmed via
      `navigator.serviceWorker.getRegistrations()` in a real page.
- [x] **Real bug found and fixed via this deployment test** (would not have
      surfaced on `localhost`, where the fix's absence never mattered): the
      `controllerchange` listener in `app.js` reloaded the page
      unconditionally, including on the very first-ever visit's
      install→activate→claim sequence — not just on a genuine version
      update for an already-controlled page. On `localhost`'s near-zero
      latency this claim always completed before a test script got around
      to uploading a file, masking the bug; on the real live URL's higher
      latency, uploading a file shortly after first load raced the SW's
      first claim, and the resulting auto-reload silently discarded the
      in-progress upload (parse never completed, status stayed blank,
      confirmed by inspecting worker lifecycle: the pdf.js worker was
      created, then immediately closed by the reload). Fixed by only
      reloading when the page **already had** a controller before this
      registration (`hadController = !!navigator.serviceWorker.controller`
      captured before `.register()`) — a first-ever claim now completes
      silently with nothing to lose, and only a real "newer worker took
      over from an older one" transition reloads. Redeployed
      (`js/version.js` → `v18`) and re-verified clean.
- [x] Full offline cycle against the real deployment: went offline after
      the SW's first activation settled, reloaded — shell loaded from
      cache, a complete upload→parse→export cycle succeeded with zero
      network requests, zero console errors, same correct output
      (`CAPT AHMAD BIN TESTING August 2026.pdf`) as the online path.
- [x] **2026-09-30, xlsx "Rest Day" feature**: two real xlsx exports were
      each missing different calendar days entirely from the source (the
      roster system doesn't export a rest day when the next day's duty
      starts before 08:00 LT). `xlsx-roster-parser.js` used to hard-reject
      the whole file on any such gap; now every missing date is filled in
      unconditionally as `item: 'REST DAY'`, tracked in its own
      `header_totals.rest_days` stat (excluded from `at_base`/`away`), with
      a `legend['REST DAY']` explanation rendered in the exported
      Code/Description table. Along the way found and fixed a real latent
      date-collision bug: a `'D'`/`'DO1'` day-off's own raw timestamp can
      land on the same calendar day as an already-recorded duty (the
      day-off's timestamp is when rest *starts*, i.e. that evening), which
      was silently invisible before this change since the old hard-reject
      always aborted parsing before reaching the affected rows. Re-verified
      exact-match on both real fixtures (`rest_days: 3` each, correct
      dates). Also added an explicit "Export in Local Time (LT)" UI
      callout (`index.html`/`styles.css`) since a UTC-exported roster can
      silently shift or drop dates the same way.
- [x] **2026-09-30, calendar-grid PDF with content-level rotation**: a real
      "fridge view" calendar-grid PDF (`page.rotate === 0`, but every glyph
      individually drawn with a baked-in 270° rotation in its own text
      matrix — a fundamentally different mechanism from a page-level
      `/Rotate` flag) failed format detection entirely (`"unknown"`).
      Fixed in `pdf-textextract.js`: `detectContentRotation()` samples each
      text item's own transform (`atan2(b,a)`) and, when a dominant
      non-zero rotation is found across enough samples, overrides
      `page.getViewport({rotation})` with it — same mechanism already
      proven for real page-level rotation, just detected from content
      instead of the page dictionary. Fixing extraction exposed two further
      real bugs in `calendar-grid-parser.js`, both latent because the
      original calendar-grid fixture this parser was built against never
      triggered them:
      1. `parseHeader()` matched `MONTH_YEAR_RE`/`CREW_LINE_RE` against each
         raw text item individually, assuming pdf.js always hands back
         "October 2026" and the crew-info line as one combined string. This
         file draws them as several separate per-word items on the same
         line instead. Fixed by matching against each physical line's
         *joined* text (via the already-existing `groupIntoPhysicalLines`)
         instead of raw items — the same technique `detectGridColumns()`
         and `buildCellsForColumn()` already used, so this is
         backward-compatible by construction.
      2. Per-glyph column assignment (`nearestColumn` applied to each raw
         item independently) misassigned the tail of long flight lines
         (e.g. "MH 125 KUL 08:55 - PER 14:50") to the next day's column
         once their x-position drifted past the inter-column midpoint —
         this file's day-cells are narrow enough that a full flight line's
         text visually overflows into the neighboring cell. Fixed by
         `assignItemsToColumns()`: walk each physical row left-to-right and
         only allow a token to start a new column once the column built so
         far already forms a *complete* recognized cell fragment (a whole
         activity, REPORT/DEBRIEF/layover line, date cell, or day-off code)
         — an in-progress pattern keeps pulling in tokens regardless of
         their own nearest-column, since a real cell boundary never falls
         mid-pattern. Verified all 31 October days parse with complete,
         correct flight/leg data; full render visually confirmed via
         `qlmanage` thumbnail. Regression-tested against the committed
         Roster Report fixture (`roster_report_aug2026.pdf`, format
         detection + parse unchanged) and both xlsx fixtures (untouched,
         as expected — different code path).
- [x] **2026-09-30, auto-detect UTC vs LT Roster Report exports**: given
      two real PDFs of the same October roster (`OCT LT.pdf`/`OCT UTC.pdf`)
      shifted by exactly 8h (KUL's UTC offset) with **no explicit
      "UTC"/"LT" label anywhere in either file's text or metadata**, the
      app previously had no way to tell them apart and silently treated
      every upload as LT. Ported the sibling desktop app's verified
      `AIRPORT_TIMEZONES` IATA->offset table into a new
      `js/airport-timezones.js` (same values, not re-derived). Detection
      reuses two fixed-time sentinels this roster system's own convention
      guarantees: a day-off's Report time is always `00:00` LT, and an
      `OFF01` ground-duty's Dep time is always `08:30` LT — a consistent
      8h deviation from either means the file is raw UTC. Both signals had
      to be captured *during* row parsing in `styled-roster-parser.js` /
      `xlsx-roster-parser.js` (stashed as a `_rawReport` field, deleted
      before the parser returns) since the existing day-off code path
      already discarded that exact cell before this change. Conversion
      (`convertDutyDayToLT`, shared via `styledRosterParser`'s exported
      helpers) shifts every absolute time — Report, each leg's own Dep/Arr,
      Debrief — by *that time's own station's* offset (confirmed via Shaz:
      Dep/Arr are each station's true local time, not a single home-base
      reference), independently re-deriving each cell's day-rollover
      annotation and the day's own corrected calendar date; duty/flight
      hour durations are left untouched (already elapsed-time invariant —
      confirmed both sample PDFs print the identical `FH:47:45|DH:140:35`
      totals). **Gold test**: converting `OCT UTC.pdf` produces
      `duty_days` an exact match against `OCT LT.pdf`'s own. The exported
      document's Monthly Statistics now shows a "Times Shown In" row
      ("Local Time (LT)" or "UTC (converted to LT)"). Regression-tested
      against the committed Roster Report fixture (still detects `LT`,
      unchanged) and the calendar-grid format (untouched, different code
      path). **Real bug found along the way**: one of last session's two
      xlsx Rest-Day fixtures (`cwpCrewRosterReport1790644498711.xlsx`) is
      itself a genuine raw-UTC export (unambiguous `16:00`/`00:30`
      sentinels) that was silently mis-dated by the Rest Day feature the
      whole time it shipped — now auto-detected and correctly converted.

## Needs a real phone (not available in this environment)

- [ ] Install to home screen on iOS and Android — confirm icon/name/theme,
      standalone launch (no browser chrome).
- [ ] Airplane mode after install — confirm a full convert cycle works with
      the real fixture (or a real roster PDF) with zero connectivity.
- [ ] Confirm the downloaded PDF/PNG actually save/share correctly from
      each platform's download UI.
