# Reference 01 - Config, Util, Grid, ReportGrid, PriceRow, SidebarState

Files: `config.js`, `util.js`, `grid.js`, `reportGrid.js`, `priceRow.js`, `sidebarState.js`.

All code is Apps Script (no modules): every file defines globals (`const X`, `function f_`) and the files load in any order, so
nothing here may call another file at load time.

## 1. Layer overview and dependencies

| File | Layer | May call / depend on |
|---|---|---|
| `config.js` | Shared | nothing (constants only) |
| `util.js` | Shared | nothing (pure functions; no spreadsheet access) |
| `grid.js` | L1 Grid | `util.js` (`parseA1_`, `rectA1_`); platform: `Sheets` advanced service (if enabled), `SpreadsheetApp`. **No project words** (rule 2 in ARCHITECTURE.md). Does not read `config.js`. |
| `reportGrid.js` | Report adapter | `Grid`, `PriceRow`, `ResetReport.run` (`resetReport.js`), `TechnicalSheet.touch` (`technicalSheet.js`), `PRICING_SHEET`, `RESET_SHEET` |
| `priceRow.js` | Report adapter | `config.js` (`PRICE_ROW_KEY`, `PRICE_ROW_MARK`, `DEFAULT_PRICE_ROW`, `MIN_PRICE_ROW`, `PRICING_SHEET`, `RESET_SHEET`), `TechnicalSheet.touch`, `PropertiesService`, `SpreadsheetApp`, `Logger` |
| `sidebarState.js` | Shared state | `config.js` (`HEADERS_VERSION_KEY`, `PRICE_ROW_KEY`), `PriceRow.clamp`, `PropertiesService`, `Logger` |

Rules:

- Only `reportGrid.js` calls `Grid.open` / `new Grid` (production code); everyone else asks `ReportGrid`.
- Services never commit; use cases own open/commit.
- Note the cycle `ReportGrid.commit -> TechnicalSheet.touch -> SidebarState.bump` and `PriceRow.sync -> TechnicalSheet.touch`
  (allowed because calls are made at run time only).

---

## 2. config.js (constants grouped by purpose)

Nothing is a function. Changing a header text of the workbook = change it here.

### 2.1 Sheet names
| Constant | Value | Meaning |
|---|---|---|
| `DEFS_SHEET` | `'Gotowe wyceny'` | Sheet with ready pricing definitions. |
| `PARTITIONS_SHEET` | `'Struktury kosztów'` | Sheet with cost structures (partitions). |
| `RESET_SHEET` | `'Szablon'` | Template the report is reset from ("Zacznij od nowa"); also may carry its own price-row marker. |
| `PRICING_SHEET` | `'Wycena'` | The report sheet. |
| `ASSORT_SHEET` | `'Gotowe asortymenty'` | Source sheet of assortments (batch load). |
| `TECH_SHEET` | `'Wycena - arkusz techniczny'` | Technical (dump) sheet. |
| `TECH_DUMP_SHEET` | `= TECH_SHEET` | Alias: the technical sheet is one dump table owning the whole sheet. |

