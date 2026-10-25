class MyDataValidation{
  constructor(dValFunc,dValArgs,dValDesc){
    this.dataValidationFunction = dValFunc;
    this.dataValArguments = dValArgs;
    this.dataValidationDescriptoin = dValDesc;
  }

  getDescription(){
    return this.dataValidationDescriptoin ?? " - unknown validation - ";
  }

  getDVFunction(){
    return this.dataValidationFunction;
  }

  isSameAsSample(sample){
    if(this.dataValidationFunction!=sample.getCriteriaType()) return false;
    if(this.dataValArguments) for(let i=0; i<this.dataValArguments.length; ++i){
      if(Array.isArray(this.dataValArguments[i])){ 
        if(!compareArrays(this.dataValArguments[i],sample.getCriteriaValues()[i])) return false;
      }
      else if(this.dataValArguments[i] !== sample.getCriteriaValues()[i]) return false;
    }
    return true;
  }

  getSpreadsheetAppDataValidation(){
    if(!this.dataValidationFunction) return null;
    // dbgLog(this.getDVFunction()+": "+JSON.stringify(this.dataValArguments));
    let args = this.dataValArguments;
    if(this.dataValidationFunction == "VALUE_IN_LIST") if(args[1]==null) args.push(true);
    return SpreadsheetApp.newDataValidation()
                        .withCriteria(
                          SpreadsheetApp.DataValidationCriteria[this.dataValidationFunction],
                          this.dataValArguments ?? []
                        ).build();
  }
}

class ConfigDValStore{
  constructor(){
    this.simple = {};
    this.simple["operators"] = new MyDataValidation(
      "VALUE_IN_LIST",
      [ODataQuery.listComparisonOperators().map(op => "'"+op)],
      "operator selection"
    );
    this.simple["queryOptions"] = new MyDataValidation(
      "VALUE_IN_LIST",
      [ODataQuery.listOptions()],
      "query option selection"  
    );
    this.simple["filterLogic"] = new MyDataValidation(
      "VALUE_IN_LIST",
      [ODataQuery.listFilterLogics()],
      "filter logic  selection"  
    );
    this.simple["orderBy"] = new MyDataValidation(
      "VALUE_IN_LIST",
      [ODataQuery.listSortingOrders()],
      "filter logic  selection"  
    );
    this.empty = new MyDataValidation(
      "VALUE_IN_LIST",
      [[]],
      "empty selection"
    );
    
    this.simple["tables"] = this.metadataTables();

    this.fields = {};
    this.navProperteis = {};

    this.date = new MyDataValidation(
      "DATE_IS_VALID_DATE",
      undefined,
      "date validation"
    );

    

    this.tables = {};
  }

  simpleList(name,array,description){
    if(!name) return this.empty; 
    if(name in this.simple) return this.simple[name];
    else return this.simple[name] = new MyDataValidation(
      "VALUE_IN_LIST",
      array ? [array] : [[]],
      description ?? name
    )
  }

  metadataTables(){
    if("tables" in this.simple) return this.simple["tables"];
    try{
      return this.simpleList("tables",getMetadata().listTables(),"table selector");
    } catch(e) {
      if(e instanceof ConnectionError) return this.empty;
      throw e;
    }
  }

  /** BC not reachable and nothing cached: the empty list (with its note), and it is not remembered, so a later run asks again. */
  whenBCAvailable(makeValidation, whenNot=this.empty){
    try{
      return makeValidation();
    } catch(e) {
      if(e instanceof ConnectionError) return whenNot;
      throw e;
    }
  }

  tableFields(table){
    if(table in this.fields) return this.fields[table];
    const validation = this.whenBCAvailable(() => new MyDataValidation(
      "VALUE_IN_LIST",
      [getMetadata().listProperties(table)],
      `field selection for ${table}`
    ), null);
    if(!validation) return this.empty;
    return this.fields[table] = validation;
  }

  tableNavProperties(table){
    if(table in this.navProperteis) return this.navProperteis[table];
    // dbgLog("Creating new DV for NavProperties of "+table);
    const validation = this.whenBCAvailable(() => new MyDataValidation(
      "VALUE_IN_LIST",
      [getMetadata().listNavProperties(table)],
      `navProperties selection for ${table}`
    ), null);
    if(!validation) return this.empty;
    return this.navProperteis[table] = validation;
  }

  dateValidator(){
    return this.date;
  }

  populate(tables){
    for(let [key,value] of Object.entries(tables)){
      this.tables[key] = value;
    }
  }

  fieldDV(table,field){
    // dbgLog(`table: ${table}, field: ${field}`);
    if(!field || !table) return null;
    let dataType = this.whenBCAvailable(() => getMetadata().getDataType(field,table), null);
    // dbgLog(`dataType: ${dataType}`);
    switch(dataType){
      case "Edm.Date": return this.dateValidator();
    }
    return null;
  }

  realMyDataValidation(ticket){
    if(ticket==null) return new MyDataValidation();
    if(typeof(ticket)!="string"){
      // dbgLog(typeof(ticket)); 
      throw new TypeError("Data Validations Store Ticket must be a valid string.");
    }
    let ticketValues = ticket.split(":");
    switch(ticketValues[0]){
      case "simple": return this.simpleList(ticketValues[1]);
      case "native":
        switch(ticketValues[1]){
          case "date": return this.dateValidator();
          default: return null;
        }
      case "table":
        // dbgLog(ticket);
        // dbgLog(ticketValues[1]);
        // dbgLog(this.tables[ticketValues[1]]);
        if(!this.tables[ticketValues[1]]) return this.empty;
        switch(ticketValues[2]){
          case "fields": return this.tableFields(this.tables[ticketValues[1]]);
          case "navProperties": return this.tableNavProperties(this.tables[ticketValues[1]]);
        }
      case "field":
        // dbgLog(ticket);
        return this.fieldDV(this.tables[ticketValues[1]],ticketValues[2])
    }
  }

}