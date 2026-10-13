class SheetCoeditor{
  constructor(sheetName,readingActive){
    this.sheetName = sheetName;
    this.sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
    if(!this.sheet) this.sheet = this.insertNewConfigSheet(sheetName);
    this.startRow = 6;
    this.startCol = 2;
    
    if(readingActive) this.switchReadingControl(true);
    try{
      this.cct = this.loadFromStore();
      if(!this.cct) this.cct = this.loadFromSheet();
    }
    catch(e){
      this.switchReadingControl(false);
      throw e;
    }
  }
  // - - - - - - - - Create new config sheet - - - - - - - -   
  insertNewConfigSheet(sheetName){
    let sheet = SpreadsheetApp.getActiveSpreadsheet().insertSheet(sheetName);
    this.setupConfigHeader(sheet);
    return sheet;
  }

  setupConfigHeader(sheet){
    let range = sheet.getRange(1,1,4,7);
    // Logger.log(JSON.stringify(map2D(range.getFontColorObjects(),x=>x.asRgbColor().asHexString())));
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
  }

  // - - - - - - - - Get - - - - - - - -   
  getDataRange(){
    return this.sheet.getRange(this.startRow,this.startCol,Math.max(this.sheet.getLastRow()-1,1),5);
  }

  getTable(){
    return this.cct.getTable();
  }

  getExtendTable(){
    return this.cct.getExtendTable();
  }

  getTableQueryArray(){
    return this.cct.getTableQueryArray();
  }

  getExtendQueryArray(){
    return this.cct.getQueryArray("extendOption");
  }

  getDataTypes(){
    let fields1 = this.getTableQueryArray();
    fields1 = fields1.filter(row => ((row[0]=="filter" || row[0] == "select") && row[1])).map(row => [row[1],getMetadata().getDataType(row[1],this.getTable())]);
    let fields2 = this.getExtendQueryArray();
    fields2 = fields2.filter(row => ((row[0]=="filter" || row[0] == "select") && row[1])).map(row => [row[1],getMetadata().getDataType(row[1],this.getExtendTable())]);
    return Object.fromEntries(fields1.concat(fields2));
  }

  // - - - - - - - - Load Content Tracker - - - - - - - - 

  loadFromSheet(){
    let valuesArray = this.getDataRange().getValues();
    
    // const cache = CacheService.getDocumentCache();
    // cache.put("configSheet_"+this.sheetName, JSON.stringify(valuesArray), 21600);
    
    return new CCTImportConfig(valuesArray);
  }

  loadFromStore(){
    return null;
    const cache = CacheService.getDocumentCache();
    let valuesArray = JSON.parse(cache.get("configSheet_"+this.sheetName));
    if(!valuesArray) return null;
    // this.sheet.getRange(this.startRow,this.startCol+6,valuesArray.length,valuesArray[0].length).setValues(valuesArray);
    return new CCTImportConfig(valuesArray);
  }

  // - - - - - - - - Handle events - - - - - - - - 
  sheetEdit(e){
    this.respondToManyCellsEdit();
    
    // if(e?.range?.getA1Notation().indexOf(":")<0) this.respondToSingleCellEdit(e);
    // else this.respondToManyCellsEdit();
  }

  respondToSingleCellEdit(e){
    let array = this.cct.originalArray;
    array[e.range.getRow()-this.startRow][e.range.getColumn()-this.startCol] = e.value;
    this.cct = new CCTImportConfig(array);
    this.applyCoeditsWithLock();
  }

  respondToManyCellsEdit(){
    Logger.log("Many cells edit...");
    this.cct = this.loadFromSheet();
    this.applyCoeditsWithLock();
  }

  // - - - - - - - - Modify sheet - - - - - - - -     
  applyCoeditsWithLock(){
    this.applyCoedits();
    return;
    const lock = LockService.getScriptLock();
    const properties = PropertiesService.getDocumentProperties();
    lock.tryLock(1000);
    if (lock.hasLock()) { 
      Logger.log("Lock received. Applying coedits.");
      this.applyCoedits();
      properties.setProperty("requireCoedit","no");
      Logger.log("Coedits applied. Setting requireCoedit to "+properties.getProperty("requireCoedit"));
    } else {
      properties.setProperty("requireCoedit","yes");
      Logger.log("Script locked. Setting requireCoedit to "+properties.getProperty("requireCoedit")+" and waiting...");
      lock.tryLock(10000);
      let requireCoedit = properties.getProperty("requireCoedit")=="yes";
      Logger.log("Lock status: "+lock.hasLock()+". requireCoedit: "+requireCoedit);
      if (lock.hasLock() && requireCoedit) {
        Logger.log("Lock available, coedits required. Applying coedits.");
        this.cct = this.loadFromSheet();
        this.applyCoedits();
        properties.setProperty("requireCoedit","no");
        Logger.log("Additional script finished. Setting requireCoedit to "+properties.getProperty("requireCoedit"));
      }
      else Logger.log("Quitting.");
    }

    // // Insert options cascade representation to sheet for debugging.
    // let sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Konfiguracja 2");
    // let optRep = this.cct.arrayRepresentation();
    // sheet.getRange(2,8,optRep.length,optRep[0].length).setValues(optRep);
  }
  
  applyCoedits(){
    this.switchEstimateInfoActive(false);
    if(this.insertRows()>0) this.cct = this.loadFromSheet();
    this.setDataValidationsToSheet();
  }

  insertRows(){
    this.cct.insertRows.toReversed().toSorted((a,b)=>b.afterRow-a.afterRow).forEach(instructions =>{
      // Logger.log(instructions);
      this.insertRow(instructions);
    });
    SpreadsheetApp.flush();
    return this.cct.insertRows.length;
  }

  insertRow(instructions){
    this.sheet.insertRowAfter(instructions.afterRow+this.startRow);
    this.sheet.getRange(instructions.afterRow+this.startRow+1,this.startCol,1,instructions.rowContent.length).setValues([instructions.rowContent]);
  }

  setDataValidationsToSheet(){
    let noteMsg = 'Pusta lista może wynikać z braku połączenia z BC. Spróbuj nawiązać połączenie i wywołaj opcję "Analizuj zapytanie" dla tego arkusza';
    let notesArray = map2D(this.cct.getDataValidationsArray(),x => x ? x.getDescription()=="empty selection" ? noteMsg : null : null)
    let array = map2D(this.cct.getDataValidationsArray(),x => x ? x.getSpreadsheetAppDataValidation() : null)
    this.sheet.getRange(this.startRow,this.startCol,array.length,array[0].length).setDataValidations(array).setNotes(notesArray);
  }

  setTotRowsInfo(totRows){
    let row = 2;
    let col = 6;
    this.sheet.getRange(row,col,1,1).setValue(totRows).setNumberFormat("#,##0");
    this.switchEstimateInfoActive(true);
  }

  switchConnectionControl(active){
    let row = 2;
    let col = 3;
    let cell = this.sheet.getRange(row,col,1,1);
    if(active) cell.setFontColor("black").setBackground("red");
    else cell.setFontColor("#999999").setBackground("#cccccc");
    SpreadsheetApp.flush();
  }

  switchReadingControl(active){
    let row = 2;
    let col = 2;
    let cell = this.sheet.getRange(row,col,1,1);
    if(active) cell.setFontColor("black").setBackground("green");
    else cell.setFontColor("#999999").setBackground("#cccccc");
    SpreadsheetApp.flush();
  }

  switchDataWritingControl(active){
    let row = 2;
    let col = 4;
    let cell = this.sheet.getRange(row,col,1,1);
    if(active) cell.setFontColor("black").setBackground("red");
    else cell.setFontColor("#999999").setBackground("#cccccc");
    SpreadsheetApp.flush();
  }

  switchEstimateInfoActive(active=true){
    let row = 2;
    let col = 5;
    this.sheet.getRange(row,col,1,2).setFontColor(active ? "black" : "#999999");
    SpreadsheetApp.flush();
  }

}