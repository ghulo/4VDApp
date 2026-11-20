import type { Migration } from 'kysely/migration';
import * as initialSchema from './001_initial_schema.js';
import * as reportsAndActivity from './002_reports_and_activity.js';
import * as returnsCountsWriteOffs from './003_returns_counts_write_offs.js';
import * as promotionsAndTargets from './004_promotions_and_targets.js';
import * as pushNotifications from './005_push_notifications.js';
import * as accounts from './006_accounts.js';
import * as weeklyReport from './007_weekly_report.js';
import * as roles from './008_roles.js';
import * as language from './009_language.js';
import * as undo from './010_undo.js';
import * as alertSubjects from './011_alert_subjects.js';
import * as carwash from './012_carwash.js';
import * as cashCounts from './013_cash_counts.js';
import * as expenses from './014_expenses.js';
import * as customerTabs from './015_customer_tabs.js';
import * as purchaseOrders from './016_purchase_orders.js';
import * as expiryDates from './017_expiry_dates.js';
import * as barcodes from './018_barcodes.js';
import * as nui from './019_nui.js';
import * as carwashes from './020_carwashes.js';
import * as documents from './021_documents.js';
import * as tabRefunds from './022_tab_refunds.js';
import * as billsAndReports from './023_bills_and_reports.js';
import * as noExpenseDays from './024_no_expense_days.js';
import * as cashChecked from './025_cash_checked.js';
import * as assistantChats from './026_assistant_chats.js';
import * as businessBank from './027_business_bank.js';
import * as documentLineCodes from './028_document_line_codes.js';
import * as invoiceDetails from './029_invoice_details.js';
import * as billScans from './030_bill_scans.js';
import * as billScanReopen from './031_bill_scan_reopen.js';
import * as productCountry from './032_product_country.js';
import * as productRequests from './033_product_requests.js';
import * as dayClosings from './034_day_closings.js';
import * as pushDeviceApp from './035_push_device_app.js';
import * as activitySay from './036_activity_say.js';
import * as trefinImport from './037_trefin_import.js';
import * as productBarcodes from './038_product_barcodes.js';
import * as books from './039_books.js';
import * as billKinds from './040_bill_kinds.js';
import * as vat from './041_vat.js';
import * as money from './042_money.js';
import * as counter from './043_counter.js';
import * as opening from './044_opening.js';
import * as trefinCompare from './045_trefin_compare.js';
import * as trefinHistory from './046_trefin_history.js';
import * as trefinSales from './047_trefin_sales.js';
import * as trefinStock from './048_trefin_stock.js';
import * as trefinMoney from './049_trefin_money.js';
import * as trefinJournal from './050_trefin_journal.js';
import * as trefinOffersActivity from './051_trefin_offers_activity.js';
import * as statements from './052_statements.js';
import * as splitPayment from './053_split_payment.js';
import * as weighedProducts from './054_weighed_products.js';
import * as cashOpenings from './055_cash_openings.js';
import * as counterPins from './056_counter_pins.js';
import * as offlineSales from './057_offline_sales.js';
import * as salesDocuments from './058_sales_documents.js';
import * as partners from './059_partners.js';
import * as settingsSafety from './060_settings_safety.js';
import * as wholesale from './061_wholesale.js';
import * as units from './062_units.js';
import * as packBarcodes from './063_pack_barcodes.js';
import * as stockDocuments from './064_stock_documents.js';
import * as fixedAssets from './065_fixed_assets.js';
import * as billEmails from './066_bill_emails.js';
import * as shortDated from './067_short_dated.js';
import * as payroll from './068_payroll.js';
import * as stockLocations from './069_stock_locations.js';
import * as portal from './070_portal.js';
import * as portalOrderChanges from './071_portal_order_changes.js';
import * as employeeDetails from './072_employee_details.js';
import * as projects from './073_projects.js';
import * as recipes from './074_recipes.js';
import * as serials from './075_serials.js';
import * as declarations from './076_declarations.js';
import * as twoStepSignIn from './077_two_step_sign_in.js';
import * as businessEverywhere from './078_business_everywhere.js';
import * as uniquePerBusiness from './079_unique_per_business.js';
import * as passkeys from './080_passkeys.js';
import * as rowSecurity from './081_row_security.js';
import * as platformDeveloper from './082_platform_developer.js';
import * as twoStepAgain from './083_two_step_again.js';
import * as sessionBusiness from './084_session_business.js';
import * as people from './085_people.js';
import * as blockPerBusiness from './086_block_per_business.js';
import * as businessShortName from './087_business_short_name.js';
import * as allLogs from './088_all_logs.js';
import * as sessionsFrom from './089_sessions_from.js';
import * as businessBrand from './090_business_brand.js';
import * as imports from './091_imports.js';
import * as privateFiles from './092_private_files.js';
import * as pinDayLock from './093_pin_day_lock.js';
import * as backupSearchPath from './094_backup_search_path.js';
import * as customsPapers from './095_customs_papers.js';
import * as refundMethods from './096_refund_methods.js';
import * as counterEventIds from './097_counter_event_ids.js';

