import type { QuestionOn } from './activityText.js';
import { type Language, money, wholeMoney } from './language.js';

/**
 * Everything the server writes for people to read: alerts, the "needs your
 * attention" list, the daily summary and emails. Albanian must have every
 * entry English has (the type makes a missing one a compile error).
 */

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export type ApprovalKind = 'return' | 'write-off' | 'stock count' | 'product' | 'bill';

/** What kind of entry was undone or restored (see services/undo). */
export type UndoneKind = 'sale' | 'return' | 'write_off' | 'count_line' | 'stock' | 'edit' | 'settings';

export interface ServerMessages {
  language: Language;
  roleName: Record<string, string>;
  writeOffReason: Record<string, string>;
  /** One line per request in the team app's "Your requests". */
  myRequest: {
    return: (p: { what: string; refund: number }) => string;
    writeOff: (p: { what: string; reason: string }) => string;
    count: (scope: string | null) => string;
    sale: (p: { what: string; total: number }) => string;
    product: (p: { name: string; price: number }) => string;
    bill: (p: { supplier: string | null; lines: number }) => string;
  };
  wholeShop: string;

  outOfStockTitle: (product: string) => string;
  outOfStockMessage: (product: string) => string;
  lowStockTitle: (product: string) => string;
  lowStockMessage: (p: { product: string; left: number; reorderLevel: number }) => string;

  pendingTitle: (kind: ApprovalKind) => string;
  returnPending: (p: { name: string; what: string; reasons: string[] }) => string;
  writeOffPending: (p: { name: string; what: string }) => string;
  productPending: (p: { name: string; product: string; price: string }) => string;
  billPending: (p: { name: string; supplier: string | null; lines: number }) => string;
  billEmailedPending: (p: { sender: string; supplier: string | null; lines: number }) => string;
  billEmailTitle: string;
  portalOrderTitle: string;
  portalOrderMessage: (p: { name: string; total: number; lines: number }) => string;
  importDoneTitle: string;
  importDoneMessage: (p: { products: number; changed: number; suppliers: number; customers: number }) => string;
  portalChangeAgreedTitle: string;
  portalChangeAgreedMessage: (p: { name: string; id: number }) => string;
  portalChangeCancelledTitle: string;
  portalChangeCancelledMessage: (p: { name: string; id: number }) => string;
  billEmailDuplicate: (p: { sender: string; file: string | null; day: string }) => string;
  billEmailNoFile: (p: { sender: string; subject: string | null }) => string;
  productApproved: (product: string) => string;
  productApprovedMessage: string;
  productRejected: (product: string) => string;
  countPending: (p: { name: string; scope: string; differences: number }) => string;
  reasonRefundOver: (amount: number) => string;
  reasonSoldDaysAgo: (days: number) => string;
  reasonDamaged: string;

  returnApproved: (what: string) => string;
  returnApprovedMessage: string;
  returnRejected: (what: string) => string;
  writeOffApproved: (what: string) => string;
  writeOffApprovedMessage: string;
  writeOffRejected: (what: string) => string;
  countReviewed: (scope: string) => string;
  countReviewedMessage: string;
  undoneTitle: (kind: UndoneKind, what: string) => string;
  undoneMessage: (note: string | null) => string;
  restoredTitle: (kind: UndoneKind, what: string) => string;
  restoredMessage: string;
  /** What a settings change is about, in titles. */
  settingsWhat: string;

  dailyTitle: (revenue: number) => string;
  dailySales: (p: { sales: number; profit: number; lastWeek: number }) => string;
  dailyUrgent: (p: { titles: string[]; more: number }) => string;
  dailyOthers: (n: number) => string;
  dailyNothing: string;
  dayClosedTitle: string;
  /** `name` is set only when the business has several carwashes. */
  dailyCarwash: (p: { name: string | null; carwash: number; change: number; total: number }) => string;
  dailyCarwashMissing: (name: string | null) => string;
  /** `difference` is 0 when it matched; `compared` false when the carwash had no takings to compare with. */
  dailyCash: (p: { place: 'shop' | 'carwash'; carwash: string | null; difference: number; compared: boolean }) => string;
  dailyCashMissing: (place: 'shop' | 'carwash', carwash: string | null) => string;
  cashDifferenceTitle: (p: { place: 'shop' | 'carwash'; carwash: string | null; difference: number }) => string;
  cashDifferenceMessage: (p: { name: string; counted: number; float: number; expected: number }) => string;

  /** The To do list (DESIGN.md 3.3): one line that names the thing, one on what to do. */
  todo: {
    requestsTitle: (count: number) => string;
    requestsDetail: string;
    billScanTitle: (supplier: string | null) => string;
    billScanDetail: (input: { name: string | null; number: string | null; emailFrom?: string | null }) => string;
    billEmailWaitingTitle: (sender: string) => string;
    portalOrderTitle: (p: { name: string; total: number }) => string;
    portalOrderDetail: (p: { lines: number; day: string }) => string;
    importCheckTitle: (products: number) => string;
    importCheckDetail: string;
    pinLockedTitle: (name: string) => string;
    pinLockedDetail: string;
    billEmailWaitingDetail: (limit: number) => string;
    billEmailFailedTitle: (sender: string) => string;
    billEmailFailedDetail: string;
    cashDetail: (p: { name: string | null; day: string }) => string;
    closeDayTitle: (left: number) => string;
    closeDayDetail: string;
    shiftTitle: (left: number) => string;
    shiftDetail: string;
    duplicatesTitle: (count: number) => string;
    duplicatesDetail: string;
    /** An offline Counter sale sold more than 4VD thought was on the shelf. */
    shortfallTitle: (product: string) => string;
    shortfallDetail: (shortBy: number) => string;
    /** month "2026-09"; the return is due on day 20 of the month after. */
    vatDueTitle: (month: string) => string;
    vatDueDetail: (late: boolean) => string;
    /** month "2026-09": wage tax and pension due on day 15 of the month after. */
    payrollAtkTitle: (p: { month: string; amount: number }) => string;
    payrollAtkDetail: (late: boolean) => string;
    payrollRunTitle: (month: string) => string;
    payrollRunDetail: string;
    /** due "2026-10-15": the quarter's profit tax instalment. */
    tmDueTitle: (p: { quarter: number; year: number; due: string }) => string;
    tmDueDetail: (p: { amount: number; late: boolean }) => string;
    /** Last year's yearly declaration (CD or PD), due 31 March. */
    declarationDueTitle: (p: { year: number; form: 'CD' | 'PD'; due: string }) => string;
    declarationDueDetail: (p: { late: boolean }) => string;
    questionTitle: (on: QuestionOn) => string;
    questionDetail: (p: { name: string | null; text: string }) => string;
  };
  questions: {
    answeredTitle: (on: QuestionOn) => string;
  };

  testAlertTitle: string;
  testAlertMessage: string;

  insight: {
    soldOutTitle: (product: string) => string;
    soldOutDetail: (p: { perDay: number; order: number }) => string;
    runningOutTitle: (p: { product: string; daysLeft: number }) => string;
    runningOutDetail: (p: { left: number; perDay: number; rising: boolean; order: number }) => string;
    missingTitle: (p: { product: string; units: number }) => string;
    missingDetail: (p: { times: number; days: number }) => string;
    unusualTitle: (p: { product: string; quantity: number }) => string;
    unusualDetail: (p: { saleId: number; seller: string | null; usual: number }) => string;
    belowCostTitle: (product: string) => string;
    belowCostDetail: (p: { sales: number; days: number; shortfall: number }) => string;
    deadStockTitle: (p: { product: string; days: number }) => string;
    deadStockDetail: (p: { inStock: number; tiedUp: number | null }) => string;
    tabOverdueTitle: (p: { name: string; amount: number }) => string;
    tabOverdueDetail: (p: { days: number }) => string;
    billOverdueTitle: (p: { supplier: string; amount: number; days: number }) => string;
    billDueSoonTitle: (p: { supplier: string; amount: number; days: number }) => string;
    billDetail: (p: { number: string | null; dueOn: string }) => string;
    expiringTitle: (p: { product: string; quantity: number; daysLeft: number }) => string;
    expiringDetail: string;
  };

