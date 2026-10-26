# Suggested layers, use cases and services for import-z-BC

Builds on `current-architecture.md` (what exists) and `architecture-proposal.md` (Grid plan). Rule as in wyceny: **a layer calls only layers below it**;
Apps Script has one global scope, so each module is ONE namespace (class with static methods or object literal) and nothing is used at load time.
Names in `[brackets]` are today's code that moves there.

```
 L5  ENTRY POINTS     thin wrappers only: parse the event, call ONE use case inside Controller.run
 L4  USE CASES        one per user-visible action; own the "open → work in memory → commit" sequence
 L3  SERVICES         domain logic, no direct sheet access (work on a grid passed in, or on plain data)
     DATA SOURCES     BC / OData access, metadata  (talk to the network, not to sheets)
 L2  SHEET ADAPTERS   know ONE sheet's layout; open / commit a Grid for it
 L1  GRID / BULK      generic: Grid (small sheets), BulkSheet (tall result data)
 L0  PLATFORM + STATE SpreadsheetApp, Sheets API, UrlFetch, ScriptApp, LockService, Properties/Cache
 side: Settings & state (one place), Controller (error/alert wrapper), Util, Log
```

## L5 Entry points (names unchanged: Apps Script and the menu call them by name)
`onOpen`, `onEdit`, `sheetEdit`, `sheetChange`, `autoRefreshHandler`, menu handlers, sidebar functions (`google.script.run`), `authCallback`.
Each is 1–5 lines: `Controller.run(name, () => UseCase.run(args))`. Trigger-power / permit checks stay here or in `TriggerGate` (L3), never in use cases.

## L4 Use cases (new namespaces, extracted from Menu.js / Quick Start.js / Settings Sheet.js)
| Use case | Today in | Does |
|---|---|---|
| `RefreshSheet.run(configName)` | `refreshAllDataForConfigSheet` | config → query → fetch pages → write result; status colours |
| `RefreshAll.run()` | `refreshAll`, `autoRefreshContent` | loop over `SettingsModel` sheets, call `RefreshSheet`, update last refresh |
| `EstimateSheet.run(configName)` | `estimateForCurrentSheet`, `estimateResponseSize` | count query → show "estimated rows" |
| `AnalyseConfig.run(sheetName, e?)` | `updateAfterEdit`, `SheetCoeditor.applyCoedits` | re-read config, rebuild dropdowns, insert rows, write validations/notes |
| `CreateImportWizard.run()` | `insertImportWizard`, `SettingsSheet.addNewSheetInfo`, `insertNewConfigSheet` | new config sheet + settings row |
| `ScheduleRefresh.run()` | `setRefreshTrigger`, `sheetEdit` on settings | (re)issue time trigger + permit |
| `ConnectBC.run()` / `Logout.run()` | `startAuthFlow`, `connectionSetup`, `logoutFlow` | OAuth flow, status sidebar |
| `CheckStatus.run()` | `statusCheck`, `lightStatusCheck`, `forceAgentRefresh` | agent / trigger health, repair (`StatusManager`) |
| `HandleEdit.run(e)` | `onEdit`, `sheetEdit`, `checkInstallableAgentRan` | simple↔installable dedupe, then `AnalyseConfig` / settings edit |

A use case: opens grids through adapters (L2), calls services (L3), commits **once**, then does platform-only things (toast, alert, trigger changes).

## L3 Services (no `SpreadsheetApp` ranges; take a grid or plain arrays)
| Service | From | Responsibility |
|---|---|---|
| `QueryModel` | `CoedContentTracker`, `CCTImportConfig`, `CoedOption*` | parse config rows → query description; compute `insertRows` instructions; cascade of options |
| `QueryBuilder` | `ODataQuery` | description → OData URL (`$select/$filter/$expand…`) |
| `ValidationCatalog` | `Data Validations.js` (`ConfigDValStore`, `MyDataValidation`) | which dropdown belongs to which cell (returns specs `{list}` / `{date}`, not SpreadsheetApp objects) |
| `ResultTable` | `ODataResponseTable`, `DataType` | pages → 2-D array + column formats |
| `SettingsModel` | `SettingsSheet` (logic part) | list of sheet pairs, refresh frequency, last refresh – on a grid |
| `AgentService` | `AgentManager`, `TriggerWrapper`, `TriggerLog`s, `StatusManager`, `Track onEdit Triggers` | trigger registry, power/permit decisions, installable-vs-simple detection (no sheet access; uses state + ScriptApp) |

