function testFunc_runWithController(){
  Controller.run("testAction",testFunc_powerOffAllAgentsInFile);
}

function testFunc_storageObject(){
  let impSettings = getImportSettings();
  Logger.log(`Sheet name: ${impSettings.getProperty("importSheetName")}`);
  impSettings.setProperty("importSheetName","Ustawienia importu 2");
  Logger.log(`Sheet name changed to Ustawienia importu 2`);
  Logger.log(`Sheet name: ${getImportSettings().getProperty("importSheetName")}`);
}

function testFunc_fullTriggerListing(){
  return StatusManager.getAllProjectTriggers();
}

function testFunc_powerOffAllAgentsInFile(){
  StatusManager.powerOffAllAgentsInFile();
}

function testFunc_poweringTriggers(){
  Logger.log("Triggers installed before run:");
  Logger.log(TriggerWrapper.getUserTriggers().map(trigger => `${trigger.getEventType()} trigger with id ${trigger.getUniqueId()}. \n`));
  let samplingTrigger = TriggerWrapper.getUserTriggers()[0];
  Logger.log(`Sampling trigger: ${samplingTrigger.getUniqueId()}`);
  TriggerWrapper.triggerPowerOff(samplingTrigger.getUniqueId());
}

function testFunc_statusCheckOnOpen(){
  StatusManager.lightStatusCheck();
}

function testFunc_deleteAllAgentsFromStorage(){
  let array = getAgentManager().agentStorage.storageArray;
  array.forEach(item => {
    Logger.log("item  "+JSON.stringify(item));
    getAgentManager().delete(item[0]);
    getAgentManager().delete(item[1]);
  });
}

function testFunc_listAllTriggers(){
  let actveSheetId = SpreadsheetApp.getActiveSpreadsheet().getId();
  let userTriggers = TriggerWrapper.getUserTriggers();
  Logger.log(`User has ${userTriggers.length} triggers for Ss ${actveSheetId}:`);
  userTriggers.forEach(trigger => Logger.log(`${trigger.getEventType()}, id: ${trigger.getUniqueId()}`));
  let projectTriggers = ScriptApp.getProjectTriggers();
  Logger.log(`Project has ${projectTriggers.length} triggers:`);
  projectTriggers.forEach(trigger => Logger.log(`${trigger.getEventType()}, id: ${trigger.getUniqueId()}. Ss: ${trigger.getTriggerSourceId()} (${trigger.getTriggerSourceId() == actveSheetId ? 'active sheet' : 'other file'})`));
}

function testFunc_deleteOldestTriggers(){
  let trigId = getDocumentTriggerLog().getOldest(ScriptApp.EventType.ON_EDIT)?.triggerId;
  Logger.log("Oldest ON_EDIT in Document before deleting: "+trigId);
  Logger.log("Deleting...");
  getAgentManager().delete(trigId);
  getDocumentTriggerLog().deleteEntryWithTriggerId(trigId);
  getUserTriggerLog().deleteEntryWithTriggerId(trigId);
  trigId = getDocumentTriggerLog().getOldest(ScriptApp.EventType.ON_EDIT)?.triggerId;
  Logger.log("Oldest ON_EDIT in Document after deleting: "+trigId);
}

function testFunc_consoleUserKey(){
  console.log(Session.getTemporaryActiveUserKey());;
}

function testFunc_storageArray(){
  getAgentManager().saveToStorageArray("editId","changeId");
}

function testFunc_agentManager(){
Logger.log("Triggers installed before run:");
  Logger.log(TriggerWrapper.getUserTriggers().map(trigger => `${trigger.getEventType()} trigger with id ${trigger.getUniqueId()}. \n`));
  
  try{
    getAgentManager().reclaimAgent();
  } catch (e){
    if(e instanceof SimpleError) Logger.log("Error: "+e.message);
    else throw(e);
  }
  
  Logger.log("Triggers installed after run:");
  Logger.log(TriggerWrapper.getUserTriggers().map(trigger => `${trigger.getEventType()} trigger with id ${trigger.getUniqueId()}. \n`));
}

function testFunc_wC_TriggerManager(){
  Controller.run("testFunc_TriggerManager",testFunc_TriggerManager);
}

function testFunc_wC_testTriggerLogging(){
  Controller.run("testFunc_testTriggerLogging",testFunc_testTriggerLogging);
}

function testFunc_noElement(){
  let array = [];
  Logger.log(array[5]===undefined);
}

function testFunc_slice() {
  let values = ["a","b","c"];
  Logger.log(values.slice(1));
  Logger.log(values.slice(1).length);
  Logger.log(values);
  Logger.log(values.slice(0));
}

function testFunc_unserialize(){
  let values = [];
  helpFunc_logArguments(...values,null);
}

function helpFunc_logArguments(a,b,c,d){
  Logger.log("a: " + JSON.stringify(a));
  Logger.log("b: " + JSON.stringify(b));
  Logger.log("c: " + JSON.stringify(c));
  Logger.log("d: " + JSON.stringify(d));
}

function helpFunc_CCT_fromSheet(sheetName){
  let sheet = sheetName ?  SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName) : SpreadsheetApp.getActiveSheet();
  let array = sheet.getRange(6,2,sheet.getLastRow()-5,5).getValues();
  return cct = new CCTImportConfig(array);
}

function testFunc_contentTrackerInit(){
  let cct = helpFunc_CCT_fromSheet("Arkusz2");
}

function testFunc_fixRegister(){
  let register = new FixRegister();
  register.logFix("name1",1,[1,2,3]);
  register.logFix("name1",11,[1,2,3]);
  register.logFix("name1",10,[1,2,3]);
  register.logFixOverride("name1",12,[1,2,3]);
  register.logFixIfNotExists("name1",2,[1,2,3]);
  register.logFixIfNotExists("name2",7,[1,2,3]);
  Logger.log(register.allEntries("name1"));
  register.removeAll();
  Logger.log(register.allEntries()); 
}

