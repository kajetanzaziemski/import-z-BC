const JS_DATA_TYPES = ['string', 'number', 'bool', 'date', 'null'];
const EDM_DATA_TYPES = ['Edm.Guid', 'Edm.Int64', 'Edm.String', 'Edm.Stream', 'Edm.Int32', 'Edm.DateTimeOffset', 'Edm.Boolean', 'Edm.Decimal', 'Edm.Date'];

class DataType{
  constructor(dataType){
    if(dataType?.constructor.name == "DataType") return dataType;
    this.originalString = dataType; 
    this.dataWorld = 
      DataType.switchJSDataTypes(dataType) ? "JS" :
      DataType.switchEDMDataTypes(dataType) ? "EDM" :
      "other";
  }

  getEDMDataType(){
    if(this.dataWorld == "EDM") return this.originalString;
    else if(this.dataWorld == "JS"){
      switch(this.originalString){
        case 'string': return 'Edm.String';
        case 'number': return 'Edm.Decimal';
        case 'bool': return 'Edm.Boolean';
        case 'date': return 'Edm.Date';
        case 'null': return 'Edm.String';
      }
    }
    return undefined;
  }

  getJSDataType(){
    if(this.dataWorld == "JS") return this.originalString;
    else if (this.dataWorld == "EDM"){
      switch(this.originalString){    
        case "Edm.String": return 'string';
        case "Edm.Int64": return 'number';
        case "Edm.Int32": return 'number'; 
        case "Edm.Boolean": return 'bool';
        case "Edm.Decimal": return 'number';
        case "Edm.Date": return 'date';
        case "Edm.Guid": return 'string';
        case "Edm.Stream": return 'blob';
        case "Edm.DateTimeOffset": return 'date';
      }
    }
    return undefined;
  }

  getSpreadsheetNumberFormat(){
    switch(this.getEDMDataType()){
      case "Edm.Guid": return '@';
      case "Edm.Int64": return '#';
      case "Edm.String": return '@';
      case "Edm.Stream": return 'General';
      case "Edm.Int32": return '#'; 
      case "Edm.DateTimeOffset": return 'yyyy-mm-dd hh:mm';
      case "Edm.Boolean": return 'General';
      case "Edm.Decimal": return '#,##0.00';
      case "Edm.Date": return 'yyyy-mm-dd';
    }
    return "General";
  }

  static switchJSDataTypes(dataTypeString){
    return JS_DATA_TYPES.includes(dataTypeString) ? dataTypeString : undefined;
  }

  static switchEDMDataTypes(dataTypeString){
    return EDM_DATA_TYPES.includes(dataTypeString) ? dataTypeString : undefined;
  }

}