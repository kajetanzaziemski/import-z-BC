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
        // Logger.log(`Reading page ${i++} of ${this.totalPages ?? "unknown"}...`);
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
      shCoed.switchConnectionControl(false);
      throw e;  
    }
    shCoed.switchConnectionControl(false);
    if(this.dataArray == null || this.dataArray.length == 0 || this.totalRows == 0) this.dataArray = [["Brak danych spełniających zadane kryteria."]]
    return this;
  }

  readAllPages_test(){
    this.nextPage = "https://api.businesscentral.dynamics.com/v2.0/866d091a-d7fb-42bd-a8a4-527bfaa33759/Megaron/ODataV4/Company('Megaron%20S.A.')/Customer?$select=No&$top=1000";
    let i = 1;
    try{
      while(this.nextPage){
        // Logger.log(`Reading page ${i++} of ${this.totalPages ?? "unknown"}...`);
        // if(shCoed) shCoed.switchConnectionControl(true);
        this.fetchHttpResponse(this.nextPage);
        this.readPage_test(i++);
        // if(i==2 && shCoed) shCoed.setTotRowsInfo(this.getTotalRows());
        if(this.error){
          this.dataArray = Object.entries(this.error);
          return this;
        }
      }
    } catch (e) {
      shCoed.switchConnectionControl(false);
      throw e;  
    }
    shCoed.switchConnectionControl(false);
    if(this.dataArray == null || this.dataArray.length == 0 || this.totalRows == 0) this.dataArray = [["Brak danych spełniających zadane kryteria."]]
    return this;
  }

  detTotalRows(responseTotalRows){
    Logger.log(responseTotalRows);
    if(responseTotalRows == null) return null;
    if(this.query.getLimit() == "unlimited") return responseTotalRows;
    return Math.min(this.query.getLimit(),responseTotalRows);
  }

  detDataTypes(){
    return this.dataArray[0];
  }

  getTotalRows(){
    // Logger.log("Total rows: "+this.totalRows + ". Average extend: "+ this.averageExtendCount);
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
    
    // Logger.log(this.dataArray);
    return this;
  }
  
  // https://api.businesscentral.dynamics.com/v2.0/866d091a-d7fb-42bd-a8a4-527bfaa33759/Megaron/ODataV4/Company('Megaron%20S.A.')/Customer?$select=No&$top=100&$count=true

  readPage_test(n=0){
    if(!this.response) return this;
    let odTable = new ODataResponseTable(this.response.getContentText());
    if(this.error = odTable.getError()) return this;
    if(!this.totalRows) if(this.totalRows = this.detTotalRows(odTable.getResponseRowCount())) this.totalPages = Math.ceil(this.totalRows / OData_Page_Length);
    if(!this.averageExtendCount) this.averageExtendCount = odTable.getAverageExtendCount();
    this.nextPage = "https://api.businesscentral.dynamics.com/v2.0/866d091a-d7fb-42bd-a8a4-527bfaa33759/Megaron/ODataV4/Company('Megaron%20S.A.')/Customer?$select=No&$top=1000&$skip="+(1000*n);
    if(this.dataArray == null){ 
      this.dataArray=odTable.getDataArray();
      let i=0;
      this.dataArray[0].forEach(header => this.columnInfo[i++] = odTable.getColumnInfo(header));
    }
    else this.dataArray.push(...odTable.getDataArray(true));
    
    // Logger.log(this.dataArray);
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

class ODataResponseTable {
  constructor(jsonResponse,headerSeparatorString="."){
    this.debugArray = [];

    // Logger.log(jsonResponse);
    this.response = JSON.parse(jsonResponse);
    this.error = this.response.error;
    this.headerSeparator = headerSeparatorString;
    this.lineCount = 0;
    this.responseRowCount = null;
    this.extendRowCounts = {};
    this.nextLink = null;
    if(!this.getError()){
      this.headers = this.readHeaders();
      this.values = Object.fromEntries(Array.from(this.headers,(x) => [x,[]]));
      this.expandResponse();
    }
  }

  getResponseRowCount(){
    return this.responseRowCount;
  }

  getAverageExtendCount(header){
    if(!header){
      let array = [];
      Object.keys(this.extendRowCounts).forEach(key => {
        // Logger.log(key +": " + JSON.stringify(this.extendRowCounts[key]));
        if(key != "value") array.push(...this.extendRowCounts[key]);
      });
      // Logger.log(average(array) ?? 1);
      return average(array) ?? 1;
    }
    if(!this.extendRowCounts[header]) return 0;
    return average(this.extendRowCounts[header]) ?? 1;
  }

  getError(){
    return this.error;
  }

  getNextPage(){
    return this.nextLink;
  }

  getColumnInfo(header){
    if(header.indexOf(this.headerSeparator)<0) return {table: null, field: header};
    let headerChain = header.split(this.headerSeparator).toReversed();
    return {field: headerChain[0], table: headerChain[1]};
  }

  fullHeader(headerPrefix,headerValue){
    return (headerPrefix=="" ? "" : headerPrefix+this.headerSeparator)+headerValue; 
  }

  readHeaders(responseElement=this.response,headerPrefix=""){
    var localHeaders = [];
    for (const [key, value] of Object.entries(responseElement)) {
      if(/^\@odata/.test(key)){
        if(key=="@odata.nextLink"){
          this.nextLink = value;
        }
        if(key=="@odata.count"){
          this.responseRowCount = value;
        }
        
        continue;      
      }
      if(Array.isArray(value)){
        if(!this.extendRowCounts[key]) this.extendRowCounts[key] = [value.length];
        else this.extendRowCounts[key].push(value.length);
      }
      if(Array.isArray(value) && value.length>0){         
        var maxHeaders = [];
        value.forEach(v => {
          var currentHeaders = this.readHeaders(v,this.fullHeader(headerPrefix,/^value$/.test(key) ? "" : key));
          if(currentHeaders.length > maxHeaders.length) maxHeaders = currentHeaders;
        });
        localHeaders.push(...maxHeaders);
      }
      else localHeaders.push(this.fullHeader(headerPrefix,key));
    }
    return localHeaders;
  }

  expandResponse(responseObject=this.response,headerPrefix="",rowData={}){
    var [arrV,arrK] = [false,false];
  
    for (const [key, value] of Object.entries(responseObject)) {
      if(/^\@odata/.test(key)) continue;      
      if(Array.isArray(value)) [arrV,arrK] = [value,key]
      else rowData[this.fullHeader(headerPrefix,key)]=value;
    }

    if (arrV) arrV.forEach(v => {
      this.expandResponse(v,this.fullHeader(headerPrefix,/^value$/.test(arrK) ? "" : arrK),rowData)
    });
    else{ 
      Object.keys(rowData).forEach(k=>{
        this.values[k][this.lineCount] = rowData [k];
      })
      this.lineCount++;
    }

    return this.lineCount;
  }

  getDataArray(skipHeaders=false,selFields=this.headers){
    var res = [];
    
    if(skipHeaders) selFields.forEach(f => res.push(this.values[f]));
    else selFields.forEach(f => res.push([f,...this.values[f]]));
    return transposed(res);
  }
}