  email: {
    footer: string;
    /** Small print under a customer business's own emails. */
    runsOn: string;
    pasteLink: string;
    greeting: (name: string) => string;
    inviteSubject: (p: { inviter: string; shop: string }) => string;
    inviteBody: (p: { inviter: string; shop: string; role: string }) => string;
    inviteChoosePassword: string;
    inviteButton: string;
    inviteNote: string;
    inviteNoteShort: string;
    portalInviteSubject: (shop: string) => string;
    portalInviteBody: (p: { shop: string; customer: string }) => string;
    portalInviteButton: string;
    portalInviteNote: string;
    portalSignInSubject: (shop: string) => string;
    portalSignInBody: (shop: string) => string;
    portalSignInButton: string;
    portalSignInNote: string;
    portalChangedSubject: (p: { shop: string; id: number }) => string;
    portalChangedBody: (p: { shop: string; id: number }) => string;
    portalChangedReason: (reason: string) => string;
    portalChangedTotal: (total: string) => string;
    portalChangedButton: string;
    portalChangedNote: string;
    verifySubject: string;
    verifyBody: string;
    verifyButton: string;
    expires24h: string;
    passkeySubject: string;
    passkeyBody: (device: string) => string;
    passkeyButton: string;
    passkeyNote: string;
    resetSubject: string;
    resetBody: string;
    resetButton: string;
    resetNote: string;
    resetNoteShort: string;
    confirmSubject: string;
    confirmBody: string;
    confirmButton: string;
    confirmNote: string;
    errorSubject: (count: number) => string;
    errorIntro: (p: { name: string; count: number }) => string;
    errorItem: (p: { what: string; count: number }) => string;
    errorNote: string;
    changedSubject: string;
    changedBody: (email: string) => string;
    changedWarning: string;
  };
  /** The daily and weekly report: alert, email and section names. */
  report: {
    shop: string;
    carwash: string;
    title: (p: { kind: 'daily' | 'weekly'; period: string; revenue: number | null }) => string;
    salesLine: (p: { sales: number; profit: number; change: number | null }) => string;
    billsLine: (p: { count: number; amount: number }) => string;
    stockLine: (count: number) => string;
    approvalsLine: (count: number) => string;
    nothing: string;
    testPrefix: string;
    sections: Record<string, string>;
    /** The email's headline. */
    kindTitle: Record<'daily' | 'weekly', string>;
    emailIntro: (p: { name: string; kind: 'daily' | 'weekly'; period: string }) => string;
    emailButton: string;
    emailNote: string;
    /** The report email's figures, rows and stamps, laid out like the report page. */
    lines: {
      revenue: string;
      profit: string;
      net: string;
      salesCount: string;
      change: (percent: number) => string;
      before: (amount: number) => string;
      margin: (margin: number) => string;
      netHint: string;
      units: (p: { units: number; average: number }) => string;
      byDay: string;
      sold: (units: number) => string;
      sales: (count: number) => string;
      refunds: string;
      stockLosses: string;
      float: (amount: number) => string;
      counted: string;
      matched: string;
      short: (amount: number) => string;
      over: (amount: number) => string;
      total: string;
      owedBy: (customers: number) => string;
      overdue: string;
      owed: string;
      dueSoon: string;
      paid: (count: number) => string;
      due: (p: { day: string; overdue: boolean }) => string;
      stock: Record<'soldOut' | 'runningOut' | 'expiring', string>;
      waiting: string;
      none: string;
    };
  };
  /** The printed A4 invoice and credit note. */
  document: {
    invoice: string;
    creditNote: string;
    number: string;
    issued: string;
    issuedBy: string;
    buyer: string;
    buyerName: string;
    address: string;
    nui: string;
    phone: string;
    corrects: (number: string) => string;
    reason: string;
    fiscalReceipt: string;
    product: string;
    quantity: string;
    unitPrice: string;
    vatRate: string;
    net: string;
    vat: string;
    total: string;
    vatAt: (rate: number) => string;
    vatExempt: string;
    netTotal: string;
    vatTotal: string;
    grandTotal: string;
    pricesIncludeVat: string;
    signedSeller: string;
    signedBuyer: string;
    refundTotal: string;
    vatSummary: string;
    payment: string;
    bank: string;
    iban: string;
    payReference: string;
    discount: string;
    discountTotal: string;
    inWords: string;
    paymentMethod: string;
    paidAtTill: string;
    onAccount: string;
    refundedAtTill: string;
    creditedToAccount: string;
    dueDate: string;
    deliverTo: string;
    serial: string;
    warrantyUntil: string;
    stamp: string;
  };
}

const EN_MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SQ_MONTH = ['janarit', 'shkurtit', 'marsit', 'prillit', 'majit', 'qershorit', 'korrikut', 'gushtit', 'shtatorit', 'tetorit', 'nëntorit', 'dhjetorit'];
const SQ_MONTH_DAY = ['janar', 'shkurt', 'mars', 'prill', 'maj', 'qershor', 'korrik', 'gusht', 'shtator', 'tetor', 'nëntor', 'dhjetor'];
const EN_ON_TODO: Record<QuestionOn['kind'], string> = { bill: 'the bill', document: 'invoice', entry: 'entry' };
const SQ_ON_TODO: Record<QuestionOn['kind'], string> = { bill: 'faturën', document: 'faturën e shitjes', entry: 'regjistrimin' };

const enUndoneKind: Record<UndoneKind, string> = {
  sale: 'sale',
  return: 'return',
  write_off: 'write-off',
  count_line: 'count',
  stock: 'stock change',
  edit: 'change',
  settings: 'change',
};

