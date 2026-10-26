// The EDMX ($metadata) document of Business Central as XML: namespaces, the document and its elements.
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