### 2.2 Header area geometry and names
| Constant | Value | Meaning |
|---|---|---|
| `GROUP_HEADER` | `'Składowe kosztu zmiennego'` | Row-2 group header over the cost elements. |
| `GROUP_ROW` | `2` | Row of the common (row-2) header. |
| `FIRST_HEADER_ROW` | `3` | First row of the multi-level element header. |
| `GROUP_HEADER_IS_PARENT` | `true` | The first division of an element alone under its own row-2 group header adds no parent row (the group header is the parent). `false` = always add one. |
| `LINE_HEADER` | `'Lp.'` | Standalone row-2 header; a non-empty cell under it starts a price line. |
| `ANALYZE_HEADER` | `'Analizuj'` | Standalone row-2 header of the checkbox column; the last header row holds a "select all" checkbox. |
| `INDEX_HEADER` | `'Indeks Asortymentu'` | Standalone row-2 header where the loaded assortment key goes. |
| `INDEX_INSERT_AFTER_COL` | `2` | If the sheet has no index header, a column is inserted after column B. |
| `TIME_HEADER` | `'Czas produkcji 1 szt. (s)'` | Leaf header (margin group) that the loader fills; one end of the time/performance binding. |
| `PERFORMANCE_HEADER`, `TIME_TEMPLATE` | `'Wydajność produkcji z 1 linii (szt./h)'`, `'Czas z asortymentu'` | The other end of the time binding; the pricing template of both headers. |
| `TIME_SOURCE_HEADER` | `'Czas produkcji na jednej linii (s)'` | Header of the production-time column in the source sheet (section row or header row). |
| `PCS_HEADER` | `'Liczba szt. na pal.'` | Header of the pieces-per-pallet column (same text in the source sheet and the report). |
| `MASS_HEADER` | `'Masa produktu (kg)'` | Row-2 header of the product mass column. |
| `TRANSPORT_HEADER` | `'Koszt transportu'` | Built-in element outside the group. |
| `NET_PRICE_HEADER` | `'Cena netto'` | Built-in element outside the group. |
| `ANNUAL_COST_HEADERS` | `['Łączny koszt produkcji (roczny)','Koszt sprzedaży (roczny)']` | Built-in elements (row-3 headers under the row-2 group "Parametry do wyliczenia marży 3-go stopnia"), priced by the annual-cost cascade; their price cell is not copied into a new line. |
| `ANNUAL_COST_SOURCES` | element -> sheet (`'Marszruty'`, `'Kanały sprzedaży'`) | Where each annual-cost cascade is read from; `ANNUAL_COST_HEADERS` is its keys. |
| `ANNUAL_COST_TEMPLATE` | `'Koszty roczne'` | Template of those elements. |
| `GROUP_ROW_COMPACT_PX` | `21` | Height of row 2 after the first division of the "Składowe kosztu zmiennego" group (see `Headers.finish`). |
| `ANNUAL_COST_PARAMS_TEMPLATE` | `'Koszty roczne z parametrami'` | Template of the elements that have `ANNUAL_COST_PARAMS`: the annual-cost cascade plus the switch "fill all the fields / only this one". |
| `ANNUAL_COST_PARAMS` | element -> `[{ param, header }]` | Cascade parameters copied to other headers; those headers show the element's panel, and their price cells are not copied into a new line. |
| `BINDING_AUTO_COLOR` | `'#fffbe6'` | Background (light yellow) of the calculated cell of a binding. |
| `BINDING_AUTO_COLORS_OLD` | `['#fff2cc']` | Earlier calculated-cell colours: still recognised as "calculated" (and replaced when the cell is touched). |
| `TARGET_MARGIN_HEADER`, `VARIABLE_COST_HEADER` | `'Docelowa marża 1 st.'`, `'Koszt zmienny z transportem'` | The net price <-> margin binding: margin = 1 - variable cost / net price. |
| `COLUMN_BINDINGS` | `[{ a, b, with?, forward, inverse }]` | Two-way bindings between two columns, by header name (see `Bindings`). `forward` / `inverse` are formula texts with `{x}` for the source cell: `B = forward(A)`, `A = inverse(B)`. `with: { k: header }` makes `{k}` that header's cell on the same line (the pair is skipped when it is missing). Now: "Czas produkcji 1 szt. (s)" <-> "Wydajność produkcji z 1 linii (szt./h)" (both `3600/{x}`) and "Cena netto" <-> "Docelowa marża 1 st." (`1-{k}/{x}` / `{k}/(1-{x})`, k = "Koszt zmienny z transportem"). |
| `ANNUAL_COST_SOURCE_COLUMNS` | element -> `'Marszruta produkcyjna'` / `'Kanał sprzedaży'` | Columns of the source sheet ("Gotowe asortymenty") that choose the cascade row of an annual-cost element when an assortment is loaded. |
| `CASCADE_SECTION`, `PARAMS_SECTION` | `'Kaskada'`, `'Parametry'` | Row-1 section headers of the source sheets. |
| `COST_GROUPS_SHEET`, `COST_GROUPS_KEYS`, `COST_GROUPS_VALUES` | `'Grupy kosztów'`, `'C:C'`, `'D:D'` | Where the cascade values are priced. |
| `NOTE_ROWS` | `3` | Rows under a price row that belong to it (comment, label, number). |

### 2.3 Element names and ordering (assortment placement)
| Constant | Value | Meaning |
|---|---|---|
| `PRODUCT_ELEMENT` | `'Produkt'` | Becomes a header over the components when they are loaded. |
| `COMPONENT_NAME` | `'Komponent'` | Auto-numbered `Komponent #1, #2...`. |
| `UNIT_PACKAGING` | `'Opakowanie jednostkowe'` | |
| `BAG_ELEMENT` | `'Worek'` | Belongs under unit packaging. |
| `TOP_ORDER` | `['Produkt','Opakowanie jednostkowe','Opakowanie zbiorcze']` | Left-to-right order of top-level headers inserted next to each other. |
| `SUB_ORDER` | `['Wiadro','Pokrywka']` | Order of sub-headers under unit packaging. |
| `ASSORT_PARENT_ELEMENT` | `'Koszt zmienny'` | Template's empty leaf under the group; used for the first new top-level header. |
| `ASSORT_LAYOUTS` | object | Source-sheet "Podział" value -> layout tree. String = leaf element; `{group, parts}` = header over its parts (nested). Keys: `'Worek'`, `'Wiadro'`. "Inny" intentionally absent (does nothing). |

### 2.4 Notes under a price row (look and comment rules)
| Constant | Value | Meaning |
|---|---|---|
| `NOTE_COLOR` | `'#aaaaaa'` | Font colour of note rows. |
| `NOTE_FONT_SIZE` | `8` | Default note font size. |
| `NOTE_FONT_SIZES` | `{ 2: 7 }` | Per-offset override (offset 2 = label row). |
| `NOTE_NUMBER_FORMAT` | `'[=0]0;[<0.00001]0.00E+00;0.00000'` | Number-row format. |
| `COLLAPSED_ELEMENT_NAME` | `''` | Element name left after collapsing; `''` = the group header text. |
| `COMMENT_SEPARATOR` | `', '` | Joins comments. |
| `COMMENT_MAX_LEN` | `30` | A joined comment longer than this goes into a cell note. |
| `COMMENT_PLACEHOLDER` | `'Wiele składników'` | The cell text in that case. |
| `KOMPONENT_LABEL` | `'Zawartość na 1 kg:'` | Label row of "Komponent" pricing. |
| `TRANSPORT_NOTE` | `'Na podstawie pełnej palety'` | Comment of transport pricing. |
| `TRANSPORT_LABEL` | `'Transport palety (zł):'` | Label of transport pricing. |

(`[[NUM]]`, `[[MASS]]`, `[[PCS]]` placeholders mentioned in config comments are replaced by `PriceElement.write`.)