export const en: ServerMessages = {
  language: 'en',
  roleName: { developer: 'the 4VD developer', main_admin: 'the main admin', admin: 'an admin', owner: 'the owner', employee: 'an employee', family: 'a family member', accountant: 'the accountant' },
  writeOffReason: { damaged: 'damaged', lost: 'lost', expired: 'expired', theft: 'stolen', other: 'other' },
  myRequest: {
    return: ({ what, refund }) => `Return of ${what}, refund ${money(refund, 'en')}`,
    writeOff: ({ what, reason }) => `${what} (${reason})`,
    count: (scope) => `Stock count of ${scope ?? 'the whole shop'}`,
    sale: ({ what, total }) => `Sale of ${what}, ${money(total, 'en')}`,
    product: ({ name, price }) => `New product ${name} at ${money(price, 'en')}`,
    bill: ({ supplier, lines }) => `Bill${supplier ? ` from ${supplier}` : ''} (${lines} ${lines === 1 ? 'line' : 'lines'})`,
  },
  wholeShop: 'the whole shop',

  outOfStockTitle: (product) => `Out of stock: ${product}`,
  outOfStockMessage: (product) => `${product} has run out. Restock it to keep selling.`,
  lowStockTitle: (product) => `Low stock: ${product}`,
  lowStockMessage: ({ product, left, reorderLevel }) => `Only ${left} left of ${product} (reorder level is ${reorderLevel}).`,

  pendingTitle: (kind) => (kind === 'bill' ? 'New bill waiting to be checked' : `New ${kind} waiting for approval`),
  productPending: ({ name, product, price }) => `${name} wants to add ${product} at ${price}.`,
  billEmailedPending: ({ sender, supplier, lines }) => `A bill${supplier ? ` from ${supplier}` : ''} came by email from ${sender} (${lines} ${lines === 1 ? 'line' : 'lines'}).`,
  billEmailTitle: 'Bill by email',
  portalOrderTitle: 'Order from the portal',
  portalOrderMessage: (p) => `${p.name} sent an order of ${money(p.total, 'en')} (${p.lines} ${p.lines === 1 ? 'line' : 'lines'})`,
  importDoneTitle: 'Your import is done',
  importDoneMessage: (p) => `${p.products} new products, ${p.changed} changed, ${p.suppliers} suppliers, ${p.customers} customers. Check a few of them by eye.`,
  portalChangeAgreedTitle: 'Change agreed',
  portalChangeAgreedMessage: (p) => `${p.name} agreed to your change of order #${p.id}. You can accept it now.`,
  portalChangeCancelledTitle: 'Changed order cancelled',
  portalChangeCancelledMessage: (p) => `${p.name} cancelled order #${p.id} instead of agreeing to the change.`,
  billEmailDuplicate: ({ sender, file, day }) => `${file ?? 'A bill'} from ${sender} was already received on ${day}, so it wasn't read again.`,
  billEmailNoFile: ({ sender, subject }) => `An email from ${sender}${subject ? ` (${subject})` : ''} had no PDF or bill photo, so nothing was added.`,
  billPending: ({ name, supplier, lines }) => `${name} scanned a bill${supplier ? ` from ${supplier}` : ''} (${lines} ${lines === 1 ? 'line' : 'lines'}).`,
  productApproved: (product) => `${product} was added to the shop`,
  productApprovedMessage: 'It can be sold now.',
  productRejected: (product) => `${product} was not added`,
  returnPending: ({ name, what, reasons }) => `${name} returned ${what} (${reasons.join(', ')}).`,
  writeOffPending: ({ name, what }) => `${name} reported ${what}.`,
  countPending: ({ name, scope, differences }) =>
    `${name} counted ${scope}: ${differences} ${differences === 1 ? 'product differs' : 'products differ'} from the system.`,
  reasonRefundOver: (amount) => `refund over ${wholeMoney(amount, 'en')}`,
  reasonSoldDaysAgo: (days) => `sold more than ${days} days ago`,
  reasonDamaged: 'damaged item',

  returnApproved: (what) => `Your return of ${what} was approved`,
  returnApprovedMessage: 'The refund has been recorded.',
  returnRejected: (what) => `Your return of ${what} was rejected`,
  writeOffApproved: (what) => `Your write-off of ${what} was approved`,
  writeOffApprovedMessage: 'The stock has been updated.',
  writeOffRejected: (what) => `Your write-off of ${what} was rejected`,
  countReviewed: (scope) => `Your stock count of ${scope} was reviewed`,
  countReviewedMessage: 'The stock has been corrected where the owner approved it.',
  undoneTitle: (kind, what) => `Your ${enUndoneKind[kind]} ${kind === 'edit' || kind === 'settings' ? 'to' : 'of'} ${what} was undone`,
  undoneMessage: (note) => (note ? `Reason: ${note}` : 'No reason was given.'),
  restoredTitle: (kind, what) => `Your ${enUndoneKind[kind]} ${kind === 'edit' || kind === 'settings' ? 'to' : 'of'} ${what} was restored`,
  restoredMessage: 'It counts again.',
  settingsWhat: 'the shop settings',

  dailyTitle: (revenue) => `Today: ${money(revenue, 'en')} in sales`,
  dailySales: ({ sales, profit, lastWeek }) =>
    `${count(sales, 'sale', 'sales')}, ${money(profit, 'en')} profit. Same day last week: ${money(lastWeek, 'en')}.`,
  dailyUrgent: ({ titles, more }) => `Urgent: ${titles.join('; ')}${more > 0 ? ` and ${more} more` : ''}.`,
  dailyOthers: (n) => `${count(n, 'other thing', 'other things')} to look at on the Overview page.`,
  dailyNothing: 'Nothing needs your attention.',
  dayClosedTitle: 'The day is closed',
  dailyCarwash: ({ name, carwash, change, total }) =>
    `Carwash${name ? ` (${name})` : ''}: ${money(carwash, 'en')} + ${money(change, 'en')} change = ${money(total, 'en')}.`,
  dailyCarwashMissing: (name) => `Today's carwash${name ? ` (${name})` : ''} takings aren't entered yet.`,
  dailyCash: ({ place, carwash, difference, compared }) => {
    const drawer = place === 'shop' ? 'Shop cash' : `Carwash cash${carwash ? ` (${carwash})` : ''}`;
    if (!compared) return `${drawer} counted; no carwash takings entered to compare with.`;
    if (difference === 0) return `${drawer} matched.`;
    return `${drawer}: ${money(Math.abs(difference), 'en')} ${difference < 0 ? 'short' : 'over'}.`;
  },
  dailyCashMissing: (place, carwash) => `${place === 'shop' ? 'Shop' : `Carwash${carwash ? ` (${carwash})` : ''}`} cash not counted yet.`,
  cashDifferenceTitle: ({ place, carwash, difference }) =>
    `${place === 'shop' ? 'Shop' : `Carwash${carwash ? ` (${carwash})` : ''}`} cash ${difference < 0 ? 'short' : 'over'} by ${money(Math.abs(difference), 'en')}`,
  cashDifferenceMessage: ({ name, counted, float, expected }) =>
    `${name} counted ${money(counted, 'en')} with a ${money(float, 'en')} float. The app expected ${money(expected, 'en')} on top of the float.`,

  todo: {
    requestsTitle: (count) => `${count} ${count === 1 ? 'request is' : 'requests are'} waiting for a decision`,
    requestsDetail: 'Approve or reject them so the team knows where they stand.',
    billScanTitle: (supplier) => (supplier ? `Check the scanned bill from ${supplier}` : 'Check a scanned bill'),
    billScanDetail: ({ name, number, emailFrom }) =>
      emailFrom
        ? `${number ? `Bill ${number}, came` : 'Came'} by email from ${emailFrom}. Confirm it to put the stock in.`
        : `${number ? `Bill ${number}, scanned` : 'Scanned'}${name ? ` by ${name}` : ''}. Confirm it to put the stock in.`,
    billEmailWaitingTitle: (sender) => `Read the emailed bill from ${sender}`,
    portalOrderTitle: (p) => `${p.name} sent an order of ${money(p.total, 'en')}`,
    portalOrderDetail: (p) => `${p.lines} ${p.lines === 1 ? 'product' : 'products'}, sent ${p.day}. Accept it as an offer or decline it.`,
    importCheckTitle: (products) => `Check the ${products} imported products`,
    importCheckDetail: 'Look at a few side by side with your file, then mark the import checked.',
    pinLockedTitle: (name) => `The Counter PIN of ${name} is locked`,
    pinLockedDetail: '10 wrong PINs in a day: someone may be guessing it. Ask them, then unlock it on their page. If nobody unlocks it, it opens once the wrong tries are a day old.',
    billEmailWaitingDetail: (limit) => `Today's ${limit} bill reads by email are used up. Read it now, or it waits for tomorrow.`,
    billEmailFailedTitle: (sender) => `The emailed bill from ${sender} couldn't be read`,
    billEmailFailedDetail: 'Open the file and try again, or add the bill by hand.',
    cashDetail: ({ name, day }) => `${name ? `Counted by ${name}` : 'Counted'} on ${day}. Look into it, then mark it as checked.`,
    closeDayTitle: (left) => `Close the day: ${left} ${left === 1 ? 'step' : 'steps'} left`,
    closeDayDetail: 'Count the drawers, enter the carwash and add the expenses before you go.',
    shiftTitle: (left) => `End your shift: ${left} ${left === 1 ? 'step' : 'steps'} left`,
    shiftDetail: 'Count your drawer and enter the takings before you go.',
    duplicatesTitle: (count) => `${count} ${count === 1 ? 'product may be' : 'products may be'} listed twice`,
    duplicatesDetail: 'Merge each pair or keep both, so stock and sales add up in one place.',
    shortfallTitle: (product) => `Count ${product}`,
    shortfallDetail: (shortBy) => `Sold ${shortBy} more than 4VD had in stock, so stock was set to 0. Count the shelf.`,
    vatDueTitle: (month) => `${EN_MONTH[Number(month.slice(5, 7)) - 1]} VAT is due by 20 ${EN_MONTH[Number(month.slice(5, 7)) % 12]}`,
    vatDueDetail: (late) => (late ? 'The day to file has passed. File it with ATK, then mark the month as filed.' : 'Check the figures, file them with ATK, then mark the month as filed.'),
    payrollAtkTitle: ({ month, amount }) => `${EN_MONTH[Number(month.slice(5, 7)) - 1]} wage tax and pension: ${new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format(amount)} to ATK by 15 ${EN_MONTH[Number(month.slice(5, 7)) % 12]}`,
    payrollAtkDetail: (late) => (late ? 'The day to pay has passed. Declare the payroll in EDI, pay ATK, then record the payment in Payroll.' : 'Declare the payroll in EDI, pay ATK, then record the payment in Payroll.'),
    payrollRunTitle: (month) => `Run the ${EN_MONTH[Number(month.slice(5, 7)) - 1]} payroll`,
    payrollRunDetail: 'Check each person’s pay and confirm it, so the wages, the tax and the pension are in the books.',
    tmDueTitle: ({ quarter, year, due }) => `Profit tax for Q${quarter} ${year} is due by ${Number(due.slice(8, 10))} ${EN_MONTH[Number(due.slice(5, 7)) - 1]}`,
    tmDueDetail: ({ amount, late }) =>
      late ? `The day has passed. Pay about ${money(amount, 'en')} to ATK, then mark it as paid.` : `About ${money(amount, 'en')} on the profit so far. Pay it to ATK, then mark it as paid.`,
    declarationDueTitle: ({ year, form, due }) => `File the ${year} ${form} by ${Number(due.slice(8, 10))} ${EN_MONTH[Number(due.slice(5, 7)) - 1]}`,
    declarationDueDetail: ({ late }) =>
      late ? 'The day has passed. Check the figures with the accountant, file it with ATK, then mark it as filed.' : 'The figures come from the books. Check them with the accountant, file with ATK, then mark it as filed.',
    questionTitle: (on) => `The accountant asks about ${EN_ON_TODO[on.kind]} ${on.label}`,
    questionDetail: ({ name, text }) => `${name ?? 'The accountant'}: “${text}”`,
  },
  questions: {
    answeredTitle: (on) => `Your question on ${EN_ON_TODO[on.kind]} ${on.label} has an answer`,
  },

  testAlertTitle: 'Test alert from 4VD',
  testAlertMessage: 'Alerts are working on this device.',

  insight: {
    soldOutTitle: (product) => `${product} is sold out`,
    soldOutDetail: ({ perDay, order }) => `It was selling about ${perDay} a day. Order about ${order}.`,
    runningOutTitle: ({ product, daysLeft }) =>
      `${product} runs out ${daysLeft === 0 ? 'today' : `in about ${count(daysLeft, 'day', 'days')}`}`,
    runningOutDetail: ({ left, perDay, rising, order }) =>
      `${left} left, selling about ${perDay} a day${rising ? ', and picking up' : ''}. Order about ${order}.`,
    missingTitle: ({ product, units }) => `${count(units, 'unit', 'units')} of ${product} went missing`,
    missingDetail: ({ times, days }) =>
      `${times === 1 ? 'Once' : `${times} times`} in the last ${days} days, from counts that came up short or stock reported lost.`,
    unusualTitle: ({ product, quantity }) => `Unusually big sale: ${quantity} × ${product}`,
    unusualDetail: ({ saleId, seller, usual }) =>
      `Sale #${saleId}${seller ? ` by ${seller}` : ''}. A sale is usually about ${usual}. Check it wasn't a typing mistake.`,
    belowCostTitle: (product) => `${product} sold below cost`,
    belowCostDetail: ({ sales, days, shortfall }) =>
      `${count(sales, 'sale', 'sales')} in the last ${days} days brought in ${money(shortfall, 'en')} less than cost. Check its price and promotions.`,
    deadStockTitle: ({ product, days }) => `${product} hasn't sold in ${days}+ days`,
    deadStockDetail: ({ inStock, tiedUp }) =>
      `${inStock} in stock${tiedUp === null ? '' : `, ${money(tiedUp, 'en')} tied up at cost`}. A promotion could move it.`,
    tabOverdueTitle: ({ name, amount }) => `${name} is late paying ${money(amount, 'en')}`,
    tabOverdueDetail: ({ days }) => `${days === 1 ? '1 day' : `${days} days`} past the day they promised. Send a reminder from their page.`,
    billOverdueTitle: ({ supplier, amount, days }) => `${money(amount, 'en')} to ${supplier} is ${days} ${days === 1 ? 'day' : 'days'} late`,
    billDueSoonTitle: ({ supplier, amount, days }) =>
      `${money(amount, 'en')} to ${supplier} is due ${days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`}`,
    billDetail: ({ number, dueOn }) => `${number ? `Bill no. ${number}, d` : 'D'}ue on ${dueOn}. Record the payment once it's paid.`,
    expiringTitle: ({ product, quantity, daysLeft }) =>
      daysLeft < 0
        ? `${quantity} × ${product} expired ${count(-daysLeft, 'day', 'days')} ago`
        : daysLeft === 0
          ? `${quantity} × ${product} expire today`
          : `${quantity} × ${product} expire in ${count(daysLeft, 'day', 'days')}`,
    expiringDetail: 'Sticker them: the till sells them short-dated near the date. Once the date has passed, remove them as expired under Stock → Expiring.',
  },

  email: {
    footer: 'You’re getting this because of your 4VD account.',
    runsOn: 'Runs on 4VD',
    pasteLink: 'Or paste this link into your browser:',
    greeting: (name) => `Hi ${name},`,
    inviteSubject: ({ inviter, shop }) => `${inviter} invited you to ${shop} on 4VD`,
    inviteBody: ({ inviter, shop, role }) => `${inviter} has invited you to join ${shop} on 4VD as ${role}.`,
    inviteChoosePassword: 'Choose your password (or use Google) to set up your account.',
    inviteButton: 'Accept the invite',
    inviteNote: 'This link works once and expires in 7 days. If you weren’t expecting it, you can ignore this email.',
    inviteNoteShort: 'This link works once and expires in 7 days.',
    portalInviteSubject: (shop) => `${shop} invites you to order online`,
    portalInviteBody: (p) => `${p.shop} opened an online account for ${p.customer}: your prices, orders, invoices and what is still to pay, on your phone.`,
    portalInviteButton: 'Open my account',
    portalInviteNote: 'This link works once and expires in 7 days. After that, sign in with this email address.',
    portalSignInSubject: (shop) => `Sign in to ${shop}`,
    portalSignInBody: (shop) => `Press the button to sign in to your account at ${shop}.`,
    portalSignInButton: 'Sign in',
    portalSignInNote: 'This link works once and expires in 15 minutes. If you didn’t ask for it, ignore this email.',
    portalChangedSubject: (p) => `${p.shop} changed your order #${p.id}`,
    portalChangedBody: (p) => `${p.shop} made a change to your order #${p.id}. Look at it and agree, or cancel the order.`,
    portalChangedReason: (reason) => `Why: ${reason}`,
    portalChangedTotal: (total) => `New total: ${total}`,
    portalChangedButton: 'See the change',
    portalChangedNote: 'Nothing is prepared until you agree.',
    verifySubject: 'Confirm your email for 4VD',
    verifyBody: 'Please confirm this is your email address.',
    verifyButton: 'Confirm my email',
    expires24h: 'This link expires in 24 hours.',
    passkeySubject: 'A passkey was added to your 4VD account',
    passkeyBody: (device) => `A new passkey (${device}) can now sign in to your 4VD account with the device’s fingerprint, face or PIN.`,
    passkeyButton: 'See my passkeys',
    passkeyNote: 'If you didn’t add it, remove it on your profile and change your password.',
    resetSubject: 'Reset your 4VD password',
    resetBody: 'Someone asked to reset the password for your 4VD account. If it was you, choose a new one here.',
    resetButton: 'Choose a new password',
    resetNote: 'This link works once and expires in 1 hour. If you didn’t ask for this, ignore this email; your password stays the same.',
    resetNoteShort: 'This link works once and expires in 1 hour. If you didn’t ask for this, ignore this email.',
    confirmSubject: 'Confirm your new email for 4VD',
    confirmBody: 'Confirm this address to start using it to log in to 4VD.',
    confirmButton: 'Use this email',
    confirmNote: 'This link expires in 24 hours. Until then you keep logging in with your old email.',
    errorSubject: (count) => `4VD ran into ${count === 1 ? 'an error' : `${count} errors`}`,
    errorIntro: ({ name, count }) =>
      `Hi ${name}, the server logged ${count === 1 ? 'an error' : `${count} errors`} since the last email. The app may still be working; this is so you hear about it first.`,
    errorItem: ({ what, count }) => `${count > 1 ? `${count}× ` : ''}${what}`,
    errorNote: 'The full details are in the Render logs for 4vd-api. You get at most one of these an hour.',
    changedSubject: 'Your 4VD email was changed',
    changedBody: (email) => `Your 4VD account now logs in with ${email}, and this address won't be used any more.`,
    changedWarning: 'If you didn’t do this, tell the shop owner straight away.',
  },
  report: {
    shop: 'Shop',
    carwash: 'Carwash',
    title: ({ kind, period, revenue }) =>
      `${kind === 'daily' ? 'Daily' : 'Weekly'} report · ${period}${revenue === null ? '' : `: ${money(revenue, 'en')}`}`,
    salesLine: ({ sales, profit, change }) =>
      `${sales} ${sales === 1 ? 'sale' : 'sales'}, ${money(profit, 'en')} profit${change === null ? '' : ` (${change >= 0 ? '+' : ''}${change}%)`}`,
    billsLine: ({ count, amount }) => `${count} ${count === 1 ? 'bill' : 'bills'} overdue (${money(amount, 'en')})`,
    stockLine: (count) => `${count} ${count === 1 ? 'product' : 'products'} to restock`,
    approvalsLine: (count) => `${count} waiting for approval`,
    nothing: 'Nothing needs your attention.',
    testPrefix: 'Test: ',
    sections: {
      sales: 'Sales',
      products: 'Best sellers',
      team: 'Team',
      losses: 'Refunds and losses',
      carwash: 'Carwash',
      cash: 'Cash counts',
      expenses: 'Expenses',
      tabs: 'Customer tabs',
      bills: 'Supplier bills',
      stock: 'Stock',
      approvals: 'Approvals',
    },
    kindTitle: { daily: 'Daily report', weekly: 'Weekly report' },
    emailIntro: ({ name, kind, period }) => `Hi ${name}, here is your ${kind === 'daily' ? 'daily' : 'weekly'} report for ${period}.`,
    emailButton: 'Open the full report',
    emailNote: 'Choose what is in this report, when it comes and whether it is emailed on your Profile page.',
    lines: {
      revenue: 'Sales',
      profit: 'Profit',
      net: 'Left after costs',
      salesCount: 'Number of sales',
      change: (percent) => `${percent >= 0 ? 'Up' : 'Down'} ${Math.abs(percent)}% on the period before`,
      before: (amount) => `${money(amount, 'en')} the period before`,
      margin: (margin) => `${Math.round(margin * 100)}% margin`,
      netHint: 'Shop profit plus the carwash, minus expenses',
      units: ({ units, average }) => `${count(units, 'unit', 'units')} · ${money(average, 'en')} on average`,
      byDay: 'Sales by day',
      sold: (units) => `${units} sold`,
      sales: (n) => count(n, 'sale', 'sales'),
      refunds: 'Refunded',
      stockLosses: 'Stock lost',
      float: (amount) => `float ${money(amount, 'en')}`,
      counted: 'Counted',
      matched: 'Matched',
      short: (amount) => `Short ${money(amount, 'en')}`,
      over: (amount) => `Over ${money(amount, 'en')}`,
      total: 'Total',
      owedBy: (customers) => `Owed by ${count(customers, 'customer', 'customers')}`,
      overdue: 'Overdue',
      owed: 'You owe',
      dueSoon: 'Due this week',
      paid: (n) => `Paid in ${count(n, 'payment', 'payments')}`,
      due: ({ day, overdue }) => `${overdue ? 'was due' : 'due'} ${day}`,
      stock: { soldOut: 'Sold out', runningOut: 'Running out', expiring: 'Expiring' },
      waiting: 'Requests waiting for you',
      none: 'Nothing here.',
    },
  },
  document: {
    invoice: 'Invoice',
    creditNote: 'Credit note',
    number: 'No.',
    issued: 'Date',
    issuedBy: 'Issued by',
    buyer: 'Buyer',
    buyerName: 'Name',
    address: 'Address',
    nui: 'NUI',
    phone: 'Phone',
    corrects: (number) => `Reverses invoice ${number}`,
    reason: 'Reason',
    fiscalReceipt: 'Fiscal receipt',
    product: 'Product',
    quantity: 'Qty',
    unitPrice: 'Unit price',
    vatRate: 'VAT',
    net: 'Net',
    vat: 'VAT',
    total: 'Total',
    vatAt: (rate) => `VAT ${rate}%`,
    vatExempt: 'Exempt',
    netTotal: 'Total without VAT',
    vatTotal: 'Total VAT',
    grandTotal: 'Total to pay',
    pricesIncludeVat: 'Prices include VAT.',
    signedSeller: 'Issued by (signature)',
    signedBuyer: 'Received by (signature)',
    refundTotal: 'Total to refund',
    vatSummary: 'VAT by rate',
    payment: 'Payment by bank transfer',
    bank: 'Bank',
    iban: 'IBAN',
    payReference: 'Reference',
    discount: 'Rabat',
    discountTotal: 'Total rabat',
    inWords: 'In words',
    paymentMethod: 'Payment',
    paidAtTill: 'Paid at the till',
    onAccount: 'On account',
    refundedAtTill: 'Refunded at the till',
    creditedToAccount: 'Credited to the account',
    dueDate: 'Due by',
    deliverTo: 'Deliver to',
    serial: 'S/N',
    warrantyUntil: 'warranty until',
    stamp: 'Stamp',
  },
};

