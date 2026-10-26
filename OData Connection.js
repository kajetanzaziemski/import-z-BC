const OData_Page_Length = 20000;

class ODataConnection{
  constructor(){
    this.query = new ODataQuery();
    this.queryTable = null;
    this.baseURL = getGlobalSettings().getODataURL()+`Company('${getGlobalSettings().getCompany()}')/`;
    this.quryURL = null;

    this.response = null;
    this.error = null;
    this.totalRows = null;
    this.averageExtendCount = null;
    this.totalPages = null;
    this.nextPage = null;
    this.dataArray = null;
    this.columnInfo = [];
  }

  // - - - - - - - - Set - - - - - - - -  
  setupConnection(){
    if(this.queryTable) this.queryURL = this.buildQueryURL(this.baseURL,this.queryTable,this.query,true);
    return this;
  }

  buildQueryURL(baseURL,queryTable,query,count=true){
    if(count) this.query.setCount(true);
    let queryText = query.queryText();
    let request = baseURL + queryTable + "?" + (queryText ?? "$top=100");
    return request;
  }

  setQueryTable(table){
    this.queryTable = table;
    return this;
  }

  setODataQuery(table,queryArray,dataTypes){
    if(Array.isArray(table)){
      queryArray = table;
      table = null;
    }
    if(table) this.setQueryTable(table);
    this.query.addExpressionsFromArray(queryArray);
    this.query.setDateTypesFromObject(dataTypes);
    return this;
  }

  setExtendQuery(extendTable,queryArray,dataTypes){
    if(!extendTable) return this;
    let extendQuery = new ODataQuery(queryArray,dataTypes);
    this.query.setExpand(extendTable,extendQuery);
    return this;
  }

  // - - - - - - - - Get - - - - - - - -  
  readAllPages(shCoed){
    this.nextPage = this.queryURL;
    let i = 1;
    try{
      while(this.nextPage){
        // dbgLog(`Reading page ${i++} of ${this.totalPages ?? "unknown"}...`);
        if(shCoed) shCoed.switchConnectionControl(true);
        this.fetchHttpResponse(this.nextPage);
        this.readPage();
        i++;
        if(i==2 && shCoed) shCoed.setTotRowsInfo(this.getTotalRows());
        if(this.error){
          this.dataArray = Object.entries(this.error);
          return this;
        }
      }
    } catch (e) {
      if(shCoed) shCoed.switchConnectionControl(false);
      throw e;  
    }
    if(shCoed) shCoed.switchConnectionControl(false);
    if(this.dataArray == null || this.dataArray.length == 0 || this.totalRows == 0) this.dataArray = [["Brak danych spełniających zadane kryteria."]]
    return this;
  }

  detTotalRows(responseTotalRows){
    dbgLog(responseTotalRows);
    if(responseTotalRows == null) return null;
    if(this.query.getLimit() == "unlimited") return responseTotalRows;
    return Math.min(this.query.getLimit(),responseTotalRows);
  }

  getTotalRows(){
    // dbgLog("Total rows: "+this.totalRows + ". Average extend: "+ this.averageExtendCount);
    return this.totalRows * this.averageExtendCount;
  }
  
  readPage(){
    if(!this.response) return this;
    let odTable = new ODataResponseTable(this.response.getContentText());
    if(this.error = odTable.getError()) return this;
    if(!this.totalRows) if(this.totalRows = this.detTotalRows(odTable.getResponseRowCount())) this.totalPages = Math.ceil(this.totalRows / OData_Page_Length);
    if(!this.averageExtendCount) this.averageExtendCount = odTable.getAverageExtendCount();
    this.nextPage = odTable.getNextPage();
    if(this.dataArray == null){ 
      this.dataArray=odTable.getDataArray();
      let i=0;
      this.dataArray[0].forEach(header => this.columnInfo[i++] = odTable.getColumnInfo(header));
    }
    else this.dataArray.push(...odTable.getDataArray(true));
    
    // dbgLog(this.dataArray);
    return this;
  }
  
  fetchHttpResponse(requestURL=this.queryURL){
    if(!requestURL) return this;
    this.response = BCConnection.fetchURL(requestURL);
    return this;
  }

  getDataArray(){
    return this.dataArray;
  }

  getColumnInfo(columnId){
    if(columnId==null) return this.dataArray[0].map((header,index) => this.getColumnInfo(index));
    if(typeof(columnId)=="string") columnId = this.dataArray[0].findIndex(item => item == columnId);
    if(columnId<0) return null;
    else return this.columnInfo[columnId];
  }
}
