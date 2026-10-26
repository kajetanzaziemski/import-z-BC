// ---------------------------------------------------------------------------
// VALIDATION LAB (developer tool): a scratch sheet "Test weryfikacji" with the operator dropdown written in every combination, to be LOOKED at on a real sheet:
//   rows    5 rule written by the Spreadsheet service, items with an apostrophe ("'<", "'=" ... as the add-on writes them)
//           6 the same rule written by the Sheets API
//           7 rule written by the service, items without apostrophe (control)     8 the same written by the API
//   columns B ">=" written by the service   C ">=" written by the API   D "=" written by the service ("'=": plain text)   E "=" written by the API   F empty: pick from the list
// A red triangle in a cell is the warning "the value is not in the list". Which cells have it shows whether the rule, the way the value got into the cell, or the
// apostrophe matters (docs/bugs-todo.md #18). The sheet is replaced every time. Nothing else is touched.
// ---------------------------------------------------------------------------

const ValidationLab = {
  SHEET: "Test weryfikacji",

  /** Builds the sheet; returns a short note for the user. */
  build(){
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const old = ss.getSheetByName(ValidationLab.SHEET);
    if(old) ss.deleteSheet(old);
    const sheet = ss.insertSheet(ValidationLab.SHEET);
    const apiOk = typeof Sheets !== "undefined" && !!Sheets && !!Sheets.Spreadsheets;

    const quoted = ODataQuery.listComparisonOperators().map(op => "'"+op);
    const plain = ODataQuery.listComparisonOperators().filter(op => op != "=");     // a lone "=" cannot be a plain item (it would be a formula)
    const rules = [
      {row: 5, label: "reguła: usługa, elementy z apostrofem",     items: quoted, by: "service"},
      {row: 6, label: "reguła: API, elementy z apostrofem",        items: quoted, by: "api"},
      {row: 7, label: "reguła: usługa, elementy bez apostrofu",    items: plain,  by: "service"},
      {row: 8, label: "reguła: API, elementy bez apostrofu",       items: plain,  by: "api"}
    ];
    const columns = [
      {col: 2, head: ">= (usługa)",              text: ">=", typed: ">=", by: "service"},
      {col: 3, head: ">= (API)",                 text: ">=", typed: ">=", by: "api"},
      {col: 4, head: "= (usługa, jako tekst)",   text: "=",  typed: "'=", by: "service"},
      {col: 5, head: "= (API)",                  text: "=",  typed: "=",  by: "api"},
      {col: 6, head: "pusta: wybierz z listy",   text: "",   typed: null, by: null}
    ];

    sheet.getRange(1,1).setValue("Test weryfikacji operatorów. Czerwony trójkąt w komórce = ostrzeżenie, że wartości nie ma na liście. Wiersze: kto zapisał regułę. Kolumny: kto zapisał wartość.");
    sheet.getRange(2,1).setValue("W kolumnie F wybierz wartości z listy w każdym wierszu i zobacz, które komórki dostają ostrzeżenie.");
    sheet.getRange(4,1).setValue("");
    columns.forEach(c => sheet.getRange(4,c.col).setValue(c.head));
    rules.forEach(r => sheet.getRange(r.row,1).setValue(r.label));

    // values first, rules after (the add-on puts rules on cells that already hold values)
    const apiRequests = [];
    rules.forEach(r => columns.forEach(c => {
      if(c.typed === null) return;
      if(c.by == "service") sheet.getRange(r.row,c.col).setValue(c.typed);
      else if(apiOk) apiRequests.push({updateCells: {rows: [{values: [{userEnteredValue: {stringValue: c.text}}]}], start: {sheetId: sheet.getSheetId(), rowIndex: r.row-1, columnIndex: c.col-1}, fields: "userEnteredValue"}});
    }));
    if(apiRequests.length){
      SpreadsheetApp.flush();
      Sheets.Spreadsheets.batchUpdate({requests: apiRequests},ss.getId());
    }

    const ruleRequests = [];
    rules.forEach(r => columns.forEach(c => {
      if(r.by == "service"){
        sheet.getRange(r.row,c.col).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(r.items,true).setAllowInvalid(true).build());
      }
      else if(apiOk){
        ruleRequests.push({updateCells: {rows: [{values: [{dataValidation: {condition: {type: "ONE_OF_LIST", values: r.items.map(x => ({userEnteredValue: x}))}, showCustomUi: true}}]}],
          start: {sheetId: sheet.getSheetId(), rowIndex: r.row-1, columnIndex: c.col-1}, fields: "dataValidation"}});
      }
    }));
    if(ruleRequests.length){
      SpreadsheetApp.flush();
      Sheets.Spreadsheets.batchUpdate({requests: ruleRequests},ss.getId());
    }
    sheet.autoResizeColumns(1,6);
    if(!apiOk) return "Arkusz \"" + ValidationLab.SHEET + "\" utworzony, ale bez usługi Sheets (API): wiersze i kolumny API są puste.";
    return "Arkusz \"" + ValidationLab.SHEET + "\" utworzony. Zobacz, które komórki mają czerwony trójkąt, i wybierz wartości z listy w kolumnie F.";
  }
};
