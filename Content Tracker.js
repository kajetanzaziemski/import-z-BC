class CoedOption{
  constructor(values,dataValidationTickets,cct,table){
    this.label = values[0];
    this.option = undefined;
    this.cct = cct;
    this.table = table;

    dataValidationTickets = this.prepareDataValidationsForChaining(dataValidationTickets,values.length);
    this.setDataValidation(dataValidationTickets[0]);
    if(values.length>1) if(values.slice(1).join("") || dataValidationTickets.slice(1).join("")) this.addOption(values.slice(1),dataValidationTickets.slice(1));
  }
  
  prepareDataValidationsForChaining(dataValidationTickets,length){
    if(!dataValidationTickets) dataValidationTickets = [];
    if(!Array.isArray(dataValidationTickets)) dataValidationTickets = [dataValidationTickets];
    if(dataValidationTickets.length<length) dataValidationTickets = dataValidationTickets.concat(Array(length-dataValidationTickets.length).fill(null));
    return dataValidationTickets;
  }
  
  // - - - - - - - - Set - - - - - - - -   
  addOption(values,dataValidations){
    //if(this.label == "queryOption" || this.label == "extendOption") this.option = new CQueryOption(values,null,this.cct);
    //else 
    this.option = new CoedOption(values,dataValidations,this.cct,this.table);
  }

  setDataValidation(dataValidationTicket){
    this.dataValidationTicket = dataValidationTicket;
    return this;
  }
  
  // - - - - - - - - Get - - - - - - - - 
  getLabel(){
    return this.label;
  }

  getValue(){
    return this.option ? this.option.label : null;
  }

  getDataValidation(){
    // return this.cct.dValStore.realMyDataValidation(this.getDataValidationTicket());
    return this.getDataValidationTicket() ? this.cct.dValStore.realMyDataValidation(this.getDataValidationTicket()) : null;
  }

  getDataValidationTicket(){
    return this.dataValidationTicket;
  }

  getDataValidationsChain(){
    let res = [this.getDataValidation()];
    if(this.option){
      res.push(...this.option.getDataValidationsChain());
    }
    if(this.constructor.name=="CQFOperatorOption"){
      // dbgLog(res.map(item => item ? item.getDescription() : "(empty)"));
      // dbgLog(this.option);
    }
    return res;
  }

  getLabelChain(){
    let res = [this.getLabel()];
    if(this.option){
      res.push(...this.option.getLabelChain());
    }
    return res;
  }

  // - - - - - - - - Debugging - - - - - - - - 
  representationChain(){ 
    let res = [
      `${this.cct ? "." : "!"}${this.label ?? "null"} \n` +
      `(${this.constructor.name}) \n` +
      `=${this.getValue() ?? "null"} \n` +
      `(${this.getDataValidation() ? this.getDataValidation().getDescription() : " - no data validation - "}) \n` +
     `(${this.getDataValidationTicket() ? this.getDataValidationTicket() : " - no data validation - "}) \n` +
      `${this.option === undefined ? "-$" : "-->"}`
    ];
    if(this.option){
      res.push(...this.option.representationChain());
    }
    return res;
  }
}

class CQueryOption extends CoedOption{
  constructor(values,dataValidations,cct,table){
    super(values,dataValidations,cct,table);
    this.setDataValidation("simple:queryOptions");
    // this.setTable(table);
  }

  setTable(table){
    this.table = table;
  }

  addOption(values){
    switch(values[0]){
      case "filter":
        this.option = new CQFilterOption(values,["table",this.getTable(),"fields"].join(":"),this.cct,this.table);
        return this;
      case "select":
        this.option = new CoedOption(values,["table",this.getTable(),"fields"].join(":"),this.cct,this.table);
        return this;
      case "filterLogic":
        this.option = new CoedOption(values.length>1 ? values : [values,null],[["table",this.getTable(),"fields"].join(":"),"simple:filterLogic"],this.cct,this.table);
        return this;
      case "orderBy":
        this.option = new CoedOption(values.length>1 ? values : [values,null],[["table",this.getTable(),"fields"].join(":"),"simple:orderBy"],this.cct,this.table);
        return this;
      default:
        super.addOption(values);
        return this;
    }
  }

  getTable(){
    return this.label == "queryOption" ? "table" : this.label == "extendOption" ? "extend" : undefined;
  }

  getValue(){
    return this.option ? joinIfNotEmpty(this.option.label,this.option.getValue()) : null;
  }
}



class CQFilterOption extends CoedOption{
  constructor(values,dataValidations,cct,table){
    super(values,dataValidations,cct,table);
    // this.table = table;
    if(!this.option) this.addOption("",null);
    this.option.setDataValidation("simple:operators");
  }

  addOption(values,dvalditaions){
    this.option = new CQFOperatorOption(values,dvalditaions,this.cct,this.table);
  }
}