### 2.5 Keys, caches, technical sheet, price row
| Constant | Value | Meaning |
|---|---|---|
| `WINDOW_CACHE_SECONDS` | `6*3600` | Cache lifetime of the raw element window (selection). |
| `HEADERS_VERSION_KEY` | `'headersVersion'` | Document property: sidebar version stamp. |
| `TECH_TOKEN_MIN` | `1e14` | Token `$A$1` = `Date.now()*100 + priceRow`; a plain old `Date.now()` is below this and means "unknown price row". |
| `DUMP_LINES_KEY` | `'dumpLines'` | Document property: price rows the dump was last written for. |
| `TECH_DUMP_COLUMNS` | `['Cena netto','Koszt transportu']` | Columns copied into the dump. |
| `CASCADE_TEMPLATE` | `'Kaskadowy'` | Name of the cascade pricing template. |
| `PRICE_ROW_KEY` | `'priceRow'` | Document property: last known price row. |
| `PRICE_ROW_MARK` | `'wycenyPriceRow'` | Developer-metadata key on the price row. |
| `DEFAULT_PRICE_ROW` | `4` | Template: row 2 group header, row 3 elements, row 4 prices. |
| `MIN_PRICE_ROW` | `4` | `GROUP_ROW + 2` (hard-coded, not computed). |

---

## 3. util.js (pure helpers)

### `colLetters_(n)`

**Purpose:** Converts a 1-based column number into its spreadsheet letters (1 is `A`, 27 is `AA`).

**Accepts:**
- `n` — number, 1-based column number

**Returns:** string of letters.

**On bad data:** `n <= 0`, `NaN` or a non-number gives `''`; it never throws.

### `rectA1_(m)`

**Purpose:** Builds the A1 text of a rectangle: a single cell such as `"B3"` or a range such as `"B3:D4"`.

**Accepts:**
- `m` — object `{r1, c1, r2, c2}` (1-based)

**Returns:** string.

**On bad data:** `m` null or undefined throws TypeError; missing fields give strings containing `undefined` or `NaN`.

### `parseA1_(a1)`

**Purpose:** The inverse of `rectA1_`: turns an A1 reference into a rectangle object.

**Accepts:**
- `a1` — `"B3"` or `"B3:D4"`, upper-case letters only (coerced with `String()`)

**Returns:** `{r1, c1, r2, c2}`.

**On bad data:** anything that does not match (lower case, `$`, whole-column references such as `A:A`, sheet names) throws TypeError.

### `numberForFormula_(v)`

**Purpose:** Writes a number as text safe to embed in a formula, independent of the locale's decimal separator.
Numbers are rounded to six decimals; non-integers become a fraction expression.

**Accepts:**
- `v` — number

**Returns:** string (a plain literal for integers, otherwise `"(<micro-units>/1000000)"`).

**On bad data:** `NaN` or `undefined` returns `"(NaN/1000000)"`, an invalid formula, without throwing; strings that parse as numbers are coerced.

### `formulaRefs_(formula)`

**Purpose:** Lists the cells a formula reads on its own sheet: single cells, ranges (`$C$3:D4`), whole columns (`E:E`) and whole rows (`7:7`). References to other sheets (`'Sheet'!B5`, `Sheet!A:A`) and text in quotes are skipped, as are function names that look like cells (`LOG10(`). Names and `INDIRECT` cannot be seen.

**Accepts:**
- `formula` — text (coerced with `String()`)

**Returns:** `[{ r1, c1, r2, c2 }]`; a whole column has `r2 = Infinity`, a whole row `c2 = Infinity`.

**On bad data:** never throws; text that is not a formula returns whatever cell-like words it contains.

### `safeJson_(obj)`

**Purpose:** Serialises a value to JSON that can safely sit inside an HTML `<script>` block (the characters `<`, U+2028 and U+2029 are escaped).

**Accepts:**
- `obj` — any JSON-serialisable value

**Returns:** string.

**On bad data:** `undefined` or a function makes the call throw TypeError; a circular structure throws from `JSON.stringify`.

---

## 4. grid.js

A `Grid` is an in-memory copy of the top rows of ONE sheet, exposing a Sheet-like API (so old code written against a `Sheet` works on it).
Cell edits only change memory and mark cells *dirty*; `commit()` writes everything in one go. Coordinates are 1-based `(row, col)`.

### 4.1 Module constants and helpers
| Name | Meaning |
|---|---|
| `USE_SHEETS_API = true` | `false` forces the Spreadsheet-service path. |
| `MODEL_ROWS = 20` | Minimum window height. |
| `MODEL_MAX_ROWS = 3000` | Hard cap of the window. |
| `modelRows_(anchorRow, lastRow)` | Window height: at least 20, at least a few rows below the anchor and the last used row, never above 3000 (`lastRow` falsy counts as 0). |
| `sheetsApiAvailable_()` | True when `USE_SHEETS_API` is on and the advanced Sheets service is enabled. |
| `loadGridViaService_(spec, sheet)` | Service-path read (see `Grid.open`). |
| `loadGridViaApi_(spec, fresh)` | API-path read (see `Grid.open`). |

### 4.2 Constructor `new Grid(init)`

`init` fields are all read as-is, with no validation; a missing `v`, `f`, `merges` or `source` makes later calls throw TypeError.

