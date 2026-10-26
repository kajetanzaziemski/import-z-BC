# The life of the agents: when they are created and destroyed

"Agent" = the pair of installable triggers `sheetEdit` (on edit) + `sheetChange` (on change) that the add-on installs for **one user and one document**.
A simple `onEdit` cannot call BC or write much, an installable one can. Everything below is read from the code and pinned by `tests/agents.test.js`
(simulated triggers, several documents of one user; nothing here was observed on a real spreadsheet, apart from what the live check showed).

## What is stored where (four records of one fact)
| Record | Scope | Content | Written when |
|---|---|---|---|
| **Project triggers** (`ScriptApp.getProjectTriggers()`) | the platform | the real triggers of this **user** in **all** documents (`getTriggerSourceId()` = document id) | by `ScriptApp` only |
| **Document log** `docTriggerArray` | this document's properties | entries `{triggerId, event, function, created, lastUsed, SsId, powerOn}` of the agents of this document | when the run closes |
| **User log** `usrTriggerArray` | the user's properties (all documents) | the same entries, for every document the user installed agents in | when the run closes |
| **Pair list** `agentArray` | the user's properties | `[[editId, changeId], ...]`, max 5 pairs | when the run closes |

Also: the **suspect flag** `agentSuspect` (document property) and the **installable record** `edit:<sheet>!<cell>instalTraceKey_` (document cache, 30 s) used by the detector.
All logs are loaded when first used in an execution and saved by a closing action of the run (`Controller`); a change made outside a run is not saved.
"Active" (`checkIfActive`) means: **the document log** has a powered-ON `sheetEdit` entry *and* a powered-ON `sheetChange` entry. It never asks the platform.

## When agents are CREATED
Only `AgentManager.installNew()` creates triggers; it is reached through `recruitAgent()` ← `StatusManager.repairStatus()` ← `forceRefresh()`. `forceRefresh()` is called by exactly two things:

1. **The status check at the end of a run** (`StatusManager.fullStatusCheck()` = "if not active, `forceRefresh`"). It is registered as a closing action by `MainSettings.setAddonStatus(true)`, which happens
   - at the start of **every run whose action name begins with `menu`** (`Controller.run` switches the add-on ON for any menu click: authorise, wizard, refresh, estimate, refresh all, analyse ...), and
   - when the sidebar calls `changeAddonStatus(true)` (the on/off switch).
   So: **the first menu click in a document (or after the agents stopped counting as active) installs the agents.** A click when they are active changes nothing. A sidebar call named `request...` (status, settings,
   permits ...) does not switch the add-on on and installs nothing. Opening the document (`onOpen`) never installs: if the add-on is ON and the agents are not active it only shows an alert
   ("Kreator importu z BC nie jest w pełni skonfigurowany ...") when the run closes; if the add-on is OFF the whole run is skipped.
2. **The button "Odśwież konfigurację"** (`forceAgentRefresh`) — unconditionally, also when the agents work (see "replacing" below).