function testFunc_regexp(){
  Logger.log(/_setValue/.test("table_setValue"));
}

function testFunc_optionCascading(){
  let cct = helpFunc_CCT_fromSheet("Konfiguracja 9");
  let array = cct.arrayRepresentation();
  let sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Konfiguracja 9");
  sheet.getRange(6,8,array.length,array[0].length).setValues(array);
}

function testFunc_setupOptions(){
  let cct = helpFunc_CCT_fromSheet("Arkusz2");
  cct.setupOptions();
}

function testFunc_queryOptionLabel(){
  let cct = helpFunc_CCT_fromSheet("Arkusz2");
  Logger.log(cct.queryOptionLabel("tabela"));
  Logger.log(cct.queryOptionLabel("extend"));
  Logger.log(cct.queryOptionLabel("queryOption"));
  Logger.log(cct.queryOptionLabel("extendOption"));
}

function helpFunc_sampleMetadata(table){
  switch(table){
    case "sampleTableFields": return ["Document_Type", "No", "Sell_to_Customer_No", "ITI_Sell_to_Search_NameME", "Sell_to_Customer_Name", "Sell_to_Customer_Name_2", "Quote_No", "ITI_Posting_Desc_Code", "Posting_Description", "Sell_to_Address", "Sell_to_Address_2", "Sell_to_City", "Sell_to_County", "Sell_to_Post_Code", "Sell_to_Country_Region_Code", "Sell_to_Contact_No", "Sell_to_Phone_No", "SellToMobilePhoneNo", "Sell_to_E_Mail", "ITI_Internal_ID", "ITI_SellToVATRegNoOrigCtryCode", "ITI_Sell_to_VAT_Reg_No", "Sell_to_Contact", "No_of_Archived_Versions", "Document_Date", "Posting_Date", "ITIDeliveryDateInvPeriod", "ITI_Inv_Period_Starting_Date", "ITIInvPeriodEndingDate", "ITI_VAT_Delivery_Date", "ITI_VAT_Settlement_Date", "ITI_Postponed_VAT", "ITI_Skip_on_Sending_to_NSeI", "ITI_Missing_NSeI_No_Reason", "VAT_Reporting_Date", "Order_Date", "Due_Date", "Requested_Delivery_Date", "Promised_Delivery_Date", "External_Document_No", "Your_Reference", "ShpfyOrderNo", "ShpfyShopify_Risk_Level", "Salesperson_Code", "Campaign_No", "Opportunity_No", "Responsibility_Center", "Assigned_User_ID", "Job_Queue_Status", "Status", "WorkDescription", "ITI_Comment_TextME", "ITI_Total_Quantity_of_PalletME", "ITI_Real_Quantity_of_PalletME", "ITITotalNetWeightME", "ITITotalGrossWeightME", "ITITotalQtyME", "ITI_API_Order_CreatedME", "ITIMegaron_Sales_Ord_StatusME", "ITI_Nos_Template_CodeME", "Currency_Code", "ITIExchangeRateMEME", "ITI_Exchange_Rate_DateME", "ITIExchRateTableNoME", "ITI_VAT_Currency_Code", "ITI_VAT_Amount_Currency", "ITI_Split_Payment", "Company_Bank_Account_Code", "Prices_Including_VAT", "ITI_VAT_Status_Code", "ITI_Self_Charged_VAT_Code", "VAT_Country_Region_Code", "ITI_VATRegNoOrigCountryCode", "VAT_Registration_No", "Gen_Bus_Posting_Group", "VAT_Bus_Posting_Group", "Customer_Posting_Group", "Payment_Terms_Code", "Payment_Method_Code", "EU_3_Party_Trade", "ITI_EU_3_Party_Interm_Role", "SelectedPayments", "Shortcut_Dimension_1_Code", "Shortcut_Dimension_2_Code", "Payment_Discount_Percent", "Pmt_Discount_Date", "Journal_Templ_Name", "Direct_Debit_Mandate_ID", "ITI_Bal_Account_Type", "ITI_Bal_Account_No", "ShippingOptions", "Ship_to_Code", "Ship_to_Name", "Ship_to_Name_2", "Ship_to_Address", "Ship_to_Address_2", "Ship_to_City", "Ship_to_County", "Ship_to_Post_Code", "Ship_to_Country_Region_Code", "Ship_to_Phone_No", "Ship_to_Contact", "Shipment_Method_Code", "Shipping_Agent_Code", "Shipping_Agent_Service_Code", "Package_Tracking_No", "BillToOptions", "ITIBill_to_Customer_No_ME", "ITI_Bill_to_Search_NameME", "Bill_to_Name", "Bill_to_Name_2", "Bill_to_Address", "Bill_to_Address_2", "Bill_to_City", "Bill_to_County", "Bill_to_Post_Code", "Bill_to_Country_Region_Code", "Bill_to_Contact_No", "Bill_to_Contact", "BillToContactPhoneNo", "BillToContactMobilePhoneNo", "BillToContactEmail", "Location_Code", "Shipment_Date", "Shipping_Advice", "Outbound_Whse_Handling_Time", "Shipping_Time", "Late_Order_Shipping", "Combine_Shipments", "Completely_Shipped", "ITI_Payer_Branch_No_ME", "ITI_Payer_Branch_NameME", "ITI_Payer_Branch_Name_2ME", "ITI_Payer_Branch_AddressME", "ITI_Payer_Branch_Address_2ME", "ITI_Payer_Branch_CityME", "ITI_Payer_Branch_Post_CodeME", "ITI_Payer_Branch_Search_NameME", "ITI_Vendor_No_ME", "ITIISIntrastatTransaction", "Transaction_Specification", "Transaction_Type", "Transport_Method", "Exit_Point", "Area", "Applicable_For_Serv_Decl", "Language_Code", "Format_Region", "Prepayment_Percent", "Compress_Prepayment", "Prepmt_Payment_Terms_Code", "Prepayment_Due_Date", "Prepmt_Payment_Discount_Percent", "Prepmt_Pmt_Discount_Date", "ITI_Shoper_Order_ME", "ITI_Shoper_Order_No_ME", "ITI_Order_Paid_in_ShoperME", "ITI_Shoper_StatusME", "ITI_Shoper_DateME", "ITI_Shoper_TimeME", "Date_Filter", "Location_Filter"];
    case "sampleTables": return ["Media", "Company", "AccountantPortalActivityCues", "AccountantPortalFinanceCues", "AccountantPortalUserTasks", "powerbifinance", "SalesOrder", "SalesOrderSalesLines", "UserTaskSetComplete", "DimensionSets", "ItemSalesAndProfit", "ItemSalesByCustomer", "SalesDashboard", "SalesOpportunities", "SalesOrdersBySalesPerson", "TopCustomerOverview", "Archiwum_zamówień_sprzedaży_Excel", "Archiwum_zamówień_sprzedaży_ExcelSalesLinesArchive", "Arkusz_płatności_do_dostawców_Excel", "BOM_produkcyjny_Excel", "BOM_produkcyjny_ExcelProdBOMLine", "BOM_versionList", "Car_Registration_Excel", "Ceny_sprzedaży_Excel", "CenyZapasow", "ChangeLogEntries", "Chart_of_Accounts", "Customer", "Customer_Card_Excel", "CustomersMegaron", "DimensionsValues", "Dzienniki_główne_Excel", "Dzienniki_inwentaryzacji_Excel", "Dzienniki_zapasów_Excel", "Edytuj_przypisanie_znaczników_kont_K_G_Excel", "ExcelTemplateAgedAccountsPayable", "ExcelTemplateAgedAccountsReceivable", "ExcelTemplateBalanceSheet", "ExcelTemplateCashFlowStatement", "ExcelTemplateIncomeStatement", "ExcelTemplateRetainedEarnings", "ExcelTemplateTrialBalance", "ExcelTemplateViewCompanyInformation", "Faktura_zakupu_Excel", "Faktura_zakupu_ExcelPurchLines", "FSStanDATA", "GL_Item_Ledger_Relation", "GLEntries", "Grupy_księgowe_dostawców_Excel", "handlowy", "Item_Journals_Excel", "Item_Card_Excel", "ItemLedgerEntriesMeg", "Job_List", "Job_Planning_Lines", "Job_Task_Lines", "Kartoteka_dostawcy_Excel", "Kartoteka_konta_K_G_Excel", "Kartoteka_kontaktu_Excel", "Kartoteka_kontaktu_ExcelContactIntEntriesSubform", "Kartoteka_kontaktu_ExcelProfile_Questionnaire", "Kartoteka_lokalizacji_Excel", "Kartoteka_nabywcy_Excel", "Kartoteka_pracownika_Excel", "Kartoteka_środka_trwałego_Excel", "Kartoteka_środka_trwałego_ExcelDepreciationBook", "Kartoteka_użytkownika_Excel", "Kartoteka_użytkownika_ExcelPermissions", "Kartoteka_użytkownika_ExcelPlans", "Kartoteka_zapasu_Excel", "Komponenty_zlecenia_prod__Excel", "Lista_dokumentów_sprzedaży_Excel", "Lista_zawartości_pojemnika_Excel", "ListaDokumentówSprzedaży", "MailOutbox", "Mapowanie_ID_do_konta_Podgląd_Excel", "Mapowanie_tekstu_do_konta_Excel", "Mapowanie_tekstu_do_konta_Excel_0", "Matrix_BOM", "Oznaczenia_zapasu_Excel", "Page_99000789_Excel", "PocztaTransportowa", "PocztaTransportowaITISalesLinesME", "Posted_Return_Receipts", "PostedSalesCreditMemoLINES", "PostedSalesCreditMemos", "PostedSalesCreditMemosITISalesCrMemoLines", "PostedSalesCreditMemosLinesPL", "PostedSalesInvoicesHeaders", "PostedSalesInvoicesHeadersITISalesInvLines", "PostedSalesInvoicesLines", "PostedSalesInvoicesVariableCosts", "postedShipmentHeaders", "postedShipmentHeadersITISalesShipmLines", "Power_BI_Aged_Acc_Payable", "Power_BI_Aged_Acc_Receivable", "Power_BI_Aged_Inventory_Chart", "Power_BI_Job_Act_v_Budg_Cost", "Power_BI_Job_Act_v_Budg_Price", "Power_BI_Job_Profitability", "Power_BI_Sales_Pipeline", "Power_BI_Top_5_Opportunities", "Power_BI_WorkDate_Calc", "Pracownicy", "Pracownicy_magazynowi_Excel", "ProdOrderComponents", "Purchase_Invoice_Excel", "Purchase_Invoice_ExcelPurchLines", "Purchase_InvoicePurchLines_Excel", "Purchase_Order_Line_Excel", "purchaseDocumentLines", "purchaseDocuments", "purchaseDocumentsworkflowPurchaseDocumentLines", "PurchasePrice", "Rabaty_wiersza_sprzedaży_Excel", "Raport_finansowy_Excel", "Raporty", "Sales_Cr_Memo_Line_Excel", "Sales_Order_Line_Excel", "salesDocumentLines", "salesDocuments", "salesDocumentsworkflowSalesDocumentLines", "SalesDocumentsList", "SalesOrdersHeaders", "SalesOrdersHeadersITISalesLinesME", "SalesOrdersLines", "SalesOrdersStatusMeg", "SalesOrdersStatusMegITISalesLinesME", "SalesOrdersStatusMeg2", "SalesOrdersStatusMeg2ITISalesLinesME", "Seria_numeracji_Excel", "Szablony_programu_Word_Excel", "Vendor_Card_Excel", "VendorLedgerEntries2", "Waluty_Excel", "Wartości_wymiaru_Excel", "Wersja_BOM_u_prod__Excel", "Wersja_BOM_u_prod__ExcelProdBOMLine", "Wiersze_serii_numeracji_Excel", "Wiersze_sprzedaży_Excel", "Wiersze_zaks_faktury_sprzed__Excel", "Wiersze_zaks_faktury_zakupu_Excel", "Wiersze_zaks_przyjęć_zakupu_Excel", "Wiersze_zaks_wydania_sprzedaży_Excel", "workflowCustomers", "workflowGenJournalBatches", "workflowGenJournalLines", "workflowItems", "workflowPurchaseDocumentLines", "workflowPurchaseDocuments", "workflowPurchaseDocumentsworkflowPurchaseDocumentLines", "workflowSalesDocumentLines", "workflowSalesDocuments", "workflowSalesDocumentsworkflowSalesDocumentLines", "workflowVendors", "workflowWebhookSubscriptions", "Zakończone_zlecenie_prod__Excel", "Zakończone_zlecenie_prod__ExcelProdOrderLines", "Zaks_faktura_kor_sprzedaży_Excel", "Zaks_faktura_kor_sprzedaży_ExcelSalesCrMemoLines", "Zaksięgowana_faktura_sprzedaży_Excel", "Zaksięgowana_faktura_sprzedaży_ExcelSalesInvLines", "Zaksięgowana_faktura_zakupu_Excel", "Zaksięgowana_faktura_zakupu_ExcelPurchInvLines", "Zaksięgowane_przyjęcie_zakupu_Excel", "Zaksięgowane_przyjęcie_zakupu_ExcelPurchReceiptLines", "Zaksięgowane_wydanie_sprzedaży_Excel", "Zaksięgowane_wydanie_sprzedaży_ExcelSalesShipmLines", "Zamówienie_sprzedaży_Excel", "Zamówienie_sprzedaży_ExcelSalesLines", "Zamówienie_zakupu_Excel", "Zamówienie_zakupu_ExcelPurchLines", "Zapisy_dziennika_zmian_Excel", "Zapisy_księgi_dostawców_Excel", "Zapisy_księgi_głównej_Excel", "Zapisy_księgi_nabywców_Excel", "Zapisy_księgi_pracowników_Excel", "Zapisy_księgi_ŚT_Excel", "Zapisy_księgi_zapasów_Excel", "Zapisy_magazynowe_Excel", "Zapisy_wyceny_Excel", "Zawartość_pojemnika_Excel", "Zwolnione_zlecenie_prod__Excel", "Zwolnione_zlecenie_prod__ExcelProdOrderLines", "ZwolnioneZP", "BankAccountLedgerEntries", "Cust_LedgerEntries", "DimensionSetEntries", "FALedgerEntries", "G_LBudgetEntries", "G_LEntries", "ItemLedgerEntries", "ItemsWithLocation", "JobLedgerEntries", "MailSent", "MegaraxCreditMemoLines", "Power_BI_Cust_Item_Ledg_Ent", "Power_BI_Cust_Ledger_Entries", "Power_BI_Customer_List", "Power_BI_GL_Amount_List", "Power_BI_GL_BudgetedAmount", "Power_BI_Item_Purchase_List", "Power_BI_Item_Sales_List", "Power_BI_Jobs_List", "Power_BI_Purchase_Hdr_Vendor", "Power_BI_Purchase_List", "Power_BI_Sales_Hdr_Cust", "Power_BI_Sales_List", "Power_BI_Top_Cust_Overview", "Power_BI_Vend_Item_Ledg_Ent", "Power_BI_Vendor_Ledger_Entries", "Power_BI_Vendor_List", "Res_LedgerEntries", "SalesOrdersArchive", "SegmentLines", "ValueEntries", "VendorLedgerEntries"];
    case "sampleNavProperties": return ["Salesperson_Code_Link", "Currency_Code_Link", "ITI_VAT_Currency_Code_Link", "SalesOrderSalesLines"];
  }
}

