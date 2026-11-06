# The limit of clock triggers (5 per user) - where it can be hit and what happens

Apps Script allows a user a small number of clock (time-based) triggers for an add-on: **5**, all documents together. The add-on creates a clock trigger in **one function only**:
`ScheduleRefresh.createTrigger_`. (The agents - `onEdit` / `onChange` in `Trigger Manager.js` - are not clock triggers and do not count.)

## What the code does about the limit
- **Counting** (`ScheduleRefresh.clockTriggerIds_`): the clock triggers the trigger list shows (union of three looks - the list is not reliable, see `triggersSeen_`) plus the triggers the user's records
  (`refreshTrigger:<id>`, `Refresh Registry.js`) saw or made within the last 10 minutes (the list may lag behind a trigger just made). All documents count. A trigger about to be replaced does not.
- **Refusing** (`assertRoomForTrigger_`): when 5 OTHER triggers are counted (the one this document's set-up is about to replace - the permit's - is not among them: it is removed first, so the total after the operation is the same) the set-up throws an error with `triggerLimit = true` - "Nie utworzono triggera: masz już 5 wyzwalaczy czasowych (limit Apps Script: 5 na użytkownika...) ... Triggery: <ids>".
  The set-up asks BEFORE it removes anything, so when it is refused the old trigger and the permit stay as they were. Changing this document's own trigger when the user has exactly 5 is allowed: 4 others + the old one -> the old one is removed, the new one installed, 5 again. Before the count, the leftovers of THIS document (its records, not the permit's) are deleted: they would only take places.
- The check sits in `createTrigger_` itself, so no path to a new trigger can skip it (the set-up passes `checked = true` after its own check, which can count the trigger it replaces).

## Every case in which a clock trigger is created, and what happens
| # | Case | Path | At the limit |
|---|------|------|--------------|
| 1 | The user edits the frequency (number / unit) or the time of day in the settings sheet | edit trigger -> Router job `settings.refreshFrequency` -> `setRefreshTrigger` -> `ScheduleRefresh.apply` -> `applyNewest_` -> `setUp` | `setUp` refuses (before removing anything). `apply` catches it: `fail_` writes the **red message** in the sheet (with the sentence about the limit), keeps the error (`refreshSetupError`, `limit: true`) for the sidebar, and the error goes on to `Controller.run` (logged, closing actions run, the execution ends with the error). If the message cannot be written, a toast says so. |
| 2 | The sidebar button "Ustaw wg. danych w arkuszu" | `applyRefreshSettings` (run `requestApplyRefreshSettings`, job `settings.refreshApply`) -> same `apply` | As 1; the sidebar's failure handler also shows "Błąd: ..." under the button, and the tab reloads with the red error box (headline, the limit sentence, the time) and "Szczegóły błędu" (the platform's error / our message with the ids). |
| 3 | "Wyłącz autoodświeżanie" | `turnOff` -> `apply` -> `setUp` | **Creates nothing**, so the limit cannot be hit. It removes the trigger and marks the permit off. |
| 4 | A set-up whose result is not right is made once more | `applyNewest_` -> `reconcile_` finds problems -> `setUp` again | The same guard: a refusal is an error of the run, as in 1 (the first `setUp` had already succeeded, so this happens only if the places were taken in between). |
| 5 | The old trigger is put back after a failed creation | `restoreAfterFailure_` -> `createTrigger_` (not `checked`) | The guard refuses; the `catch` there **marks the permit off** (what is shown is what is true) and the failure of the NEW trigger (the original error) goes on as in 1. The refresh is therefore **off** after this case. It is only possible when the places were taken between the check and the creation. |
| 6 | The platform refuses although the add-on counted fewer than 5 | `createTrigger_` -> `trigger.create()` throws the platform's "too many triggers" / "zbyt wiele wyzwalaczy" | `setUp` catches it, `restoreAfterFailure_` puts the old trigger back from the permit (a place was freed by removing it), the original error goes on as in 1; `isTriggerLimit_` recognises the message (Polish / English), or any trigger-related error while 5 clock triggers are counted, so the limit sentence is shown. The old trigger gets a new id and the same settings. |
| 7 | Several edits at once | `runLatestOnly` ("refreshSetup") | One set-up at a time; an older run drops out without creating anything. The newest run does 1-6. |
| 8 | Another user of the same document | the limit and the records are per user | The other user's triggers are not counted; if this user has no trigger of their own, the permit of the document may name theirs (the panel shows it as another user's). |

Nothing else creates a clock trigger: `onOpen` / the time zone check, the scheduled refresh, the log, the panel and the developer tool "Triggery odświeżania" only read or delete.

## Where the count can be wrong
- **Too low** (the platform may still refuse - case 6): a trigger the list does not show for longer than ten minutes AND the records do not know (made by an older version of the add-on, before the records existed), or a record lost with the user properties.
- **Too high** (a set-up is refused although a place is free): a trigger deleted by hand in the trigger editor is counted for up to ten minutes (its record was seen recently); a stale list never lowers the count.
- **Where to get places back** (not named in any message the user sees): the developer tool "Narzędzia programisty -> Triggery odświeżania" lists the user's clock triggers and deletes one (it cleans nothing else: the permit and the record stay, see `docs/use-cases.md`).

## The live check
A refusal is an expected error of the jobs `settings.refreshFrequency` / `settings.refreshApply`: the verifier then only requires that the permit is as it was (`lcVerifyRefreshTrigger_`).

## A sheet set up by the legacy version (the sidebar's guess)

Before refresh permits a document had a clock trigger (handler `autoRefresh`) and nothing else that says what is set: no interval, no owner. When the document has **no permit**,
or only the permit the legacy handler issued for itself (an `issuedFor`, no `intervalHours`, no `issuedBy`, not `off`), the "Auto-odświeżanie" tab judges from the sheet
(`ScheduleRefresh.legacyCurrent`): the refresh is shown as **on** when the sheet has a frequency and the last refresh is no older than one interval plus a margin (a quarter of
the interval, at least an hour); the next refresh is the last one + the interval. The tab says it is a guess, and "Ustaw wg. danych w arkuszu" is active (it makes a proper trigger
and permit; the legacy trigger then finds a permit that is not its own and deletes itself). Nothing else is used as a marker: every set-up of this version writes a permit
(also when it switches the refresh off, then `issuedFor` is null), and a permit is never deleted, so no extra document property is needed. Only the sidebar uses the guess;
the trigger logic (`ScheduleRefresh.current`) does not.
