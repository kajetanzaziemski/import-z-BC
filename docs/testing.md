# Testing the Grid layer and ConfigGrid

Three levels. Only level 3 touches a real spreadsheet; levels 1–2 run offline in a second (`node tests/run.js`, Node ≥ 18, no dependencies).

## 1. Grid unit tests (`tests/run.js`, 77 tests)
`tests/sim.js` is an in-memory spreadsheet that answers BOTH the Sheets API (`spreadsheets.get/batchUpdate`) and the Spreadsheet service on one store.
Each scenario runs through both commit paths (`[api]`, `[service]`), and "parity" scenarios assert that the two paths leave identical sheets.
The sim throws on any request or method it does not know, so `Grid.js` cannot start using a new call unnoticed.
Architecture rules are tests too (no project words in `Grid.js`, nothing used at load time, only `SpreadsheetApp`/`Sheets`/`Utilities`).

## 2. Golden tests of ConfigGrid (`tests/config-grid.test.js`, 33 tests)
- `tests/golden/legacy-config-header.js` is a **frozen copy of the pre-Grid code** (`setupConfigHeader`, the four `switch*` methods, `setTotRowsInfo`).
- The test runs it on the simulated Spreadsheet service and requires `ConfigGrid` (through the API path AND the service path) to leave the same sheet:
  cells, notes, formats (weight, size, colour, background, alignment, wrap, number format), merges, validation, size.
- The status switches are compared **after every step** of a whole refresh sequence, both on `ConfigGrid` and through the real `Sheet Coeditor.js`
  (loaded as Apps Script loads it; only the query model, `CCTImportConfig`, is stubbed).
- `tests/golden/config-header.snapshot.json` stores the legacy result as a file; if the header is changed on purpose:
  `UPDATE_GOLDEN=1 node tests/run.js` and review the diff of the JSON.
- Also asserted: one `batchUpdate` per switch / per sheet creation (the old code made ~40 calls for a new sheet), the status handle reads only rows 1–6,
  a concurrent edit of another header cell between two switches survives, a missing sheet gives `null` / a clear error.
- Mutation check done by hand: changing a colour, a merge, the number format, a note, the wired cell or the alignment mapping makes tests fail.

What levels 1–2 can NOT tell: whether Google Sheets itself renders/accepts exactly this. Specific doubts:
the `'general-left'` / `'general-right'` alignments (Grid now writes them as "not set"), colour strings like `#ff000000`, number format type inferred from the pattern.

## 2b. State-layer tests (`tests/state.test.js`, `tests/platform-fakes.js`)
Fake `PropertiesService` / `CacheService` / `LockService` (cache lifetimes with a fake clock, a lock that can be busy or free up while waiting, services that can be
switched to "missing" or "throwing") and a loader that puts the **real project files** into a **fresh global scope per execution**, like a new Apps Script run.
Executions can share one fake platform, which models concurrent or consecutive runs (the CLAUDE.md storage rule is tested that way). Part 1 pins the behaviour of the old
names; part 2 tests `Store` / `Settings` and the moved callers. Mutation check: 13 deliberate breakages of the new code, all caught. See `docs/state.md`.

## 2c. The live check helpers as the judge (merged from `live-test-helpers`)
`Live Check*.js` (+ `docs/live-check.md`, `docs/bugs-todo.md`) come from the branch `live-test-helpers`. They were written against the add-on **as it was before
the refactor** and verify each entry point's outcome in a real spreadsheet. The arrangement on this branch:
- **The refactor must satisfy the helpers, not the other way round.** The helper files are pinned by hash (`tests/golden/live-check.sha256.json`); a changed
  verifier fails `node tests/run.js` unless it is re-pinned on purpose (`UPDATE_GOLDEN=1`, only together with an intended change of behaviour).
- **They read stored data directly** (`PropertiesService` / `CacheService`, literal keys `importSettingsArray`, `docTriggerArray`, `usrTriggerArray`, `agentArray`, cache keys), not through
  `Store` / `Settings`, so they also prove that the refactor kept keys and JSON. The architecture rules about `Store` / `Settings` exempt `Live Check*.js` for that reason.