function testFunc_DValTickets(){
  let configDValStore = new ConfigDValStore();
  let tablesMap = {
    table: "Company",
    extend: "SalesOrderSalesLines",
    extend2: "Currency"
  }
  configDValStore.populate(tablesMap);
  Logger.log(configDValStore.realMyDataValidation("simple:operators").getDescription());
}

function testFunc_newRows(){
  let cct = helpFunc_CCT_fromSheet("Arkusz2");
  Logger.log(cct.insertRows);
}

function testFunc_setDataValidations(){
  let sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Arkusz2");
  sheet.getRange(1,1,1,1).setDataValidation(SpreadsheetApp.newDataValidation().requireDate().build());
}

function testFunc_dValArray(){
  let cct = helpFunc_CCT_fromSheet("Arkusz2");
  let sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Arkusz2");
  let dValArray = sheet.getRange(2,2,sheet.getLastRow()-1,5).getDataValidations();
  // map2D(dValArray,x => Logger.log(x));
  helpFunc_writeArrayToSheet(map2D(dValArray,x => x ? x.getCriteriaType() : "-"),"DValCheck",2,2);
  helpFunc_writeArrayToSheet(map2D(cct.getDataValidationsArray(),x => x ? x.getDVFunction() : "-"),"DValCheck",2,8);
  helpFunc_setDValArrayToSheet(map2D(cct.getDataValidationsArray(),x => x ? x.getSpreadsheetAppDataValidation() : null),"DValCheck",2,8);
  // cct.checkDisplayedDataValidations(dValArray);
}