class CQFOperatorOption extends CoedOption{
  constructor(values,dataValidations,cct,table){
    super(values,dataValidations,cct,table);
    // this.table = table;
  }

  addOption(values){
    this.option = new CoedOption(values,["field",this.table,this.label].join(":"),this.cct);
  }


}

class CoedContentTracker{
  constructor(array){
    this.originalArray = array;
    this.lines=[];
    this.importantValues={};
    this.fixRegister = new FixRegister();
    this.dValStore = null;
    this.insertRows = [];
    this.dValChanges = [];

    this.beforeReading();
    this.setupDValStore();
    this.addFromArray(array);
    this.applyAllFixes();
    this.dValStore.populate(this.importantValues);
  }

  beforeReading(){
    // empty function for inheriting
  }

  setupDValStore(){
    // empty function for inheriting
  }
  
  // - - - - - - - - Get - - - - - - - - 
  getImportantValue(key){
    return this.importantValues[key];
  }

  getDataValidationsArray(){
    let res = [];
    this.lines.forEach(line => {
      let row = line.option.getDataValidationsChain();
      row.unshift(null);
      // dbgLog(row);
      res.push(row);
    });
    return rectArray(res,5);
  }

  // - - - - - - - - Set - - - - - - - - 
  addFromArray(array){
    array.forEach(line => this.addLine(line[0],line.slice(1)));
  }

  addLine(label,values){
    let line = {
      option: this.createLineOption(label,values),
      active: true
    };
    return this.lines.push(line)-1;
  }

  createLineOption(label,values){
    return new CoedOption([label].concat(values),null,this);
  }

  // - - - - - - - - Apply fixes - - - - - - - - 
  applyAllFixes(){
    let fixKeys = this.fixRegister.allKeys(true);
    fixKeys.forEach(fixKey => this.applyFix(fixKey));
  }

  applyFix(key){
    if(this[key]){ 
      // dbgLog(`${key} found in CCT`);
      let fixes = this.fixRegister.allEntries(key,true);
      fixes.forEach(fix => this.runKeyFunction(fix));
      this.fixRegister.removeAll(key);
    }
    // else dbgLog(key+" not found in CCT.");
  }

  runKeyFunction(fix){
    // dbgLog(`Running ${fix.key} with ${JSON.stringify(fix.params)}, line number: ${fix.rowNumber}`);
    return this[fix.key](...fix.params,fix.rowNumber);
  }

  // - - - - - - - - Verify data validations - - - - - - - -  
  checkDisplayedDataValidations(displayedArray){
    this.dValChanges = [];
    let referenceArray = this.getDataValidationsArray();
    let H = referenceArray.length;
    let W = referenceArray[0].length;
    for(let i = 0; i<H; ++i){
      for(let j = 0; j<W; ++j){
        
        let rules = null;
        
        if(displayedArray[i][j]==null){ 
          if(referenceArray[i][j]!=null) rules = referenceArray[i][j];
          else ;
        }
        else if(referenceArray[i][j]==null){ 
          if(displayedArray[i][j]!=null) rules = null;
        }
        else if(referenceArray[i][j].isSameAsSample(displayedArray[i][j])){
          // dbgLog(`Match found at ${i},${j}`);
        }
        else{
          rules = referenceArray[i][j];
        }
        
        if(rules) this.dValChanges.push({
          row: i,
          col: j,
          rules: rules
        })
        
      }
    }
    return this.dValChanges;
  }

  // - - - - - - - - Debugging - - - - - - - -  

// -X-#-X-#-X--X-#-X-#-X--X-#-X-#-X-  UNDER CONSTRUCTION  -X-#-X-#-X--X-#-X-#-X--X-#-X-#-X--X-#-X-#-X-
// Obsolete. Requires updating.
  logContent(){
    dbgLog("#--- CoedContentTracker contet:");
    dbgLog(this.lines);
    dbgLog(this.importantValues);
    dbgLog("#--- ------------------ ------");
  }
// -X-#-X-#-X--X-#-X-#-X--X-#-X-#-X--X-#-X-#-X--X-#-X-#-X--X-#-X-#-X--X-#-X-#-X--X-#-X-#-X--X-#-X-#-X-

  arrayRepresentation(){
    let res = [];
    this.lines.forEach(line => {
      res.push(line.option.representationChain());
    });
    return rectArray(res);
  }
}

class CCTImportConfig extends CoedContentTracker{
  // constructor(array){
  //   super(array);
  // }
  // - - - - - - - - Set - - - - - - - - 
  beforeReading(){
    this.fixRegister.logFixIfNotExists("setupTable",-1,[]);
  }

  setupDValStore(){
    this.dValStore = new ConfigDValStore();
  }

  // - - - - - - - - Get - - - - - - - - 
  getTable(){
    return this.getImportantValue("table");
  }