| Field | Meaning |
|---|---|
| `source` | `{kind:'service', sheet}` or `{kind:'api', ssId, sheetId, rowCount, columnCount, tpl, rowGroups}`; `tpl` = `{sheetId,rowCount,columnCount,columnWidths[]}` for a reset, else `null`. Any other `kind` is treated as the service path by `commit` (tests pass `{kind:'x'}`). |
| `sheetName` | Name of the edited sheet. |
| `maxRows` | Row count of the sheet (grows with inserts). |
| `anchorRow` | Anchor row (follows inserts above it). |
| `rows`, `cols` | Window size in the model (`rows` x `cols`). |
| `v` | `v[row-1][col-1]` values. |
| `f` | Same shape; formula text or `''`. |
| `merges` | `[{r1,c1,r2,c2}]` (1x1 entries may appear and are filtered out by `_finalMerges`). |
| `frozenRows` | Frozen rows when read (default 0). |
| `sheetAnchorRow` | Anchor of the SHEET as it stands now (default = `anchorRow`; differs only in a reset). |

Derived/internal state: `anchorRow0` (anchor the grid started with), `ops` (ordered structural ops `ir`/`ic`/`dc`),
`dirty` (`'r,c'`->true), `notes` (`'r,c'`->text, `''` removes), `checks` (`'r,c'`->true add / false remove validation),
`aligns`, `borders`, `afterOps`, `rowFormats`, `active`, `scratch`.

**scratch** — `grid.scratch = {}`: free per-session storage for services (e.g. `Headers` sets `scratch.groupWidened`).
Never written anywhere; lost with the grid.

**Anchor row** — `grid.anchorRow` is the first price row. `insertRowsAfter(after, n)` with `after < anchorRow` moves it down by `n`.
`ReportGrid.decorate` adds `grid.getPriceRow()` returning it.

### 4.3 Static method

### `Grid.open(spec)`

**Purpose:** Reads the top rows of a sheet (or of the template, for a reset) in ONE read and returns an editable in-memory `Grid`.
Which read is used depends on whether the advanced Sheets service is enabled.

**Accepts:**
- `spec.sheetName` — string, sheet to edit
- `spec.anchor` — function returning the anchor row; it is given the sheet on the service path and no argument on the API path
- `spec.reset` — optional bool; the grid starts as the template and the reset happens inside `commit`
- `spec.templateName`, `spec.templateAnchor`, `spec.sheetAnchor` — required when `reset` is set (template name, function for the template's anchor, function for the sheet's current anchor)
- `spec.resetFallback` — optional function that resets the sheet right away on the service path

**Returns:**
- a `Grid`
- `null` on the service path when the sheet does not exist

**Flow:**

1. API path (advanced service enabled): one `spreadsheets.get` of the window rows of the sheet, or of the template when resetting.
   A tiny extra read gets the row count when not resetting.
2. Values come from the user-entered values (formula results from the effective value); the window width is the rightmost non-empty cell or merge (at least 1).
3. On a reset the grid starts as the template, with `sheetAnchorRow` set to the sheet's current anchor and `source.tpl` and `source.rowGroups` filled.
4. Service path: if `reset` is set and `resetFallback` exists it runs first (resets the sheet now, outside the commit); then the sheet is read with `getValues`, `getFormulas` and `getMergedRanges`.

**On bad data:**
- the API path never returns null: a missing edited sheet or template throws `Error('Brak arkusza "..." (API zwróciło: ...).')`
- a missing `spec.anchor` (or similar) throws TypeError
- a reset on the service path without `resetFallback` silently reads the un-reset sheet

### 4.4 Public methods of `Grid` (Sheet-like slice)

### Simple getters

- `getName()` — returns the sheet name.
- `getMaxRows()` — returns the sheet size (tracks inserts).
- `getLastColumn()` — returns the window width.
- `getLastRow()` — returns the window height, NOT the last used row.
- `getAnchorRow()` — returns the anchor row.

All take no arguments and have no failure modes.

### `getRange(r, c, nr, nc)`

**Purpose:** Creates a `GridRange` view over part of the grid, like `Sheet.getRange`.

**Accepts:**
- `r`, `c` — 1-based start row and column
- `nr`, `nc` — optional row and column counts (default 1)

**Returns:** `GridRange`.

**On bad data:** there is no bounds check. Ranges outside the window are allowed; reads give `''` and writes are silently dropped (see `_set`).
A count of 0, a negative count or `NaN` gives an empty range, so loops over it do nothing.

### `getRangeList(a1List)`

**Purpose:** Groups several A1 ranges so one border setting can be applied to all of them, like `Sheet.getRangeList`.

**Accepts:**
- `a1List` — array of A1 strings (upper-case, parsed with `parseA1_`)

**Returns:** an object `{setBorder, getRanges}`:
- `setBorder(...)` records one border entry for all rectangles, arguments kept as given
- `getRanges()` returns `GridRange[]`

**On bad data:** an invalid A1 string throws TypeError only when `getRanges()` is called, not at creation. `setBorder` never validates; the commit does.

### `formatRow(row, spec)`

**Purpose:** Queues a whole-row format, used for the grey look of note rows under a price row.
It resets the row's formats except borders, applies the look, and removes the left, right and inner vertical borders.

**Accepts:**
- `row` — row number
- `spec` — `{ size, color:'#rrggbb', clearTop?, clearBottom?, vAlign?='top', wrap?, numberFormat? }`; `clearTop` and `clearBottom` also remove the top and bottom borders

**Returns:** undefined.

**On bad data:** a missing or short `spec.color` throws TypeError at commit (API path), not at call time.
On the API path only the red channel of `color` is used for all three channels, so only greys work.
Rows outside the sheet make the batch update fail.

### `formatCell(row, col, spec)`

**Purpose:** Same as `formatRow`, but for ONE cell and with borders untouched; used for a note row the user already uses.

