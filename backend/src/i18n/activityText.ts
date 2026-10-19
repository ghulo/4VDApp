import { type Language, LOCALE, money } from './language.js';

/**
 * Activity sentences in both languages. A log entry stores what happened as a
 * key plus its values (`Say`), and is written out in the reader's language when
 * it is shown, so the Albanian dashboard never reads an English history. The
 * English sentence is also kept in `summary` for search, the AI and old rows.
 */

interface Words {
  money: (amount: number) => string;
  /** "14 Oct" / "14 tet" from a yyyy-mm-dd day. */
  day: (iso: string) => string;
  /** "a, b and c" / "a, b dhe c". */
  list: (items: string[]) => string;
}

type Role = 'developer' | 'admin' | 'owner' | 'employee' | 'family' | 'accountant';
type RolePower = 'sell' | 'oversee' | 'products' | 'manage' | 'books' | 'filing' | 'reopen' | 'entries' | 'customers' | 'documents';
type RoleChange = { role: Role; power: RolePower; on: boolean };
type LoginHow = 'password' | 'google' | 'googleFirst' | 'invite';
export type ProductField =
  | 'name'
  | 'description'
  | 'categoryId'
  | 'price'
  | 'costPrice'
  | 'imageUrl'
  | 'sku'
  | 'isActive'
  | 'vatRate'
  | 'vatExempt'
  | 'originCountry'
  | 'bulkPricingTiers';
export type ShopField = 'name' | 'address' | 'phone' | 'nui' | 'timeZone' | 'bankName' | 'iban' | 'invoiceNote';
type SettingName =
  | 'refundApprovalLimit'
  | 'returnWindowDays'
  | 'minimumMarginPercent'
  | 'cashFloatShop'
  | 'paymentTermsDays'
  | 'employeeDiscountLimit';
export type UserChange =
  | { kind: 'renamed'; to: string }
  | { kind: 'role'; from: Role; to: Role }
  | { kind: 'blocked' }
  | { kind: 'allowed' }
  | { kind: 'password' }
  | { kind: 'targetRemoved' }
  | { kind: 'target'; to: number }
  | { kind: 'commissionRemoved' }
  | { kind: 'commission'; to: number };
export type SettingChange = { name: SettingName; from: number; to: number };
type ExpensePlace = { carwash: string } | { place: string };
type WriteOffReason = 'damaged' | 'lost' | 'expired' | 'other' | string;

/** Why a cost changed: a delivery, a scanned bill, or a scanned bill taken back. */
export type CostReason = { order: number; supplier: string } | { scan: string } | { reopened: true } | { bill: string };

/** A place money is kept; a null name is the usual name of its kind. */
type Place = { kind: 'till' | 'safe' | 'bank'; name: string | null };
/** A move's sides; null is the owner (money put in or taken out). */
type Move = { amount: number; from: Place | null; to: Place | null };

/** A product line in a sentence: "2 × Oak Chair". */
type Units = { quantity: number; product: string };

