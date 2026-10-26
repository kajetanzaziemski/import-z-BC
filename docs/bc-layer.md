# The BC layer: files and what they hold

| File | Holds | Replaces |
|---|---|---|
| `BC Auth.js` | `BCAuth` (the OAuth2 service, authorise, callback, logout) and the entry point `authCallback` | `Autoryzacja BC.js` (the login half) |
| `BC Connection.js` | `BCConnection.fetchURL` - one authenticated GET, errors mapped (`ConnectionError`, URL length) | `Autoryzacja BC.js` (the fetch half) |
| `OData Query.js` | `ODataQuery` - builds the `$select/$filter/...` text | unchanged |
| `OData Connection.js` | `ODataConnection` - the query, the paged read, the total row estimate | `OData Response Handling.js` (first class) |
| `OData Response.js` | `ODataResponseTable` - one JSON page as a table | `OData Response Handling.js` (second class) |
| `BC Metadata.js` | `BCMetadata` - tables / fields / data types of BC, cached in the document cache | `Metadata.js` (first class) |
| `Edmx.js` | `EdmxDocument`, `EdmxElement`, the XML namespaces | `Metadata.js` (the rest) |

Pinned by `tests/auth.test.js`, `tests/bc-layer.test.js`, `tests/state.test.js` (metadata cache), `tests/refresh.test.js`.

## Deleted
`Test Functions.js` is out of scope (not used, not maintained): code that only it needed was removed, so **it no longer works** and must be kept on its own branch/tag before the merge into `main` (reminder in `docs/milestones.md`).
- `ODataConnection.readAllPages_test` / `readPage_test` (a hard-coded tenant url), `detDataTypes`
- `getTable`, `getTableWithRequest` (`Menu.js`; they used `ODATA_URL_`, which is defined nowhere), `basicMenu`
- `userSafe` (`Custom errors.js`), the globals `getBCService_`, `showSidebar`, `logout`
- from `BCMetadata`: `setSchema`, `setWorkingTable`; from `EdmxDocument`: the commented-out cache code and `getPropertyDataType`
