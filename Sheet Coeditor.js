// The co-editor of one config sheet: loads the query model (Content Tracker.js) from the sheet's lines, applies what the model asks
// for (new lines, dropdowns, notes) and drives the status cells. It does not touch the spreadsheet itself: the lines and the
// status cells are reached through ConfigGrid (Config Grid.js).
const MAX_COEDIT_PASSES = 3;
const SHEET_CHANGED = Symbol("the lines changed while the co-edit was working");

class SheetCoeditor{
  constructor(sheetName,readingActive){
    this.sheetName = sheetName;
    if(!ConfigGrid.exists(sheetName)) this.insertNewConfigSheet(sheetName);

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
  }

  /** Rewrites the header block of the config sheet (for repairing a sheet by hand, see Test Functions.js; the argument is not needed any more). */
  setupConfigHeader(){
    ConfigGrid.resetHeader(this.sheetName);
  }

  // - - - - - - - - Get - - - - - - - -   
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

  /** Reads the sheet again (a new snapshot of the lines is kept for the writes that follow). */
  loadFromSheet(){
    this.lines = ConfigGrid.lines(this.sheetName);
    if(!this.lines) throw new SimpleError("Nie znaleziono arkusza konfiguracji \""+this.sheetName+"\".");
    return new CCTImportConfig(this.lines.values());
  }

  loadFromStore(){
    return null;   // the config is always read from the sheet; the cache-based variant was removed (unreachable code, see git history)
  }

  // - - - - - - - - Handle events - - - - - - - - 
  /**
   * @param e The edit event (not used: the sheet is read again).
   * @param shouldContinue {function(): boolean} Asked at the checkpoints (before the first write, after the inserted lines, before the dropdowns are written):
   *   false = a newer co-edit has started, stop here and leave the rest to it. Default: always continue.
   * @returns {boolean} true when everything was done, false when it stopped at a checkpoint.
   */
  sheetEdit(e,shouldContinue=()=>true){
    // The model is built from what was read, and building it asks BC (seconds). When the lines are not what was read any more by the time something is to be
    // written (the user pasted a line meanwhile), the pass is thrown away and done again from a fresh read: nothing is written from an old picture.
    // Bounded: a sheet that never keeps still is left to the next trigger.
    for(let pass = 1; pass <= MAX_COEDIT_PASSES; pass++){
      const result = this.respondToManyCellsEdit(shouldContinue);
      if(result !== SHEET_CHANGED) return result;
    }
    return true;
    
    // if(e?.range?.getA1Notation().indexOf(":")<0) this.respondToSingleCellEdit(e);
    // else this.respondToManyCellsEdit();
  }

  respondToManyCellsEdit(shouldContinue=()=>true){
    dbgLog("Many cells edit...");
    this.cct = this.loadFromSheet();
    if(!shouldContinue()) return false;      // checkpoint 1: nothing has been written yet
    if(this.linesChanged()) return SHEET_CHANGED;
    return this.applyCoeditsWithLock(shouldContinue);
  }

  // - - - - - - - - Modify sheet - - - - - - - -     
  applyCoeditsWithLock(shouldContinue=()=>true){
    return this.applyCoedits(shouldContinue);   // the lock (and "only the newest run completes") is runLatestOnly (functions.js), around the whole sheetEdit
  }

  applyCoedits(shouldContinue=()=>true){
    this.switchEstimateInfoActive(false);
    if(this.insertRows()>0) this.cct = new CCTImportConfig(this.lines.values());   // the sheet as the inserts left it (no second read)
    if(!shouldContinue()) return false;      // checkpoint 2: the lines are in; building the dropdowns asks BC and is the slow part
    return this.setDataValidationsToSheet(shouldContinue);
  }

  /** Are the lines on the sheet now different from what this co-edit works on (what it read, plus the lines it inserted itself)? One fresh read of the lines. */
  linesChanged(){
    const fresh = ConfigGrid.lines(this.sheetName);
    if(!fresh) return true;
    return JSON.stringify(fresh.values()) !== JSON.stringify(this.lines.values());
  }

  insertRows(){
    this.cct.insertRows.toReversed().toSorted((a,b)=>b.afterRow-a.afterRow).forEach(instructions =>{
      this.lines.insertRowAfter(instructions.afterRow,instructions.rowContent);
    });
    this.lines.save();
    return this.cct.insertRows.length;
  }

  setDataValidationsToSheet(shouldContinue=()=>true){
    let noteMsg = 'Pusta lista może wynikać z braku połączenia z BC. Spróbuj nawiązać połączenie i wywołaj opcję "Analizuj zapytanie" dla tego arkusza';
    const validations = this.cct.getDataValidationsArray();
    let notesArray = map2D(validations,x => x ? x.getDescription()=="empty selection" ? noteMsg : null : null)
    let array = map2D(validations,x => x ? x.getSpreadsheetAppDataValidation() : null)
    if(!shouldContinue()) return false;      // checkpoint 3: everything is prepared, nothing written yet
    if(this.linesChanged()) return SHEET_CHANGED;
    this.lines.setDropdowns(array,notesArray);
    this.lines.setLineFormats(QUERY_OPTION_WIDTHS,LINE_WIDTH_TABLE);      // stale cells of a line are shown grey (Config Grid.js builds the rules from the widths)
    this.lines.save();
    return true;
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