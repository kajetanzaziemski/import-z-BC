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
    ConfigGrid.create(sheetName);            // inserts the sheet and writes the header block (config layout: Config Grid.js)
    return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  }

  /** Rewrites the header block of an existing config sheet (for repairing a sheet by hand, see Test Functions.js). */
  setupConfigHeader(sheet){
    ConfigGrid.resetHeader(sheet.getName());
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
    dbgLog("Many cells edit...");
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
      dbgLog("Lock received. Applying coedits.");
      this.applyCoedits();
      properties.setProperty("requireCoedit","no");
      dbgLog("Coedits applied. Setting requireCoedit to "+properties.getProperty("requireCoedit"));
    } else {
      properties.setProperty("requireCoedit","yes");
      dbgLog("Script locked. Setting requireCoedit to "+properties.getProperty("requireCoedit")+" and waiting...");
      lock.tryLock(10000);
      let requireCoedit = properties.getProperty("requireCoedit")=="yes";
      dbgLog("Lock status: "+lock.hasLock()+". requireCoedit: "+requireCoedit);
      if (lock.hasLock() && requireCoedit) {
        dbgLog("Lock available, coedits required. Applying coedits.");
        this.cct = this.loadFromSheet();
        this.applyCoedits();
        properties.setProperty("requireCoedit","no");
        dbgLog("Additional script finished. Setting requireCoedit to "+properties.getProperty("requireCoedit"));
      }
      else dbgLog("Quitting.");
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
      // dbgLog(instructions);
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

  /** The status cells of this config sheet (Config Grid.js); read once per SheetCoeditor, every switch is one commit. */
  statusCells(){
    if(!this.statusGrid) this.statusGrid = ConfigGrid.status(this.sheetName);
    if(!this.statusGrid) throw new SimpleError("Nie znaleziono arkusza konfiguracji \""+this.sheetName+"\".");
    return this.statusGrid;
  }

  setTotRowsInfo(totRows){
    this.statusCells().setTotalRows(totRows);
  }

  switchConnectionControl(active){
    this.statusCells().set("connection",active);
  }

  switchReadingControl(active){
    this.statusCells().set("reading",active);
  }

  switchDataWritingControl(active){
    this.statusCells().set("writing",active);
  }

  switchEstimateInfoActive(active=true){
    this.statusCells().setEstimateActive(active);
  }

}