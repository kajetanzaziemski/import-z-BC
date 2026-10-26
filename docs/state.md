# State: Store and Settings (L0 facade)

Step 2 of the migration plan. Pure facade: **no change of what is stored** (same scopes, keys and JSON), no change of behaviour, so a
version with and without it can run on the same document. Tests: `tests/state.test.js` (`node tests/run.js`).

## The four mechanisms, and where each went
| Before | Now |
|---|---|
| `HelperDataStore` / `OptionalDataStore` (properties + cache by scope) | implementation behind **`Store`** (`Store.js`); called from `Store.js` only |
| `StorageArray` / `StorageObject` (`Trigger Manager.js`) | moved unchanged to `Store.js`; created through `Store.object(key, scope)` (one per key and scope per run) / `Store.array(key, scope)` |
| `getImportSettings()` + `MainSettings` (add-on status, settings sheet name, refresh permit) | values in **`Settings`** (`Settings.js`: `addonStatus()`, `settingsSheetName()`, `refreshPermit()`, `issueRefreshPermit()`, `touchRefreshPermit()`, `get/set`); `MainSettings` keeps what happens *around* them (on/off words, status check at the end of the run, sheet-name lookup) and forwards; `getImportSettings()` = `Settings.store()` |
| `GlobalSettings` / `getGlobalSettings()` (tenant, environment, company × 3 scopes) | class unchanged except it calls `Store`; the one-per-run instance is `Settings.bc()`; `getGlobalSettings()` returns it |

`Store`: `get/set/remove(scope,key)`, `getJson/setJson`, `cache.get/set(…, ttl)/remove`, `optional.getCache/setCache`, `object`, `array`, `service(scope,'properties'|'cache')`, `available`.

## Callers moved (mechanical, each pinned by a test)
`Track onEdit Triggers.js` (document cache with 30 s lifetime, suspect flag), `functions.js` (`runLatestOnly` ticket), `Trigger Manager.js` (trigger logs → `getJson/setJson`,
agent pairs → `Store.array`), `BC Metadata.js` (optional document cache), `BC Auth.js` (OAuth2 property store / cache = user scope via `Store.service`),
`Global Add-on Settings.js`, `Quick Start.js` (`getGlobalSettings`, settings sheet name).
Rules in the tests: only `Store.js` touches `HelperDataStore`/`OptionalDataStore`; only `Helper Data Store.js` touches `PropertiesService`/`CacheService`; only `Store.js` constructs
`StorageObject`/`StorageArray`; only `Settings.js` knows the `importSettingsArray` key. (`Test Functions.js`, the manual tests, is exempt.)

## What the tests pin (and found)
- `StorageObject` keeps the CLAUDE.md invariant: only changed keys, merged under a lock, a stale snapshot never reverts another run's key (two executions on one fake platform).
- `StorageArray` still writes the **whole** array back: a test pins the lost update (`e3` lost) so that fixing it (agent registry, see `docs/agent-service.md` smell 1) is a conscious change.
- `getAddonStatus` logged `'true'` always (operator precedence in the `dbgLog` message); the log now shows the real value. Nothing else about it changed.
- `Edmx.js` calls `XmlService.getNamespace(...)` **at load time** (top level, line ~97). Allowed by Apps Script, but it breaks "nothing is used at load time"; left as is, the test platform has a stub.
- Dead code removed from `Sheet Coeditor.js` (statements after an unconditional `return` in `loadFromStore` and `applyCoeditsWithLock`; they were the only direct `PropertiesService`/`CacheService` uses outside the store).
- `getMainSettings()` (Quick Start) returns the **SettingsSheet** (the settings table), not `MainSettings`: a naming trap that the later `SettingsGrid` step should remove.

## Left for later
- `Controller` dependencies of the state classes (`registerClosingOnce` in constructors; `MainSettings.setAddonStatus` → `Controller` / `StatusManager`) – upward dependencies, kept.
- Renaming `Helper Data Store.js` / folding it into `Store.js` once nothing else mentions it (the manual tests still do).
- Per-entry merge for the trigger logs and the agent pairs (data-format change, needs a migration).
- Not verified on a real spreadsheet: the fakes follow the documented behaviour of Properties / Cache / Lock services (`getProperty` null when missing, cache lifetime, `tryLock` result), not an observed run.