- Offline (`tests/live-check.test.js`): every action name the code passes to `Controller.run` / `Controller.checked` has a verifier and no verifier is orphaned (a renamed
  entry point shows up here); with the helpers loaded and switched off the whole state suite gives the same results; switched on, a check never throws into the run;
  the verifiers' own copy of the config sheet layout (`LC_CONFIG_HEADER`, idle colours) agrees with what `ConfigGrid` produces.
- In a real spreadsheet: `liveCheckEnable()`, then use the add-on (menu, edits, triggers) and read the sidebar (add-on menu -> Narzędzia programisty -> Live check) or
  `liveCheckReport(20, true)`. **Known findings in the old code show as `FAIL` / `WARN`** (see `docs/bugs-todo.md`: settings writes lost in `sheetEdit`, nested `Controller.run`,
  offline `ConnectionError`); the refactor keeps them on purpose - a finding that disappears or a new `FAIL` is a behaviour change to look at.
  Run the same checks on a copy of the old script (branch `live-test-helpers`) and on this branch, and compare the two reports.

## 2d. Use-case tests (`tests/refresh.test.js`)
The extracted workflows (`RefreshSheet`, `EstimateSheet`, `ResultSheet`, `ImportQuery`) run with the real `Menu.js` on the simulated spreadsheet; the config reader, the BC connection,
the metadata and the settings sheet are faked and record their calls, so the tests pin the order of the status-cell switches, the error paths and what is written to the result sheet.
Written against the old code first. See `docs/use-cases.md`.

## 3. Real-spreadsheet check (do before anything is pushed to the live add-on)
Production runs the **Spreadsheet-service path** (the Sheets advanced service is not enabled in `appsscript.json`), so that is the path to check.
1. Push to a **copy** of the script (a second Apps Script project / test spreadsheet, not the Marketplace one): `clasp push` there (`.claspignore` keeps `tests/` out).
2. Open a spreadsheet that has a config sheet made by the OLD add-on version (e.g. "Konfiguracja 1"; do not edit it).
3. Script editor → run `testConfigGridHeaderMatchesReference("Konfiguracja 1")`. It creates a sheet with `ConfigGrid`, compares A1:G4 (values, weights, backgrounds,
   sizes, horizontal/vertical alignments, wraps, notes, font colours, merges) with the reference and logs every difference, then deletes its sheet.
   Expected: "header matches". (F2, the estimated number of rows, is ignored: a used sheet has a number there.) First real run (Konfiguracja 7): only the empty columns A and G differed in the horizontal alignments (`general-left` in the reference, `general` from ConfigGrid) – the old code wrote the string `general`, which Sheets keeps as an explicit alignment; the service path now passes the same strings on. Re-run to confirm.
4. Run `testConfigGridStatusSwitches("Konfiguracja 1")` and watch row 2: B2 green, C2 red, E2:F2 black with 1,234,567, D2 red, then all grey. Check the colours
   change live (the code flushes after each switch) and the sheet is not slowed down noticeably.
5. In the add-on: add a new import sheet (wizard) → compare with an old one by eye; edit a query line (status B2 flashes green); run "Odśwież" on a small query
   (C2 red while fetching, F2 shows the estimated rows, D2 red while writing).
6. Optional: enable the Sheets advanced service in the test copy to exercise the API path; this adds an OAuth scope, so do it only for the test project.
Record the result (date, spreadsheet, path, pass/fail) in the PR / commit message; nothing in the repo claims real-spreadsheet verification.

## Adding the next adapter (SettingsGrid, ...)
1. Freeze the old code in `tests/golden/legacy-*.js`. 2. Write the adapter on Grid. 3. Golden test: legacy vs adapter through both paths, step by step.
4. Move the callers; keep the old public methods as one-line forwarders. 5. Add a manual `test…` function for the real-sheet check.
