class BCMetadata{
  constructor(){
    this.table = null;
    this.schema = null; // Should set to default schema on construction!
    
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

  getTables(schema = this.schema){
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

  getTableData(table,schema = this.schema){
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

  // - - - - - - - - Set  - - - - - - - -   
  setSchema(schema){
    this.schema = schema;
  }

  setWorkingTable(table){
    this.table = table;
  }

  // - - - - - - - - Read  - - - - - - - -   
  listTables(schema = this.schema){
    return this.getTables(schema);    
  }

  listProperties(table = this.table,schema = this.schema){
    return this.getTableData(table,schema).fields.map(fieldItem => fieldItem.Name);
  }
  
  listNavProperties(table = this.table,schema = this.schema){
    return this.getTableData(table,schema).navProperties;
  }

  getDataType(field,table=this.table,schema = this.schema){
    const property = this.getTableData(table,schema).fields.find(p => p.Name == field);
    return property ? property.Type : null;
  }
}

/*
  Specyfikacja danych wg. https://docs.oasis-open.org/odata/odata/v4.0/os/part3-csdl/odata-v4.0-os-part3-csdl.html
*/

const edmxURI = "http://docs.oasis-open.org/odata/ns/edmx";
const edmxPrefix = "edmx";
const edmxNS = XmlService.getNamespace(edmxPrefix,edmxURI);

const edmURI = "http://docs.oasis-open.org/odata/ns/edm";
const edmPrefix = "edm";
const edmNS = XmlService.getNamespace(edmPrefix,edmURI);

/**
 * Represents an EDMX metadata document for OData.
 */
class EdmxDocument {
   constructor(xmlDocument){
   this.doc = xmlDocument; 
  }
  
  // Functions mirroring XMLService Document methods 
  

  // Functions specific to EDMX Documents
  getDataServicesElem(){
    return new EdmxElement(this.doc.getRootElement().getChild("DataServices",edmxNS));
  }

  /**
   * @param edmxSchemaNamespace {String} Schema's Namespace attribute value. If not provided the function returns first schema in order.
   * @returns Schema element {EdmxElement}
   */
  getSchemaElem(edmxSchemaNamespace){
    var edmxDSElem = this.getDataServicesElem();
    return edmxSchemaNamespace ? edmxDSElem.getChildByAttribute("Namespace",edmxSchemaNamespace) : edmxDSElem.getChildren("Schema",edmNS)[0];
  }
  
  /*/ Caching 
  cacheKey(edmElement, elementName){
    return `${edmElement}.${elementName}`.substring(0,250);
  }

  readCache(edmElement, elementName) {
    const cache = CacheService.getDocumentCache(); 
    const cacheVal = cache.get(this.cacheKey(edmElement,elementName));
    return cacheVal;
  }

  readCacheObject(edmElement, elementName){
    const cacheValue = this.readCache(edmElement, elementName);
    return cacheValue ? JSON.parse(cacheValue) : null;
  }

  writeCache(edmElement, elementName,cacheText,forceWrite=false){
    const cache = CacheService.getDocumentCache();
    const cachedValue = cache.get(this.cacheKey(edmElement,elementName));
    if (cachedValue != null && !forceWrite) {
      return cachedValue;
    }
    cache.put(this.cacheKey(edmElement,elementName), cacheText, 3600);  // cache for 1 h
    return cacheText;
  }

  writeCacheObject(edmElement, elementName,cacheObject,forceWrite=false){
    const cacheText = JSON.stringify(cacheObject);
    this.writeCache(edmElement,elementName,cacheText,forceWrite);
    return cacheObject;
  }

  getAllCache(edmxSchemaNamespace){
    let keys = [this.cacheKey(edmxSchemaNamespace ?? "default_schema","EntityType")];
    
    let tables = this.listEntityTypes(edmxSchemaNamespace);
    tables.forEach(table => {
      const edmElementName = "EntityType" + (edmxSchemaNamespace ?? "");
      keys.push([this.cacheKey(edmElementName,table)]);
      let edmValueName = table + "wDT";
      keys.push([this.cacheKey(edmElementName,edmValueName)]);
      edmValueName = table + "np"; // "np" = "Navigation Properties"
      keys.push([this.cacheKey(edmElementName,edmValueName)]);    
    });
    return CacheService.getDocumentCache().getAll(keys); 
  }
  */

  // Data service
  /**
   * @param edmxSchemaNamespace {String} If no Schema Namespace provided, first Schema in order is chosen.
   * @return {string[]} List of names of available Entity Types.
   */
  listEntityTypes(edmxSchemaNamespace){
    return this.getSchemaElem(edmxSchemaNamespace).getAllAttributeValuesFromChildren("EntityType","Name");
  }

  listProperties(entityTypeName,edmxSchemaNamespace){
    const edmElementName = "EntityType" + (edmxSchemaNamespace ?? "");
    return  this.getSchemaElem(edmxSchemaNamespace)
              .getChildByAttribute("Name",entityTypeName,"EntityType")
              ?.getAllAttributeValuesFromChildren("Property","Name") 
          ?? 
            [];
  }

  listPropertiesWithDataTypes(entityTypeName,edmxSchemaNamespace){
    const edmElementName = "EntityType" + (edmxSchemaNamespace ?? "");
    const edmValueName = entityTypeName + "wDT"; // "wDT" = "with Data Types"
    return this.getSchemaElem(edmxSchemaNamespace).getChildByAttribute("Name",entityTypeName,"EntityType").getAllAttributeValuesArraysFromChildren("Property",["Name","Type"]);
  }

  getPropertyDataType(propertyName,entityTypeName,edmxSchemaNamespace){
    const propList = this.listPropertiesWithDataTypes(entityTypeName,edmxSchemaNamespace);
    const property = propList.find(p => p.Name == propertyName);
    return property ? property.Type : null;
  }

  listNavigationProperties(entityTypeName,edmxSchemaNamespace){
    const edmElementName = "EntityType" + (edmxSchemaNamespace ?? "");
    const edmValueName = entityTypeName + "np"; // "np" = "Navigation Properties"
    return this.getSchemaElem(edmxSchemaNamespace).getChildByAttribute("Name",entityTypeName,"EntityType").getAllAttributeValuesFromChildren("NavigationProperty","Name");
  }
}

/**
 * Represents an EDMX metada XML element.
 */
class EdmxElement {
  constructor(xmlElement){
    this.elem = xmlElement;
  }
  
  // Helper functions used by other functions within the class
  getAllChildren(){
    var elemChildren = this.elem.getChildren();
    var res = [];
    elemChildren.forEach(obj => res.push(new EdmxElement(obj)));
    return res;
  }
  
  // Functions mirroring XMLService Element methods 
  getChildren(name, namespace){
    if(name==undefined||namespace==undefined) return this.getAllChildren();
    var elemChildren = this.elem.getChildren(name,namespace);
    var res = [];
    elemChildren.forEach(obj => res.push(new EdmxElement(obj)));
    return res;
  }

  getName(){
    return this.elem.getName();
  }
  
  // Functions specific to EDMX Elements
  getEdmxAttribute(attributeName){
    return this.elem.getAttribute(attributeName) ? this.elem.getAttribute(attributeName).getValue() : null;
  }

  getChildByAttribute(attributeName,attributeValue,childName){
    const childElems = this.getChildren(childName,edmNS);
    const childElemsLen = childElems.length;
    for(let i=0;i<childElemsLen;i++) if (childElems[i].getEdmxAttribute(attributeName)==attributeValue) return childElems[i];
    return null;
  }

  getAllAttributeValuesFromChildren(childName,attributeName){
    const childElems = this.getChildren();
    const childElemsLen = childElems.length;
    var res = [];
    for(let i=0;i<childElemsLen;i++) if (childElems[i].elem.getAttribute(attributeName) && childElems[i].getName()==childName) res.push(childElems[i].getEdmxAttribute(attributeName));
    return res;
  }

  getAllAttributeValuesArraysFromChildren(childName,atributeNames){
    const childElems = this.getChildren();
    const childElemsLen = childElems.length;
    var res = [];
    for(let i=0;i<childElemsLen;i++) {
      if(childElems[i].getName()==childName){
        var attrCollection = Object.fromEntries(atributeNames.map(a =>[a,[]]));
        atributeNames.forEach(attributeName =>{
          if (childElems[i].elem.getAttribute(attributeName)) 
          attrCollection[attributeName] = childElems[i].getEdmxAttribute(attributeName);
        }); 
        res.push(attrCollection);
      }
    }
    return res;
  }
}