/**
 * Every migration, keyed by name. Kysely runs them in key order, so always
 * prefix new ones with the next number. Listing them here (instead of reading
 * the folder at runtime) works the same under tsx, the compiled build and
 * Windows paths.
 */
export const migrations: Record<string, Migration> = {
  '001_initial_schema': initialSchema,
  '002_reports_and_activity': reportsAndActivity,
  '003_returns_counts_write_offs': returnsCountsWriteOffs,
  '004_promotions_and_targets': promotionsAndTargets,
  '005_push_notifications': pushNotifications,
  '006_accounts': accounts,
  '007_weekly_report': weeklyReport,
  '008_roles': roles,
  '009_language': language,
  '010_undo': undo,
  '011_alert_subjects': alertSubjects,
  '012_carwash': carwash,
  '013_cash_counts': cashCounts,
  '014_expenses': expenses,
  '015_customer_tabs': customerTabs,
  '016_purchase_orders': purchaseOrders,
  '017_expiry_dates': expiryDates,
  '018_barcodes': barcodes,
  '019_nui': nui,
  '020_carwashes': carwashes,
  '021_documents': documents,
  '022_tab_refunds': tabRefunds,
  '023_bills_and_reports': billsAndReports,
  '024_no_expense_days': noExpenseDays,
  '025_cash_checked': cashChecked,
  '026_assistant_chats': assistantChats,
  '027_business_bank': businessBank,
  '028_document_line_codes': documentLineCodes,
  '029_invoice_details': invoiceDetails,
  '030_bill_scans': billScans,
  '031_bill_scan_reopen': billScanReopen,
  '032_product_country': productCountry,
  '033_product_requests': productRequests,
  '034_day_closings': dayClosings,
  '035_push_device_app': pushDeviceApp,
  '036_activity_say': activitySay,
  '037_trefin_import': trefinImport,
  '038_product_barcodes': productBarcodes,
  '039_books': books,
  '040_bill_kinds': billKinds,
  '041_vat': vat,
  '042_money': money,
  '043_counter': counter,
  '044_opening': opening,
  '045_trefin_compare': trefinCompare,
  '046_trefin_history': trefinHistory,
  '047_trefin_sales': trefinSales,
  '048_trefin_stock': trefinStock,
  '049_trefin_money': trefinMoney,
  '050_trefin_journal': trefinJournal,
  '051_trefin_offers_activity': trefinOffersActivity,
  '052_statements': statements,
  '053_split_payment': splitPayment,
  '054_weighed_products': weighedProducts,
  '055_cash_openings': cashOpenings,
  '056_counter_pins': counterPins,
  '057_offline_sales': offlineSales,
  '058_sales_documents': salesDocuments,
  '059_partners': partners,
  '060_settings_safety': settingsSafety,
  '061_wholesale': wholesale,
  '062_units': units,
  '063_pack_barcodes': packBarcodes,
  '064_stock_documents': stockDocuments,
  '065_fixed_assets': fixedAssets,
  '066_bill_emails': billEmails,
  '067_short_dated': shortDated,
  '068_payroll': payroll,
  '069_stock_locations': stockLocations,
  '070_portal': portal,
  '071_portal_order_changes': portalOrderChanges,
  '072_employee_details': employeeDetails,
  '073_projects': projects,
  '074_recipes': recipes,
  '075_serials': serials,
  '076_declarations': declarations,
  '077_two_step_sign_in': twoStepSignIn,
  '078_business_everywhere': businessEverywhere,
  '079_unique_per_business': uniquePerBusiness,
  '080_passkeys': passkeys,
  '081_row_security': rowSecurity,
  '082_platform_developer': platformDeveloper,
  '083_two_step_again': twoStepAgain,
  '084_session_business': sessionBusiness,
  '085_people': people,
  '086_block_per_business': blockPerBusiness,
  '087_business_short_name': businessShortName,
  '088_all_logs': allLogs,
  '089_sessions_from': sessionsFrom,
  '090_business_brand': businessBrand,
  '091_imports': imports,
  '092_private_files': privateFiles,
  '093_pin_day_lock': pinDayLock,
  '094_backup_search_path': backupSearchPath,
  '095_customs_papers': customsPapers,
  '096_refund_methods': refundMethods,
  '097_counter_event_ids': counterEventIds,
};