  getExtendTable(){
    return this.getImportantValue("extend");
  }

  getQueryArray(queryType){
    let res = [];
    this.fixRegister.allEntries(queryType).forEach(entry => {
      // dbgLog(entry.key + " _at_ "+entry.rowNumber);
      res.push(this.lines[entry.rowNumber].option.getLabelChain().slice(1));
    });
    return rectArray(res,4);
  }

  getTableQueryArray(){
    return this.getQueryArray("queryOption");
  }

  getExtendQueryArray(){
    return this.getQueryArray("extendOption");
  }
  
  // - - - - - - - - Config Import settings - - - - - - - - 
  singleLineOptionFixKey(label,key){
    return label+"_"+key;
  }

  queryOptionLabel(label,key){
    label = label=="table" ? "queryOption" : label=="extend" ? "extendOption" : label;
    return key ? this.singleLineOptionFixKey(label,key) : label;
  }


  // - - - - - - - - Read content - - - - - - - - 
  addLine(label,values){
    let lineNumber = super.addLine(label,values);
    let line = this.lines[lineNumber];
    let singleLineOptions = ["table","extend"];
    let queryOptions = ["queryOption","extendOption"];
    if(singleLineOptions.includes(label)) this.readSingleLineOption(line,lineNumber);
    else if(queryOptions.includes(label)) this.readQueryOption(line,lineNumber);
    else switch(label){
      case "header":
        // this.logFix(["headerFlag"+row[1],rowPosition]);
        break;
    }
    return lineNumber;
  }

  createLineOption(label,values){
    if(label == "queryOption") return new CQueryOption([label].concat(values),null,this,"table");
    if(label == "extendOption") return new CQueryOption([label].concat(values),null,this,"extend");
    if(label == "table") return new CoedOption([label].concat(values),"simple:tables",this);
    if(label == "extend") return new CoedOption([label].concat(values),"table:table:navProperties",this);
    return new CoedOption([label].concat(values),null,this);
  }

  readSingleLineOption(line,lineNumber){
    this.fixRegister.logFix(this.singleLineOptionFixKey(line.option.getLabel(),"flag"),lineNumber);
    if(line.option.getValue()){
      if(!this.fixRegister.exists(this.singleLineOptionFixKey(line.option.getLabel(),"valueFlag"))){
        this.fixRegister.logFix("setValue",lineNumber,[line.option.getLabel(),line.option.getValue()],1);
        this.fixRegister.logFix("setupOptions",lineNumber,[this.queryOptionLabel(line.option.getLabel())]);
      }
      this.fixRegister.logFix(this.singleLineOptionFixKey(line.option.getLabel(),"valueFlag"),lineNumber);
      if(line.option.getLabel()=="table"){
        this.fixRegister.logFixIfNotExists("setupExtend",lineNumber,[]);
      }
    }
  }

  readQueryOption(line,lineNumber){
    if(!line.option.getValue()) this.fixRegister.logFix(this.queryOptionLabel(line.option.getLabel(),"emptyQueryOptionFlag"),lineNumber);
    this.fixRegister.logFix(line.option.getLabel(),lineNumber);
  }

  // - - - - - - - - Fix functions - - - - - - - - 
  setValue(label,value,rowNumber){
    this.importantValues[label] = value;
  }

  setupExtend(lineNumber){
    if(!this.fixRegister.exists(this.singleLineOptionFixKey("extend","flag"))){
      this.insertRows.push({
        afterRow: this.fixRegister.lastRowNumber(this.queryOptionLabel("table")) ?? this.fixRegister.lastRowNumber(this.singleLineOptionFixKey("table","flag")) ?? rowNumber,
        rowContent: ["extend"]
      });
    }
  }

  setupTable(lineNumber){
    if(!this.fixRegister.exists(this.singleLineOptionFixKey("table","flag"))){
      this.insertRows.push({
        afterRow: lineNumber,
        rowContent: ["table"]
      });
    }
  }
  
  setupOptions(label,rowNumber){
    if(!this.fixRegister.exists(this.queryOptionLabel(label,"emptyQueryOptionFlag"))){
      // logObjectsArray(this.fixRegister.allEntries(this.queryOptionLabel(label)));
      // dbgLog(`Insert row after last ${label}, line number: `+this.fixRegister.lastRowNumber(this.queryOptionLabel(label)));
      // dbgLog(`If no ${label}s, then insert at pos. spec. by setupOptions: `+rowNumber);
      this.insertRows.push({
        afterRow: this.fixRegister.lastRowNumber(this.queryOptionLabel(label)) ?? rowNumber,
        rowContent: [this.queryOptionLabel(label)]
      });
    }
    else{
      // dbgLog(`Empty ${label} available at line number ` + this.fixRegister.firstRowNumber(this.queryOptionLabel(label,"emptyQueryOptionFlag")));
    }
  }

}