# The Controller: one run per entry point

`Controller.run(actionName, fn, e)` (`Controller.js`) wraps every entry point of the add-on. An entry point is whatever the platform calls: a trigger, a menu item, a sidebar
call (`google.script.run`), the OAuth callback. Each such call is a **separate Apps Script execution** with a fresh global scope: the Controller's lists, `Store.object` cache and the
memoised settings / trigger-log singletons start empty every time. So: **one run per execution**.

## The rules
1. **Every platform entry goes through `Controller.run`.** `tests/controller.test.js` derives the list of entries (trigger names, `addItem` handlers in `Menu.js`, functions the sidebars call, `authCallback`) and fails if one bypasses it.
   `Controller.run` is called from entry points only (a test checks the enclosing function of every call), and there is no second wrapper (`Controller.checked` was removed).
2. **No nested runs.** Entry points do not call each other; shared work lives in a use case both call (e.g. `StatusManager.forceRefresh()` is used by the sidebar's `forceAgentRefresh` and by the status check after switching the add-on ON). If a run is started while
   another is in progress the work is still done inline, but `console.error("NESTED RUN ...")` says so - nothing may do that (tests assert no such line in the flows they run).
3. **The one exception is `onOpen`: the menu is built first, outside the Controller**, in every auth mode (fast, needs no services, must appear whether the add-on is ON or not). Where the script is authorised (`authMode != NONE`) the rest
   (the status check that warns when the agents are not active) is an ordinary run `"onOpen"`.
4. The three functions the live check sidebar polls every few seconds (`liveCheckSidebarData`, `...Detail`, `...SetEnabled`) are not wrapped on purpose (they would fill their own list). Test functions (`Test Functions.js`) are out of scope.

## What one run does
```
run(name, fn, e)
  0. a run already in progress?  -> report NESTED RUN, do fn inline, return          (a mistake, see 2.)
  1. live check: take the "before" snapshot                                          (only with the Live Check files)
  2. name starts with "menu"     -> the add-on is switched ON  (settings sheet name ensured; one status check registered for the end)
  3. gate: add-on OFF and the name does not start with "request"  -> skipped, returns null (nothing registered before runs)
  4. initial actions (registerInit), then fn(ctx)           ctx = { event, actionName, registerClosing, data }
  5. an error is logged whole (console.error) and remembered; an `UnknownError` (the wrapper of an unexpected error, e.g. from `TriggerWrapper`) is replaced by the original error it carries, which is what the caller gets
  6. closing actions, in order, each in its own try/catch - also after an error; actions registered WHILE closing run after the queued ones
  7. live check: judge the outcome; rethrow the remembered error, else return fn's result
```
Name prefixes: `menu…` = the user chose something in the add-on menu (so the add-on is ON afterwards); `request…` = a sidebar / callback call that must work with the add-on OFF (status, settings, the OAuth callback); anything else is skipped while OFF
(the triggers: a switched-off add-on does nothing on edits).

## Closing actions: where saves live
`StorageObject` / `StorageArray` / the trigger logs register their save **when they are built**, with `registerClosingOnce(fn, flag)` (a flag registers once per execution). So an entry point that changes a setting must be inside a run, otherwise the save never happens
(direct `Store.set` writes are immediate and need no closing action). Two consequences, both fixed:
- Registered **before** the run (the edit trigger's log line builds the settings object first): kept for the run (bugs-todo #1).
- Registered **during the closing phase** (the status check repairs the agents there and builds the trigger logs): run too, in order, with a safety cap of 200 (bugs-todo #2).

Also: user alerts are registered as closing actions, so they appear after the state is saved.

## Known, left alone
- A second top-level run in the same execution (the script editor, tests) does not save what the memoised state objects changed (their save was registered when they were built, in the first run). Production never has a second run.
- `onOpen` keeps `authMode != NONE` as the condition for the run (`LIMITED` included), as before.
