class ODataQuery { 
   constructor(queryArray,dataTypes){
    this.query = {
      select: [],
      filter: [],
      filterLogic: new Map(),
      orderBy: new Map(),
      expand: new Map(),
      limit: 100,
      count: true
    };
    this.filterDataTypes = {};
    this.info = [];

    const arrayProcessedResponse = this.addExpressionsFromArray(queryArray);
    if(arrayProcessedResponse.queryLinesCount) this.info = [arrayProcessedResponse.message];
    else this.info = ["Created with empty constructor."];
    if(dataTypes) this.setDateTypesFromObject(dataTypes);
  }

  setDateTypesFromObject(dataTypes){
    Object.entries(dataTypes).forEach(o => this.setFilterDataType(o[0],o[1]));
  }

  setFilterDataType(filteringField,dataType){
    // dbgLog(`Setting Data Type for ${filteringField}: ${dataType}`);
    let properType = new DataType(dataType).getJSDataType();
    if(properType) this.filterDataTypes[filteringField] = properType;
    else this.info.push(`Cannot convert data type "${dataType}" to proper type. Data type not set.`);
    // dbgLog("Last info: " + this.info.findLast(i => true));
  }

  detFilterDataType(filteringField){
    if(this.filterDataTypes[filteringField]){
      return this.filterDataTypes[filteringField];
    }
    return undefined;
  }

  addExpressionsFromArray(queryArray){
    var resObj = {
      message: "",
      queryLinesCount: 0
    };
    if(queryArray && queryArray.length) queryArray.forEach(q => {
      switch(q[0]){
        case "select": 
          this.addSelectFields(q.slice(1));
          break;
        case "filter": 
          this.addFilter(...q.slice(1));
          break;
        case "filterLogic": 
          this.setFilterLogic(q[1],q[2] ?? q[3]);
          break;
        case "orderBy": 
          this.setOrderBy(q[1],q[2] ?? q[3]);
          break;
        case "limit": 
          this.setLimit(q[1] ?? q[2] ?? q[3]);
          break;
        case null: ;
      }
      resObj.queryLinesCount++;
    });
    resObj.message = [`${resObj.queryLinesCount} lines processed on construction.`];
    return resObj;
  }

  static listOptions(){ return ["select","filter","filterLogic","orderBy","limit"];}
  static listComparisonOperators(){ return ["<",">","=","<>","<=",">=","endswith","startswith","contains"];}
  static listSortingOrders(){return ["asc","desc"];}
  static listFilterLogics(){return ["AND","OR"];}
  
  setExpand(expandField,expandQuery=new oDataQuery()){
    this.query.expand.set(expandField,expandQuery);
    return this;
  }

  setOrderBy(orderingField,orderDirection){
    if (orderDirection == "asc" || orderDirection == "desc") this.query.orderBy.set(orderingField,orderDirection);
    else if (orderDirection == undefined) this.query.orderBy.set(orderingField,"asc");
    else this.info.push(`${orderDirection} is not valid order direction.`);
    return this;
  }

  setFilterLogic(filteringField,logicChoice){
    // dbgLog("Trying: Set filter logic for "+filteringField+" to "+logicChoice);
    if (logicChoice == "AND" || logicChoice == "OR") this.query.filterLogic.set(filteringField,logicChoice);
    else this.info.push(`${logicChoice} is not valid logic.`);
    return this;
  }

  getFilterLogic(filteringField){
    // dbgLog("Reading filter logic for "+filteringField+": "+(this.query.filterLogic.get(filteringField) ?? "AND"));
    return this.query.filterLogic.get(filteringField) ?? "AND";
  }

  setLimit(noOfRows){
    this.query.limit = noOfRows;
    return this;
  }

  setCount(ifCount){
    this.query.count = ifCount;
  }

  getLimit(){
    return this.query.limit;
  }

  getCount(){
    return this.query.count;
  }

  addSelectFields(fields){
    if(Array.isArray(fields)) fields.forEach(f => {if(f) this.addSelectFields(f)});
    else this.query.select.push(fields);
    return this;
  }