const en = {
  loggedIn: (p: { name: string; how: LoginHow }) =>
    `${p.name} ${{ password: 'logged in', google: 'logged in with Google', googleFirst: 'logged in with Google for the first time', invite: 'logged in for the first time' }[p.how]}`,

  billScanned: (p: { supplier: string | null; lines: number }) =>
    `Scanned a bill${p.supplier ? ` from ${p.supplier}` : ''} (${p.lines} ${p.lines === 1 ? 'line' : 'lines'})`,
  billScanConfirmed: (p: { supplier: string; pieces: number; orderId: number; newProducts: number }) =>
    `Confirmed the scanned bill from ${p.supplier}: ${p.pieces} pieces into stock with order #${p.orderId}${p.newProducts > 0 ? `, ${p.newProducts} new products` : ''}`,
  billScanDiscarded: (p: { supplier: string | null }) => `Discarded a scanned bill${p.supplier ? ` from ${p.supplier}` : ''}`,
  orderFromScan: (p: { orderId: number }) => `Made order #${p.orderId} from a scanned bill`,
  barcodePutBack: (p: { product: string; to: string | null }) =>
    `Put the barcode of ${p.product} back${p.to ? ` to ${p.to}` : ''} (scanned bill reopened)`,
  billScanReopened: (p: { supplier: string | null; undone: boolean }) =>
    `Reopened the scanned bill${p.supplier ? ` from ${p.supplier}` : ''}${p.undone ? ': stock, bill and order put back' : ''}`,
  productFromBill: (p: { product: string; supplier: string }) => `Added product ${p.product} from ${p.supplier}'s bill`,
  barcodeFromBill: (p: { product: string; from: string | null; to: string; supplier: string }) =>
    `Changed the barcode of ${p.product}${p.from ? ` from ${p.from}` : ''} to ${p.to}, as on ${p.supplier}'s bill`,

  shopChanged: (p: { fields: ShopField[] }, w: Words) =>
    `Changed the shop's ${w.list(p.fields.map((field) => ({ name: 'name', address: 'address', phone: 'phone', nui: 'NUI', timeZone: 'time zone', bankName: 'bank', iban: 'IBAN', invoiceNote: 'invoice note' })[field] ?? field))}`,

  carwashAdded: (p: { name: string; float: number }, w: Words) => `Added the carwash ${p.name} (cash float ${w.money(p.float)})`,
  carwashArchived: (p: { name: string; stoppedExpenses: number }) =>
    `Archived the carwash ${p.name}${p.stoppedExpenses > 0 ? `; its ${p.stoppedExpenses} monthly expense${p.stoppedExpenses === 1 ? '' : 's'} stopped repeating` : ''}`,
  carwashRestored: (p: { name: string }) => `Restored the carwash ${p.name}`,
  carwashChanged: (p: { name: string; renamedTo: string | null; float: { from: number; to: number } | null }, w: Words) =>
    [
      p.renamedTo ? `Renamed the carwash ${p.name} to ${p.renamedTo}` : `Changed the carwash ${p.name}`,
      p.float ? `cash float from ${w.money(p.float.from)} to ${w.money(p.float.to)}` : null,
    ]
      .filter(Boolean)
      .join(': '),
  takingsSaved: (p: { carwash: string | null; day: string; changed: boolean; carwashAmount: number; change: number }, w: Words) =>
    `${p.changed ? 'Changed' : 'Entered'} the ${p.carwash ? `${p.carwash} carwash` : 'carwash'} takings for ${w.day(p.day)}: ${w.money(p.carwashAmount)} carwash + ${w.money(p.change)} change`,
  takingsRemoved: (p: { carwash: string | null; day: string }, w: Words) =>
    `Removed the ${p.carwash ? `${p.carwash} carwash` : 'carwash'} takings for ${w.day(p.day)}`,

  cashDifferenceChecked: () => 'Checked a cash difference',
  cashCounted: (p: { counted: number; drawer: string | null; float: number }, w: Words) =>
    `Counted ${w.money(p.counted)} in the ${p.drawer ? `${p.drawer} carwash` : 'shop'} drawer (float ${w.money(p.float)})`,

  categoryAdded: (p: { name: string }) => `Added category ${p.name}`,
  categoryEdited: (p: { name: string }) => `Edited category ${p.name}`,
  categoryRenamed: (p: { from: string; to: string }) => `Renamed category ${p.from} to ${p.to}`,
  categoryDeleted: (p: { name: string }) => `Deleted category ${p.name}`,

  noExpenses: (p: { day: string }, w: Words) => `Said ${w.day(p.day)} had no expenses`,
  noExpensesTakenBack: (p: { day: string }, w: Words) => `Took back "no expenses" for ${w.day(p.day)}`,

  documentIssued: (p: { kind: 'invoice' | 'credit_note'; number: string; total: number }, w: Words) =>
    `Issued ${p.kind === 'invoice' ? 'invoice' : 'credit note'} ${p.number} for ${w.money(p.total)}`,
  fiscalReceiptLinked: (p: { number: string; receipt: string }) => `Linked ${p.number} to fiscal receipt ${p.receipt}`,
  fiscalReceiptRemoved: (p: { number: string }) => `Removed the fiscal receipt from ${p.number}`,
  counterSettingsChanged: () => 'Changed the counter settings (fiscal printer, receipt footer, drawer)',
  printerReport: (p: { kind: 'x' | 'z' }): string => (p.kind === 'z' ? "Ran the fiscal printer's Z report (closes the fiscal day)" : "Printed the fiscal printer's X report"),
  drawerOpened: (p: { reason: string }) => `Opened the drawer without a sale: ${p.reason}`,

  expenseAdded: (p: { amount: number; category: string; at: ExpensePlace; day: string; monthly: boolean }, w: Words) =>
    `Added an expense: ${w.money(p.amount)} for ${EN_EXPENSE[p.category] ?? p.category} (${'carwash' in p.at ? `${p.at.carwash} carwash` : p.at.place}) on ${w.day(p.day)}${p.monthly ? ', repeating every month' : ''}`,
  expenseRemoved: (p: { amount: number; category: string; day: string }, w: Words) =>
    `Removed the ${w.money(p.amount)} ${EN_EXPENSE[p.category] ?? p.category} expense of ${w.day(p.day)}`,
  expenseStopped: (p: { category: string }) => `Stopped the monthly ${EN_EXPENSE[p.category] ?? p.category} expense`,
  bookEntryAdded: (p: { id: number; amount: number; description: string }, w: Words) =>
    `Wrote entry #${p.id} in the books (${w.money(p.amount)}): ${p.description}`,
  bookEntryReversed: (p: { id: number }) => `Reversed entry #${p.id} in the books`,
  openingPosted: (p: { id: number; day: string; amount: number }, w: Words) => `Posted the opening balances on ${w.day(p.day)} (entry #${p.id}, ${w.money(p.amount)})`,
  openingTakenBack: (p: { id: number; reason: string }) => `Took back the opening balances (entry #${p.id}): ${p.reason}`,
  openingTrefinLoaded: (p: { bills: number; charges: number; lines: number }) =>
    `Brought the opening balances over from TREFIN: ${p.lines} lines, ${p.bills} open supplier bills, ${p.charges} customer balances`,

  vatFiled: (p: { month: string; outcome: 'pay' | 'carry' | 'nothing'; amount: number }, w: Words) =>
    `Filed the VAT return for ${EN_MONTHS[Number(p.month.slice(5, 7)) - 1]} ${p.month.slice(0, 4)}: ${
      p.outcome === 'pay' ? `${w.money(p.amount)} to pay` : p.outcome === 'carry' ? `${w.money(p.amount)} carried to next month` : 'nothing to pay'
    }`,
  vatReopened: (p: { month: string; reason: string }) =>
    `Reopened the VAT month ${EN_MONTHS[Number(p.month.slice(5, 7)) - 1]} ${p.month.slice(0, 4)}: ${p.reason}`,
  yearClosed: (p: { year: number; profit: number; tax: number }, w: Words) =>
    `Closed ${p.year} in the books: ${p.profit >= 0 ? 'profit' : 'loss'} of ${w.money(Math.abs(p.profit))} after ${w.money(p.tax)} profit tax moved into retained earnings`,
  yearReopened: (p: { year: number; reason: string }) => `Reopened ${p.year} in the books: ${p.reason}`,
  tmPaid: (p: { year: number; quarter: number; amount: number; day: string }, w: Words) =>
    `Paid the profit tax instalment for Q${p.quarter} ${p.year}: ${w.money(p.amount)} on ${w.day(p.day)}`,
  tmUndone: (p: { year: number; quarter: number; amount: number }, w: Words) => `Took back the ${w.money(p.amount)} profit tax instalment for Q${p.quarter} ${p.year}`,
  questionAsked: (p: { on: QuestionOn; text: string }) => `Asked about ${EN_ON[p.on.kind]} ${p.on.label}: “${p.text}”`,
  questionAnswered: (p: { on: QuestionOn; text: string }) => `Answered on ${EN_ON[p.on.kind]} ${p.on.label}: “${p.text}”`,
  bookAccountAdded: (p: { number: string; name: string }) => `Added account ${p.number} ${p.name} to the books`,
  bookAccountChanged: (p: { number: string; name: string }) => `Changed account ${p.number} ${p.name} in the books`,
  bookLinksChanged: () => 'Changed which accounts the books post to',
  booksStartChanged: (p: { from: string | null; to: string }, w: Words) =>
    `Set the books to start on ${w.day(p.to)}${p.from ? ` (was ${w.day(p.from)})` : ''}`,

  expiryNoted: (p: Units & { day: string }, w: Words) => `Noted ${p.quantity} × ${p.product} expiring on ${w.day(p.day)}`,
  expiryCleared: (p: Units & { day: string }, w: Words) => `Dealt with ${p.quantity} × ${p.product} expiring on ${w.day(p.day)}`,

  reorderLevelChanged: (p: { product: string; from: number; to: number }) =>
    `Changed reorder level of ${p.product} from ${p.from} to ${p.to}`,
  stockAdded: (p: { product: string; amount: number; reason: string }) => `Added ${p.amount} to ${p.product} (${p.reason})`,
  stockRemoved: (p: { product: string; amount: number; reason: string }) =>
    `Removed ${p.amount} from ${p.product} (${p.reason})`,

  invited: (p: { email: string; role: Role }) => `Invited ${p.email} as ${EN_ROLE[p.role]}`,
  joined: (p: { name: string; role: Role }) => `${p.name} joined as ${EN_ROLE[p.role]}`,

  bulkPricesUpdated: (p: { product: string }) => `Updated bulk prices for ${p.product}`,

  productRequested: (p: { name: string; price: number }, w: Words) => `Asked to add ${p.name} at ${w.money(p.price)}`,
  productRequestApproved: (p: { name: string; by: string | null }) => `Approved adding ${p.name}${p.by ? `, asked for by ${p.by}` : ''}`,
  productRequestRejected: (p: { name: string; note: string }) => `Did not add ${p.name}: ${p.note}`,

  barcodeRemoved: (p: { product: string }) => `Removed the barcode of ${p.product}`,
  barcodeAdded: (p: { product: string; code: string }) => `Gave ${p.product} another barcode, ${p.code}`,
  otherBarcodeRemoved: (p: { product: string; code: string }) => `Took the barcode ${p.code} off ${p.product}`,
  barcodeAddedFromBill: (p: { product: string; code: string; supplier: string }) => `Gave ${p.product} another barcode, ${p.code}, as on ${p.supplier}'s bill`,
  barcodeTakenBack: (p: { product: string; code: string }) => `Took the barcode ${p.code} off ${p.product} (scanned bill reopened)`,
  barcodeSet: (p: { product: string; to: string }) => `Set the barcode of ${p.product} to ${p.to}`,
  photoChanged: (p: { product: string }) => `Changed the photo of ${p.product}`,
  photoRemoved: (p: { product: string }) => `Removed the photo of ${p.product}`,
  productAdded: (p: { name: string }) => `Added product ${p.name}`,
  productDeleted: (p: { name: string }) => `Deleted product ${p.name}`,
  productsMerged: (p: { kept: string; merged: string }) => `Merged ${p.merged} into ${p.kept}`,
  duplicateKeptApart: (p: { name: string; other: string }) => `Kept ${p.name} and ${p.other} as two products`,
  productPriceChanged: (p: { name: string; from: number; to: number; also: ProductField[] }, w: Words) =>
    `Changed price of ${p.name} from ${w.money(p.from)} to ${w.money(p.to)}${enAlso(p.also)}`,
  productShown: (p: { name: string; also: ProductField[] }) => `Showed ${p.name} in the app${enAlso(p.also)}`,
  productHidden: (p: { name: string; also: ProductField[] }) => `Hid ${p.name} from the app${enAlso(p.also)}`,
  productRenamed: (p: { from: string; to: string; also: ProductField[] }) => `Renamed ${p.from} to ${p.to}${enAlso(p.also)}`,
  productEdited: (p: { name: string; fields: ProductField[] }) => `Edited ${p.name}: ${p.fields.map((field) => EN_PRODUCT_FIELD[field]).join(', ')}`,

  promotionStarted: (p: { name: string; percent: number; product: string | null; products: number }) =>
    `Started promotion "${p.name}": ${p.percent}% off ${p.product ?? `${p.products} products`}`,
  promotionCancelled: (p: { name: string }) => `Cancelled promotion "${p.name}"`,
  promotionEnded: (p: { name: string }) => `Ended promotion "${p.name}" early`,

  supplierAdded: (p: { name: string }) => `Added the supplier ${p.name}`,
  supplierChanged: (p: { name: string }) => `Changed the supplier ${p.name}'s details`,
  supplierRemoved: (p: { name: string }) => `Removed the supplier ${p.name}`,
  ordered: (p: { products: number; supplier: string }) => `Ordered ${p.products} ${p.products === 1 ? 'product' : 'products'} from ${p.supplier}`,
  orderCancelled: (p: { orderId: number; supplier: string }) => `Cancelled order #${p.orderId} from ${p.supplier}`,
  costChanged: (p: { product: string; from: number | null; to: number | null; because: CostReason }, w: Words) =>
    `Changed cost of ${p.product} from ${p.from === null ? 'none' : w.money(p.from)} to ${p.to === null ? 'none' : w.money(p.to)} (${
      'order' in p.because ? `order #${p.because.order} from ${p.because.supplier}` : 'scan' in p.because ? `scanned bill from ${p.because.scan}` : 'bill' in p.because ? `bill from ${p.because.bill}` : 'scanned bill reopened'
    })`,
  orderReceived: (p: { orderId: number; supplier: string; units: number }) =>
    `Received order #${p.orderId} from ${p.supplier}: ${p.units} ${p.units === 1 ? 'unit' : 'units'} into stock`,

  returned: (p: Units & { saleId: number; refund: number }, w: Words) =>
    `Returned ${p.quantity} × ${p.product} from sale #${p.saleId}, refund ${w.money(p.refund)}`,
  returnApproved: (p: Units & { refund: number }, w: Words) => `Approved the return of ${p.quantity} × ${p.product}, refund ${w.money(p.refund)}`,
  returnRejected: (p: Units & { note: string }) => `Rejected the return of ${p.quantity} × ${p.product}: ${p.note}`,

  sold: (p: Units & { total: number; discount: number | null; customer: string | null; onTab: boolean }, w: Words) =>
    `Sold ${p.quantity} × ${p.product} for ${w.money(p.total)}${p.discount ? ` with ${p.discount}% rabat` : ''}${p.customer ? (p.onTab ? ` on ${p.customer}'s tab` : ` to ${p.customer}`) : ''}`,

  rolesChanged: (p: { changes: RoleChange[]; pages: number }) =>
    `Changed what roles may do: ${[
      ...p.changes.map((change) => `${EN_ROLE[change.role]} ${change.on ? 'may now' : 'may no longer'} ${EN_POWER[change.power]}`),
      ...(p.pages > 0 ? [`${p.pages} menu ${p.pages === 1 ? 'page' : 'pages'}`] : []),
    ].join('; ')}`,
  settingsChanged: (p: { changes: SettingChange[] }, w: Words) => `Changed ${p.changes.map((change) => enSetting(change, w)).join(' and ')}`,

  countStarted: (p: { scope: string | null }) => `Started a stock count of ${p.scope ?? 'the whole shop'}`,
  countSubmitted: (p: { scope: string | null; counted: number; different: number }) =>
    `Submitted the stock count of ${p.scope ?? 'the whole shop'}: ${p.counted} counted, ${p.different} different`,
  countCancelled: (p: { scope: string | null }) => `Cancelled the stock count of ${p.scope ?? 'the whole shop'}`,
  countCorrected: (p: { product: string; difference: number; scope: string | null }) =>
    `Corrected ${p.product} by ${p.difference > 0 ? '+' : ''}${p.difference} after the count of ${p.scope ?? 'the whole shop'}`,
  countKept: (p: { product: string; scope: string | null; note: string }) =>
    `Kept the stock of ${p.product} unchanged after the count of ${p.scope ?? 'the whole shop'}: ${p.note}`,

  billEdited: (p: Bill, w: Words) => `Edited ${enBill(p, w)}`,
  billPaid: (p: Bill & { paid: number; left: number; from?: Place }, w: Words) =>
    `Paid ${w.money(p.paid)} on ${enBill(p, w)}${p.from ? ` from ${enPlace(p.from)}` : ''}${p.left === 0 ? ' (paid in full)' : `, ${w.money(p.left)} left`}`,
  billPaymentRemoved: (p: Bill & { payment: number }, w: Words) => `Removed a ${w.money(p.payment)} payment from ${enBill(p, w)}`,
  billVoided: (p: Bill & { note: string }, w: Words) => `Voided ${enBill(p, w)}: ${p.note}`,
  billPhotoAdded: (p: Bill, w: Words) => `Added a photo to ${enBill(p, w)}`,
  billPhotoRemoved: (p: Bill, w: Words) => `Removed the photo from ${enBill(p, w)}`,
  billAdded: (p: Bill & { dueOn: string | null; paidNow?: boolean }, w: Words) =>
    p.supplier === null
      ? `Added a ${w.money(p.amount)} expense, paid on the spot`
      : `Added a ${w.money(p.amount)} bill from ${p.supplier}${p.number ? ` (no. ${p.number})` : ''}${p.paidNow ? ', paid on the spot' : p.dueOn ? `, due ${w.day(p.dueOn)}` : ''}`,
  billCredited: (p: Bill & { credit: number; returned: boolean }, w: Words) =>
    `Recorded ${p.returned ? 'a return' : 'a credit'} of ${w.money(p.credit)} against ${enBill(p, w)}`,
  priceChanged: (p: { product: string; from: number; to: number; because: { bill: string } }, w: Words) =>
    `Changed the price of ${p.product} from ${w.money(p.from)} to ${w.money(p.to)} (bill from ${p.because.bill})`,

  tabOpened: (p: { name: string }) => `Opened a tab for ${p.name}`,
  customerChanged: (p: { name: string }) => `Changed ${p.name}'s details`,
  tabClosed: (p: { name: string }) => `Closed ${p.name}'s tab`,
  tabPaid: (p: { name: string; amount: number; place?: Place }, w: Words) =>
    `${p.name} paid ${w.money(p.amount)} off their tab${p.place && !(p.place.kind === 'till' && p.place.name === null) ? ` into ${enPlace(p.place)}` : ''}`,

  placeAdded: (p: { place: Place }) => `Added ${enPlace(p.place)} as a place money is kept`,
  placeChanged: (p: { place: Place }) => `Changed the details of ${enPlace(p.place)}`,
  placeClosed: (p: { place: Place }) => `Closed ${enPlace(p.place)}`,
  moneyMoved: (p: Move, w: Words) => enMove(p, w),
  moveRemoved: (p: Move, w: Words) => `Removed: ${enMove(p, w)}`,
  billsPaidTogether: (p: { supplier: string | null; amount: number; bills: number; from: Place }, w: Words) =>
    `Paid ${w.money(p.amount)} over ${p.bills} ${p.bills === 1 ? 'bill' : 'bills'}${p.supplier ? ` from ${p.supplier}` : ''}, from ${enPlace(p.from)}`,
  statementUploaded: (p: { place: Place; lines: number; skipped: number }) =>
    `Uploaded a statement for ${enPlace(p.place)}: ${p.lines} ${p.lines === 1 ? 'line' : 'lines'}${p.skipped > 0 ? ` (${p.skipped} already in)` : ''}`,
  bankLineConfirmed: (p: { place: Place; amount: number; text: string; lines?: number }, w: Words) =>
    p.lines && p.lines > 1 ? `Matched ${p.lines} lines of the ${enPlace(p.place)} statement` : `Matched the ${w.money(p.amount)} line "${p.text}" of the ${enPlace(p.place)} statement`,
  bankLineUndone: (p: { place: Place; amount: number; text: string }, w: Words) => `Took back the match of the ${w.money(p.amount)} line "${p.text}" of the ${enPlace(p.place)} statement`,
  bankLineSkipped: (p: { place: Place; amount: number; text: string }, w: Words) => `Left out the ${w.money(p.amount)} line "${p.text}" of the ${enPlace(p.place)} statement`,
  bankRuleSaved: (p: { contains: string }) => `Saved a rule for bank lines with "${p.contains}"`,
  bankRuleRemoved: (p: { contains: string }) => `Removed the rule for bank lines with "${p.contains}"`,

  userAdded: (p: { name: string; role: Role }) => `Added ${p.name} as ${EN_ROLE[p.role]}`,
  userChanged: (p: { name: string; changes: UserChange[] }, w: Words) => {
    const parts = p.changes.map((change) => enUserChange(p.name, change, w));
    const sentence = parts.length > 0 ? parts.join('; ') : `saved ${p.name} with no changes`;
    return sentence.charAt(0).toUpperCase() + sentence.slice(1);
  },
  userRemoved: (p: { name: string }) => `Removed ${p.name}`,

  writeOffReported: (p: Units & { reason: WriteOffReason }) => `Reported ${p.quantity} × ${p.product} (${EN_REASON[p.reason] ?? p.reason})`,
  writeOffApproved: (p: Units & { reason: WriteOffReason }) =>
    `Approved the write-off of ${p.quantity} × ${p.product} (${EN_REASON[p.reason] ?? p.reason})`,
  writeOffRejected: (p: Units & { reason: WriteOffReason; note: string }) =>
    `Rejected the write-off of ${p.quantity} × ${p.product} (${EN_REASON[p.reason] ?? p.reason}): ${p.note}`,

  /** Undid or restored another entry: its own sentence, in the same language. */
  undid: (p: { entry: unknown }, _w: Words, language: Language) => `Undid: ${said(p.entry as Said, language)}`,
  restored: (p: { entry: unknown }, _w: Words, language: Language) => `Restored: ${said(p.entry as Said, language)}`,
};

