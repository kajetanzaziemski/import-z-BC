// ---------------------------------------------------------------------------
// CELL INSPECTOR (developer tool): what the platform stored for the data validation of the active cell, read back through the Spreadsheet service and through
// the Sheets API, side by side. Made to compare the two representations of the same dropdown (docs/bugs-todo.md #18). Read-only; no project words.
// ---------------------------------------------------------------------------

const CellInspector = {
  /** The report for the active cell (a plain object). */
  describe(){
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const range = ss.getActiveRange();
    const sheetName = range.getSheet().getName();
    const a1 = range.getA1Notation();
    const first = a1.split(':')[0];            // the top left cell of a selection
    const cell = range.getSheet().getRange ? range.getSheet().getRange(first) : range;
    return {
      cell: {sheet: sheetName, a1: first},
      service: CellInspector.viaService_(cell),
      api: CellInspector.viaApi_(ss,sheetName,first)
    };
  },

  /** The report as indented JSON text. */
  text(){
    return JSON.stringify(CellInspector.describe(),null,2);
  },

  viaService_(cell){
    const dv = cell.getDataValidation();
    const value = cell.getValue();
    return {
      value: {value: value, formula: cell.getFormula(), display: cell.getDisplayValue(), valueType: value instanceof Date ? 'date' : typeof value},
      validation: dv ? {type: String(dv.getCriteriaType()), values: dv.getCriteriaValues(), allowInvalid: dv.getAllowInvalid()} : null
    };
  },

  viaApi_(ss,sheetName,a1){
    if(typeof Sheets === "undefined" || !Sheets || !Sheets.Spreadsheets) return "The Sheets advanced service is not available.";
    try{
      const quoted = "'" + sheetName.replace(/'/g,"''") + "'";
      const res = Sheets.Spreadsheets.get(ss.getId(),{
        ranges: [quoted + "!" + a1],
        includeGridData: true,
        fields: "sheets(data(rowData(values(userEnteredValue,effectiveValue,formattedValue,dataValidation))))"
      });
      const cell = res.sheets[0].data[0].rowData?.[0]?.values?.[0] ?? {};
      return {
        userEnteredValue: cell.userEnteredValue ?? null,
        effectiveValue: cell.effectiveValue ?? null,
        formattedValue: cell.formattedValue ?? null,
        validation: cell.dataValidation ?? null
      };
    }
    catch(e){
      return "Sheets API error: " + e.message;
    }
  }
};