  addFilter(filteringField,filterExpression,filterValue){
    if(filteringField==null || this.letterFormat(filterExpression)==null || filterValue==null) return this;
    var filter1 = {
      field: filteringField,
      expr: this.letterFormat(filterExpression),
      value: filterValue
    }
    this.query.filter.push(filter1);
    return this;
  }

  filterText(filterItem){
    var res = "(";
    var filterItems = filterItem==undefined ? this.query.filter.toSorted((a,b) => a.field ? a.field.localeCompare(b.field) : "".localeCompare(b.field)) : new Array(filterItem);
    var prevField = "";
    filterItems.forEach(ft => {   
      if(ft.field!=prevField && prevField!="") res+= ") and (";
      else if(res != "(") res+= this.filterLogicOperator(ft.field);
      res += this.singleFilterItemText(ft);
      prevField = ft.field;
    })
    res += ")";
    return res;
  }

  singleFilterItemText(filterItem){
    if(filterItem.expr == "endswith" || filterItem.expr == "startswith" || filterItem.expr == "contains"){
      return filterItem.expr + "(" + filterItem.field + "," + this.formatAndEscapeValue(filterItem) + ")";
    }
    return filterItem.field+" "+filterItem.expr+" "+this.formatAndEscapeValue(filterItem);
  }

  formatAndEscapeValue(filterItem){
    switch(this.detFilterDataType(filterItem.field)){
      case "date": return Utilities.formatDate(new Date(filterItem.value),SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone(),"yyyy-MM-dd");
      case "number": return filterItem.value;
    }
    return "'"+filterItem.value+"'";
  }

  orderByText(){
    var res = "";
    this.query.orderBy.forEach((v,k,m)=> {
      if(res!="") res += ',';
      res += k + ' ' + v;
    });
    return res;
  }

  queryText(nestedQuery=false){
    var optSeparator = nestedQuery ? ";" : "&";
    var res = "";
    if(this.query.select.length) res += "$select=" + this.query.select.join(",");
    if(this.query.filter.length) res += (res!="" ? optSeparator : "") + "$filter=" + this.filterText();
    if(this.query.orderBy.size) res += (res!="" ? optSeparator : "") + "$orderby=" + this.orderByText();
    this.query.expand.forEach((expQuery,expField,map) => {
      res += optSeparator + "$expand=" + expField;
      var expQueryText = expQuery.queryText(true);
      if(expQueryText!="") res += "(" + expQueryText + ")";
    });
    //if(nestedQuery) return res;
    if(this.query.limit=="unlimited") ;
    else if(this.query.limit>0) res += optSeparator + '$top=' + this.query.limit;
    else res += optSeparator + '$top=100';
    if(this.getCount()) res += optSeparator + '$count=true';
    return res;
  }

  filterLogicOperator(filteringField){
    // dbgLog("filterLogicOperator for: "  + filteringField);
    if(this.getFilterLogic(filteringField) == "AND"){
      // dbgLog("and"); 
      return " and ";
    }
    // dbgLog("or"); 
    return " or ";
  }
  
  letterFormat(filterExpr){
    switch(filterExpr){
      case "<": return "lt";
      case ">": return "gt";
      case "==":return "eq";
      case "=" :return "eq";
      case "!=":return "ne";
      case "<>":return "ne";
      case "<=":return "le";
      case ">=":return "ge";
    }
    const letterExpressions = ["lt","gt","eq","ne","le","ge","in","endswith","startswith","contains"];
    return letterExpressions.includes(filterExpr) ? filterExpr : null;
  }
}

/* Dodatkowe opcje dla filtrów:
  // endswith(FieldName, 'value') — Filter where a field ends with a specific string
  // startswith(FieldName, 'value') — Filter where a field starts with a specific string
  // contains(FieldName, 'value') — Filter where a field contains a specific string
  
  // indexof(FieldName, 'value') — Find position of a substring
  // tolower(FieldName) / toupper(FieldName) — Case conversion for comparison
  // trim(FieldName) — Remove leading/trailing whitespace
  // substring(FieldName, start, length) — Extract part of a string

wg. opisu na https://www.hougaard.com/be-smart-about-business-central-odata-filter-like-a-pro/
*/