**Accepts:**
- `row`, `col` — the cell
- `spec` — same as for `formatRow`

**Returns:** undefined.

**On bad data:** same failure modes as `formatRow`.

### `setActiveRange(range)`

**Purpose:** Remembers which cell should be selected after the commit.

**Accepts:**
- `range` — a `GridRange`; only its top-left cell is used

**Returns:** undefined.

**On bad data:** a non-range throws TypeError (`getRow`).

### `setRowHeight(r, px)`

**Purpose:** Sets the height of row `r` in pixels, written with the commit after the structural changes (API: `updateDimensionProperties`; service: `sheet.setRowHeight`). The row number follows later row inserts of the same operation.

**Accepts:** `r` — 1-based row; `px` — pixels.

**Returns:** the grid.

**On bad data:** nothing is validated.

### `insertRowsAfter(after, n, opts)`

**Purpose:** Inserts blank rows after a given row, keeping the in-memory model consistent with what the sheet will look like after the commit.
Rows inserted above the anchor push the anchor down.

**Accepts:**
- `after` — row after which to insert (0 = at the top)
- `n` — number of rows
- `opts.plain` — optional; new rows get no data validation (checkboxes and lists are not inherited)
- `opts.fit` — optional; the new rows do not keep the height they inherit: as the last requests of the commit they are fitted to their content (`autoResizeDimensions`; service path: `autoResizeRows`). The final row numbers are tracked through later inserts. `Headers.divide` passes it for a new header row. Cells merged over several rows are ignored by the fit, so a row made only of such cells ends at the default height.

**Returns:** undefined.

**Behaviour to know:**
- the window keeps its height, so rows pushed past its end are dropped from memory; if `after` is at or beyond the window end, the window grows instead
- merges, alignments, dirty cells, notes and checkboxes are shifted; borders, row formats, post-commit operations and the active cell are NOT shifted

**On bad data:** no validation. `n <= 0` changes nothing in memory but still records an operation, so the commit sends a degenerate insert.
A negative `after` corrupts the model.

### `insertColumnsAfter(after, n)`

**Purpose:** Inserts blank columns after a given column and widens the model accordingly.

**Accepts:**
- `after` — column after which to insert
- `n` — number of columns

**Returns:** undefined.

**Behaviour to know:** merges, alignments, dirty cells, notes and checkboxes are shifted; borders and row formats are not (row formats cover whole rows; the column of a `formatCell` is not shifted).

**On bad data:** no validation.

### `deleteColumns(from, n)`

**Purpose:** Deletes columns from the model and drops or shrinks everything that touched them.

**Accepts:**
- `from` — first column to delete
- `n` — number of columns

**Returns:** undefined.

**On bad data:** there is no clamp to the window width. A range past the window is harmless in memory, but the API request will delete real columns.

### `setCheckbox(r, c, checked)`

**Purpose:** Puts a checkbox with the given state into a cell; the commit adds the checkbox validation.

**Accepts:**
- `r`, `c` — the cell
- `checked` — truthy or falsy

**Returns:** undefined.

**On bad data:** outside the window the value is dropped; the checkbox entry stays but is skipped at commit.

### `clearCheckbox(r, c)`

**Purpose:** Empties a cell and removes its checkbox validation at commit.

**Accepts:**
- `r`, `c` — the cell

**Returns:** undefined.

**On bad data:** same as `setCheckbox`.

### `commit()`

**Purpose:** Writes every change recorded in the grid to the sheet in one go, using the API path or the service path depending on the grid's source.
It first checks that the frozen rows allow the planned merges. See 4.6.

**Accepts:** nothing.

**Returns:** undefined.

**On bad data:**
- throws `Error(<Polish message>)` when the freeze would make a merge illegal; nothing is written
- platform errors from `Sheets.Spreadsheets.batchUpdate` or the service calls propagate
- a missing `source` throws TypeError
- commit is not idempotent: calling it twice replays the structural operations

### 4.5 `GridRange` (returned by `getRange`)

Fields: `m` (grid), `r`, `c`, `nr`, `nc`. Reads see the model including the operation's own changes.
Setters return `this` unless noted. Reading outside the window gives `''`; writing outside is silently ignored.

### Geometry getters

- `getSheet()` — returns the owning `Grid`.
- `getRow()`, `getColumn()` — first row and column.
- `getLastRow()`, `getLastColumn()` — last row and column of the range.
- `getNumRows()`, `getNumColumns()` — size of the range.
- `getA1Notation()` — the range as an A1 string (via `rectA1_`).

No failure modes.

### `getCell(i, j)`

**Purpose:** Gives a one-cell range at an offset inside this range.

**Accepts:**
- `i`, `j` — 1-based row and column offsets

**Returns:** `GridRange`.

**On bad data:** no bounds check against the range.

### Reading values

- `getValues()` — 2D array of values; numbers, booleans and strings are preserved.
- `getDisplayValues()` — 2D array of strings made with `String(value)`; this is NOT the formatted display text, numbers are raw.
- `getFormulas()` — 2D array of formula text, `''` where none.
- `getValue()`, `getDisplayValue()`, `getFormula()` — the same for the top-left cell only.

Outside the window all of them give `''`.

### `setValue(x)`

**Purpose:** Writes a value into the top-left cell; a string starting with `=` is stored as a formula.

**Accepts:**
- `x` — any value; `null` and `undefined` become `''`

**Returns:** `this`.

**On bad data:** outside the window the write is silently ignored.

### `setValues(a)`

**Purpose:** Writes a 2D array of values into the range, applying the same `=` formula rule per cell.

