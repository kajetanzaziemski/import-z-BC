// ---------------------------------------------------------------------------
// IMPORT QUERY: the BC connection that a config sheet describes (table, query lines, extend, data types).
// Shared by RefreshSheet and EstimateSheet; was written out twice in Menu.js. No sheet access of its own: it asks the SheetCoeditor.
// ---------------------------------------------------------------------------

const ImportQuery = {
  /** An ODataConnection set up from the config sheet read by `shCoed` (not yet fetched). */
  connectionFor(shCoed){
    const odConnection = new ODataConnection()
      .setODataQuery(shCoed.getTable(),shCoed.getTableQueryArray(),shCoed.getDataTypes())
      .setExtendQuery(shCoed.getExtendTable(),shCoed.getExtendQueryArray(),shCoed.getDataTypes())
      .setupConnection();
    // odConnection.queryURL = odConnection.queryURL.replace("S.A.","sa");
    dbgLog(odConnection.queryURL);
    return odConnection;
  }
};