`installNew()` does, in this order: delete **every** user `sheetEdit`/`sheetChange` (any edit/change trigger of this project, whatever its function) bound to this document ->
create the edit trigger -> create the change trigger -> log both in the document log and the user log -> push `[editId, changeId]` to the pair list. Rule in `TriggerGateway`:
at most one edit and one change trigger per user and document (otherwise `SimpleError`). If creating the change trigger fails after the edit one was created, the edit trigger is deleted again (all or nothing). Before anything is deleted or created the user's triggers are counted: a pair that would pass the platform's quota of 20 triggers per user and script (the document's own edit/change triggers, about to be replaced, do not count) is refused with a message.

`recruitAgent()` first asks "active?" — if yes it returns the existing edit trigger's id and does nothing. Otherwise: if the **pair list already has 5 pairs** (all documents of the user together) it evicts one first (below), else it installs.

**No other path.** `SettingsSheet` used to create raw `sheetEdit` / `sheetChange` triggers (not logged, outside the limit) whenever it was built; that is gone. The agents come only from the status check / the button above.

## When agents are REPLACED
`forceRefresh()` = **power off** every agent of the document (document log and user log, `powerOn=false`) -> **clean up** the logs against the project triggers (table below) -> `recruitAgent()`.
Because the entries are OFF and the triggers still exist, the clean-up row `OFF|OFF|V` removes the log entries and **uninstalls** the triggers, then a new pair is installed (new ids). So the button, and a status
check after the detector powered the agents off, both end with a *different* pair, and the suspect flag is cleared (`clearAgentSuspect`, "agents repaired").

## When agents are DESTROYED or stop working
| Situation | What happens to triggers | What happens to logs |
|---|---|---|
| **Eviction**: a 6th pair is needed (6th document of the user, or a repair) | the pair whose edit trigger was **used least recently** (`lastUsed`, else `dateCreated`; an entry without a readable date counts as oldest) is deleted from the project, wherever it was installed | removed from the pair list and, **only if it belongs to the current document**, from the document log and user log. A pair of another document keeps its ON entries in *that* document's log (a script cannot write another document's properties) and its entries in the user log |
| **Detector, 1st miss** (edit in the document, no `sheetEdit` reported it within 12 s) | nothing | `agentSuspect` set; alert shown |
| **Detector, 2nd miss** with no installable run in between | nothing is deleted | all `sheetEdit`/`sheetChange` entries of the document **powered OFF** (doc log and user log); the installable handlers then skip the edit (`agent.skipped`); alert shown |
| further misses while OFF | nothing | nothing, no alert |
| **Status check / button** after power off | the OFF pair is uninstalled (`OFF|...|V` rows) | entries removed, then replaced (above) |
| **"Delete all agents in log"** (Trigger table sidebar) | every pair of the **user's pair list** is deleted, in all documents | pair list emptied; document-log entries only if they belong to this document; **user-log entries of other documents remain** |
| **"Purge User/Document Log"** (same sidebar) | none | only the log is emptied |
| Add-on switched **OFF** (`changeAddonStatus(false)`) | none | none. Triggers keep firing but `Controller.run` returns at the gate |
| Logout, closing the document, removing the add-on | none (the code does nothing here) | none |

An installable run that happens while the add-on is ON also **marks the trigger used** (`lastUsed`, both logs) at the start of every `sheetEdit`/`sheetChange` run, and clears the suspect flag
(`recordInstallableSeen`, before the power check, so a powered-off but alive agent is still seen). A powered-off or unlogged trigger id gives `isPowered = false`: the edit is skipped (`sheetChange` quirk:
a powered-off or unlogged `sheetChange` is skipped too and announces `agent.skipped`; it used to run the action before looking at the power).

## The detector (how a dead agent is noticed)
Every user edit fires the simple `onEdit` and the installable `sheetEdit`. The installable one leaves a counter in the document cache; the simple one polls for it every 500 ms for up to 12 s and consumes it.
No record -> `raiseAgentAlarm`: first time = **suspect** (flag + alert), second time while the flag is still set = **dead** (power off all + alert, or nothing if already off). An installable run clears the flag.

## Reconciliation table (`ACTION_TABLE`, run by `logCleanUp`)
For every trigger id in any of the three records: state `user | document | project` (`ON`/`OFF`/`X`=not logged, `V`/`X`=trigger exists or not) -> what to do.
`Remove` = delete the entry from the pair list and the log; `Uninstall` = delete the trigger; `Reinstate` = create the user-log entry from the trigger.
```
ON|ON|V  nothing               ON|ON|X  remove user+doc       ON|OFF|X remove user+doc      ON|X|V  nothing          ON|X|X  remove user
OFF|ON|V remove u+d, uninstall OFF|ON|X remove u+d            OFF|OFF|V remove u+d, uninstall OFF|OFF|X remove u+d   OFF|X|V remove user, uninstall   OFF|X|X remove user
X|ON|V   reinstate user        X|ON|X   nothing (ghost)       X|OFF|V  remove doc, uninstall X|OFF|X nothing (ghost)  X|X|V   nothing (raw trigger)   X|X|X nothing
ON|OFF|V  user powered OFF (tombstone), remove doc, uninstall   (the document's OFF wins; the row was missing before)
```
`ON|OFF|V` can arise when a stale write brings the user log's ON back after the document powered the agents off. `X|ON|X` is what an **evicted** document is left with: its log says ON, the trigger is gone, the clean-up does nothing, `checkIfActive` says "active", no status check repairs it.

## What this adds up to (observed in `tests/agents.test.js`)
- One user with agents in six documents: the sixth evicts the first. The first document believes it is covered (ghost entries), nothing repairs it; its next edits trigger the detector (suspect, then dead + OFF),
  and its next menu click repairs it — by evicting the *next* oldest pair. With more than five documents the documents take each other's slots in turn.
- Real quota: 20 triggers per user and script; five pairs are ten, plus the time triggers of the automatic refresh. Nothing counts them.
- Logs are whole-array snapshots written at the end of a run (`StorageArray`): two runs of one document that both change a log can overwrite each other.
