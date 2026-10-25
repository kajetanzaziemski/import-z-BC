# Grid.js: differences from wyceny's grid.js

`Grid.js` started as a copy of wyceny `grid.js` @ `e042de5`. The reference of the unchanged parts is
`wyceny-grid-reference.md`; this file lists what was added or changed here. Tests: `node tests/run.js`.

## Added
| API | Notes |
|---|---|
| `Grid.create({ sheetName, rows = 20, cols = 1 })` | Grid for a sheet that does not exist. `commit()` inserts it (a default 1000x26 sheet, else it throws), then writes. An existing name fails at the commit (`insertSheet` error). |
| `grid.commit()` more than once | After a commit nothing is pending (`_settle`): the next commit writes only later changes. Row/column counts are tracked, so a later insert is an insert, not an append. |
| `GridRange.setFontWeight/Size/Color`, `setVerticalAlignment`, `setWrapStrategy`, `setNumberFormat` | Queued in `grid.formats` (one entry per rectangle, props merged), written at commit. Bad colour / alignment / wrap fail at the call. |
| `setFontWeights/Sizes/Colors`, `setVerticalAlignments`, `setWrapStrategies`, `setNumberFormats`, `setBackgrounds`, `setHorizontalAlignments`, `setNotes`, `setDataValidations` | Array forms, `a[i][j]` -> cell (i, j). `setNotes` null = no note. |
| `GridRange.setDataValidation(x)` / `clearDataValidations()` | `x` = `{ list, strict = true, dropdown = true }`, `{ date: true }`, `null`, or a SpreadsheetApp `DataValidation` of kind VALUE_IN_LIST / DATE_IS_VALID_DATE (other kinds throw). A checkbox and a validation on one cell: the last call wins. |
| `grid.autoResizeColumns(from, n)` | Final column numbers; follows inserted columns. |
| Dates | `Date` values are written in both paths (API: serial number in the spreadsheet's time zone) and read back as `Date` from cells whose number format is DATE / TIME / DATE_TIME. |
| colours | `'#rrggbb'`, `'#rgb'`, `'#aarrggbb'` (what `getFontColors` returns), basic names (`black`, `green`, `red`...). |
| horizontal alignment | `'general'`, `'general-left'`, `'general-right'` (what `getHorizontalAlignments` returns for a cell without an explicit alignment) all mean "not set": the general alignment renders text left and numbers right by itself. |

## Changed
- `spec.anchor` is optional (default row 1); `Grid.open` returns `null` for a missing sheet on **both** paths (wyceny threw on the API path).
- The window **grows**: with `insertRowsAfter` (wyceny cut it back to its old height), and with any write past it. A write to a row past the end of the
  sheet throws; a write past the last column appends columns to the sheet. Notes and validations also reach their cells. (Before, such writes were dropped silently.)
- `insertRowsAfter(..., { plain: true })` on the service path clears the validation of the **whole** row (before: only up to the window's width).
- `Grid.open` takes an optional `window` (rows to read): a small grid for a few known cells, e.g. a status row.
- `Grid.exists(sheetName)`: whether the sheet is there, without reading it (`SheetCoeditor` constructor).
- `Grid.open` on the API path also reads the time zone and the cells' number format type.

## Not changed, not used by import-z-BC, not tested here
The reset-from-a-template path (`spec.reset`, `templateName`, row groups, `_frozenPlan`'s reset branch), `formatRow` / `formatCell`, borders
(recorded by the simulation only), `afterOps`, `setActiveRange`. Anything new that starts to use them needs tests first.

## Known limits / to verify on a real spreadsheet
- All tests run against `tests/sim.js`, not Google Sheets. Points the simulation cannot confirm: an **empty list** validation (`VALUE_IN_LIST` with `[]`, used
  by `ConfigDValStore.empty`) in the API path (`ONE_OF_LIST` with no values) may be refused by the real API; a number format pattern's API `type` is
  inferred from the pattern (`numberFormatType_`); sheet time zones with a changing offset are only checked on Europe/Warsaw and America/Los_Angeles.
- `Grid.create` assumes a default sheet size of 1000x26.
- Reading takes the top `modelRows_` rows only (max 3000): not for tall data sheets (see `docs/architecture-proposal.md`, BulkSheet).
