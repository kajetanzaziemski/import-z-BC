// ---------------------------------------------------------------------------
// RESULT SHEET: the sheet an import writes its table to.
// What is specific here: the number format of a column follows the data type BC reported for it. The writing itself (clear, formats,
// chunked values) is BulkSheet.js, which does not know about BC.
// ---------------------------------------------------------------------------

const ResultSheet = {
  /**
   * Replaces the content of the result sheet (created when missing) with `table` (header row first).
   * @param sheetName {String} Result sheet.
   * @param table {Array[]} Rows of equal length; table[0] is the header row. Must not be empty.
   * @param columnDataTypes {String[]} Data type of each column (EDM or JS name); sets the number format of the column.
   */
  write(sheetName,table,columnDataTypes){
    dbgLog(columnDataTypes);
    BulkSheet.writeTable(sheetName,table,{columnFormats: columnDataTypes.map(dataType => new DataType(dataType).getSpreadsheetNumberFormat())});
  }
};
