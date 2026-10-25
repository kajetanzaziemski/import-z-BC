# Use cases extracted from Menu.js and Settings Sheet.js (step 3 of the plan)

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


---

# RefreshAll and ScheduleRefresh

| New | Was | Role |
|---|---|---|
| `RefreshAll.all()` (`RefreshAll.js`) | body of `refreshAll` in `Menu.js` | every config/result pair of the settings sheet, in order (menu "refresh all") |
| `RefreshAll.ticked()` | `refreshAllTrue` | only the pairs ticked for automatic refresh |
| `RefreshAll.scheduled()` | `autoRefreshFunction` in `Settings Sheet.js` | what a time trigger does: `ticked()`, then note the time on the settings sheet |
| `ScheduleRefresh.setUp(frequency)` (`ScheduleRefresh.js`) | `SettingsSheet.setRefreshTrigger` | remove the refresh triggers, create THE time trigger (`everyHours(n)` / `everyDays(n)`), issue the refresh permit for it (interval in hours) |
| `ScheduleRefresh.run(e)` | `autoRefreshContent` | a time trigger fired: only if the permit was issued for this trigger refresh (`RefreshAll.scheduled()`) and touch the permit, else delete itself |
| `ScheduleRefresh.runLegacy(e)` | `autoRefreshContentOld` | the same for old triggers that run `autoRefresh()`; issues its own permit when there is none |

Entry points stay where they are and keep their names, action names and live-check hooks: `autoRefreshHandler(e)` / `autoRefresh(e)` (`Controller.checkInput` + `Controller.run("requestAutoRefesh", ...)`),
`refreshAll()` (`menuRefreshAll`). The old function names (`autoRefreshFunction`, `autoRefreshContent`, `autoRefreshContentOld`, `refreshAllTrue`, `SettingsSheet.setRefreshTrigger`) are one-line forwarders.

## Behaviour kept on purpose (pinned by `tests/schedule.test.js`, written first against the old code)
- The permit rules of CLAUDE.md: a trigger refreshes only if `permit.issuedFor === e.triggerUid`, otherwise it deletes itself (only itself); `touchRefreshPermit` re-reads the store, so a permit reissued by another run meanwhile is not overwritten.
- Quirks, pinned so that fixing them is a conscious change: `setUp` removes the refresh triggers of **all** documents of the user (bugs-todo #5); without a refresh-frequency row (`null`) it removes them and then fails with a `TypeError`;
  the time is noted also when nothing was ticked and not when a refresh fails; the first legacy run records no `lastRun` (the permit it issued is not stored yet when it is touched); the first failing sheet stops the loop.

## The one difference
`SettingsSheet.setRefreshTrigger()` used to read the refresh frequency *after* removing the triggers; the forwarder reads it first and hands the value to `ScheduleRefresh.setUp`. It only matters if reading the settings sheet itself fails: then the old triggers are no longer removed first.

## Testing
Real files in a fresh Apps Script scope on fake Properties/Cache/Lock services and a fake `ScriptApp` with real trigger bookkeeping (`tests/platform-fakes.js`: `newTrigger(...).timeBased().everyHours(n).create()`, `getProjectTriggers()`, `getUserTriggers()` without time triggers,
`deleteTrigger`). Faked: the settings sheet object and the single-sheet refresh. 12 deliberate breakages of the new files are all caught. Rules: neither file touches a spreadsheet; only `ScheduleRefresh.js` creates time-based triggers or removes the refresh triggers; the new files load alone.
**Not covered offline:** Apps Script's real trigger quotas/latency and real `ScriptApp` behaviour; the live check (`requestAutoRefesh`, `sheetEditAction` for the refresh-frequency edit) covers those on a real spreadsheet.