type Bill = { amount: number; supplier: string | null; number: string | null };
/** What a question is about, for a sentence: "the bill Fresh Foods 123". */
export type QuestionOn = { kind: 'bill' | 'document' | 'entry'; label: string };

const EN_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const EN_ON: Record<QuestionOn['kind'], string> = { bill: 'the bill', document: 'invoice', entry: 'entry' };
const SQ_MONTHS = ['janar', 'shkurt', 'mars', 'prill', 'maj', 'qershor', 'korrik', 'gusht', 'shtator', 'tetor', 'nëntor', 'dhjetor'];
const SQ_ON: Record<QuestionOn['kind'], string> = { bill: 'faturën', document: 'faturën e shitjes', entry: 'regjistrimin' };

const EN_ROLE: Record<Role, string> = { developer: 'developer', admin: 'admin', owner: 'owner', employee: 'employee', family: 'family', accountant: 'accountant' };
const EN_POWER: Record<RolePower, string> = {
  sell: 'sell',
  oversee: 'see costs, reports and activity and decide requests',
  products: 'add and edit products',
  manage: 'change stock, people and settings',
  books: 'read the books, VAT, bills and reports',
  filing: 'file VAT',
  reopen: 'reopen a filed month',
  entries: 'write entries in the books',
  customers: 'see customers',
  documents: 'open invoices',
};
const EN_REASON: Record<string, string> = { damaged: 'damaged', lost: 'lost', expired: 'expired', theft: 'stolen', other: 'other' };
const EN_EXPENSE: Record<string, string> = {
  rent: 'rent',
  electricity: 'electricity',
  water: 'water',
  wages: 'wages',
  supplies: 'supplies',
  repairs: 'repairs',
  taxes: 'taxes',
  other: 'other',
  internet: 'internet and phone',
  fuel: 'fuel',
  transport: 'transport',
  cleaning: 'cleaning',
  advertising: 'advertising',
  bank_fees: 'bank fees',
  professional: 'accountant and lawyer',
  insurance: 'insurance',
  office: 'office',
  shop: 'shop',
};
const EN_PRODUCT_FIELD: Record<ProductField, string> = {
  name: 'name',
  description: 'description',
  categoryId: 'category',
  price: 'price',
  costPrice: 'cost price',
  imageUrl: 'image',
  sku: 'SKU',
  isActive: 'visibility',
  vatRate: 'VAT rate',
  vatExempt: 'VAT exemption',
  originCountry: 'country',
  bulkPricingTiers: 'bulk prices',
};
const enAlso = (also: ProductField[]) => (also.length > 0 ? ` (also changed ${also.map((field) => EN_PRODUCT_FIELD[field]).join(', ')})` : '');
const enPlace = (place: Place) =>
  place.kind === 'till' ? (place.name ? `the ${place.name} till` : "the shop's till") : place.kind === 'safe' ? (place.name ?? 'the safe') : (place.name ?? 'the bank');
