// FROZEN COPY of the config sheet header / status code of SheetCoeditor as it was before it moved to ConfigGrid
// (Sheet Coeditor.js @ 05f135a). The golden tests run it against the simulated Spreadsheet service and compare the result
// with ConfigGrid. Do not "improve" this file: its only job is to stay exactly as the old code was.
'use strict';
const legacy = {
  startRow: 6,
  startCol: 2,

  /** was SheetCoeditor.setupConfigHeader(sheet) */
  setupConfigHeader(sheet, SpreadsheetApp) {
    let range = sheet.getRange(1,1,4,7);
    // dbgLog(JSON.stringify(map2D(range.getFontColorObjects(),x=>x.asRgbColor().asHexString())));
    range.setFontWeights([["normal","bold","normal","normal","normal","normal","normal"],["normal","normal","normal","normal","normal","normal","normal"],["normal","bold","bold","normal","normal","normal","normal"],["normal","bold","bold","bold","bold","bold","normal"]]);
    range.setBackgrounds([["#cccccc","#cccccc","#ffffff","#ffffff","#ffffff","#ffffff","#cccccc"],["#cccccc","#cccccc","#cccccc","#cccccc","#cccccc","#cccccc","#cccccc"],["#cccccc","#ffffff","#ffffff","#ffffff","#ffffff","#ffffff","#cccccc"],["#cccccc","#ffffff","#ffffff","#ffffff","#ffffff","#ffffff","#cccccc"]]);
    range.setFontSizes([[10,10,10,10,10,10,10],[10,8,8,8,8,10,10],[10,8,8,10,10,10,10],[10,8,8,8,8,8,10]]);
    range.setHorizontalAlignments([["general","center","general","general","general","general","general"],["general","center","center","center","general-left","general-right","general"],["general","general-left","general-left","general","general","general","general"],["general","general-left","general-right","general-right","general-right","general-right","general"]]);
    let merge = ["B1:F1","C3:F3"];
    merge.forEach(r => sheet.getRange(r).merge());
    range.setNotes([["","","","","","",""],["","","","","","",""],["","","","","","",""],["","Skrypt czyta tylko linie z poprawnym opisem. Musi być jedną z wartości: \"table\", \"queryOption\", \"extend\", \"extendOption\". Linie z pustą lub błędną wartością opisu są pomijane.","","","","",""]]);
    range.setValues([["","Zapytanie do bazy danych BC","","","","",""],["","Analiza zapytania","Pobieranie z bazy danych","Wstawianie danych do arkusza","Szacowana liczba wierszy:","",""],["","Linie zapytania","Kolejne składowe linii zapytania","","","",""],["","Opis linii",1,2,3,4,""]]);
    range.setVerticalAlignments([["bottom","bottom","bottom","bottom","bottom","bottom","bottom"],["bottom","middle","middle","bottom","bottom","bottom","bottom"],["bottom","bottom","bottom","bottom","bottom","bottom","bottom"],["bottom","bottom","bottom","bottom","bottom","bottom","bottom"]]);
    range.setWrapStrategies([[SpreadsheetApp.WrapStrategy.OVERFLOW, SpreadsheetApp.WrapStrategy.OVERFLOW, SpreadsheetApp.WrapStrategy.OVERFLOW, SpreadsheetApp.WrapStrategy.OVERFLOW, SpreadsheetApp.WrapStrategy.OVERFLOW, SpreadsheetApp.WrapStrategy.OVERFLOW, SpreadsheetApp.WrapStrategy.OVERFLOW], [SpreadsheetApp.WrapStrategy.WRAP, SpreadsheetApp.WrapStrategy.WRAP, SpreadsheetApp.WrapStrategy.WRAP, SpreadsheetApp.WrapStrategy.WRAP, SpreadsheetApp.WrapStrategy.WRAP, SpreadsheetApp.WrapStrategy.WRAP, SpreadsheetApp.WrapStrategy.WRAP], [SpreadsheetApp.WrapStrategy.OVERFLOW, SpreadsheetApp.WrapStrategy.OVERFLOW, SpreadsheetApp.WrapStrategy.OVERFLOW, SpreadsheetApp.WrapStrategy.OVERFLOW, SpreadsheetApp.WrapStrategy.OVERFLOW, SpreadsheetApp.WrapStrategy.OVERFLOW, SpreadsheetApp.WrapStrategy.OVERFLOW], [SpreadsheetApp.WrapStrategy.OVERFLOW, SpreadsheetApp.WrapStrategy.OVERFLOW, SpreadsheetApp.WrapStrategy.OVERFLOW, SpreadsheetApp.WrapStrategy.OVERFLOW, SpreadsheetApp.WrapStrategy.OVERFLOW, SpreadsheetApp.WrapStrategy.OVERFLOW, SpreadsheetApp.WrapStrategy.OVERFLOW]]);
    range.setFontColors([["#ff000000","#ff000000","#ff000000","#ff000000","#ff000000","#ff000000","#808080"],["#ff000000","#999999","#999999","#999999","#999999","#999999","#ff000000"],["#ff000000","#ff000000","#ff000000","#ff000000","#ff000000","#ff000000","#808080"],["#ff000000","#ff000000","#ff000000","#ff000000","#ff000000","#ff000000","#808080"]]);
  },

  /** was SheetCoeditor.setTotRowsInfo */
  setTotRowsInfo(sheet, totRows) {
    let row = 2;
    let col = 6;
    sheet.getRange(row,col,1,1).setValue(totRows).setNumberFormat("#,##0");
    legacy.switchEstimateInfoActive(sheet, true);
  },

  /** was SheetCoeditor.switchConnectionControl */
  switchConnectionControl(sheet, active) {
    let row = 2;
    let col = 3;
    let cell = sheet.getRange(row,col,1,1);
    if(active) cell.setFontColor("black").setBackground("red");
    else cell.setFontColor("#999999").setBackground("#cccccc");
    SpreadsheetApp.flush();
  },

  /** was SheetCoeditor.switchReadingControl */
  switchReadingControl(sheet, active) {
    let row = 2;
    let col = 2;
    let cell = sheet.getRange(row,col,1,1);
    if(active) cell.setFontColor("black").setBackground("green");
    else cell.setFontColor("#999999").setBackground("#cccccc");
    SpreadsheetApp.flush();
  },

  /** was SheetCoeditor.switchDataWritingControl */
  switchDataWritingControl(sheet, active) {
    let row = 2;
    let col = 4;
    let cell = sheet.getRange(row,col,1,1);
    if(active) cell.setFontColor("black").setBackground("red");
    else cell.setFontColor("#999999").setBackground("#cccccc");
    SpreadsheetApp.flush();
  },

  /** was SheetCoeditor.switchEstimateInfoActive */
  switchEstimateInfoActive(sheet, active=true) {
    let row = 2;
    let col = 5;
    sheet.getRange(row,col,1,2).setFontColor(active ? "black" : "#999999");
    SpreadsheetApp.flush();
  }
};

module.exports = legacy;