function helpFunc_writeArrayToSheet(array,sheetName,row,col){
  let sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if(!sheet) sheet = SpreadsheetApp.getActiveSpreadsheet().insertSheet(sheetName);
  sheet.getRange(row,col,array.length,array[0].length).setValues(array);
}

function helpFunc_setDValArrayToSheet(array,sheetName,row,col){
  let sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if(!sheet) sheet = SpreadsheetApp.getActiveSpreadsheet().insertSheet(sheetName);
  sheet.getRange(row,col,array.length,array[0].length).setDataValidations(array);
}

function testFunc_sheetCoeditor(){
  let shCoed = new SheetCoeditor("Konfiguracja 2");
}

function testFuns_readDataValidationCriteria(){
  let sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Ustawienia Importu");
  Logger.log(sheet.getRange(6,5).getDataValidation().getCriteriaType());
  Logger.log(sheet.getRange(6,5).getDataValidation().getCriteriaValues());  
}

function testFunc_readMainSettingsValues(){
  let sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Ustawienia Importu");
  let array = sheet.getDataRange().getValues();
  Logger.log(JSON.stringify(array)); 
}

function testFunc_mainSettings(){
  getMainSettings();
}

function testFunc_largeArrays(){
  configSheetName = "Konfiguracja 4";
  
  let shCoed = new SheetCoeditor(configSheetName);
  
  let table = shCoed.getTable();
  let extend = shCoed.getExtendTable();

  let tableQuery = new ODataQuery(shCoed.getTableQueryArray(),shCoed.getDataTypes());
  Logger.log("table: "+table);
  Logger.log(tableQuery.filterDataTypes);
  Logger.log(tableQuery.queryText());

  let extendQuery = new ODataQuery(shCoed.getExtendQueryArray(),shCoed.getDataTypes());
  Logger.log("extend: "+extend);
  Logger.log(extendQuery.filterDataTypes);
  Logger.log(extendQuery.queryText());

  if(extend) tableQuery.setExpand(extend,extendQuery);
  Logger.log("Full query :"+tableQuery.queryText());

  if(!table){
    Logger.log("No table in config sheet. Quitting.")
    return;
  }

  var oDataTable1 = getTable(table,tableQuery.queryText());
  
  while(oDataTable1){
    var table1 = oDataTable1.getDataArray();
    let sum = {};
    for(let x of table1){if(typeof(x[2])=="number") sum[x[1]]==undefined ? sum[x[1]]=x[2] : sum[x[1]]+=x[2];}
    let res = ";"
    Object.keys(sum).forEach(key => res+=`${key}: ${sum[key]}\n`);
    Logger.log(res);
    oDataTable1 =  null;//getTableWithRequest(oDataTable1.getNextPage());
  }

}