const enMove = (p: Move, w: Words) =>
  p.from === null
    ? `Put ${w.money(p.amount)} of the owner's money into ${enPlace(p.to!)}`
    : p.to === null
      ? `Took ${w.money(p.amount)} out of ${enPlace(p.from)} for the owner`
      : `Moved ${w.money(p.amount)} from ${enPlace(p.from)} to ${enPlace(p.to)}`;
const enBill = (p: Bill, w: Words) =>
  p.supplier === null ? `the ${w.money(p.amount)} expense` : `the ${w.money(p.amount)} bill from ${p.supplier}${p.number ? ` (no. ${p.number})` : ''}`;

function enSetting({ name, from, to }: SettingChange, w: Words): string {
  switch (name) {
    case 'refundApprovalLimit':
      return `the refund approval limit from ${w.money(from)} to ${w.money(to)}`;
    case 'returnWindowDays':
      return `the return window from ${from} to ${to} days`;
    case 'minimumMarginPercent':
      return `the minimum margin from ${from}% to ${to}%`;
    case 'cashFloatShop':
      return `the shop's cash float from ${w.money(from)} to ${w.money(to)}`;
    case 'paymentTermsDays':
      return `the payment terms from ${from} to ${to} days`;
    case 'employeeDiscountLimit':
      return `the most rabat employees can give from ${from}% to ${to}%`;
  }
}

