# Use cases extracted from Menu.js (step 3 of the plan)

Pure move: same calls in the same order, same error handling, same status-cell switching. One intended difference (below).

| New | Was | Role |
|---|---|---|
| `RefreshSheet.run(configSheetName?, resultSheetName?)` (`RefreshSheet.js`) | `refreshAllDataForConfigSheet` in `Menu.js` | read the config sheet, fetch every page from BC, write the result sheet; status cells show reading → connection (per page) → writing and are put back to idle on any failure |
| `EstimateSheet.run(configSheetName?)` (`EstimateSheet.js`) | `estimateResponseSize` in `Menu.js` | fetch the first page, show the estimated row count in F2 of the config sheet; writes to no other sheet |
| `ImportQuery.connectionFor(shCoed)` (`Import Query.js`) | the same 5 lines written out twice | the `ODataConnection` described by a config sheet |
| `ResultSheet.write(sheetName, table, columnDataTypes)` (`ResultSheet.js`) | the inline block at the end of the refresh | create-if-missing, wipe (`getDataRange().clear()`), one number format per column from the data type, one `setValues` |

`Menu.js` keeps the menu entry points and their action names (`menuRefreshCurrentSheet`, `menuRefreshAll`, `menuEstimateForCurrentSheet`, so the live check still recognises them) and now
calls the use cases. `refreshAllDataForConfigSheet` and `estimateResponseSize` stay as one-line forwarders (`Test Functions.js` and anything old still use the names).

## Behaviour kept on purpose (pinned by tests)
- The reading cell is lit by the `SheetCoeditor` constructor; refresh puts it idle *before* lighting writing; an error anywhere puts the lit cell back to idle and is rethrown.
- A refresh without a table in the config sheet only puts reading to idle. The result sheet is only touched after the data was fetched successfully.
- The data type of a column is looked up with the column's own table (`Sales.Since`) or else the main table.
- **Quirk kept: `EstimateSheet` without a table returns early and leaves the reading cell lit** (the old code did; the live check's "activity indicators back to idle" will report it - see `docs/bugs-todo.md` style findings). It is pinned by a test so that fixing it is a conscious change.

## The one intended change
`estimateForCurrentSheet_script` assigned `configSheet = ...` without `let` and created an implicit global (`docs/bugs-todo.md` #4). It is a local now. Nothing else read that global.

## How it is tested (`tests/refresh.test.js`)
Real: `Menu.js`, the use cases, `DataType`, `Controller`/`Settings`/`Store`, and the result sheet on the simulated spreadsheet. Faked (recording every call): `SheetCoeditor`, `ODataConnection`,
`getMetadata`, `getMainSettings`. Written first against the old `Menu.js` (all green), then the extraction ran against the same tests; 12 deliberate breakages of the new files are all caught.
Rules: the use cases and `ImportQuery` contain no `SpreadsheetApp`/range access; `Menu.js` builds no connection or coeditor; only `ResultSheet.js` clears a data range; the new files load alone.

**Not covered offline:** the real query model (`CCTImportConfig`, `ODataQuery`, `ODataResponseTable`) end to end - they were not changed, and the fakes stand in for them. The live check
(`menuRefreshCurrentSheet`, `menuRefreshAll`, `menuEstimateForCurrentSheet`: result sheet exists, data rows = estimate, uniform formats, indicators idle) covers that on a real spreadsheet.

## Next
- `RefreshAll` / `ScheduleRefresh` (the loops in `Menu.js` and `Settings Sheet.js`, `autoRefreshFunction`) can now call `RefreshSheet.run` directly.
- `ResultSheet.write` is the seam for the BulkSheet writer: tall data should not go through Grid's 3000-row window; the contract (table, per-column types) is already the one a bulk writer needs.