function testFunc_ODataQueryTest(){
  let request = "https://api.businesscentral.dynamics.com/v2.0/866d091a-d7fb-42bd-a8a4-527bfaa33759/Megaron_Sandbox_1/ODataV4/Company('Megaron%20S.A.')/Chart_of_Accounts?$select=No&$filter=startswith(No,'701')&$top=100&$count=true";
  // endswith(FieldName, 'value') — Filter where a field ends with a specific string
  // startswith(FieldName, 'value') — Filter where a field starts with a specific string
  // contains(FieldName, 'value') — Filter where a field contains a specific string
  
  // indexof(FieldName, 'value') — Find position of a substring
  // tolower(FieldName) / toupper(FieldName) — Case conversion for comparison
  // trim(FieldName) — Remove leading/trailing whitespace
  // substring(FieldName, start, length) — Extract part of a string
  
  var oDataTable1 = getTableWithRequest(request);
  Logger.log(oDataTable1.getDataArray());
}

function testFunc_readMetadata(){
  let mD = getMetadata().metadata;
  const cache = CacheService.getDocumentCache(); 
  cache.remove(mD.cacheKey("default_schema","EntityType"));
  Logger.log(mD.listEntityTypes());
  // Logger.log(mD.listProperties("GLEntries"));
  let allChildren = mD.getSchemaElem().getChildByAttribute("Name","Chart_of_Accounts","EntityType").getAllChildren();
  Logger.log(allChildren.length);
  let text = "";
  allChildren.forEach(elem => text += `${elem.getName()} Name="${elem.getEdmxAttribute("Name")}" Type="${elem.getEdmxAttribute("Type")}"\n`);
  Logger.log(text);
}

function testFunc_ODataConnection(){
  configSheetName = "Konfiguracja 3";
  let shCoed = new SheetCoeditor(configSheetName);
  let odConnection = new ODataConnection()
    .setODataQuery(shCoed.getTable(),shCoed.getTableQueryArray(),shCoed.getDataTypes())
    .setExtendQuery(shCoed.getExtendTable(),shCoed.getExtendQueryArray(),shCoed.getDataTypes())
    .setupConnection();
  // odConnection.queryURL = odConnection.queryURL.replace("S.A.","sa");
  Logger.log(odConnection.queryURL);
  odConnection.readAllPages();
  Logger.log(odConnection.dataArray); 
}

function testFunc_globalSettings(){
  Logger.log(getGlobalSettings().getTenantId());
  Logger.log(getGlobalSettings().getServiceName());
  Logger.log(getGlobalSettings().getActiveScope());
}

function testFunc_numberFormats(){
  let sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Arkusz1");
  sheet.getRange(30,2,9,1).setValues(EDM_DATA_TYPES.map(dt => [dt]));
  sheet.getRange(30,3,9,1).setNumberFormats(EDM_DATA_TYPES.map(dt => [new DataType().getSpreadsheetNumberFormat()]));
  sheet.getRange(30,3,9,1).setValues(EDM_DATA_TYPES.map(dt => ["24 mar 89"]));
  
}

function testFunc_addApostrophes(){
  let string = "Edm.Guid, Edm.Int64, Edm.String, Edm.Stream, Edm.Int32, Edm.DateTimeOffset, Edm.Boolean, Edm.Decimal, Edm.Date";
  Logger.log("'"+string.replaceAll(", ","', '")+"'");
}

function testFunc_dataType(){
  let testDataType = new DataType(new DataType("string"));
  Logger.log(testDataType.dataWorld);
}

function testFunc_runFuncFromArgument(){
  helpFunc_runFunction(testFunc_slice);
}

function helpFunc_runFunction(action){
  action();
}

function testFunc_formatConfigSheet(){
  let shCoed = new SheetCoeditor("Konfiguracja 5");
  shCoed.setupConfigHeader(shCoed.sheet);
}