function enUserChange(name: string, change: UserChange, w: Words): string {
  switch (change.kind) {
    case 'renamed':
      return `renamed ${name} to ${change.to}`;
    case 'role':
      return `changed ${name}'s role from ${EN_ROLE[change.from]} to ${EN_ROLE[change.to]}`;
    case 'blocked':
      return `blocked ${name}`;
    case 'allowed':
      return `let ${name} back in`;
    case 'password':
      return `set a new password for ${name}`;
    case 'targetRemoved':
      return `removed ${name}'s monthly target`;
    case 'target':
      return `set ${name}'s monthly target to ${w.money(change.to)}`;
    case 'commissionRemoved':
      return `removed ${name}'s commission`;
    case 'commission':
      return `set ${name}'s commission to ${change.to}%`;
  }
}

type Templates = typeof en;
type Key = keyof Templates;

/** What an entry says, stored as a key and its values. */
export type Say = { [K in Key]: Parameters<Templates[K]>[0] extends undefined ? { key: K; params?: undefined } : { key: K; params: Parameters<Templates[K]>[0] } }[Key];

/** A stored Say, or an old entry's English sentence when it has none. */
export type Said = Say | { text: string };

const SQ_ROLE: Record<Role, string> = { developer: 'zhvillues', admin: 'administrator', owner: 'pronar', employee: 'punonjës', family: 'anëtar i familjes', accountant: 'kontabilist' };
const SQ_POWER: Record<RolePower, string> = {
  sell: 'shesë',
  oversee: 'shohë kostot, raportet dhe aktivitetin dhe vendosë për kërkesat',
  products: 'shtojë dhe ndryshojë produktet',
  manage: 'ndryshojë stokun, njerëzit dhe cilësimet',
  books: 'lexojë librat, TVSH-në, faturat dhe raportet',
  filing: 'deklarojë TVSH-në',
  reopen: 'rihapë një muaj të deklaruar',
  entries: 'shkruajë regjistrime në libra',
  customers: 'shohë klientët',
  documents: 'hapë faturat',
};
const SQ_REASON: Record<string, string> = { damaged: 'i dëmtuar', lost: 'i humbur', expired: 'i skaduar', theft: 'i vjedhur', other: 'tjetër' };
const SQ_EXPENSE: Record<string, string> = {
  rent: 'qiraja',
  electricity: 'rryma',
  water: 'uji',
  wages: 'pagat',
  supplies: 'furnizime',
  repairs: 'riparime',
  taxes: 'taksa dhe tarifa',
  other: 'të tjera',
  internet: 'interneti dhe telefoni',
  fuel: 'karburanti',
  transport: 'transporti',
  cleaning: 'pastrimi',
  advertising: 'reklamat',
  bank_fees: 'tarifat bankare',
  professional: 'kontabilisti dhe avokati',
  insurance: 'sigurimi',
  office: 'zyra',
  shop: 'dyqani',
};
const SQ_STOCK_REASON: Record<string, string> = {
  Restock: 'rimbushje',
  'Manual adjustment': 'ndryshim me dorë',
  'Initial stock': 'stoku fillestar',
  Sale: 'shitje',
  Return: 'kthim',
  'Write-off': 'dëmtim ose humbje',
  Recount: 'rinumërim',
  Undo: 'zhbërje',
  Restore: 'rikthim',
  Delivery: 'furnizim',
  'Returned to supplier': 'kthim te furnitori',
};
const SQ_PRODUCT_FIELD: Record<ProductField, string> = {
  name: 'emri',
  description: 'përshkrimi',
  categoryId: 'kategoria',
  price: 'çmimi',
  costPrice: 'çmimi i kostos',
  imageUrl: 'fotoja',
  sku: 'SKU',
  isActive: 'dukshmëria',
  vatRate: 'TVSH-ja',
  vatExempt: 'lirimi nga TVSH-ja',
  originCountry: 'vendi',
  bulkPricingTiers: 'çmimet me shumicë',
};
const SQ_SHOP_FIELD: Record<ShopField, string> = {
  name: 'emrin',
  address: 'adresën',
  phone: 'telefonin',
  nui: 'NUI-në',
  timeZone: 'zonën kohore',
  bankName: 'bankën',
  iban: 'IBAN-in',
  invoiceNote: 'shënimin e faturës',
};
const sqAlso = (also: ProductField[]) => (also.length > 0 ? ` (ndryshoi edhe ${also.map((field) => SQ_PRODUCT_FIELD[field]).join(', ')})` : '');
/** A place in the case the sentence needs: "arka e dyqanit", "arkën e dyqanit", "arkës së dyqanit". */
const SQ_PLACE = {
  nom: ['arka', 'e', 'kasaforta', 'banka'],
  acc: ['arkën', 'e', 'kasafortën', 'bankën'],
  gen: ['arkës', 'së', 'kasafortës', 'bankës'],
} as const;
const sqPlace = (place: Place, form: keyof typeof SQ_PLACE = 'nom') => {
  const [till, of, safe, bank] = SQ_PLACE[form];
  return place.kind === 'till' ? `${till} ${of} ${place.name ?? 'dyqanit'}` : (place.name ?? (place.kind === 'safe' ? safe : bank));
};
const sqMove = (p: Move, w: Words) =>
  p.from === null
    ? `Futi ${w.money(p.amount)} të pronarit në ${sqPlace(p.to!, 'acc')}`
    : p.to === null
      ? `Nxori ${w.money(p.amount)} nga ${sqPlace(p.from)} për pronarin`
      : `Kaloi ${w.money(p.amount)} nga ${sqPlace(p.from)} te ${sqPlace(p.to)}`;
const sqBill = (p: Bill, w: Words) =>
  p.supplier === null ? `shpenzimin prej ${w.money(p.amount)}` : `faturën prej ${w.money(p.amount)} nga ${p.supplier}${p.number ? ` (nr. ${p.number})` : ''}`;
const sqScope = (scope: string | null) => scope ?? 'gjithë dyqanit';
const sqCarwash = (carwash: string | null) => (carwash ? `lavazhit ${carwash}` : 'lavazhit');

function sqSetting({ name, from, to }: SettingChange, w: Words): string {
  switch (name) {
    case 'refundApprovalLimit':
      return `kufirin e miratimit të rimbursimit nga ${w.money(from)} në ${w.money(to)}`;
    case 'returnWindowDays':
      return `afatin e kthimit nga ${from} në ${to} ditë`;
    case 'minimumMarginPercent':
      return `marzhin minimal nga ${from}% në ${to}%`;
    case 'cashFloatShop':
      return `kusurin e arkës së dyqanit nga ${w.money(from)} në ${w.money(to)}`;
    case 'paymentTermsDays':
      return `afatin e pagesës nga ${from} në ${to} ditë`;
    case 'employeeDiscountLimit':
      return `rabatin më të madh që japin punonjësit nga ${from}% në ${to}%`;
  }
}