## L3 Data sources (network)
`BCClient` [`BCAuth` (BC Auth.js), `BCConnection` (BC Connection.js), `ODataConnection` (OData Connection.js)] — OAuth2 + paged GET, retries, errors → `ConnectionError`.
`BCMetadata` [`BC Metadata.js`, `Edmx.js`] — entity/field/nav-property catalogue, cached.

## L2 Sheet adapters (the ONLY code that knows layouts)
| Adapter | Knows | API |
|---|---|---|
| `ConfigGrid` | start row 6 / col 2, header block 4×7, status cells (2,2)(2,3)(2,4), estimate cell (2,6), valid row labels | `open(name)`, `create(name)`, `rows()`, `setStatus(kind, on)`, `setEstimate(n)`, `writeValidations(matrix)` |
| `SettingsGrid` | table at B2:E…, row labels `configSheet / lastRefresh / refreshFrequency / headerGeneralSettings`, date format | `open()`, `create()`, `pairs()`, `setLastRefresh(d)`, `addPair(...)` |
| `ResultSheet` (BulkSheet) | result sheet name per config, clear + column formats + chunked write | `write(name, table, formats)` |

## L1 Generic
`Grid` / `GridRange` (done, tested) and `BulkSheet` (new; tall data, no 3000-row window).

## L0 State and platform (one place each)
Today there are four mechanisms (`HelperDataStore`, `MainSettings`, `getImportSettings`, `getGlobalSettings`). Suggest **one `Store` namespace** with scopes:
`Store.document` (StorageObject, merge-on-save under lock – keep CLAUDE.md rules), `Store.user`, `Store.script`, `Store.cache`; `MainSettings` / `GlobalSettings`
become typed accessors on top of it (`Settings.addonStatus()`, `Settings.refreshPermit()`, `Settings.tenant()`…).
`Lock` (document lock wrapper: `withDocumentLock`, `runLatestOnly`), `Log` (`dbgLog`, `agentLog`).

## Rules to enforce in `tests/run.js` (as wyceny does)
1. Only L2 adapters build or open a Grid; services and use cases never call `Grid.open` / `new Grid`.
2. Services never call `commit()`; only use cases do.
3. Entry points contain no logic: each calls exactly one `UseCase.run` (plus `Controller.run`).
4. `SpreadsheetApp.getActive…/getRange` appears only in L0/L1/L2 files.
5. No cross-file use at load time (files load in any order).
6. `Grid.js` / `Grid Util.js` stay free of project words (already tested).

## Suggested file layout (clasp flat; sorted prefixes keep the load order irrelevant but readable)
`10 Entry – *.js`, `20 UseCase – *.js`, `30 Service – *.js`, `35 BC – *.js`, `40 Sheet – ConfigGrid.js / SettingsGrid.js / ResultSheet.js`,
`50 Grid.js / Grid Util.js / BulkSheet.js`, `60 State – Store.js / Settings.js / Lock.js / Log.js`, `00 credentials` (untracked, must stay first).

## Order of work (each step ships on its own)
1. `ConfigGrid` + status switches (smallest, first real Grid use) → golden test vs current `setupConfigHeader`.
2. `Store`/`Settings` facade over existing mechanisms (no behaviour change), then move callers.
3. Extract `RefreshSheet` / `EstimateSheet` from `Menu.js` (pure move) → add `ResultSheet`/BulkSheet.
4. `SettingsGrid` + `RefreshAll`/`ScheduleRefresh`. (Both done: `Settings Grid.js` holds the layout and all cell access of the settings sheet, `SettingsSheet` keeps the meaning of the lines.)
5. Split `SheetCoeditor` into `ConfigGrid` + `QueryModel` + `AnalyseConfig`. Done for the sheet access: `ConfigGrid.lines()` reads/inserts/writes the query lines, `SheetCoeditor` has no `SpreadsheetApp` call left, `AnalyseConfig` is the use case. The query model (`Content Tracker.js`, `Data Validations.js`, `Fix Register.js`) never touched a range, so it was not moved or renamed (a rename to `QueryModel` / `ValidationCatalog` would be churn without a behaviour gain); a rule test keeps it free of sheet calls.
6. (Done, see `docs/agent-service.md`; behaviour fixes still open) `AgentService` regroup (largest, riskiest; touches triggers/permits – last, with the live-add-on caveats of CLAUDE.md).
7. Enforce the rules above as tests.