function testFunc_arrayLength(){
  let array = [4.0, 6.0, 5.0, 4.0, 1.0, 5.0, 3.0, 6.0, 3.0, 2.0, 3.0, 4.0, 6.0, 6.0, 2.0, 2.0, 1.0, 1.0, 3.0, 1.0, 1.0, 10.0, 4.0, 3.0, 2.0, 1.0, 3.0, 2.0, 5.0, 2.0, 1.0, 5.0, 3.0, 5.0, 1.0, 4.0, 6.0, 1.0, 6.0, 1.0, 2.0, 4.0, 1.0, 2.0, 1.0, 3.0, 1.0, 2.0, 2.0, 2.0, 4.0, 1.0, 3.0, 1.0, 1.0, 1.0, 3.0, 5.0, 3.0, 3.0, 1.0, 2.0, 3.0, 2.0, 6.0, 4.0, 4.0, 5.0, 1.0, 4.0, 2.0, 4.0, 5.0, 1.0, 5.0, 3.0, 1.0, 3.0, 7.0, 4.0, 2.0, 4.0, 3.0, 1.0, 6.0, 1.0, 6.0, 4.0, 10.0, 5.0, 8.0, 3.0, 5.0, 4.0, 1.0, 1.0, 1.0, 4.0, 2.0, 6.0, 2.0, 1.0, 6.0, 4.0, 1.0, 2.0, 1.0, 1.0, 1.0, 5.0, 1.0, 4.0, 3.0, 1.0, 6.0, 1.0, 6.0, 1.0, 4.0, 6.0, 3.0, 5.0, 6.0, 8.0, 1.0, 2.0, 1.0, 5.0, 2.0, 4.0, 1.0, 7.0, 1.0, 4.0, 1.0, 5.0, 5.0, 2.0, 5.0, 11.0, 3.0, 2.0, 4.0, 1.0, 1.0, 5.0, 1.0, 1.0, 2.0, 1.0, 2.0, 2.0, 5.0, 2.0, 1.0, 6.0, 1.0, 1.0, 2.0, 2.0, 1.0, 3.0, 6.0, 2.0, 4.0, 1.0, 1.0, 2.0, 3.0, 4.0, 6.0, 2.0, 2.0, 3.0, 2.0, 1.0, 1.0, 1.0, 2.0, 2.0, 5.0, 1.0, 3.0, 7.0, 2.0, 6.0, 1.0, 6.0, 2.0, 1.0, 2.0, 2.0, 1.0, 3.0, 5.0, 1.0, 6.0, 2.0, 5.0, 3.0, 2.0, 4.0, 1.0, 2.0, 1.0, 1.0, 6.0, 4.0, 3.0, 2.0, 2.0, 3.0, 1.0, 1.0, 2.0, 2.0, 2.0, 1.0, 4.0, 6.0, 3.0, 4.0, 4.0, 6.0, 5.0, 3.0, 3.0, 5.0, 4.0, 3.0, 3.0, 3.0, 7.0, 2.0, 6.0, 6.0, 4.0, 1.0, 7.0, 7.0, 3.0, 5.0, 6.0, 3.0, 1.0, 1.0, 1.0, 2.0, 3.0, 2.0, 2.0, 4.0, 1.0, 4.0, 7.0, 5.0, 3.0, 1.0, 8.0, 6.0, 3.0, 4.0, 2.0, 5.0, 2.0, 5.0, 6.0, 2.0, 3.0, 4.0, 5.0, 5.0, 2.0, 2.0, 5.0, 2.0, 2.0, 1.0, 7.0, 1.0, 4.0, 7.0, 5.0, 2.0, 5.0, 2.0, 1.0, 3.0, 1.0, 6.0, 5.0, 4.0, 5.0, 3.0, 4.0, 5.0, 3.0, 2.0, 3.0, 2.0, 1.0, 2.0, 4.0, 2.0, 1.0, 4.0, 4.0, 6.0, 5.0, 2.0, 3.0, 4.0, 1.0, 2.0, 3.0, 3.0, 1.0, 4.0, 3.0, 2.0, 5.0, 1.0, 2.0, 12.0, 2.0, 1.0, 1.0, 5.0, 6.0, 3.0, 1.0, 2.0, 5.0, 5.0, 1.0, 4.0, 9.0, 2.0, 2.0, 1.0, 3.0, 1.0, 1.0, 1.0, 2.0, 2.0, 1.0, 3.0, 1.0, 1.0, 2.0, 3.0, 1.0, 2.0, 6.0, 1.0, 1.0, 2.0, 8.0, 4.0, 2.0, 2.0, 2.0, 3.0, 1.0, 1.0, 3.0, 1.0, 2.0, 1.0, 2.0, 6.0, 1.0, 1.0, 1.0, 7.0, 3.0, 4.0, 2.0, 8.0, 2.0, 1.0, 3.0, 1.0, 5.0, 5.0, 1.0, 5.0, 2.0, 3.0, 1.0, 1.0, 2.0, 2.0];
  Logger.log(array.length);
}

function testFunc_conditionalOperator(){
  let x = {y: 5};
  Logger.log(x?.y);
  x = null;
  Logger.log(x?.y ?? "default");
  Logger.log((x?.y)==true ? "prawda" : "fałsz");
}

function testFunc_modalDialog(counter=0){
  SpreadsheetApp.getActiveSpreadsheet().toast("<br> Hello </br>");
 // Utilities.sleep(1000);
  //if(counter<5) testFunc_modalDialog(counter+1);
}

function testFunc_errorReporting(){
  // userSafe(() =>    Logger.log(HelperDataStore.checkAvailability()));
  Logger.log(`Reading script property value for ${TENTANT_KEY_}`);
  userSafe(() => Logger.log(Store.get("script",TENTANT_KEY_)));
  // userSafe(() =>           (HelperDataStore.deleteUserCache('testKey')));
  // userSafe(() => Logger.log(HelperDataStore.getUserCacheValue('testKey')));
}