const sqUndoneKind: Record<UndoneKind, string> = {
  sale: 'Shitja jote',
  return: 'Kthimi yt',
  write_off: 'Heqja jote nga stoku',
  count_line: 'Numërimi yt',
  stock: 'Ndryshimi yt i stokut',
  edit: 'Ndryshimi yt',
  settings: 'Ndryshimi yt',
};

export const sq: ServerMessages = {
  language: 'sq',
  roleName: { developer: 'zhvillues i 4VD', main_admin: 'administrator kryesor', admin: 'administrator', owner: 'pronar', employee: 'punonjës', family: 'anëtar i familjes', accountant: 'kontabilist' },
  writeOffReason: { damaged: 'i dëmtuar', lost: 'i humbur', expired: 'i skaduar', theft: 'i vjedhur', other: 'tjetër' },
  myRequest: {
    return: ({ what, refund }) => `Kthim i ${what}, rimbursim ${money(refund, 'sq')}`,
    writeOff: ({ what, reason }) => `${what} (${reason})`,
    count: (scope) => `Numërim stoku i ${scope ?? 'gjithë dyqanit'}`,
    sale: ({ what, total }) => `Shitje e ${what}, ${money(total, 'sq')}`,
    product: ({ name, price }) => `Produkt i ri ${name} me ${money(price, 'sq')}`,
    bill: ({ supplier, lines }) => `Faturë${supplier ? ` nga ${supplier}` : ''} (${lines} ${lines === 1 ? 'rresht' : 'rreshta'})`,
  },
  wholeShop: 'i gjithë dyqani',

  outOfStockTitle: (product) => `Mbaroi stoku: ${product}`,
  outOfStockMessage: (product) => `${product} ka mbaruar. Furnizoje sërish që të vazhdosh ta shesësh.`,
  lowStockTitle: (product) => `Stok i ulët: ${product}`,
  lowStockMessage: ({ product, left, reorderLevel }) =>
    `Kanë mbetur vetëm ${left} nga ${product} (niveli i porosisë është ${reorderLevel}).`,

  pendingTitle: (kind) =>
    kind === 'bill'
      ? 'Faturë e re për t’u kontrolluar'
      : ({ return: 'Kthim i ri', 'write-off': 'Heqje e re nga stoku', 'stock count': 'Numërim i ri i stokut', product: 'Produkt i ri', bill: '' })[kind] +
        ' në pritje të miratimit',
  productPending: ({ name, product, price }) => `${name} do të shtojë ${product} me ${price}.`,
  billEmailedPending: ({ sender, supplier, lines }) => `Një faturë${supplier ? ` nga ${supplier}` : ''} erdhi me email nga ${sender} (${lines} ${lines === 1 ? 'rresht' : 'rreshta'}).`,
  billEmailTitle: 'Faturë me email',
  portalOrderTitle: 'Porosi nga portali',
  portalOrderMessage: (p) => `${p.name} dërgoi një porosi prej ${money(p.total, 'sq')} (${p.lines} ${p.lines === 1 ? 'rresht' : 'rreshta'})`,
  importDoneTitle: 'Importi përfundoi',
  importDoneMessage: (p) => `${p.products} produkte të reja, ${p.changed} të ndryshuara, ${p.suppliers} furnitorë, ${p.customers} klientë. Kontrollo disa me sy.`,
  portalChangeAgreedTitle: 'Ndryshimi u pranua',
  portalChangeAgreedMessage: (p) => `${p.name} pranoi ndryshimin tuaj të porosisë #${p.id}. Tani mund ta pranoni.`,
  portalChangeCancelledTitle: 'Porosia e ndryshuar u anulua',
  portalChangeCancelledMessage: (p) => `${p.name} anuloi porosinë #${p.id} në vend që të pranonte ndryshimin.`,
  billEmailDuplicate: ({ sender, file, day }) => `${file ?? 'Një faturë'} nga ${sender} ishte marrë më ${day}, prandaj nuk u lexua sërish.`,
  billEmailNoFile: ({ sender, subject }) => `Një email nga ${sender}${subject ? ` (${subject})` : ''} nuk kishte PDF ose foto fature, prandaj nuk u shtua asgjë.`,
  billPending: ({ name, supplier, lines }) => `${name} skanoi një faturë${supplier ? ` nga ${supplier}` : ''} (${lines} ${lines === 1 ? 'rresht' : 'rreshta'}).`,
  productApproved: (product) => `${product} u shtua në dyqan`,
  productApprovedMessage: 'Tani mund të shitet.',
  productRejected: (product) => `${product} nuk u shtua`,
  returnPending: ({ name, what, reasons }) => `${name} ktheu ${what} (${reasons.join(', ')}).`,
  writeOffPending: ({ name, what }) => `${name} raportoi ${what}.`,
  countPending: ({ name, scope, differences }) =>
    `${name} numëroi stokun (${scope}): ${differences} ${differences === 1 ? 'produkt ndryshon' : 'produkte ndryshojnë'} nga sistemi.`,
  reasonRefundOver: (amount) => `rimbursim mbi ${wholeMoney(amount, 'sq')}`,
  reasonSoldDaysAgo: (days) => `shitur më shumë se ${days} ditë më parë`,
  reasonDamaged: 'artikull i dëmtuar',

  returnApproved: (what) => `Kthimi yt (${what}) u miratua`,
  returnApprovedMessage: 'Rimbursimi u regjistrua.',
  returnRejected: (what) => `Kthimi yt (${what}) u refuzua`,
  writeOffApproved: (what) => `Heqja jote nga stoku (${what}) u miratua`,
  writeOffApprovedMessage: 'Stoku u përditësua.',
  writeOffRejected: (what) => `Heqja jote nga stoku (${what}) u refuzua`,
  countReviewed: (scope) => `Numërimi yt i stokut (${scope}) u shqyrtua`,
  countReviewedMessage: 'Stoku u korrigjua aty ku e miratoi pronari.',
  undoneTitle: (kind, what) => `${sqUndoneKind[kind]} (${what}) u anulua`,
  undoneMessage: (note) => (note ? `Arsyeja: ${note}` : 'Nuk u dha asnjë arsye.'),
  restoredTitle: (kind, what) => `${sqUndoneKind[kind]} (${what}) u rikthye`,
  restoredMessage: 'Vlen sërish.',
  settingsWhat: 'cilësimet e dyqanit',

  dailyTitle: (revenue) => `Sot: ${money(revenue, 'sq')} në shitje`,
  dailySales: ({ sales, profit, lastWeek }) =>
    `${count(sales, 'shitje', 'shitje')}, ${money(profit, 'sq')} fitim. E njëjta ditë javën e kaluar: ${money(lastWeek, 'sq')}.`,
  dailyUrgent: ({ titles, more }) => `Urgjente: ${titles.join('; ')}${more > 0 ? ` dhe ${more} të tjera` : ''}.`,
  dailyOthers: (n) => `${count(n, 'gjë tjetër', 'gjëra të tjera')} për të parë te Përmbledhja.`,
  dailyNothing: 'Asgjë nuk kërkon vëmendjen tënde.',
  dayClosedTitle: 'Dita u mbyll',
  dailyCarwash: ({ name, carwash, change, total }) =>
    `Lavazhi${name ? ` (${name})` : ''}: ${money(carwash, 'sq')} + ${money(change, 'sq')} këmbim = ${money(total, 'sq')}.`,
  dailyCarwashMissing: (name) => `Të ardhurat e lavazhit${name ? ` (${name})` : ''} për sot nuk janë futur ende.`,
  dailyCash: ({ place, carwash, difference, compared }) => {
    const drawer = place === 'shop' ? 'Arka e dyqanit' : `Arka e lavazhit${carwash ? ` (${carwash})` : ''}`;
    if (!compared) return `${drawer} u numërua; s’ka të ardhura lavazhi për krahasim.`;
    if (difference === 0) return `${drawer} përputhet.`;
    return `${drawer}: ${money(Math.abs(difference), 'sq')} ${difference < 0 ? 'mungesë' : 'tepricë'}.`;
  },
  dailyCashMissing: (place, carwash) => `${place === 'shop' ? 'Arka e dyqanit' : `Arka e lavazhit${carwash ? ` (${carwash})` : ''}`} nuk është numëruar ende.`,
  cashDifferenceTitle: ({ place, carwash, difference }) =>
    `${place === 'shop' ? 'Arka e dyqanit' : `Arka e lavazhit${carwash ? ` (${carwash})` : ''}`}: ${difference < 0 ? 'mungesë' : 'tepricë'} ${money(Math.abs(difference), 'sq')}`,
  cashDifferenceMessage: ({ name, counted, float, expected }) =>
    `${name} numëroi ${money(counted, 'sq')} me ${money(float, 'sq')} kusur fillestar. Aplikacioni priste ${money(expected, 'sq')} mbi kusurin.`,

  todo: {
    requestsTitle: (count) => `${count} ${count === 1 ? 'kërkesë pret' : 'kërkesa presin'} vendim`,
    requestsDetail: 'Prano ose refuzo, që ekipi ta dijë si qëndrojnë.',
    billScanTitle: (supplier) => (supplier ? `Kontrollo faturën e skanuar nga ${supplier}` : 'Kontrollo një faturë të skanuar'),
    billScanDetail: ({ name, number, emailFrom }) =>
      emailFrom
        ? `${number ? `Fatura ${number}, erdhi` : 'Erdhi'} me email nga ${emailFrom}. Konfirmoje që malli të hyjë në stok.`
        : `${number ? `Fatura ${number}, skanuar` : 'Skanuar'}${name ? ` nga ${name}` : ''}. Konfirmoje që malli të hyjë në stok.`,
    billEmailWaitingTitle: (sender) => `Lexo faturën me email nga ${sender}`,
    portalOrderTitle: (p) => `${p.name} dërgoi një porosi prej ${money(p.total, 'sq')}`,
    portalOrderDetail: (p) => `${p.lines} ${p.lines === 1 ? 'produkt' : 'produkte'}, dërguar ${p.day}. Pranoje si ofertë ose refuzoje.`,
    importCheckTitle: (products) => `Kontrollo ${products} produktet e importuara`,
    importCheckDetail: 'Shiko disa krahas skedarit tënd, pastaj shëno importin si të kontrolluar.',
    pinLockedTitle: (name) => `PIN-i i arkës për ${name} është i bllokuar`,
    pinLockedDetail: '10 PIN të gabuar brenda një dite: dikush mund të jetë duke e provuar. Pyete, pastaj zhbllokoje te faqja e tij. Nëse askush nuk e zhbllokon, hapet kur provat e gabuara bëhen një ditë të vjetra.',
    billEmailWaitingDetail: (limit) => `Leximet e sotme me email (${limit}) u mbaruan. Lexoje tani, ose pret deri nesër.`,
    billEmailFailedTitle: (sender) => `Fatura me email nga ${sender} nuk u lexua`,
    billEmailFailedDetail: 'Hape skedarin dhe provo sërish, ose shtoje faturën me dorë.',
    cashDetail: ({ name, day }) => `${name ? `E numëroi ${name}` : 'E numëruar'} më ${day}. Shiko çfarë ndodhi, pastaj shëno si të kontrolluar.`,
    closeDayTitle: (left) => `Mbyll ditën: ${left === 1 ? 'mbetet 1 hap' : `mbeten ${left} hapa`}`,
    closeDayDetail: 'Numëro arkat, fut lavazhin dhe shto shpenzimet para se të ikësh.',
    shiftTitle: (left) => `Mbyll turnin: ${left === 1 ? 'mbetet 1 hap' : `mbeten ${left} hapa`}`,
    shiftDetail: 'Numëro arkën dhe fut të ardhurat para se të ikësh.',
    duplicatesTitle: (count) => `${count === 1 ? 'Një produkt mund të jetë' : `${count} produkte mund të jenë`} dy herë në listë`,
    duplicatesDetail: 'Bashkoji ose mbaji të dyja, që stoku dhe shitjet të mblidhen në një vend.',
    shortfallTitle: (product) => `Numëro ${product}`,
    shortfallDetail: (shortBy) => `U shitën ${shortBy} më shumë se sa kishte 4VD në stok, prandaj stoku u vu 0. Numëro raftin.`,
    vatDueTitle: (month) => `TVSH-ja e ${SQ_MONTH[Number(month.slice(5, 7)) - 1]} duhet deklaruar deri më 20 ${SQ_MONTH_DAY[Number(month.slice(5, 7)) % 12]}`,
    vatDueDetail: (late) => (late ? 'Afati ka kaluar. Deklaroje në ATK, pastaj shëno muajin si të deklaruar.' : 'Kontrollo shifrat, deklaroji në ATK, pastaj shëno muajin si të deklaruar.'),
    payrollAtkTitle: ({ month, amount }) => `Tatimi në paga dhe kontributet e ${SQ_MONTH[Number(month.slice(5, 7)) - 1]}: ${new Intl.NumberFormat('sq-AL', { style: 'currency', currency: 'EUR' }).format(amount)} në ATK deri më 15 ${SQ_MONTH_DAY[Number(month.slice(5, 7)) % 12]}`,
    payrollAtkDetail: (late) => (late ? 'Afati ka kaluar. Deklaroji pagat në EDI, paguaj ATK-në, pastaj regjistro pagesën te Pagat.' : 'Deklaroji pagat në EDI, paguaj ATK-në, pastaj regjistro pagesën te Pagat.'),
    payrollRunTitle: (month) => `Bëj pagat e ${SQ_MONTH[Number(month.slice(5, 7)) - 1]}`,
    payrollRunDetail: 'Kontrollo pagën e secilit dhe konfirmoje, që pagat, tatimi dhe kontributet të jenë në libra.',
    tmDueTitle: ({ quarter, year, due }) => `Tatimi në fitim për TM${quarter} ${year} duhet paguar deri më ${Number(due.slice(8, 10))} ${SQ_MONTH_DAY[Number(due.slice(5, 7)) - 1]}`,
    tmDueDetail: ({ amount, late }) =>
      late ? `Afati ka kaluar. Paguaj rreth ${money(amount, 'sq')} në ATK, pastaj shënoje si të paguar.` : `Rreth ${money(amount, 'sq')} mbi fitimin deri tani. Paguaje në ATK, pastaj shënoje si të paguar.`,
    declarationDueTitle: ({ year, form, due }) => `Deklaro ${form} për ${year} deri më ${Number(due.slice(8, 10))} ${SQ_MONTH_DAY[Number(due.slice(5, 7)) - 1]}`,
    declarationDueDetail: ({ late }) =>
      late ? 'Afati ka kaluar. Kontrollo shifrat me kontabilistin, deklaroje në ATK, pastaj shënoje si të deklaruar.' : 'Shifrat vijnë nga librat. Kontrolloji me kontabilistin, deklaroje në ATK, pastaj shënoje si të deklaruar.',
    questionTitle: (on) => `Kontabilisti pyet për ${SQ_ON_TODO[on.kind]} ${on.label}`,
    questionDetail: ({ name, text }) => `${name ?? 'Kontabilisti'}: “${text}”`,
  },
  questions: {
    answeredTitle: (on) => `Pyetja jote për ${SQ_ON_TODO[on.kind]} ${on.label} ka përgjigje`,
  },

  testAlertTitle: 'Njoftim provë nga 4VD',
  testAlertMessage: 'Njoftimet po funksionojnë në këtë pajisje.',

  insight: {
    soldOutTitle: (product) => `${product} ka mbaruar`,
    soldOutDetail: ({ perDay, order }) => `Shitej rreth ${perDay} në ditë. Porosit rreth ${order}.`,
    runningOutTitle: ({ product, daysLeft }) =>
      `${product} mbaron ${daysLeft === 0 ? 'sot' : `për rreth ${count(daysLeft, 'ditë', 'ditë')}`}`,
    runningOutDetail: ({ left, perDay, rising, order }) =>
      `Kanë mbetur ${left}, shitet rreth ${perDay} në ditë${rising ? ' dhe po rritet' : ''}. Porosit rreth ${order}.`,
    missingTitle: ({ product, units }) => `Mungojnë ${count(units, 'copë', 'copë')} nga ${product}`,
    missingDetail: ({ times, days }) =>
      `${times === 1 ? 'Një herë' : `${times} herë`} në ${days} ditët e fundit, nga numërime që dolën me mungesë ose stok i raportuar si i humbur.`,
    unusualTitle: ({ product, quantity }) => `Shitje jashtëzakonisht e madhe: ${quantity} × ${product}`,
    unusualDetail: ({ saleId, seller, usual }) =>
      `Shitja #${saleId}${seller ? ` nga ${seller}` : ''}. Zakonisht një shitje është rreth ${usual}. Kontrollo që të mos jetë gabim shtypi.`,
    belowCostTitle: (product) => `${product} u shit nën kosto`,
    belowCostDetail: ({ sales, days, shortfall }) =>
      `${count(sales, 'shitje', 'shitje')} në ${days} ditët e fundit sollën ${money(shortfall, 'sq')} më pak se kostoja. Kontrollo çmimin dhe ofertat.`,
    deadStockTitle: ({ product, days }) => `${product} nuk është shitur prej më shumë se ${days} ditësh`,
    deadStockDetail: ({ inStock, tiedUp }) =>
      `${inStock} në stok${tiedUp === null ? '' : `, ${money(tiedUp, 'sq')} të bllokuara me koston`}. Një ofertë mund ta lëvizë.`,
    tabOverdueTitle: ({ name, amount }) => `${name} është vonë me pagesën e ${money(amount, 'sq')}`,
    tabOverdueDetail: ({ days }) => `${days === 1 ? '1 ditë' : `${days} ditë`} pas ditës që premtoi. Dërgo një kujtesë nga faqja e klientit.`,
    billOverdueTitle: ({ supplier, amount, days }) => `${money(amount, 'sq')} për ${supplier} është vonuar ${days} ditë`,
    billDueSoonTitle: ({ supplier, amount, days }) =>
      `${money(amount, 'sq')} për ${supplier} ${days === 0 ? 'duhet paguar sot' : days === 1 ? 'duhet paguar nesër' : `duhet paguar pas ${days} ditësh`}`,
    billDetail: ({ number, dueOn }) => `${number ? `Fatura nr. ${number}. ` : ''}Afati: ${dueOn}. Shëno pagesën sapo të paguhet.`,
    expiringTitle: ({ product, quantity, daysLeft }) =>
      daysLeft < 0
        ? `${quantity} × ${product} skaduan para ${count(-daysLeft, 'ditë', 'ditësh')}`
        : daysLeft === 0
          ? `${quantity} × ${product} skadojnë sot`
          : `${quantity} × ${product} skadojnë për ${count(daysLeft, 'ditë', 'ditë')}`,
    expiringDetail: 'Vendosu etiketë: arka i shet me afat të shkurtër afër datës. Pasi të kalojë afati, hiqi si të skaduara te Stoku → Afati.',
  },

  email: {
    footer: 'Po e merr këtë sepse ke një llogari në 4VD.',
    runsOn: 'Punon me 4VD',
    pasteLink: 'Ose ngjite këtë lidhje në shfletues:',
    greeting: (name) => `Përshëndetje ${name},`,
    inviteSubject: ({ inviter, shop }) => `${inviter} të ftoi në ${shop} te 4VD`,
    inviteBody: ({ inviter, shop, role }) => `${inviter} të ka ftuar të bashkohesh me ${shop} te 4VD si ${role}.`,
    inviteChoosePassword: 'Zgjidh fjalëkalimin (ose përdor Google) për ta krijuar llogarinë.',
    inviteButton: 'Prano ftesën',
    inviteNote: 'Kjo lidhje punon vetëm një herë dhe skadon pas 7 ditësh. Nëse nuk e prisje, mund ta injorosh këtë email.',
    inviteNoteShort: 'Kjo lidhje punon vetëm një herë dhe skadon pas 7 ditësh.',
    portalInviteSubject: (shop) => `${shop} ju fton të porositni online`,
    portalInviteBody: (p) => `${p.shop} hapi një llogari online për ${p.customer}: çmimet tuaja, porositë, faturat dhe sa keni për të paguar, në telefon.`,
    portalInviteButton: 'Hap llogarinë time',
    portalInviteNote: 'Kjo lidhje punon vetëm një herë dhe skadon pas 7 ditësh. Më pas hyni me këtë adresë emaili.',
    portalSignInSubject: (shop) => `Hyni te ${shop}`,
    portalSignInBody: (shop) => `Shtypni butonin për të hyrë në llogarinë tuaj te ${shop}.`,
    portalSignInButton: 'Hyr',
    portalSignInNote: 'Kjo lidhje punon vetëm një herë dhe skadon pas 15 minutash. Nëse nuk e kërkuat, injorojeni këtë email.',
    portalChangedSubject: (p) => `${p.shop} ndryshoi porosinë tuaj #${p.id}`,
    portalChangedBody: (p) => `${p.shop} bëri një ndryshim në porosinë tuaj #${p.id}. Shikojeni dhe pranojeni, ose anulojeni porosinë.`,
    portalChangedReason: (reason) => `Pse: ${reason}`,
    portalChangedTotal: (total) => `Totali i ri: ${total}`,
    portalChangedButton: 'Shiko ndryshimin',
    portalChangedNote: 'Asgjë nuk përgatitet derisa ta pranoni.',
    verifySubject: 'Konfirmo emailin për 4VD',
    verifyBody: 'Të lutem konfirmo që kjo është adresa jote e emailit.',
    verifyButton: 'Konfirmo emailin',
    expires24h: 'Kjo lidhje skadon pas 24 orësh.',
    passkeySubject: 'U shtua një çelës kalimi në llogarinë tënde 4VD',
    passkeyBody: (device) => `Një çelës i ri kalimi (${device}) tani mund të hyjë në llogarinë tënde 4VD me gjurmën e gishtit, fytyrën ose PIN-in e pajisjes.`,
    passkeyButton: 'Shiko çelësat e mi',
    passkeyNote: 'Nëse nuk e shtove ti, hiqe te profili yt dhe ndrysho fjalëkalimin.',
    resetSubject: 'Ndrysho fjalëkalimin e 4VD',
    resetBody: 'Dikush kërkoi të ndryshojë fjalëkalimin e llogarisë tënde në 4VD. Nëse ishe ti, zgjidh një të ri këtu.',
    resetButton: 'Zgjidh një fjalëkalim të ri',
    resetNote: 'Kjo lidhje punon vetëm një herë dhe skadon pas 1 ore. Nëse nuk e kërkove ti, injoroje këtë email; fjalëkalimi mbetet i njëjtë.',
    resetNoteShort: 'Kjo lidhje punon vetëm një herë dhe skadon pas 1 ore. Nëse nuk e kërkove ti, injoroje këtë email.',
    confirmSubject: 'Konfirmo emailin e ri për 4VD',
    confirmBody: 'Konfirmo këtë adresë që ta përdorësh për të hyrë në 4VD.',
    confirmButton: 'Përdor këtë email',
    confirmNote: 'Kjo lidhje skadon pas 24 orësh. Deri atëherë vazhdon të hysh me emailin e vjetër.',
    errorSubject: (count) => `4VD hasi ${count === 1 ? 'një gabim' : `${count} gabime`}`,
    errorIntro: ({ name, count }) =>
      `Përshëndetje ${name}, serveri regjistroi ${count === 1 ? 'një gabim' : `${count} gabime`} që nga emaili i fundit. Aplikacioni mund të punojë ende; kjo është që ta mësosh i pari.`,
    errorItem: ({ what, count }) => `${count > 1 ? `${count}× ` : ''}${what}`,
    errorNote: 'Detajet e plota janë te regjistrat e Render për 4vd-api. Merr më së shumti një të tillë në orë.',
    changedSubject: 'Emaili yt në 4VD u ndryshua',
    changedBody: (email) => `Llogaria jote në 4VD tani hyn me ${email}, dhe kjo adresë nuk do të përdoret më.`,
    changedWarning: 'Nëse nuk e bëre ti këtë, njofto menjëherë pronarin e dyqanit.',
  },
  report: {
    shop: 'Dyqani',
    carwash: 'Lavazhi',
    title: ({ kind, period, revenue }) =>
      `Raporti ${kind === 'daily' ? 'ditor' : 'javor'} · ${period}${revenue === null ? '' : `: ${money(revenue, 'sq')}`}`,
    salesLine: ({ sales, profit, change }) =>
      `${sales} shitje, ${money(profit, 'sq')} fitim${change === null ? '' : ` (${change >= 0 ? '+' : ''}${change}%)`}`,
    billsLine: ({ count, amount }) => `${count} ${count === 1 ? 'faturë e vonuar' : 'fatura të vonuara'} (${money(amount, 'sq')})`,
    stockLine: (count) => `${count} ${count === 1 ? 'produkt' : 'produkte'} për t’u furnizuar`,
    approvalsLine: (count) => `${count} në pritje të miratimit`,
    nothing: 'Asgjë nuk kërkon vëmendjen tënde.',
    testPrefix: 'Provë: ',
    sections: {
      sales: 'Shitjet',
      products: 'Më të shiturat',
      team: 'Ekipi',
      losses: 'Rimbursime dhe humbje',
      carwash: 'Lavazhi',
      cash: 'Numërimet e arkës',
      expenses: 'Shpenzimet',
      tabs: 'Borxhet e klientëve',
      bills: 'Faturat e furnitorëve',
      stock: 'Stoku',
      approvals: 'Miratimet',
    },
    kindTitle: { daily: 'Raporti ditor', weekly: 'Raporti javor' },
    emailIntro: ({ name, kind, period }) => `Përshëndetje ${name}, ja raporti yt ${kind === 'daily' ? 'ditor' : 'javor'} për ${period}.`,
    emailButton: 'Hap raportin e plotë',
    emailNote: 'Zgjidh çfarë ka ky raport, kur vjen dhe nëse vjen me email te faqja e Profilit.',
    lines: {
      revenue: 'Shitjet',
      profit: 'Fitimi',
      net: 'Mbetet pas kostove',
      salesCount: 'Nr. i shitjeve',
      change: (percent) => `${percent >= 0 ? 'Rritje' : 'Rënie'} ${Math.abs(percent)}% nga periudha e mëparshme`,
      before: (amount) => `${money(amount, 'sq')} periudha e mëparshme`,
      margin: (margin) => `marzhë ${Math.round(margin * 100)}%`,
      netHint: 'Fitimi i dyqanit plus lavazhi, minus shpenzimet',
      units: ({ units, average }) => `${units} copë · mesatarisht ${money(average, 'sq')}`,
      byDay: 'Shitjet sipas ditës',
      sold: (units) => `${units} të shitura`,
      sales: (n) => `${n} shitje`,
      refunds: 'Rimbursuar',
      stockLosses: 'Stok i humbur',
      float: (amount) => `kusuri fillestar ${money(amount, 'sq')}`,
      counted: 'U numërua',
      matched: 'Përputhet',
      short: (amount) => `Mungojnë ${money(amount, 'sq')}`,
      over: (amount) => `Tepricë ${money(amount, 'sq')}`,
      total: 'Gjithsej',
      owedBy: (customers) => `Borxh nga ${customers} ${customers === 1 ? 'klient' : 'klientë'}`,
      overdue: 'E vonuar',
      owed: 'Ke borxh',
      dueSoon: 'Për t’u paguar këtë javë',
      paid: (n) => `Paguar me ${n} ${n === 1 ? 'pagesë' : 'pagesa'}`,
      due: ({ day, overdue }) => `${overdue ? 'afati ishte' : 'afati'} ${day}`,
      stock: { soldOut: 'Mbaruan', runningOut: 'Po mbarojnë', expiring: 'Po skadojnë' },
      waiting: 'Kërkesa që të presin',
      none: 'Asgjë këtu.',
    },
  },
  document: {
    invoice: 'Faturë',
    creditNote: 'Notë krediti',
    number: 'Nr.',
    issued: 'Data',
    issuedBy: 'Lëshuar nga',
    buyer: 'Blerësi',
    buyerName: 'Emri',
    address: 'Adresa',
    nui: 'NUI',
    phone: 'Tel.',
    corrects: (number) => `Kthen faturën ${number}`,
    reason: 'Arsyeja',
    fiscalReceipt: 'Kuponi fiskal',
    product: 'Produkti',
    quantity: 'Sasia',
    unitPrice: 'Çmimi për njësi',
    vatRate: 'TVSH',
    net: 'Pa TVSH',
    vat: 'TVSH',
    total: 'Gjithsej',
    vatAt: (rate) => `TVSH ${rate}%`,
    vatExempt: 'E liruar',
    netTotal: 'Gjithsej pa TVSH',
    vatTotal: 'Gjithsej TVSH',
    grandTotal: 'Për pagesë',
    pricesIncludeVat: 'Çmimet përfshijnë TVSH-në.',
    signedSeller: 'Lëshoi (nënshkrimi)',
    signedBuyer: 'Pranoi (nënshkrimi)',
    refundTotal: 'Për kthim',
    vatSummary: 'TVSH sipas normës',
    payment: 'Pagesa me transfer bankar',
    bank: 'Banka',
    iban: 'IBAN',
    payReference: 'Referenca',
    discount: 'Rabati',
    discountTotal: 'Rabati gjithsej',
    inWords: 'Me fjalë',
    paymentMethod: 'Pagesa',
    paidAtTill: 'Paguar në arkë',
    onAccount: 'Në llogari',
    refundedAtTill: 'Kthyer në arkë',
    creditedToAccount: 'Kreditohet në llogari',
    dueDate: 'Afati i pagesës',
    deliverTo: 'Dërgohet në',
    serial: 'Nr. serik',
    warrantyUntil: 'garanci deri më',
    stamp: 'V.V.',
  },
};

export const messages: Record<Language, ServerMessages> = { en, sq };