function sqUserChange(name: string, change: UserChange, w: Words): string {
  switch (change.kind) {
    case 'renamed':
      return `ndryshoi emrin e ${name} në ${change.to}`;
    case 'role':
      return `ndryshoi rolin e ${name} nga ${SQ_ROLE[change.from]} në ${SQ_ROLE[change.to]}`;
    case 'blocked':
      return `bllokoi ${name}`;
    case 'allowed':
      return `e lejoi sërish ${name}`;
    case 'password':
      return `vendosi një fjalëkalim të ri për ${name}`;
    case 'targetRemoved':
      return `hoqi objektivin mujor të ${name}`;
    case 'target':
      return `vendosi objektivin mujor të ${name} në ${w.money(change.to)}`;
    case 'commissionRemoved':
      return `hoqi komisionin e ${name}`;
    case 'commission':
      return `vendosi komisionin e ${name} në ${change.to}%`;
  }
}

const sq: Templates = {
  loggedIn: (p) =>
    `${p.name} ${{ password: 'hyri', google: 'hyri me Google', googleFirst: 'hyri me Google për herë të parë', invite: 'hyri për herë të parë' }[p.how]}`,

  billScanned: (p) => `Skanoi një faturë${p.supplier ? ` nga ${p.supplier}` : ''} (${p.lines} ${p.lines === 1 ? 'rresht' : 'rreshta'})`,
  billScanConfirmed: (p) =>
    `Konfirmoi faturën e skanuar nga ${p.supplier}: ${p.pieces} copë në stok me porosinë #${p.orderId}${p.newProducts > 0 ? `, ${p.newProducts} produkte të reja` : ''}`,
  billScanDiscarded: (p) => `Hodhi poshtë një faturë të skanuar${p.supplier ? ` nga ${p.supplier}` : ''}`,
  orderFromScan: (p) => `Krijoi porosinë #${p.orderId} nga një faturë e skanuar`,
  barcodePutBack: (p) => `Ktheu barkodin e ${p.product}${p.to ? ` në ${p.to}` : ''} (fatura e skanuar u rihap)`,
  billScanReopened: (p) =>
    `Rihapi faturën e skanuar${p.supplier ? ` nga ${p.supplier}` : ''}${p.undone ? ': stoku, fatura dhe porosia u kthyen' : ''}`,
  productFromBill: (p) => `Shtoi produktin ${p.product} nga fatura e ${p.supplier}`,
  barcodeFromBill: (p) => `Ndryshoi barkodin e ${p.product}${p.from ? ` nga ${p.from}` : ''} në ${p.to}, si në faturën e ${p.supplier}`,

  shopChanged: (p, w) => `Ndryshoi ${w.list(p.fields.map((field) => SQ_SHOP_FIELD[field] ?? field))} e dyqanit`,

  carwashAdded: (p, w) => `Shtoi lavazhin ${p.name} (kusuri i arkës ${w.money(p.float)})`,
  carwashArchived: (p) =>
    `Arkivoi lavazhin ${p.name}${p.stoppedExpenses > 0 ? `; ${p.stoppedExpenses === 1 ? 'shpenzimi i tij mujor nuk përsëritet' : `${p.stoppedExpenses} shpenzimet e tij mujore nuk përsëriten`} më` : ''}`,
  carwashRestored: (p) => `Riktheu lavazhin ${p.name}`,
  carwashChanged: (p, w) =>
    [
      p.renamedTo ? `Ndryshoi emrin e lavazhit ${p.name} në ${p.renamedTo}` : `Ndryshoi lavazhin ${p.name}`,
      p.float ? `kusuri i arkës nga ${w.money(p.float.from)} në ${w.money(p.float.to)}` : null,
    ]
      .filter(Boolean)
      .join(': '),
  takingsSaved: (p, w) =>
    `${p.changed ? 'Ndryshoi' : 'Futi'} të ardhurat e ${sqCarwash(p.carwash)} për ${w.day(p.day)}: ${w.money(p.carwashAmount)} lavazh + ${w.money(p.change)} këmbim`,
  takingsRemoved: (p, w) => `Hoqi të ardhurat e ${sqCarwash(p.carwash)} për ${w.day(p.day)}`,

  cashDifferenceChecked: () => 'Kontrolloi një diferencë në arkë',
  cashCounted: (p, w) => `Numëroi ${w.money(p.counted)} në arkën e ${p.drawer ? `lavazhit ${p.drawer}` : 'dyqanit'} (kusuri ${w.money(p.float)})`,

  categoryAdded: (p) => `Shtoi kategorinë ${p.name}`,
  categoryEdited: (p) => `Ndryshoi kategorinë ${p.name}`,
  categoryRenamed: (p) => `Ndryshoi emrin e kategorisë ${p.from} në ${p.to}`,
  categoryDeleted: (p) => `Fshiu kategorinë ${p.name}`,

  noExpenses: (p, w) => `Shënoi se më ${w.day(p.day)} s'pati shpenzime`,
  noExpensesTakenBack: (p, w) => `Hoqi shënimin "s'pati shpenzime" për ${w.day(p.day)}`,

  documentIssued: (p, w) => `Lëshoi ${p.kind === 'invoice' ? 'faturën' : 'notën e kreditit'} ${p.number} për ${w.money(p.total)}`,
  fiscalReceiptLinked: (p) => `Lidhi ${p.number} me kuponin fiskal ${p.receipt}`,
  counterSettingsChanged: () => 'Ndryshoi parametrat e arkës (printeri fiskal, teksti në kupon, sirtari)',
  printerReport: (p) => (p.kind === 'z' ? 'Nxori raportin Z të printerit fiskal (mbyll ditën fiskale)' : 'Nxori raportin X të printerit fiskal'),
  drawerOpened: (p) => `Hapi sirtarin pa shitje: ${p.reason}`,
  fiscalReceiptRemoved: (p) => `Hoqi kuponin fiskal nga ${p.number}`,

  expenseAdded: (p, w) =>
    `Shtoi një shpenzim: ${w.money(p.amount)} për ${SQ_EXPENSE[p.category] ?? p.category} (${'carwash' in p.at ? `lavazhi ${p.at.carwash}` : (SQ_EXPENSE[p.at.place] ?? p.at.place)}) më ${w.day(p.day)}${p.monthly ? ', përsëritet çdo muaj' : ''}`,
  expenseRemoved: (p, w) => `Hoqi shpenzimin prej ${w.money(p.amount)} për ${SQ_EXPENSE[p.category] ?? p.category} të ${w.day(p.day)}`,
  expenseStopped: (p) => `Ndali shpenzimin mujor për ${SQ_EXPENSE[p.category] ?? p.category}`,
  bookEntryAdded: (p, w) => `Shkroi regjistrimin #${p.id} në libra (${w.money(p.amount)}): ${p.description}`,
  bookEntryReversed: (p) => `Anuloi regjistrimin #${p.id} në libra`,
  openingPosted: (p, w) => `Regjistroi gjendjet fillestare më ${w.day(p.day)} (regjistrimi #${p.id}, ${w.money(p.amount)})`,
  openingTakenBack: (p) => `Anuloi gjendjet fillestare (regjistrimi #${p.id}): ${p.reason}`,
  openingTrefinLoaded: (p) => `Solli gjendjet fillestare nga TREFIN: ${p.lines} rreshta, ${p.bills} fatura të hapura të furnitorëve, ${p.charges} borxhe të klientëve`,

  vatFiled: (p, w) =>
    `Dorëzoi deklaratën e TVSH-së për ${SQ_MONTHS[Number(p.month.slice(5, 7)) - 1]} ${p.month.slice(0, 4)}: ${
      p.outcome === 'pay' ? `${w.money(p.amount)} për t'u paguar` : p.outcome === 'carry' ? `${w.money(p.amount)} bartet në muajin tjetër` : "asgjë për t'u paguar"
    }`,
  vatReopened: (p) => `Rihapi muajin e TVSH-së ${SQ_MONTHS[Number(p.month.slice(5, 7)) - 1]} ${p.month.slice(0, 4)}: ${p.reason}`,
  yearClosed: (p, w) =>
    `Mbylli vitin ${p.year} në libra: ${p.profit >= 0 ? 'fitimi' : 'humbja'} prej ${w.money(Math.abs(p.profit))} pas tatimit në fitim prej ${w.money(p.tax)} kaloi te fitimet e mbajtura`,
  yearReopened: (p) => `Rihapi vitin ${p.year} në libra: ${p.reason}`,
  tmPaid: (p, w) => `Pagoi këstin e tatimit në fitim për TM${p.quarter} ${p.year}: ${w.money(p.amount)} më ${w.day(p.day)}`,
  tmUndone: (p, w) => `Anuloi këstin e tatimit në fitim prej ${w.money(p.amount)} për TM${p.quarter} ${p.year}`,
  questionAsked: (p) => `Pyeti për ${SQ_ON[p.on.kind]} ${p.on.label}: “${p.text}”`,
  questionAnswered: (p) => `U përgjigj te ${SQ_ON[p.on.kind]} ${p.on.label}: “${p.text}”`,
  bookAccountAdded: (p) => `Shtoi llogarinë ${p.number} ${p.name} në libra`,
  bookAccountChanged: (p) => `Ndryshoi llogarinë ${p.number} ${p.name} në libra`,
  bookLinksChanged: () => 'Ndryshoi se në cilat llogari regjistrohen veprimet',
  booksStartChanged: (p, w) => `Caktoi fillimin e librave më ${w.day(p.to)}${p.from ? ` (ishte ${w.day(p.from)})` : ''}`,

  expiryNoted: (p, w) => `Shënoi ${p.quantity} × ${p.product} që skadojnë më ${w.day(p.day)}`,
  expiryCleared: (p, w) => `U mor me ${p.quantity} × ${p.product} që skadojnë më ${w.day(p.day)}`,

  reorderLevelChanged: (p) => `Ndryshoi nivelin e porosisë së ${p.product} nga ${p.from} në ${p.to}`,
  stockAdded: (p) => `Shtoi ${p.amount} te ${p.product} (${SQ_STOCK_REASON[p.reason] ?? p.reason})`,
  stockRemoved: (p) => `Hoqi ${p.amount} nga ${p.product} (${SQ_STOCK_REASON[p.reason] ?? p.reason})`,

  invited: (p) => `Ftoi ${p.email} si ${SQ_ROLE[p.role]}`,
  joined: (p) => `${p.name} u bashkua si ${SQ_ROLE[p.role]}`,

  bulkPricesUpdated: (p) => `Përditësoi çmimet me shumicë për ${p.product}`,

  productRequested: (p, w) => `Kërkoi të shtohet ${p.name} me ${w.money(p.price)}`,
  productRequestApproved: (p) => `Miratoi shtimin e ${p.name}${p.by ? `, kërkuar nga ${p.by}` : ''}`,
  productRequestRejected: (p) => `Nuk e shtoi ${p.name}: ${p.note}`,

  barcodeRemoved: (p) => `Hoqi barkodin e ${p.product}`,
  barcodeAdded: (p) => `I dha ${p.product} edhe një barkod, ${p.code}`,
  otherBarcodeRemoved: (p) => `Hoqi barkodin ${p.code} nga ${p.product}`,
  barcodeAddedFromBill: (p) => `I dha ${p.product} edhe një barkod, ${p.code}, si në faturën e ${p.supplier}`,
  barcodeTakenBack: (p) => `Hoqi barkodin ${p.code} nga ${p.product} (fatura e skanuar u rihap)`,
  barcodeSet: (p) => `Vendosi barkodin e ${p.product} në ${p.to}`,
  photoChanged: (p) => `Ndryshoi foton e ${p.product}`,
  photoRemoved: (p) => `Hoqi foton e ${p.product}`,
  productAdded: (p) => `Shtoi produktin ${p.name}`,
  productDeleted: (p) => `Fshiu produktin ${p.name}`,
  productsMerged: (p) => `Bashkoi ${p.merged} me ${p.kept}`,
  duplicateKeptApart: (p) => `I la ${p.name} dhe ${p.other} si dy produkte`,
  productPriceChanged: (p, w) => `Ndryshoi çmimin e ${p.name} nga ${w.money(p.from)} në ${w.money(p.to)}${sqAlso(p.also)}`,
  productShown: (p) => `Shfaqi ${p.name} në aplikacion${sqAlso(p.also)}`,
  productHidden: (p) => `Fshehu ${p.name} nga aplikacioni${sqAlso(p.also)}`,
  productRenamed: (p) => `Ndryshoi emrin e ${p.from} në ${p.to}${sqAlso(p.also)}`,
  productEdited: (p) => `Ndryshoi ${p.name}: ${p.fields.map((field) => SQ_PRODUCT_FIELD[field]).join(', ')}`,

  promotionStarted: (p) => `Nisi ofertën "${p.name}": ${p.percent}% zbritje për ${p.product ?? `${p.products} produkte`}`,
  promotionCancelled: (p) => `Anuloi ofertën "${p.name}"`,
  promotionEnded: (p) => `Mbylli ofertën "${p.name}" para kohe`,

  supplierAdded: (p) => `Shtoi furnitorin ${p.name}`,
  supplierChanged: (p) => `Ndryshoi të dhënat e furnitorit ${p.name}`,
  supplierRemoved: (p) => `Hoqi furnitorin ${p.name}`,
  ordered: (p) => `Porositi ${p.products} ${p.products === 1 ? 'produkt' : 'produkte'} nga ${p.supplier}`,
  orderCancelled: (p) => `Anuloi porosinë #${p.orderId} nga ${p.supplier}`,
  costChanged: (p, w) =>
    `Ndryshoi koston e ${p.product} nga ${p.from === null ? 'asnjë' : w.money(p.from)} në ${p.to === null ? 'asnjë' : w.money(p.to)} (${
      'order' in p.because ? `porosia #${p.because.order} nga ${p.because.supplier}` : 'scan' in p.because ? `fatura e skanuar nga ${p.because.scan}` : 'bill' in p.because ? `fatura nga ${p.because.bill}` : 'fatura e skanuar u rihap'
    })`,
  orderReceived: (p) => `Mori porosinë #${p.orderId} nga ${p.supplier}: ${p.units} copë në stok`,

  returned: (p, w) => `Ktheu ${p.quantity} × ${p.product} nga shitja #${p.saleId}, rimbursim ${w.money(p.refund)}`,
  returnApproved: (p, w) => `Miratoi kthimin e ${p.quantity} × ${p.product}, rimbursim ${w.money(p.refund)}`,
  returnRejected: (p) => `Refuzoi kthimin e ${p.quantity} × ${p.product}: ${p.note}`,

  sold: (p, w) =>
    `Shiti ${p.quantity} × ${p.product} për ${w.money(p.total)}${p.discount ? ` me ${p.discount}% rabat` : ''}${p.customer ? (p.onTab ? ` në borxhin e ${p.customer}` : ` te ${p.customer}`) : ''}`,

  rolesChanged: (p) =>
    `Ndryshoi çfarë mund të bëjnë rolet: ${[
      ...p.changes.map((change) => `${SQ_ROLE[change.role]} ${change.on ? 'tani mund të' : 'nuk mund më të'} ${SQ_POWER[change.power]}`),
      ...(p.pages > 0 ? [`${p.pages} faqe të menysë`] : []),
    ].join('; ')}`,
  settingsChanged: (p, w) => `Ndryshoi ${p.changes.map((change) => sqSetting(change, w)).join(' dhe ')}`,

  countStarted: (p) => `Nisi numërimin e stokut të ${sqScope(p.scope)}`,
  countSubmitted: (p) => `Dorëzoi numërimin e stokut të ${sqScope(p.scope)}: ${p.counted} të numëruar, ${p.different} ndryshe`,
  countCancelled: (p) => `Anuloi numërimin e stokut të ${sqScope(p.scope)}`,
  countCorrected: (p) => `Korrigjoi ${p.product} me ${p.difference > 0 ? '+' : ''}${p.difference} pas numërimit të ${sqScope(p.scope)}`,
  countKept: (p) => `La stokun e ${p.product} pa ndryshuar pas numërimit të ${sqScope(p.scope)}: ${p.note}`,

  billEdited: (p, w) => `Ndryshoi ${sqBill(p, w)}`,
  billPaid: (p, w) => `Pagoi ${w.money(p.paid)} për ${sqBill(p, w)}${p.from ? ` nga ${sqPlace(p.from)}` : ''}${p.left === 0 ? ' (e paguar plotësisht)' : `, mbeten ${w.money(p.left)}`}`,
  billPaymentRemoved: (p, w) => `Hoqi një pagesë prej ${w.money(p.payment)} nga ${sqBill(p, w)}`,
  billVoided: (p, w) => `Anuloi ${sqBill(p, w)}: ${p.note}`,
  billPhotoAdded: (p, w) => `Shtoi një foto te ${sqBill(p, w)}`,
  billPhotoRemoved: (p, w) => `Hoqi foton nga ${sqBill(p, w)}`,
  billAdded: (p, w) =>
    p.supplier === null
      ? `Shtoi një shpenzim prej ${w.money(p.amount)}, të paguar në vend`
      : `Shtoi një faturë prej ${w.money(p.amount)} nga ${p.supplier}${p.number ? ` (nr. ${p.number})` : ''}${p.paidNow ? ', të paguar në vend' : p.dueOn ? `, afati ${w.day(p.dueOn)}` : ''}`,
  billCredited: (p, w) => `Regjistroi ${p.returned ? 'një kthim' : 'një kredi'} prej ${w.money(p.credit)} për ${sqBill(p, w)}`,
  priceChanged: (p, w) => `Ndryshoi çmimin e ${p.product} nga ${w.money(p.from)} në ${w.money(p.to)} (fatura nga ${p.because.bill})`,

  tabOpened: (p) => `Hapi një borxh për ${p.name}`,
  customerChanged: (p) => `Ndryshoi të dhënat e ${p.name}`,
  tabClosed: (p) => `Mbylli borxhin e ${p.name}`,
  tabPaid: (p, w) =>
    `${p.name} pagoi ${w.money(p.amount)} nga borxhi${p.place && !(p.place.kind === 'till' && p.place.name === null) ? ` në ${sqPlace(p.place, 'acc')}` : ''}`,

  placeAdded: (p) => `Shtoi ${sqPlace(p.place, 'acc')} si vend ku mbahen paratë`,
  placeChanged: (p) => `Ndryshoi të dhënat e ${sqPlace(p.place, 'gen')}`,
  placeClosed: (p) => `Mbylli ${sqPlace(p.place, 'acc')}`,
  moneyMoved: (p, w) => sqMove(p, w),
  moveRemoved: (p, w) => `Hoqi: ${sqMove(p, w)}`,
  billsPaidTogether: (p, w) =>
    `Pagoi ${w.money(p.amount)} për ${p.bills} ${p.bills === 1 ? 'faturë' : 'fatura'}${p.supplier ? ` të ${p.supplier}` : ''}, nga ${sqPlace(p.from)}`,
  statementUploaded: (p) => `Ngarkoi një ekstrakt për ${sqPlace(p.place, 'acc')}: ${p.lines} rreshta${p.skipped > 0 ? ` (${p.skipped} ishin brenda)` : ''}`,
  bankLineConfirmed: (p, w) =>
    p.lines && p.lines > 1 ? `Përputhi ${p.lines} rreshta të ekstraktit të ${sqPlace(p.place, 'gen')}` : `Përputhi rreshtin prej ${w.money(p.amount)} "${p.text}" të ekstraktit të ${sqPlace(p.place, 'gen')}`,
  bankLineUndone: (p, w) => `Anuloi përputhjen e rreshtit prej ${w.money(p.amount)} "${p.text}" të ekstraktit të ${sqPlace(p.place, 'gen')}`,
  bankLineSkipped: (p, w) => `La jashtë rreshtin prej ${w.money(p.amount)} "${p.text}" të ekstraktit të ${sqPlace(p.place, 'gen')}`,
  bankRuleSaved: (p) => `Ruajti një rregull për rreshtat e bankës me "${p.contains}"`,
  bankRuleRemoved: (p) => `Hoqi rregullin për rreshtat e bankës me "${p.contains}"`,

  userAdded: (p) => `Shtoi ${p.name} si ${SQ_ROLE[p.role]}`,
  userChanged: (p, w) => {
    const parts = p.changes.map((change) => sqUserChange(p.name, change, w));
    const sentence = parts.length > 0 ? parts.join('; ') : `ruajti ${p.name} pa ndryshime`;
    return sentence.charAt(0).toUpperCase() + sentence.slice(1);
  },
  userRemoved: (p) => `Hoqi ${p.name}`,

  writeOffReported: (p) => `Raportoi ${p.quantity} × ${p.product} (${SQ_REASON[p.reason] ?? p.reason})`,
  writeOffApproved: (p) => `Miratoi dëmtimin ose humbjen e ${p.quantity} × ${p.product} (${SQ_REASON[p.reason] ?? p.reason})`,
  writeOffRejected: (p) => `Refuzoi dëmtimin ose humbjen e ${p.quantity} × ${p.product} (${SQ_REASON[p.reason] ?? p.reason}): ${p.note}`,

  undid: (p, _w, language) => `Zhbëri: ${said(p.entry as Said, language)}`,
  restored: (p, _w, language) => `Riktheu: ${said(p.entry as Said, language)}`,
};

const TEMPLATES: Record<Language, Templates> = { en, sq };

function wordsFor(language: Language): Words {
  const locale = LOCALE[language] === 'en-IE' ? 'en-GB' : LOCALE[language];
  const days = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const lists = new Intl.ListFormat(locale, { type: 'conjunction' });
  return {
    money: (amount) => money(amount, language),
    day: (iso) => days.format(new Date(`${iso.slice(0, 10)}T12:00:00Z`)),
    list: (items) => lists.format(items),
  };
}

/** The sentence an entry says, in `language`. */
export function sayIn(say: Say, language: Language): string {
  const template = TEMPLATES[language][say.key] as (params: unknown, words: Words, language: Language) => string;
  return template(say.params, wordsFor(language), language);
}

/** A stored Say in `language`, or an old entry's English sentence as it was. */
export function said(entry: Said, language: Language): string {
  return 'text' in entry ? entry.text : sayIn(entry, language);
}

/** Whether a stored value is a Say this version knows (old or unknown keys fall back to the English summary). */
export function isSay(value: unknown): value is Say {
  return typeof value === 'object' && value !== null && typeof (value as { key?: unknown }).key === 'string' && (value as { key: string }).key in en;
}