function testFunc_codingHelper(){
  let output = '';
  let actions = ['set', 'delete', 'get'];
  let scopes = ['Document', 'User', 'Script'];
  let services = ['Property','Cache'];
  actions.forEach(action => {
    scopes.forEach(scope => {
      services.forEach(service => {
        output += `
  /**
   * ${action.charAt(0).toLowerCase()+action.slice(1)} ${scope} ${service} ${action == 'delete' ? '' : 'value'}.
   * 
   * ${action == 'get' ? '@return value.' : '@return HelperDataStore for chaining.'}
   * 
   * @param key {String} Key to ${action == 'set' ? 'save the value with' : action == 'get' ? 'to read.' : 'to delete.'}.
   * ${action == 'set' ? '@param value {String|null} Value to be saved. Set null to delete property.' : ''}
   */`;
        output += `
  static ${action}${scope}${service}${action == 'delete' ? '' : 'Value'}(key${action=='set' ? ',value=undefined' : ''}){
    return this.${action}${service}${action == 'delete' ? '' : 'Value'}('${scope.charAt(0).toLowerCase() + scope.slice(1)}',key${action=='set' ? ',value' : ''}); 
  }\n`;
      });
    });
  });
  Logger.log(output);
}

function testFunc_printCallStack(){
  Logger.log(new Error().stack);
}

function testFunc_refreshAllDataForConfigSheet_test(){
  let configSheetName = "Arkusz2";
  let shCoed = new SheetCoeditor(configSheetName,true);
  try{ 
    if(!shCoed.getTable()){
      Logger.log("No table in config sheet. Quitting.");
      shCoed.switchReadingControl(false);
      return;
    }
    
    var odConnection = new ODataConnection()
      .setODataQuery(shCoed.getTable(),shCoed.getTableQueryArray(),shCoed.getDataTypes())
      .setExtendQuery(shCoed.getExtendTable(),shCoed.getExtendQueryArray(),shCoed.getDataTypes())
      .setupConnection();
    // odConnection.queryURL = odConnection.queryURL.replace("S.A.","sa");
    Logger.log(odConnection.queryURL);
    
    odConnection.readAllPages_test();

    var columnDataTypes = odConnection.getColumnInfo().map(info => getMetadata().getDataType(info.field,info.table ?? shCoed.getTable()));
  } catch(e) {
    shCoed.switchReadingControl(false);
    throw e;  
  }
  shCoed.switchReadingControl(false);
  shCoed.switchDataWritingControl(true);
  try{  
    var table1 = odConnection.getDataArray();

    var sheetName = resultSheetName ?? getMainSettings().getResultSheetName(configSheetName);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(sheetName);
    if (!sheet) sheet = ss.insertSheet(sheetName);
    sheet.getDataRange().clear();
    Logger.log(columnDataTypes);
    columnDataTypes.forEach((dataType,index)=>{
      sheet.getRange(1,index+1,table1.length,1).setNumberFormat(new DataType(dataType).getSpreadsheetNumberFormat()); 
    });
    sheet.getRange(1, 1, table1.length, table1[0].length).setValues(table1); 
  } catch (e) {
    shCoed.switchDataWritingControl(false);
    throw e;  
  }
  shCoed.switchDataWritingControl(false);
}


function testFunc_dumpTriggersIntoSpreadsheet(){
  let ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName("trigger list"); 
  if(!sheet) sheet = ss.insertSheet("trigger list");
  sheet.getDataRange().clear();
  let triggers = ScriptApp.getProjectTriggers();
  let values = triggers.map( trigger => [
    trigger.getEventType(),
    trigger.getUniqueId(),
    trigger.getTriggerSource(),
    trigger.getTriggerSourceId() ? SpreadsheetApp.openById(trigger.getTriggerSourceId()).getName() : "-",
    trigger.getTriggerSourceId() ? SpreadsheetApp.openById(trigger.getTriggerSourceId()).getUrl() : "-",
    trigger.getHandlerFunction()
  ]
  );
  values.unshift(["Event","Trigger Id","Source","Source name","Source URL","Function"]);
  values.forEach((val,i) => val.unshift(i));
  sheet.getRange(1,1,values.length,values[0].length).setValues(values);
}

function testFunc_deleteTriggers(){
  let ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName("trigger list"); 
  let trigIds = sheet.getRange(1,3,sheet.getLastRow(),1).getValues();
  let filter = sheet.getRange(1,8,sheet.getLastRow(),1).getValues();
  trigIds = trigIds.filter((v,i)=>filter[i]=="X")
  let triggers = ScriptApp.getProjectTriggers();
  triggers = triggers.filter(trigger => trigIds.find(id => id==trigger.getUniqueId())!=null);
  Logger.log(triggers.forEach(trigger => {
    Logger.log(trigger.getUniqueId());
    // Zabezpiecznie 
    ScriptApp.deleteTrigger(trigger);
  }));
}


function testFunc_TriggerManager(){
  
  Logger.log("Before anything:");
  let trigId = TriggerWrapper.getUserTriggers().find(trigger => trigger.getEventType() === ScriptApp.EventType.ON_EDIT)?.getUniqueId()
  if(trigId) Logger.log("Trigger "+trigId+" is "+ (getDocumentTriggerLog().isTriggerLogged(trigId) ? "logged." : "NOT logged."));
  else Logger.log("No edit triggers to begin with.");

  TriggerWrapper.getUserTriggers().filter(trigger => trigger.getEventType() === ScriptApp.EventType.ON_EDIT).forEach(trigger => ScriptApp.deleteTrigger(trigger));
  
  Logger.log("After deletion:");
  trigId = TriggerWrapper.getUserTriggers().find(trigger => trigger.getEventType() === ScriptApp.EventType.ON_EDIT)?.getUniqueId()
  if(trigId) Logger.log("Trigger "+trigId+" is "+ (getDocumentTriggerLog().isTriggerLogged(trigId) ? "logged." : "NOT logged."));
  else Logger.log("No edit triggers.");

  try{
    trigId = TriggerWrapper.createOnEditTrigger("sheetEdit");
  } catch(e){
    if(e instanceof UnknownError){
      Logger.log(e.message);
      throw e.getUnknownError();
    }
    throw e;
  }
  
  Logger.log("After creation:");
  if(trigId) Logger.log("Trigger "+trigId+" is "+ (getDocumentTriggerLog().isTriggerLogged(trigId) ? "logged." : "NOT logged."));
  else Logger.log("No edit triggers.");

  Logger.log("All triggers:");
  TriggerWrapper.getUserTriggers().forEach((trigger,i) => {
    Logger.log(i+": "+trigger.getEventType());
  })
  
}

