import { type Language, money, wholeMoney } from './language.js';

/**
 * Everything the server writes for people to read: alerts, the "needs your
 * attention" list, the daily summary and emails. Albanian must have every
 * entry English has (the type makes a missing one a compile error).
 */

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export type ApprovalKind = 'return' | 'write-off' | 'stock count';

/** What kind of entry was undone or restored (see services/undo). */
export type UndoneKind = 'sale' | 'return' | 'write_off' | 'count_line' | 'stock' | 'edit' | 'settings';

export interface ServerMessages {
  language: Language;
  roleName: Record<string, string>;
  writeOffReason: Record<string, string>;
  wholeShop: string;

  outOfStockTitle: (product: string) => string;
  outOfStockMessage: (product: string) => string;
  lowStockTitle: (product: string) => string;
  lowStockMessage: (p: { product: string; left: number; reorderLevel: number }) => string;

  pendingTitle: (kind: ApprovalKind) => string;
  returnPending: (p: { name: string; what: string; reasons: string[] }) => string;
  writeOffPending: (p: { name: string; what: string }) => string;
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
  dailyCarwash: (p: { carwash: number; change: number; total: number }) => string;
  dailyCarwashMissing: string;
  /** `difference` is 0 when it matched; `compared` false when the carwash had no takings to compare with. */
  dailyCash: (p: { place: 'shop' | 'carwash'; difference: number; compared: boolean }) => string;
  dailyCashMissing: (place: 'shop' | 'carwash') => string;
  cashDifferenceTitle: (p: { place: 'shop' | 'carwash'; difference: number }) => string;
  cashDifferenceMessage: (p: { name: string; counted: number; float: number; expected: number }) => string;

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
    tabOverdueDetail: (p: { days: number; minimum: number }) => string;
  };

  email: {
    footer: string;
    pasteLink: string;
    greeting: (name: string) => string;
    inviteSubject: (p: { inviter: string; shop: string }) => string;
    inviteBody: (p: { inviter: string; shop: string; role: string }) => string;
    inviteChoosePassword: string;
    inviteButton: string;
    inviteNote: string;
    inviteNoteShort: string;
    verifySubject: string;
    verifyBody: string;
    verifyButton: string;
    expires24h: string;
    resetSubject: string;
    resetBody: string;
    resetButton: string;
    resetNote: string;
    resetNoteShort: string;
    confirmSubject: string;
    confirmBody: string;
    confirmButton: string;
    confirmNote: string;
    weeklySubject: (revenue: string) => string;
    weeklyIntro: (p: { name: string; week: string }) => string;
    weeklySummary: (p: { revenue: string; sales: number; profit: string; change: string | null }) => string;
    weeklyChange: (percent: number) => string;
    weeklyBestSellers: string;
    weeklyProduct: (p: { rank: number; name: string; revenue: string; units: number }) => string;
    weeklyNoSales: string;
    weeklyCarwash: (p: { carwash: string; change: string; total: string; together: string }) => string;
    errorSubject: (count: number) => string;
    errorIntro: (p: { name: string; count: number }) => string;
    errorItem: (p: { what: string; count: number }) => string;
    errorNote: string;
    weeklyNoCarwash: string;
    weeklyWarnings: (n: number) => string;
    weeklyButton: string;
    weeklyNote: string;
    changedSubject: string;
    changedBody: (email: string) => string;
    changedWarning: string;
  };
}

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
  roleName: { developer: 'the developer', admin: 'an admin', owner: 'the owner', employee: 'an employee', family: 'a family member' },
  writeOffReason: { damaged: 'damaged', lost: 'lost', expired: 'expired', theft: 'stolen', other: 'other' },
  wholeShop: 'the whole shop',

  outOfStockTitle: (product) => `Out of stock: ${product}`,
  outOfStockMessage: (product) => `${product} has run out. Restock it to keep selling.`,
  lowStockTitle: (product) => `Low stock: ${product}`,
  lowStockMessage: ({ product, left, reorderLevel }) => `Only ${left} left of ${product} (reorder level is ${reorderLevel}).`,

  pendingTitle: (kind) => `New ${kind} waiting for approval`,
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
  dailyCarwash: ({ carwash, change, total }) =>
    `Carwash: ${money(carwash, 'en')} + ${money(change, 'en')} change = ${money(total, 'en')}.`,
  dailyCarwashMissing: "Today's carwash takings aren't entered yet.",
  dailyCash: ({ place, difference, compared }) => {
    const drawer = place === 'shop' ? 'Shop cash' : 'Carwash cash';
    if (!compared) return `${drawer} counted; no carwash takings entered to compare with.`;
    if (difference === 0) return `${drawer} matched.`;
    return `${drawer}: ${money(Math.abs(difference), 'en')} ${difference < 0 ? 'short' : 'over'}.`;
  },
  dailyCashMissing: (place) => `${place === 'shop' ? 'Shop' : 'Carwash'} cash not counted yet.`,
  cashDifferenceTitle: ({ place, difference }) =>
    `${place === 'shop' ? 'Shop' : 'Carwash'} cash ${difference < 0 ? 'short' : 'over'} by ${money(Math.abs(difference), 'en')}`,
  cashDifferenceMessage: ({ name, counted, float, expected }) =>
    `${name} counted ${money(counted, 'en')} with a ${money(float, 'en')} float. The app expected ${money(expected, 'en')} on top of the float.`,

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
    tabOverdueTitle: ({ name, amount }) => `${name} owes ${money(amount, 'en')} on their tab`,
    tabOverdueDetail: ({ days }) => `The oldest unpaid part is ${days} days old. A friendly reminder might help.`,
  },

  email: {
    footer: 'You’re getting this because of your 4VD account.',
    pasteLink: 'Or paste this link into your browser:',
    greeting: (name) => `Hi ${name},`,
    inviteSubject: ({ inviter, shop }) => `${inviter} invited you to ${shop} on 4VD`,
    inviteBody: ({ inviter, shop, role }) => `${inviter} has invited you to join ${shop} on 4VD as ${role}.`,
    inviteChoosePassword: 'Choose your password (or use Google) to set up your account.',
    inviteButton: 'Accept the invite',
    inviteNote: 'This link works once and expires in 7 days. If you weren’t expecting it, you can ignore this email.',
    inviteNoteShort: 'This link works once and expires in 7 days.',
    verifySubject: 'Confirm your email for 4VD',
    verifyBody: 'Please confirm this is your email address.',
    verifyButton: 'Confirm my email',
    expires24h: 'This link expires in 24 hours.',
    resetSubject: 'Reset your 4VD password',
    resetBody: 'Someone asked to reset the password for your 4VD account. If it was you, choose a new one here.',
    resetButton: 'Choose a new password',
    resetNote: 'This link works once and expires in 1 hour. If you didn’t ask for this, ignore this email; your password stays the same.',
    resetNoteShort: 'This link works once and expires in 1 hour. If you didn’t ask for this, ignore this email.',
    confirmSubject: 'Confirm your new email for 4VD',
    confirmBody: 'Confirm this address to start using it to log in to 4VD.',
    confirmButton: 'Use this email',
    confirmNote: 'This link expires in 24 hours. Until then you keep logging in with your old email.',
    weeklySubject: (revenue) => `Your week at 4VD: ${revenue} in sales`,
    weeklyIntro: ({ name, week }) => `Hi ${name}, here is last week (${week}).`,
    weeklySummary: ({ revenue, sales, profit, change }) =>
      `${revenue} from ${count(sales, 'sale', 'sales')}, ${profit} profit${change ? `, ${change}` : ''}.`,
    weeklyChange: (percent) => `${percent >= 0 ? 'up' : 'down'} ${Math.abs(percent)}% on the week before`,
    weeklyBestSellers: 'Best sellers:',
    weeklyProduct: ({ rank, name, revenue, units }) => `${rank}. ${name}: ${revenue} (${units} sold)`,
    weeklyNoSales: 'No sales last week.',
    weeklyCarwash: ({ carwash, change, total, together }) =>
      `Carwash: ${total} (${carwash} carwash + ${change} change). Shop and carwash together: ${together}.`,
    weeklyNoCarwash: 'No carwash takings were entered last week.',
    errorSubject: (count) => `4VD ran into ${count === 1 ? 'an error' : `${count} errors`}`,
    errorIntro: ({ name, count }) =>
      `Hi ${name}, the server logged ${count === 1 ? 'an error' : `${count} errors`} since the last email. The app may still be working; this is so you hear about it first.`,
    errorItem: ({ what, count }) => `${count > 1 ? `${count}× ` : ''}${what}`,
    errorNote: 'The full details are in the Render logs for 4vd-api. You get at most one of these an hour.',
    weeklyWarnings: (n) =>
      n === 0 ? 'Nothing needs your attention right now.' : `${n} ${n === 1 ? 'thing needs' : 'things need'} your attention on the Overview page.`,
    weeklyButton: 'Open the dashboard',
    weeklyNote: 'You can switch this email off on your Profile page.',
    changedSubject: 'Your 4VD email was changed',
    changedBody: (email) => `Your 4VD account now logs in with ${email}, and this address won't be used any more.`,
    changedWarning: 'If you didn’t do this, tell the shop owner straight away.',
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
  roleName: { developer: 'zhvillues', admin: 'administrator', owner: 'pronar', employee: 'punonjës', family: 'anëtar i familjes' },
  writeOffReason: { damaged: 'i dëmtuar', lost: 'i humbur', expired: 'i skaduar', theft: 'i vjedhur', other: 'tjetër' },
  wholeShop: 'i gjithë dyqani',

  outOfStockTitle: (product) => `Mbaroi stoku: ${product}`,
  outOfStockMessage: (product) => `${product} ka mbaruar. Furnizoje sërish që të vazhdosh ta shesësh.`,
  lowStockTitle: (product) => `Stok i ulët: ${product}`,
  lowStockMessage: ({ product, left, reorderLevel }) =>
    `Kanë mbetur vetëm ${left} nga ${product} (niveli i porosisë është ${reorderLevel}).`,

  pendingTitle: (kind) =>
    ({ return: 'Kthim i ri', 'write-off': 'Heqje e re nga stoku', 'stock count': 'Numërim i ri i stokut' })[kind] + ' në pritje të miratimit',
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
  dailyCarwash: ({ carwash, change, total }) =>
    `Lavazhi: ${money(carwash, 'sq')} + ${money(change, 'sq')} këmbim = ${money(total, 'sq')}.`,
  dailyCarwashMissing: 'Të ardhurat e lavazhit për sot nuk janë futur ende.',
  dailyCash: ({ place, difference, compared }) => {
    const drawer = place === 'shop' ? 'Arka e dyqanit' : 'Arka e lavazhit';
    if (!compared) return `${drawer} u numërua; s’ka të ardhura lavazhi për krahasim.`;
    if (difference === 0) return `${drawer} përputhet.`;
    return `${drawer}: ${money(Math.abs(difference), 'sq')} ${difference < 0 ? 'mungesë' : 'tepricë'}.`;
  },
  dailyCashMissing: (place) => `${place === 'shop' ? 'Arka e dyqanit' : 'Arka e lavazhit'} nuk është numëruar ende.`,
  cashDifferenceTitle: ({ place, difference }) =>
    `${place === 'shop' ? 'Arka e dyqanit' : 'Arka e lavazhit'}: ${difference < 0 ? 'mungesë' : 'tepricë'} ${money(Math.abs(difference), 'sq')}`,
  cashDifferenceMessage: ({ name, counted, float, expected }) =>
    `${name} numëroi ${money(counted, 'sq')} me ${money(float, 'sq')} kusur fillestar. Aplikacioni priste ${money(expected, 'sq')} mbi kusurin.`,

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
    tabOverdueTitle: ({ name, amount }) => `${name} ka borxh ${money(amount, 'sq')}`,
    tabOverdueDetail: ({ days }) => `Pjesa më e vjetër e papaguar është ${days} ditë e vjetër. Një kujtesë miqësore mund të ndihmojë.`,
  },

  email: {
    footer: 'Po e merr këtë sepse ke një llogari në 4VD.',
    pasteLink: 'Ose ngjite këtë lidhje në shfletues:',
    greeting: (name) => `Përshëndetje ${name},`,
    inviteSubject: ({ inviter, shop }) => `${inviter} të ftoi në ${shop} te 4VD`,
    inviteBody: ({ inviter, shop, role }) => `${inviter} të ka ftuar të bashkohesh me ${shop} te 4VD si ${role}.`,
    inviteChoosePassword: 'Zgjidh fjalëkalimin (ose përdor Google) për ta krijuar llogarinë.',
    inviteButton: 'Prano ftesën',
    inviteNote: 'Kjo lidhje punon vetëm një herë dhe skadon pas 7 ditësh. Nëse nuk e prisje, mund ta injorosh këtë email.',
    inviteNoteShort: 'Kjo lidhje punon vetëm një herë dhe skadon pas 7 ditësh.',
    verifySubject: 'Konfirmo emailin për 4VD',
    verifyBody: 'Të lutem konfirmo që kjo është adresa jote e emailit.',
    verifyButton: 'Konfirmo emailin',
    expires24h: 'Kjo lidhje skadon pas 24 orësh.',
    resetSubject: 'Ndrysho fjalëkalimin e 4VD',
    resetBody: 'Dikush kërkoi të ndryshojë fjalëkalimin e llogarisë tënde në 4VD. Nëse ishe ti, zgjidh një të ri këtu.',
    resetButton: 'Zgjidh një fjalëkalim të ri',
    resetNote: 'Kjo lidhje punon vetëm një herë dhe skadon pas 1 ore. Nëse nuk e kërkove ti, injoroje këtë email; fjalëkalimi mbetet i njëjtë.',
    resetNoteShort: 'Kjo lidhje punon vetëm një herë dhe skadon pas 1 ore. Nëse nuk e kërkove ti, injoroje këtë email.',
    confirmSubject: 'Konfirmo emailin e ri për 4VD',
    confirmBody: 'Konfirmo këtë adresë që ta përdorësh për të hyrë në 4VD.',
    confirmButton: 'Përdor këtë email',
    confirmNote: 'Kjo lidhje skadon pas 24 orësh. Deri atëherë vazhdon të hysh me emailin e vjetër.',
    weeklySubject: (revenue) => `Java jote në 4VD: ${revenue} në shitje`,
    weeklyIntro: ({ name, week }) => `Përshëndetje ${name}, ja java e kaluar (${week}).`,
    weeklySummary: ({ revenue, sales, profit, change }) =>
      `${revenue} nga ${count(sales, 'shitje', 'shitje')}, ${profit} fitim${change ? `, ${change}` : ''}.`,
    weeklyChange: (percent) => `${percent >= 0 ? 'rritje' : 'rënie'} ${Math.abs(percent)}% krahasuar me javën më parë`,
    weeklyBestSellers: 'Më të shiturat:',
    weeklyProduct: ({ rank, name, revenue, units }) => `${rank}. ${name}: ${revenue} (${units} të shitura)`,
    weeklyNoSales: 'Nuk pati shitje javën e kaluar.',
    weeklyCarwash: ({ carwash, change, total, together }) =>
      `Lavazhi: ${total} (${carwash} lavazh + ${change} këmbim). Dyqani dhe lavazhi bashkë: ${together}.`,
    weeklyNoCarwash: 'Nuk u futën të ardhura të lavazhit javën e kaluar.',
    errorSubject: (count) => `4VD hasi ${count === 1 ? 'një gabim' : `${count} gabime`}`,
    errorIntro: ({ name, count }) =>
      `Përshëndetje ${name}, serveri regjistroi ${count === 1 ? 'një gabim' : `${count} gabime`} që nga emaili i fundit. Aplikacioni mund të punojë ende; kjo është që ta mësosh i pari.`,
    errorItem: ({ what, count }) => `${count > 1 ? `${count}× ` : ''}${what}`,
    errorNote: 'Detajet e plota janë te regjistrat e Render për 4vd-api. Merr më së shumti një të tillë në orë.',
    weeklyWarnings: (n) =>
      n === 0 ? 'Asgjë nuk kërkon vëmendjen tënde tani.' : `${n} ${n === 1 ? 'gjë kërkon' : 'gjëra kërkojnë'} vëmendjen tënde te Përmbledhja.`,
    weeklyButton: 'Hap panelin',
    weeklyNote: 'Mund ta çaktivizosh këtë email te faqja e Profilit.',
    changedSubject: 'Emaili yt në 4VD u ndryshua',
    changedBody: (email) => `Llogaria jote në 4VD tani hyn me ${email}, dhe kjo adresë nuk do të përdoret më.`,
    changedWarning: 'Nëse nuk e bëre ti këtë, njofto menjëherë pronarin e dyqanit.',
  },
};

export const messages: Record<Language, ServerMessages> = { en, sq };
