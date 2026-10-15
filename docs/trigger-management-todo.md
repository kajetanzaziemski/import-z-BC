# Trigger / agent management – fixes to do (separate branch)

Findings from the review of `Trigger Manager.js`, `Status Manager.js`, `Quick Start.js`. Not part of the single-edit detection change.

## Errors
1. **Whole-snapshot saves** of `StorageArray` (agent array), `DocumentTriggerLog`, `UserTriggerLog` (no lock, no dirty tracking; every edit run rewrites both logs via `logTriggerUsed`). Lost updates between concurrent executions, and between documents for the user log. Move to the `StorageObject` pattern (dirty keys merged under a lock), e.g. a map `triggerId -> entry`.
2. **`TriggerLog.getOldest()`** sorts descending (`b.lastUsed - a.lastUsed`) and subtracts ISO strings (NaN). Use `new Date(a.lastUsed) - new Date(b.lastUsed)`, handle `null`.
3. **`TriggerWrapper.deleteTrigger(trigger)`** with a Trigger object passes the object to `deleteEntryWithTriggerId`, so log entries are never removed (installNew pre-delete). Use `trigger.getUniqueId()`. `recruitAgent` can then return a stale id.
4. **Eviction** (`deleteOldest`): user-log entry is removed only when the current document's log had the id; the victim document keeps an ON entry. See design below.
5. **`sheetChange`** runs `sheetChangeAction` before the power check (`Quick Start.js`).
6. **`SettingsSheet.setupEditTriggers()`** (called from the constructor) creates unlogged `sheetEdit`/`sheetChange` triggers bypassing `AgentManager` and the 5-set limit. Remove or route through `AgentManager`.

## Weak spots
- Four sources of truth (project triggers, doc log, user log, `agentStorage`) reconciled only by `logCleanUp`. `deleteTrigger` does not touch `agentStorage`; drift makes eviction start too early or never.
- `installNew` partial failure (edit created, change throws) leaves an orphan; wrap in try/catch and roll back.
- Real quota is 20 triggers per user per script; 5 sets = 10, plus per-document `autoRefresh` time triggers and legacy triggers. Count project triggers before installing.
- `checkIfActive` reads logs only; a trigger deleted in the dashboard / revoked auth still looks active.
- Nested `Controller.run`: `fullStatusCheck` runs as a closing action and calls `forceAgentRefresh` -> `Controller.run`; `registerClosingOnce` flags are never reset, so log saves may run before the repair and the repair is lost.
- Several installable triggers on one document (several users): only one trace can be consumed per edit; leftovers can mask failures within the trace TTL.
- `Controller.js`: `if(e instanceof UnknownError) throw e.unknownError;` should use `err`.
- `AgentManager.deleteAllInDocument()` has an empty `forEach({})`.

## Design for finding 4 (no script-wide logs, no cross-document writes)
A script cannot write another document's properties and users cannot read each other's user properties, so:
1. Use `ScriptApp.getProjectTriggers()` (current user's triggers, all documents; `getTriggerSourceId()` = document id) as ground truth for the quota and for choosing the eviction victim. Drop `agentStorage`. Prune user-log entries whose id is not among the project triggers.
2. On eviction delete the trigger but keep the user-log entry, marked `powerOn=false` with its `SsId` (tombstone). When the owner next opens that document, run `logCleanUp()` scoped to the current `SsId`: state `OFF|ON|X` already maps to "remove user + doc entry" in `ACTION_TABLE`. Cap tombstones by age / count.
3. Other users of the evicted document rely on the single-edit detector (`Track onEdit Triggers.js`).
4. Throttle `lastUsed` writes (e.g. at most once per few hours per trigger).
5. Store only trigger ids, `SsId` and timestamps – no emails or names.
Alternative: refuse a 6th agent and tell the user which document holds the slots.
