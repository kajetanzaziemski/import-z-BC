# The login to Business Central (`BC Auth.js`, fetch in `BC Connection.js`)

OAuth2 with the Apps Script OAuth2 library (`appsscript.json`, symbol `OAuth2`). Tokens belong to the **user** (user properties + user cache, key `oauth2.<tenant name>`), not to the document.
Pinned by `tests/auth.test.js` (written before the move) and `tests/menu.test.js`.

## Who uses the OAuth2 service (the `BCService` of the old code)
Before: the service was built by the global function `getBCService_()` and used directly in six places. Now only `BCAuth` (in `BC Auth.js`) touches the library; a test fails if another file does.

| Where | Before | Now |
|---|---|---|
| menu "Autoryzuj" (`MenuActions.authorise`) | `getBCService_().hasAccess()`; without access `showSidebar()` built the service **again** and asked `hasAccess()` **again** | `BCAuth.authorise()`: one service, one `hasAccess()`; true = connected (the alert "Połączenie aktywne!"), false = the sidebar with the link was shown. **The only behavioural change** (one token renewal attempt instead of two) |
| authorisation sidebar (`showSidebar`) | built the service, `hasAccess()`, `getAuthorizationUrl()`, sidebar | part of `BCAuth.authorise()`; the global `showSidebar()` stays and calls it |
| OAuth callback (`authCallback`) | `getBCService_().handleCallback(request)`, then `postAuthorizationFlow` -> `menuSelector` | `BCAuth.completeCallback(request)`: `handleCallback`, then `menuSelector`; the entry point only builds the result page. `postAuthorizationFlow` is gone (it only forwarded) |
| menu "Wyloguj" (`MenuActions.logout`, global `logout`) | `getBCService_().reset()` | `BCAuth.logout()` -> `service().reset()` |
| every BC request (`BCConnection.fetchURL`) | `getBCService_().getAccessToken()` | `BCAuth.accessToken()`; the error mapping is unchanged ("Access not granted or expired." -> `ConnectionError`, URL length -> Polish message) |
| `BCMetadata.downloadEdmxDocument` | built a service and **never used it** | line removed (it only built an object) |
| `getTableWithRequest` (`Menu.js`, only `Test Functions.js` called it) | `getBCService_().getAccessToken()` | deleted with `getTable` |

The global names `getBCService_`, `showSidebar`, `logout` and `postAuthorizationFlow` are gone (only `Test Functions.js` could still use them; see `docs/bc-layer.md`).

## What did NOT change
- The service configuration (names, urls, client id / secret, callback function `authCallback`, user property store, user cache, user lock, scope, `access_type=offline`, `prompt=consent`) - every call is pinned in order.
- `authCallback` is a `requestAuthCallback` run (works with the add-on OFF), `Controller.checkInput` first, the same two result pages, the menu rebuilt in both cases.
- `Controller` rules: entries in `Menu.js` / `authCallback` stay the only entry points; no nested runs.
- The menu is still always the full menu (`menuSelector` ignores its argument, as before).

## Real-sheet check (yours)
1. "Autoryzuj" while connected: alert "Połączenie aktywne!".
2. "Wyloguj", then "Autoryzuj": the sidebar with the link; follow it; the callback page says the connection was made; "Autoryzuj" says active again.
3. Any refresh after that works (BC fetch with the token); with an expired/removed token a refresh ends with the connection error as before.
