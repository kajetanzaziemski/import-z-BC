// FROZEN copy of ResultSheet.js as it was while it called the Spreadsheet service itself (commit 2133e06). Golden reference for tests/bulk-sheet.test.js, loaded as LegacyResultSheet. Do not edit.
// ---------------------------------------------------------------------------
// RESULT SHEET: the sheet an import writes its table to.
// Today the Spreadsheet service is called directly (clear, one number format per column, one setValues), exactly as Menu.js did.
// This is the seam for the planned BulkSheet writer for tall data (Grid keeps a window of at most 3000 rows and is not meant for it).
// ---------------------------------------------------------------------------

const LegacyResultSheet = {
  /**
   * Replaces the content of the result sheet (created when missing) with `table` (header row first).
   * @param sheetName {String} Result sheet.
   * @param table {Array[]} Rows of equal length; table[0] is the header row. Must not be empty.
   * @param columnDataTypes {String[]} Data type of each column (EDM or JS name); sets the number format of the column.
   */
  write(sheetName,table,columnDataTypes){
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(sheetName);
    if (!sheet) sheet = ss.insertSheet(sheetName);
    sheet.getDataRange().clear();
    dbgLog(columnDataTypes);
    columnDataTypes.forEach((dataType,index)=>{
      sheet.getRange(1,index+1,table.length,1).setNumberFormat(new DataType(dataType).getSpreadsheetNumberFormat()); 
    });
    sheet.getRange(1, 1, table.length, table[0].length).setValues(table); 
  }
};
