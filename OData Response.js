// One page of an OData JSON response as a table (headers, rows, expanded lines, the next link, the row counts).
class ODataResponseTable {
  constructor(jsonResponse,headerSeparatorString="."){
    this.debugArray = [];

    // dbgLog(jsonResponse);
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
        // dbgLog(key +": " + JSON.stringify(this.extendRowCounts[key]));
        if(key != "value") array.push(...this.extendRowCounts[key]);
      });
      // dbgLog(average(array) ?? 1);
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