**Accepts:**
- `a` — 2D array of the same shape as the range

**Returns:** `this`.

**On bad data:** an array smaller than the range throws TypeError; extra entries in a larger array are ignored.

### `setFormula(f)`

**Purpose:** Writes a formula into the top-left cell and clears its value.

**Accepts:**
- `f` — formula string (no check for a leading `=`)

**Returns:** `this`.

**On bad data:** outside the window the write is silently ignored.

### `setFormulas(a)`

**Purpose:** Writes a 2D array of formulas into the range.

**Accepts:**
- `a` — 2D array of the same shape as the range

**Returns:** `this`.

**On bad data:** a shape mismatch throws TypeError.

### `clearContent()`

**Purpose:** Empties the value and formula of every cell in the range; the cells are cleared at commit.

**Accepts:** nothing.

**Returns:** `this`.

### `setNote(text)`

**Purpose:** Sets a cell note on every cell of the range; empty text removes the note.

**Accepts:**
- `text` — string; `null` and `undefined` mean `''` (remove); other types are converted with `String()`

**Returns:** `this`.

**On bad data:** outside the window the note is recorded but skipped at commit.

### `clearNote()`

**Purpose:** Removes the notes of the range (same as `setNote('')`).

**Accepts:** nothing.

**Returns:** `this`.

### `getMergedRanges()`

**Purpose:** Lists the merges that overlap the range, each with its full extent.

**Accepts:** nothing.

**Returns:** `GridRange[]`.

### `breakApart()`

**Purpose:** Removes the merges overlapping the range from the model; cell values stay.

**Accepts:** nothing.

**Returns:** `this`.

### `merge()`

**Purpose:** Merges the range into one cell. Overlapping merges are broken first, and all cells except the top-left are blanked, so their values are lost.

**Accepts:** nothing.

**Returns:** `this`.

**On bad data:** a one-cell range only breaks overlapping merges and creates no new one.

### `mergeVertically()`

**Purpose:** Merges each column of the range separately.

**Accepts:** nothing.

**Returns:** `this`.

### `GridRange.setBackground(color)`

**Purpose:** Sets the background of the range (`"#rrggbb"`; `null` = no fill), written with the commit (API: `repeatCell` on `userEnteredFormat.backgroundColor`; service: `setBackground`). The last call for the same range wins. A grid does not read colours, so there is no `getBackground` (code that wants to read one checks `typeof range.getBackground`).

**Accepts:** `color` — hex text or `null`.

**Returns:** the range.

**On bad data:** a malformed colour is not validated; the commit sends whatever the channel makes of it.

### `setHorizontalAlignment(a)`

**Purpose:** Queues a horizontal alignment for the range, applied at commit.

**Accepts:**
- `a` — `'left'`, `'center'` or `'right'`

**Returns:** `this`.

**On bad data:** no validation; the API path upper-cases the string.

### `setBorder(...)`

**Purpose:** Queues borders for the range, with Sheet-style arguments, applied at commit.

**Accepts:**
- `top, left, bottom, right, vertical, horizontal` — `true` adds a border, `false` removes it, `null` leaves it
- optional `color`, `style`

**Returns:** `this`.

**On bad data:** nothing is validated at call time. The API path ignores `color` and `style` (always black solid); the service path honours them.

Private helpers: `_map(f)` builds a 2D array by calling `f(row,col)`; `_each(f)` iterates `f(row,col,i,j)`; `_hits()` finds merges overlapping the range;
`_assign(r,c,x)` applies the "`=` means formula" rule.

### 4.6 Commit internals

**Notes (cell notes)**: `GridRange.setNote` fills `grid.notes`; the commit sends API `updateCells` with `fields:'note'` per cell, or `setNote` per cell on the service path. Empty text removes the note.

**Checkboxes**: the value goes through the normal dirty cells; the validation is separate (`dataValidation: BOOLEAN`, or `{}` to clear; service path: `insertCheckboxes` / `removeCheckboxes`).
Row inserts with `plain:true` additionally clear data validation of the new rows (otherwise `inheritFromBefore:true` copies the row above, checkboxes included).

**Formats**: `formatRow`/`formatCell` (note look), `setBorder` and `setHorizontalAlignment` are applied after cells and merges.

### `_frozenPlan()`

**Purpose:** Decides what to do with the frozen rows at commit so that the headers stay frozen after rows were inserted, and refuses a freeze that would split a merge.

**Accepts:** nothing.

**Returns:** one of:
- `{ rows: null }` — nothing to do (no frozen rows, or the freeze cuts the headers but no merge crosses it)
- `{ rows: B, base }` — all headers are frozen (the frozen area reaches the row above `sheetAnchorRow`); the boundary keeps its distance from the end of the headers and moves with row inserts above or inside the frozen part
- `{ error }` — the freeze cuts the headers and a final merge crosses it; message in Polish: "Zablokowane wiersze przecinają nagłówki ..."

**Behaviour to know:**
- `base` differs from the original frozen row count after a reset to a template with a different header height
- `B` is always a number in the second case, so the freeze is re-set on every commit even if unchanged

**On bad data:** the `{ error }` outcome makes `commit()` throw before anything is written.

### `_commitApi()`

**Purpose:** Sends all recorded changes as ONE `Sheets.Spreadsheets.batchUpdate`, then selects the active cell.

**Accepts:** nothing.

**Returns:** undefined.

**Flow:** the request is built in this order:

