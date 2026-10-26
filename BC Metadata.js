class BCMetadata{
  constructor(){
    this.request = getGlobalSettings().getODataURL()+`$metadata`;
    this.metadata = null;
  }

  downloadEdmxDocument(){
    var response = BCConnection.fetchURL(this.getRequest());
    var edmx = response.getContentText();
    this.metadata = new EdmxDocument(XmlService.parse(edmx));
    return this.metadata;
  }

  // - - - - - - - - Get  - - - - - - - - 
  getRequest(){
    return this.request;
  }

  getCacheKey(item){
    switch(item){
      case "tables": return this.getRequest() + "_" + item;
      default: return this.getRequest() + "_tableInfo_" + item;
    }
  }

  getEdmxDocument(){
    return this.metadata ?? this.downloadEdmxDocument();
  }

  getTables(schema){
    let tables = Store.optional.getCache("document",this.getCacheKey("tables"));
    if(tables){
      // dbgLog("Returning from cache: ");
      return JSON.parse(tables);
    }
    // dbgLog("Downloading from the source: ");
    tables = this.getEdmxDocument().listEntityTypes(schema);
    Store.optional.setCache("document",this.getCacheKey("tables"),JSON.stringify(tables));
    return tables;
  }

  getTableData(table,schema){
    let tableData = Store.optional.getCache("document",this.getCacheKey(table));
    if(tableData){
      // dbgLog("Returning from cache: ");
      return JSON.parse(tableData);
    }
    // dbgLog("Downloading from the source: ");
    let tableDataFields = this.getEdmxDocument().listPropertiesWithDataTypes(table,schema);
    let tableNavProperties = this.getEdmxDocument().listNavigationProperties(table,schema);
    tableData = {
      fields: tableDataFields,
      navProperties: tableNavProperties
    };
    Store.optional.setCache("document",this.getCacheKey(table),JSON.stringify(tableData));
    return tableData;
  }

  // - - - - - - - - Read  - - - - - - - -   
  listTables(schema){
    return this.getTables(schema);    
  }

  listProperties(table,schema){
    return this.getTableData(table,schema).fields.map(fieldItem => fieldItem.Name);
  }
  
  listNavProperties(table,schema){
    return this.getTableData(table,schema).navProperties;
  }

  getDataType(field,table,schema){
    const property = this.getTableData(table,schema).fields.find(p => p.Name == field);
    return property ? property.Type : null;
  }
}