function testFunc_testTriggerLogging(){
  let docTL = new DocumentTriggerLog();
  
  let trigger = TriggerWrapper.getUserTriggers()[0];
  let triggerId = trigger.getUniqueId();
  
  Logger.log("Before any action:");
  Logger.log(docTL.triggerArray);
  Logger.log("Trigger "+triggerId+" is "+ (docTL.isTriggerLogged(triggerId) ? "logged." : "NOT logged."));

  docTL.logNewTrigger(trigger);
  
  Logger.log("After insert:");
  Logger.log(docTL.triggerArray);
  Logger.log("Trigger "+triggerId+" is "+ (docTL.isTriggerLogged(triggerId) ? "logged." : "NOT logged."));

  docTL.logNewTrigger(trigger);

  Logger.log("After another insert:");
  Logger.log(docTL.triggerArray);
  Logger.log("Trigger "+triggerId+" is "+ (docTL.isTriggerLogged(triggerId) ? "logged." : "NOT logged."));

}

// - - - - - - - - ConfigGrid: checks on a REAL spreadsheet (the offline tests only use a simulation) - - - - - - - -

/**
 * Creates a config sheet with ConfigGrid and compares its header block (A1:G4) with the header of a config sheet made by the OLD code.
 * Run it from the script editor after pushing to a COPY of the add-on, with `referenceSheetName` = the name of an existing, untouched
 * config sheet (e.g. "Konfiguracja 1"). Logs every difference; the temporary sheet is deleted at the end.
 */
function testConfigGridHeaderMatchesReference(referenceSheetName){
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ref = ss.getSheetByName(referenceSheetName);
  if(!ref) throw new Error("Brak arkusza wzorcowego: "+referenceSheetName);
  const tmpName = "ConfigGrid test";
  const old = ss.getSheetByName(tmpName);
  if(old) ss.deleteSheet(old);
  ConfigGrid.create(tmpName);
  const tmp = ss.getSheetByName(tmpName);
  const diffs = [];
  const colors = r => map2D(r.getFontColorObjects(),x => x.asRgbColor().asHexString());
  const compare = (what,getter) => {
    const a = JSON.stringify(getter(ref.getRange(1,1,4,7))), b = JSON.stringify(getter(tmp.getRange(1,1,4,7)));
    if(a !== b) diffs.push(what+":\n  reference "+a+"\n  ConfigGrid "+b);
  };
  compare("values (F2, the estimated rows, is ignored)",r => { const v = r.getValues(); v[1][5] = ""; return v; });
  compare("font weights",r => r.getFontWeights());
  compare("backgrounds",r => r.getBackgrounds());
  compare("font sizes",r => r.getFontSizes());
  compare("horizontal alignments (F2 holds a number in a used sheet and reads general-right)",r => { const a = r.getHorizontalAlignments(); a[1][5] = ""; return a; });
  compare("vertical alignments",r => r.getVerticalAlignments());
  compare("wrap strategies",r => map2D(r.getWrapStrategies(),String));
  compare("notes",r => r.getNotes());
  compare("font colors",colors);
  compare("merged ranges",r => r.getMergedRanges().map(m => m.getA1Notation()).sort());
  ss.deleteSheet(tmp);
  const msg = diffs.length ? "ConfigGrid header DIFFERS from "+referenceSheetName+":\n"+diffs.join("\n") : "ConfigGrid header matches "+referenceSheetName+" (values, formats, notes, merges).";
  Logger.log(msg);
  return msg;
}

/**
 * Walks the status cells of a config sheet through a whole refresh (reading -> connection -> estimate -> writing -> done) with pauses,
 * so the colours can be watched. The sheet must exist; its status cells are left in the "off" state.
 */
function testConfigGridStatusSwitches(configSheetName){
  const co = new SheetCoeditor(configSheetName,false);
  const pause = () => Utilities.sleep(800);
  co.switchReadingControl(true); pause();
  co.switchReadingControl(false);
  co.switchConnectionControl(true); pause();
  co.switchConnectionControl(false);
  co.setTotRowsInfo(1234567); pause();
  co.switchDataWritingControl(true); pause();
  co.switchDataWritingControl(false);
  co.switchEstimateInfoActive(false);
  Logger.log("Status switches done on "+configSheetName+". Expected: every status cell grey (#cccccc, text #999999), E2:F2 grey, F2 = 1,234,567.");
}

/**
 * Prints what a script reads from the three activity indicators (B2:D2) and the estimate cells (E2:F2) of a config sheet - the same
 * reads the live check makes - so that "all controls look off" can be compared with the exact colours. Idle = background #cccccc, font #999999.
 */
function testConfigGridIndicators(configSheetName){
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(configSheetName);
  if(!sheet) throw new Error("Brak arkusza: "+configSheetName);
  const lines = ["B2 reading","C2 connection","D2 data writing","E2 estimate label","F2 estimate"].map(label => {
    const cell = sheet.getRange(label.split(" ")[0]);
    const idle = cell.getBackground() === "#cccccc" && cell.getFontColor() === "#999999";
    return `${label}: background ${cell.getBackground()}, font ${cell.getFontColor()}${idle ? " (idle)" : ""}`;
  });
  const text = configSheetName+"\n"+lines.join("\n");
  Logger.log(text);
  return text;
}
