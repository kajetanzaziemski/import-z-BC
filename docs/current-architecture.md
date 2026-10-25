# Today's code: areas of responsibility (branch `refactor-and-grid`, before any refactor)

Sketch from file names, class names and cross-references (`grep`), not from reading every function. Arrows = "calls / uses".
Everything is one global scope (Apps Script); the arrows are conventions, not enforced.

```
 ┌───────────────────────────────────────── ENTRY POINTS (Apps Script calls these) ───────────────────────────────────────────┐
 │  Quick Start.js            Menu.js                          Settings Sheet.js          sidebars (html + google.script.run)  │
 │  onOpen · onEdit (simple)  menu items: refresh sheet/all,   autoRefreshHandler         Global Settings SB · (New) Status SB   │
 │  sheetEdit · sheetChange   estimate size, insert wizard,    (time trigger)             Trigger Table · authCallback/logout    │
 │  (installable triggers)    connection setup, status, auth                                                                    │
 └───────┬───────────────────────────┬─────────────────────────────────┬──────────────────────────────┬──────────────────────────┘
         │ every call is wrapped by  │                                 │                              │
         ▼                           ▼                                 ▼                              ▼
 ┌────────────────┐   ┌───────────────────────────────────────────────────────────────────────────────────────────────────────┐
 │ Controller.js  │   │  WORKFLOWS (live inside Menu.js / Quick Start.js / Settings Sheet.js – no separate layer today)         │
 │ run(), init/   │   │                                                                                                         │
 │ closing hooks, │   │   refreshAllDataForConfigSheet(config, result)      updateAfterEdit(sheet, e)     autoRefreshContent(e)  │
 │ error → alert  │   │   1 read config → 2 query BC (all pages)            re-analyse config sheet       permit check → loop     │
 │ Custom errors  │   │   3 clear + write result sheet                      after user edits              over sheets             │
 └────────────────┘   └───┬───────────────┬──────────────────────────────┬───────────────────────────────┬──────────────────────┘
                          │               │                              │                               │
        ┌─────────────────▼──┐   ┌────────▼──────────────────┐   ┌───────▼─────────────────┐   ┌─────────▼────────────────────┐
        │ SHEET: CONFIG       │   │ BC / OData ACCESS         │   │ SHEET: SETTINGS          │   │ AGENT / TRIGGER MANAGEMENT    │
        │ Sheet Coeditor.js   │   │ Autoryzacja BC.js (OAuth2)│   │ Settings Sheet.js        │   │ Trigger Manager.js            │
        │  SheetCoeditor      │   │  BCConnection             │   │  SettingsSheet           │   │  AgentManager · TriggerWrapper│
        │  header block,      │   │ OData Query.js            │   │  table of config→result  │   │  Document/UserTriggerLog      │
        │  read rows, insert  │   │  ODataQuery (build $url)  │   │  sheets, refresh freq,   │   │  StorageArray / StorageObject │
        │  rows, validations, │   │ OData Response Handling   │   │  last refresh, checkbox  │   │ Status Manager.js             │
        │  status-cell colours│   │  ODataConnection (pages)  │   │  + refresh permit/trigger│   │  StatusManager (state table)  │
        │ Content Tracker.js  │   │  ODataResponseTable       │   │                          │   │ Track onEdit Triggers.js      │
        │  CoedContentTracker │   │ Metadata.js               │   │                          │   │  simple↔installable onEdit    │
        │  CCTImportConfig    │   │  BCMetadata · Edmx*       │   │                          │   │  detection, doc lock, alarm   │
        │  CoedOption (cascade│   │ Data Type.js  DataType    │   │                          │   │ Main Settings.js  MainSettings│
        │  of query options)  │   │  (OData type → sheet fmt) │   │                          │   │  addon status, permits        │
        │ Data Validations.js │   └───────────────┬───────────┘   └───────────┬──────────────┘   │ Fix Register.js              │
        │  dropdown lists     │                   │                           │                  └──────────────┬───────────────┘
        └─────────┬───────────┘                   │                           │                                 │
                  │                               ▼                           │                                 ▼
                  │                  ┌──────────────────────────┐             │             ┌──────────────────────────────────┐
                  │                  │ STORES / SETTINGS        │◄────────────┴────────────►│ PLATFORM: ScriptApp triggers,    │
                  │                  │ Helper Data Store.js     │                           │ LockService, Properties          │
                  │                  │  HelperDataStore (cache+ │                           └──────────────────────────────────┘
                  │                  │  properties), Optional…  │
                  │                  │ Global Add-on Settings.js│  (tenant / environment / company)
                  │                  │ getImportSettings()      │  (StorageObject on document properties)
                  │                  └──────────────────────────┘
                  ▼
 ┌───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
 │ PLATFORM: SpreadsheetApp – direct getRange/setValues/insertRow/… calls in SheetCoeditor, SettingsSheet, Menu (result write)  │
 │           (Grid.js, copied from wyceny, would sit between the SHEET boxes and this line – not wired in yet)                  │
 └───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
 side: functions.js (array helpers, dbgLog, runLatestOnly (was runFunctionWithLock)) · Test Functions.js (manual tests) · Grid.js / Grid Util.js (unused)
```

## The two main flows

```
 REFRESH (menu / auto)                                       EDIT of a config sheet
 ──────────────────────────                                  ───────────────────────────
 Menu / autoRefresh                                          user edits cell
   → Controller.run                                            ├─ simple onEdit  → Track onEdit: wait for installable trigger
   → SheetCoeditor(read rows)  → CCTImportConfig               └─ installable sheetEdit / sheetChange
   → ODataQuery  → ODataConnection  → BC (OAuth2)                   → StatusManager.checkTriggerPower (is this agent the active one?)
   → ODataResponseTable + BCMetadata → DataType                     → updateAfterEdit → SheetCoeditor(analyse)
   → result sheet: clear, number formats, setValues                    → CoedContentTracker → dropdowns (BCMetadata)
   → status colours on config sheet (switch*Control)                   → insert rows / validations / notes written back
```

## Observations (relevant for the refactor)
- There is no use-case layer: the refresh workflow is a function in `Menu.js`; edit handling is in `Quick Start.js`; auto-refresh in `Settings Sheet.js`.
- Sheet layout knowledge (startRow 6 / startCol 2, status cells at row 2, settings table columns) is spread over `SheetCoeditor`, `SettingsSheet` and `Menu`.
- `Helper Data Store`, `MainSettings`, `getImportSettings` and `getGlobalSettings` are four different settings/storage mechanisms.
- Only the two SHEET boxes and the result write touch `SpreadsheetApp` ranges; those are exactly where the Grid layer would plug in.
