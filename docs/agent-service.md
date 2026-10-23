# AgentService: what it is, what is in it, how to get there

"Agent" = the pair of installable triggers (`sheetEdit` + `sheetChange`) that the add-on installs for a user and a document, because a simple `onEdit`
cannot call BC or write much. About 900 lines in 3 files: `Trigger Manager.js` (430), `Status Manager.js` (296), `Track onEdit Triggers.js` (178).
Read from the code on branch `refactor-and-grid`; nothing here is changed yet.

## What the code does today (4 jobs in 3 files)
| Job | Where | Notes |
|---|---|---|
| **A. Talk to ScriptApp** | `TriggerWrapper` (static): create/delete/list triggers, `_safeRun` → `UnknownError`, rule "one onChange per user+document" | pure platform adapter; also `getProjectTriggers()` (needed for time triggers, see CLAUDE.md) |
| **B. Remember triggers** | `TriggerLog` → `DocumentTriggerLog`, `UserTriggerLog` (entries: id, event, function, created, lastUsed, `powerOn`); `AgentManager.agentStorage` = `StorageArray` of `[editId, changeId]` pairs in the *user* store | persistent registry; saved by `Controller.registerClosingOnce` |
| **C. Manage the pool** | `AgentManager`: `checkIfActive`, `recruitAgent`, `reclaimAgent` (limit 5 per user), `installNew`, `delete`, `deleteOldest`, `deleteAll` | lifecycle of the pairs |
| **D. Reconcile + decide** | `StatusManager`: `ACTION_TABLE` (User\|Document\|Script state → remove / reinstate / uninstall), `logCleanUp`, `repairStatus`, `checkTriggerPower`, `powerOffAllAgentsInFile` | the 3-log state machine |
| **E. Detect a dead agent** | `Track onEdit Triggers.js`: simple `onEdit` waits (poll 500 ms, ≤12 s) for a counter the installable `sheetEdit` wrote to the document cache; 1st miss = *suspect* flag, 2nd miss = power off all | locks, TTL cache, flag in document properties |
| **F. Show it** | `StatusManager.lightFailInfo` (alert), `statusSidebar`, `triggerTableSidebar`, `getAllProjectTriggers` (+ `ExtTrigInfo` building **HTML links with `openById(...).getName()`**) | UI mixed into the logic |

