# Architecture proposal: import-z-BC on top of the Grid layer

Status: proposal, nothing refactored yet. Branch `refactor-and-grid`.

## 1. What was copied

From `kajetanzaziemski/wyceny` @ `e042de5`:

| Here | From | Note |
|---|---|---|
| `Grid.js` | `grid.js` | Header line added, code unchanged. `Grid` + `GridRange`, no project words. |
| `Grid Util.js` | `util.js` | Grid needs `colLetters_`, `rectA1_`, `parseA1_` only. |
| `docs/grid/wyceny-grid-reference.md` | `docs/reference/01-grid-and-report.md` | Reference of Grid (section 4) and of the wyceny adapters (5-6, for orientation only). |

Not copied: `reportGrid.js`, `priceRow.js` (wyceny adapters), `tests/sim.js` (in-memory Sheets, needed once we test, see 6).

## 2. What Grid is, and what it is not

Grid = ONE read of the top rows of ONE sheet into memory (values, formulas, merges), edit it through a Sheet-like API,
ONE `batchUpdate` on `commit()` (Spreadsheet-service fallback if the Sheets advanced service is off).

Fits import-z-BC's **small, structured sheets**: the config sheet (`SheetCoeditor`: header block + query rows, inserted
rows, notes, validations, status cells) and the settings sheet (`SettingsSheet`: a 4-column table).

Does **not** fit as is:
1. **The result sheet.** `refreshAllDataForConfigSheet` writes the whole OData table (can be 10^5 rows) with
   `getDataRange().clear()` + per-column `setNumberFormat` + one `setValues`. Grid's window is capped at
   `MODEL_MAX_ROWS = 3000` and is the top of the sheet.
2. **Missing operations**, used today by `SheetCoeditor` / `SettingsSheet`: `setNumberFormat`, font weight / size / colour,
   vertical alignment, wrap, `setDataValidation(s)` (lists; Grid only has checkboxes), `insertSheet`, `clear`.
3. **Anchor row / reset-from-template** are wyceny ideas; import-z-BC needs neither (config sheet is created from code).

## 3. Proposed layers (a layer calls only layers below it)

```
 L4  ENTRY POINTS     Quick Start.js (onOpen/onEdit/onChange), Menu.js, sidebars, trigger handlers
 L3  USE CASES        RefreshSheet, EstimateSheet, InsertImportWizard, ValidateConfigSheet, AutoRefresh   (new, extracted from Menu.js / Settings Sheet.js)
 L2  SERVICES         ConfigSheet (was SheetCoeditor+CoedContentTracker), SettingsSheetModel, ResultWriter,
                      StatusManager, TriggerManager/AgentManager/StorageObject (unchanged, no sheet access)
     DATA SOURCES     ODataConnection, ODataQuery, BCMetadata, DataType
 L1  SHEET ADAPTERS   ConfigGrid, SettingsGrid (project adapters, own the layout: row/col positions, names)
                      BulkSheet (new, for result data)       ->  Grid / GridRange (generic)
 L0  PLATFORM         SpreadsheetApp, Sheets API, PropertiesService, LockService, ScriptApp, UrlFetchApp
 side: Util (Grid Util.js), dbgLog, custom errors
```

Rule of the pattern (as in wyceny): a use case opens the grid once, services work on it in memory, the use case commits once.
Services never open or commit a grid.

### 3.1 ConfigGrid (L1 adapter) + ConfigSheet (L2 service)
- `ConfigGrid.open(sheetName)` -> `Grid.open({ sheetName, anchor: () => CONFIG_FIRST_ROW })`, returns `null` if absent;
  `ConfigGrid.create(sheetName)` builds the header block (what `setupConfigHeader` does with 7 `setX` calls) as grid operations.
- The only place that knows `startRow = 6`, `startCol = 2`, the 4-row header, status cells (`switchReadingControl`,
  `switchDataWritingControl`, estimated row count).