1. Reset only (`source.tpl`): open collapsed row groups and delete all groups (deepest first); unmerge the whole sheet; clear all cells; set the frozen rows to `base`;
   append rows and columns if the template is bigger; copy the template over; set the column widths from the template; as the LAST request, fit the rows from the anchor row (the template's price row) down to the end to their content (`autoResizeDimensions`), so new data adjusts them again while the header rows keep the template's heights.
2. Structural operations in order: row inserts (appending when past the current row count, otherwise inserting with inheritance from the row above, plus clearing data validation for `plain`), column inserts, column deletes.
3. The frozen row count, if it has to change; this happens before any merge.
4. Post-commit request lists registered by services (e.g. a price line copied from the template).
5. Unmerge the whole window; write the dirty cells in runs; notes; checkbox validation; recreate the final merges; alignment; borders; row formats.
6. Send the request, then select the active cell through `SpreadsheetApp` (outside the batch).

Notes: non-top-left cells of merges are never written (`_dirtyRuns`). Borders are always black solid on this path; `false` removes, `null` leaves.

**On bad data:** platform errors from the batch update propagate.

### `_commitService()`

**Purpose:** The fallback commit using batched Spreadsheet-service calls, used when the advanced service is unavailable.

**Accepts:** nothing.

**Returns:** undefined.

**Flow:**

1. Structural operations (row inserts, column inserts, column deletes; `plain` also clears data validations).
2. Set the frozen rows if the plan has a number.
3. Run post-commit callbacks registered by services.
4. Compare merges: break stale ones, keep correct ones, remember the missing ones.
5. Clear blank dirty cells with one list; write the remaining cells in runs of the same kind (formulas versus values).
6. Notes, then checkboxes, then the missing merges (vertical merge for equal-extent columns, otherwise a normal merge).
7. Alignment and borders through range lists (falling back to per-range calls), row formats, and finally the active range.

Notes: the reset is NOT part of this commit (it was done earlier by `resetFallback`). Borders honour all `setBorder` arguments here, unlike the API path.

**On bad data:** service errors propagate.

### Private helpers

| Helper | Purpose |
|---|---|
| `_shift(axis, after, n)` | Applies the Sheets insert rule to merges and alignments (things after the point move, spanning ones grow) and re-keys dirty, notes and checks. |
| `_inWindow(r, c)` | True when the cell is inside the window. |
| `_val(r,c)` / `_form(r,c)` | Value / formula of a cell, `''` outside the window. |
| `_set(r,c,value,formula)` | Writes value and formula and marks the cell dirty; silently ignores out-of-window cells. |
| `_finalMerges()` | Merges that cover more than one cell. |
| `_dirtyRuns()` | Dirty cells grouped into horizontal runs, hiding non-top-left cells of merges, clipped to the window. |
| `_mergePlan(list)` | Turns missing merges into API merge requests, joining equal-extent single columns into one column-wise merge. |
| `_commitApi()`, `_commitService()`, `_frozenPlan()` | See above. |

---

## 5. reportGrid.js — `ReportGrid`

### `ReportGrid.open(opts)`

**Purpose:** Opens the report sheet as an editable `Grid`, with its price row reconciled first.
With the reset option the grid starts as the template instead, for "Zacznij od nowa".

**Accepts:**
- `opts` — optional object
- `opts.reset` — bool; start from the template (`RESET_SHEET`)

**Returns:**
- a decorated `Grid`
- `null` when the report sheet is missing on the service path

**On bad data:** with the Sheets API a missing sheet or template throws (see `Grid.open`). Other shapes of `opts` are ignored (`undefined` and `null` are fine).
Callers must null-check on the service path.

### `ReportGrid.create(init)`

**Purpose:** Builds a report grid directly from data, without reading a sheet; used by tests and in-memory work.
Fields in `init` override the defaults (an explicit `anchorRow` wins over `priceRow`).

**Accepts:**
- `init` — object as for `new Grid`, plus `priceRow` (number, the anchor)

**Returns:** decorated `Grid`.

**On bad data:** `init` undefined throws TypeError; a missing `source`, `v`, `f` or `merges` surfaces later as TypeError.

### `ReportGrid.commit(grid)`

**Purpose:** Writes a report grid to the sheet and then brings everything that depends on the result up to date: the stored price row and its marker, the technical sheet and the sidebar version.
The grid commit must succeed first.

**Accepts:**
- `grid` — a grid from `open` or `create`

**Returns:** undefined.

**Flow:**

1. `grid.commit()` — the single write.
2. `PriceRow.settle(grid.getPriceRow())` — stores the new price row and moves the marker.
3. `TechnicalSheet.touch()` — rewrites the technical sheet and bumps the sidebar version.

**On bad data:** if `grid.commit()` throws (e.g. freeze/merge conflict) the error propagates and steps 2 and 3 are skipped.
A grid that was not decorated (no `getPriceRow`) throws TypeError after the write.
`settle` and `touch` swallow most of their own errors, but the property write in `settle` may throw.

### `ReportGrid.decorate(grid)`

**Purpose:** Gives a grid the `getPriceRow()` method that returns its anchor row.

**Accepts:**
- `grid` — a Grid or a falsy value

**Returns:** the same grid, or the falsy value unchanged (so `null` passes through).

**On bad data:** none.

---

## 6. priceRow.js — `PriceRow`

The price row (first price row, default 4) is where the headers end: headers are rows `GROUP_ROW..priceRow-1`.

Three sources are kept in sync:

- hidden developer metadata `PRICE_ROW_MARK` on the row (follows hand-inserted rows)
- the document property `PRICE_ROW_KEY` (cheap reads)
- a grid's own `anchorRow` while an operation runs

The marker wins; if it is lost, the stored number is used and the marker is put back.

### `PriceRow.clamp(n, maxRows?)` (`clampPriceRow_`)

**Purpose:** Turns any value into a valid price row: a whole number not below the minimum, optionally not above the sheet's row count.

**Accepts:**
- `n` — any value
- `maxRows` — optional sheet row count

**Returns:** integer of at least 4 (unless `maxRows` is below 4, then `maxRows`).

**On bad data:** never throws; `undefined`, `null`, `''` and junk give 4.

### `PriceRow.stored()` (`priceRow_`)

**Purpose:** Reads the last known price row from the document properties.

**Accepts:** nothing.

**Returns:** number (clamped).

**On bad data:** unset or garbage gives 4; a `PropertiesService` error propagates.

### `PriceRow.of(sheetOrGrid)` (`priceRowOf_`)

**Purpose:** Returns the price row for whatever the caller holds: a grid's own anchor, or the stored value for anything else.

**Accepts:**
- `sheetOrGrid` — object with an optional `getPriceRow()`; may be falsy

**Returns:** number.

**On bad data:** falsy or non-grid input falls back to `stored()`.

### `PriceRow.sync(sheet?)` (`syncPriceRow_`)

**Purpose:** Reconciles the marker on the sheet with the stored price row and returns the effective value.
If the marker exists it wins and is stored; if it is missing, the stored value is used and the marker is put back.
A change of the stored value refreshes the technical sheet and the sidebar version.

**Accepts:**
- `sheet` — optional Spreadsheet-service `Sheet` (default: the report sheet)

**Returns:** the price row (number).

**On bad data:**
- no sheet at all returns `stored()` with no side effects
- marker lookup or placement errors are logged (`Logger.log`) and swallowed, treating the marker as missing
- errors from `TechnicalSheet.touch` and from the property write are not caught here

### `PriceRow.settle(row)` (`settlePriceRow_`)

**Purpose:** Records the new price row after a committed operation: stores it and moves the marker on the report sheet.
It does not refresh the technical sheet (the caller does).

**Accepts:**
- `row` — the new price row

**Returns:** undefined.

**On bad data:** junk becomes 4; marker errors are logged and ignored.

### `PriceRow.templateRow()` (`templatePriceRow_`)

**Purpose:** Finds the price row of the template sheet.

**Accepts:** nothing.

**Returns:** number (clamped); the marker row of `RESET_SHEET`, otherwise 4.

**On bad data:** a missing template gives 4.

### `PriceRow.sheet()` (`pricingSheetObj_`)

**Purpose:** Gets the report `Sheet` from the active spreadsheet.

**Accepts:** nothing.

**Returns:** `Sheet`, or `null` when there is none.

### `PriceRow.marker(sheet)` (`findPriceMarker_`)

**Purpose:** Finds the row carrying the price-row marker (developer metadata `PRICE_ROW_MARK`) on a sheet.

**Accepts:**
- `sheet` — a `Sheet`

**Returns:** row number, or `0` when there is none (the first usable hit is used).

**On bad data:** any exception (null sheet, API failure) is logged and returns 0.

### Private helpers

| Helper | Purpose |
|---|---|
| `placePriceMarker_(sheet, row)` | Does nothing if the marker is already on `row`; otherwise removes all markers with that key and adds the metadata (PROJECT visibility) to the row; errors are only logged. |
| `storePriceRow_(row)` | Writes the property if it differs; returns `true` when it changed. |

---

## 7. sidebarState.js — `SidebarState`

The sidebar polls a version stamp (bumped by commits, resets and `onEdit`) plus the stored price row.

### `SidebarState.version()`

**Purpose:** Reads the current sidebar version stamp.

**Accepts:** nothing.

**Returns:** string (`''` when never set).

**On bad data:** property errors propagate.

### `SidebarState.bump()`

**Purpose:** Marks that the sheet changed, by storing a new version stamp (the current time) so the sidebar refreshes.

**Accepts:** nothing.

**Returns:** undefined.

**On bad data:** errors are caught and logged (`Logger.log('SidebarState.bump: ...')`); it never throws.

### `SidebarState.read()`

**Purpose:** Gives the sidebar everything it polls for in a single properties read: the version stamp and the price row.

**Accepts:** nothing.

**Returns:** `{ version: string, priceRow: number }`, where the price row goes through `PriceRow.clamp`.

**On bad data:** missing values give version `''` and price row 4; property errors propagate.

---

## 8. Observations (not changed)

- `Grid.open` API path throws on a missing sheet while the service path returns `null`; callers that check for `null` miss the former.
- Borders/rowFormats/active are not shifted by later row/column inserts in the same session (merges, aligns, notes, checks, dirty are); order operations accordingly.
- `setBorder` colour/style args are honoured only on the service path (API path always black SOLID); `formatRow` colour uses only the red channel on the API path.
- `getDisplayValues()` returns `String(rawValue)`, not the sheet's formatted text.
- `insertRowsAfter` truncates the window at `rows`; rows pushed past the window end are dropped from memory.
- `_frozenPlan` returns a numeric `rows` on every commit when all headers are frozen, so the freeze is rewritten even when unchanged.
- `MIN_PRICE_ROW` is a literal `4` instead of `GROUP_ROW + 2`; `NET_PRICE_HEADER` and `TECH_DUMP_SHEET` are barely used (one file each); the "noDetail" remark in config comments refers to something not in this file.
- `ReportGrid.create` lets `init.anchorRow` override `init.priceRow` silently.