## What "no sheet access" means here (checked with grep)
The three files never touch cells/ranges. They do touch the *spreadsheet object* and the UI, in exactly these places, which is why I said the
service should be separated from them:
- `TriggerWrapper`: `getActiveSpreadsheet()` (to bind a trigger), `SsId` of an entry.
- `StatusManager`: `getUi().alert` (fail info), `showSidebar` ×2, `ExtTrigInfo.getEntryAsArray` → `openById(...)`.
- `Track onEdit Triggers.js`: `e.range.getSheet().getName() + '!' + a1` (the edit's fingerprint) – only from the event object.
So: **no Grid is ever needed here**. The Grid layer and AgentService are independent; AgentService only needs the platform (L0) and the state store.

## Proposed shape: one facade, five internal parts
```
                 use cases (HandleEdit, CheckStatus, ConnectBC...)  ── only call ──►  Agents  (facade, the ONLY public name)
                                                                                         │
        ┌────────────────────────────────────────────────────────────────────────────────┴──────────────────────────────┐
        │  EditDetector (E)        Reconciler (D)            AgentPool (C)            TriggerRegistry (B)   StatusView (F)  │
        │  decide ok/suspect/dead  pure: 3 maps → actions    install/limit/delete     doc log, user log     data → rows     │
        └───────────────┬────────────────┬───────────────────────────┬──────────────────────┬──────────────────────────────┘
                        │                │                           │                      │
                  Lock, Cache      TriggerGateway (A) ◄──────────────┘                  Store (document/user)
                  (L0 wrappers)    = TriggerWrapper, the only ScriptApp caller          (merge-on-save, CLAUDE.md)
```
**Facade (`Agents`)** – the whole outside contract:
| Call | Replaces |
|---|---|
| `Agents.isActive()` | `StatusManager.basicStatusCheck`, `AgentManager.checkIfActive` |
| `Agents.isPowered(triggerId)` | `StatusManager.checkTriggerPower` (used by `sheetEdit` / `sheetChange`) |
| `Agents.repair()` | `forceAgentRefresh` = `powerOffAll` → `reconcile` → `recruit` |
| `Agents.powerOffAll()` / `Agents.deleteAll()` | `powerOffAllAgentsInFile`, `deleteAllAgents` |
| `Agents.verifyEdit(fingerprint)` → `'ok' \| 'suspect' \| 'dead'` | `checkInstallableAgentRan` + `raiseAgentAlarm` (**returns the verdict; the use case shows the alert**) |
| `Agents.recordEdit(fingerprint, triggerId)` | `recordInstallableSeen` |
| `Agents.snapshot()` → plain rows | `getAllProjectTriggers` without HTML |

Inside: `Reconciler.plan(userMap, docMap, scriptSet)` is a **pure function** (today `ACTION_TABLE` + the loop in `logCleanUp`); `EditDetector` takes
`{cache, lock, clock, sleep}` so it can run against fakes. UI (`lightFailInfo`, sidebars, the HTML links of `ExtTrigInfo`) moves out to `CheckStatus` /
`StatusSidebar` (L4/L5), which receive the verdict/rows.

## Smells found while reading (worth fixing during the move, each needs its own test first)
1. **`StorageArray` writes the whole array back** (`saveArray`), unlike `StorageObject` (merge under lock). `AgentManager.agentStorage` and the trigger logs are
   snapshots saved at the end of every execution; two concurrent executions (onEdit + onChange) can overwrite each other's `push`/`splice` – the exact
   hazard CLAUDE.md describes for settings. The registry needs per-entry merge (e.g. keyed object, save only changed keys).
2. **State layer depends on the entry layer**: `StorageArray`/`TriggerLog` constructors call `Controller.registerClosingOnce` (saves "when the run ends").
   Hidden coupling upward; a service that is constructed outside `Controller.run` silently never saves.
3. **Singletons through globals** (`getAgentManager()`, `getDocumentTriggerLog()`, `getUserTriggerLog()`) and cycles (`StatusManager` ↔ `AgentManager` ↔ `TriggerLog` ↔ `TriggerWrapper`).
4. `AgentManager.deleteAllInDocument` is an unfinished stub (`forEach({})`), `class TriggerManager {}` is empty.
5. `EditDetector` calls `StatusManager.powerOffAllAgentsInFile()` **and** `lightFailInfo()` (UI) from inside a trigger-time check: decision, side effect and UI in one function.
6. `getAgentStatus` returns before its `res` string code (dead code after `return`).
7. A 12 s busy-wait (`Utilities.sleep` loop) inside every simple `onEdit` (limit 30 s) – by design, but it must stay the only blocking place; inject `sleep` for tests.

## How to get there safely (live add-on, riskiest area → last)
1. **Characterisation tests first**: extend `tests/sim.js` with fakes for `ScriptApp` (triggers + `getProjectTriggers`), `LockService`, `CacheService`,
   `PropertiesService`; pin the current behaviour of: `ACTION_TABLE` for all 18 combinations, `recruitAgent` with limit 5, the two-miss alarm sequence
   (ok → suspect → dead, and "installable run clears suspect"), `checkTriggerPower` for unknown ids.
2. Extract `Reconciler.plan` (pure) – behaviour identical, `logCleanUp` becomes "plan, then apply".
3. Extract `TriggerGateway` = `TriggerWrapper` renamed, no logic change.
4. Make `EditDetector` return a verdict; move the alert/power-off to the callers (`HandleEdit`).
5. Replace the three singletons by one `Agents` facade; keep the old global function names as one-line forwarders until entry points are switched.
6. Only then fix smell 1 (registry merge-on-save) – a data-format change, so migrate the stored arrays on first read and keep the old key readable.
Keep untouched: the refresh-permit logic (`MainSettings.*RefreshPermit`, `getProjectTriggers()` for time triggers) – it belongs to `ScheduleRefresh`, not to the agent pool.