- `ConfigSheet` (parsing of rows into `CoedOption` objects, `insertRows`, validations, notes) takes a grid, not a `Sheet`.
  `CoedContentTracker.insertRows` (computed rows to add) maps directly to `grid.insertRowsAfter` + `setValues`;
  today's N separate `getRange().setValues()` calls become one commit.

### 3.2 SettingsGrid / SettingsSheetModel
- `SettingsSheet` is a 4-column table; read it once into the grid, derive `refreshFrequency`, `lastRefresh`, rows of
  `configSheet | result | refresh | auto`, write changed cells, commit.
- Concurrency (CLAUDE.md): document properties via `StorageObject.saveArray` stay separate; Grid does not touch them.
  A grid commit must run inside the existing document lock when called from triggers (`withDocumentLock`), because
  Grid overwrites the cells it marked dirty, not the whole window (only `dirty` cells are written, see reference 4.6).

### 3.3 BulkSheet (new L1 adapter, NOT Grid)
Same ethos (one read / one write, no project words) for tall data:
- `BulkSheet.writeTable(sheetName, table, { columnFormats })`: ensure sheet, one `batchUpdate` (clear + number formats per
  column via `repeatCell` + `updateCells`/`pasteData`) when the Sheets API is available, chunked `setValues` otherwise
  (6M-cell and 50 MB request limits).
- Replaces the inline block in `refreshAllDataForConfigSheet`.
- Kept separate so `Grid`'s window invariants (rows <= 3000, anchor) stay intact.

### 3.4 What stays as it is
OAuth/BC/OData classes, `Trigger Manager.js`, `Status Manager.js`, `Track onEdit Triggers.js`, `Helper Data Store.js`:
no or minimal sheet access, already layered by concern. They move only by being called from use cases instead of `Menu.js`.

## 4. Grid gaps to close (in `Grid.js`, keep it generic)
Add to `GridRange`/`Grid`, each queued and flushed in `commit()` like `setBackground`/`setBorder` today:
`setNumberFormat(s)`, `setFontWeight/Size/Color`, `setVerticalAlignment`, `setWrapStrategy`, `setDataValidation`
(list / custom), `clear`. Optionally `Grid.create(sheetName, rows, cols)` that adds the sheet (`insertSheet`) at commit.
Alternative: collapse the formatting calls into `formatRow`-style `spec` objects (already there for rows/cells).

## 5. Migration plan (each step shippable and behaviour-preserving; the add-on is live)
1. Done here: Grid + helpers + docs copied, not wired in.
2. Add a Node test harness for Grid (port `tests/sim.js` from wyceny) and golden-test current `SheetCoeditor` output
   (header block incl. formats) so the refactor can be compared.
3. Extend Grid (section 4).
4. Introduce `ConfigGrid`; make `SheetCoeditor.setupConfigHeader` and status switches use it. First real use of Grid,
   smallest blast radius (new-sheet creation).
5. Move config reading/writing (`loadFromSheet`, `insertRows`, `setDataValidationsToSheet`) onto the grid.
6. `SettingsGrid`.
7. `BulkSheet` + extract `RefreshSheet` use case from `Menu.js`.
8. Add architecture-rule tests (as wyceny `tests/run.js` 1-8): only adapters build a Grid, services never commit, `Grid.js` has no
   project words.

## 6. Risks / open questions
- **Sheets advanced service**: Grid uses the fast path only if enabled in `appsscript.json` (`enabledAdvancedServices`),
  which adds the `spreadsheets` scope -> re-verification of the private Marketplace listing may be needed. Without it, Grid
  falls back to the Spreadsheet service (still works, fewer batching gains). Decision needed: enable it or not.
- **Edit events**: `onEdit`/`onChange` handlers read `e.range` from the live sheet; those stay on the platform (read-only
  by nature), like wyceny's `Selection`.
- **Concurrent executions**: commit after other trigger runs wrote the sheet -> Grid writes only dirty cells, but structural ops
  (`insertRowsAfter`) are positional; hold the document lock around open->commit for use cases that insert rows.
- **Testing**: all wyceny verification is against a simulation, not a real spreadsheet; same caveat here.
