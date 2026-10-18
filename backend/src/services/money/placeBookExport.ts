import type { MoneyPlaceKind } from '../../database/types.js';
import type { ExportColumn, Sheet } from '../../utils/spreadsheet.js';
import type { BooksLanguage } from '../books/booksExport.js';
import type { BookLineDto, BookLineKind, PlaceBookDto } from '../MoneyService.js';

const WORDS = {
  sq: {
    kinds: {
      takings: 'Xhiroja e ditës',
      carwash: 'Xhiroja e autolarjes',
      customer: 'Pagesë klienti',
      supplier: 'Pagesë furnitorit',
      group: 'Pagesë për disa fatura',
      move: 'Lëvizje parash',
      customs: 'Doganë e paguar',
      count: 'Numërim i arkës',
    } satisfies Record<BookLineKind, string>,
    place: { till: 'Arka e dyqanit', safe: 'Kasaforta', bank: 'Banka' } satisfies Record<MoneyPlaceKind, string>,
    owner: 'Pronari',
    date: 'Data',
    what: 'Çka',
    party: 'Me kë',
    detail: 'Dokumenti',
    note: 'Shënim',
    moneyIn: 'Hyrje',
    moneyOut: 'Dalje',
    balance: 'Gjendja',
    opening: 'Gjendja fillestare',
    counted: (amount: string) => `U numëruan ${amount}`,
    bills: (count: number) => `${count} fatura`,
    book: 'Libri i arkës',
    range: (from: string, to: string) => `${from} deri ${to}`,
  },
  en: {
    kinds: {
      takings: "Day's takings",
      carwash: 'Carwash takings',
      customer: 'Customer payment',
      supplier: 'Supplier payment',
      group: 'Payment for several bills',
      move: 'Money moved',
      customs: 'Customs paid',
      count: 'Till count',
    } satisfies Record<BookLineKind, string>,
    place: { till: 'Shop till', safe: 'Safe', bank: 'Bank' } satisfies Record<MoneyPlaceKind, string>,
    owner: 'Owner',
    date: 'Date',
    what: 'What',
    party: 'With',
    detail: 'Document',
    note: 'Note',
    moneyIn: 'Money in',
    moneyOut: 'Money out',
    balance: 'Balance',
    opening: 'Opening balance',
    counted: (amount: string) => `Counted ${amount}`,
    bills: (count: number) => `${count} bills`,
    book: 'Cash book',
    range: (from: string, to: string) => `${from} to ${to}`,
  },
};

type Row = Pick<BookLineDto, 'day' | 'kind' | 'amount' | 'balance' | 'party' | 'otherPlace' | 'detail' | 'bills' | 'note' | 'count'> & { opening?: boolean };

/** One place's book as a spreadsheet: every movement with its running balance. */
export function placeBookSheet(book: PlaceBookDto, language: BooksLanguage): { basename: string; sheet: Sheet<Row> } {
  const w = WORDS[language];
  const placeName = (place: { kind: MoneyPlaceKind; name: string | null }) => place.name ?? w.place[place.kind];
  const opening: Row = { day: book.from, kind: 'takings', amount: 0, balance: book.opening, party: null, otherPlace: null, detail: null, bills: null, note: null, count: null, opening: true };
  const columns: ExportColumn<Row>[] = [
    { header: w.date, kind: 'date', value: (row) => row.day },
    { header: w.what, value: (row) => (row.opening ? w.opening : w.kinds[row.kind]) },
    {
      header: w.party,
      value: (row) => (row.opening ? null : row.kind === 'move' ? (row.otherPlace ? placeName(row.otherPlace) : w.owner) : (row.party?.name ?? null)),
    },
    { header: w.detail, value: (row) => (row.bills ? w.bills(row.bills) : row.count ? w.counted(row.count.counted.toFixed(2)) : row.detail) },
    { header: w.note, value: (row) => row.note },
    { header: w.moneyIn, kind: 'money', total: true, value: (row) => (row.amount > 0 ? row.amount : null) },
    { header: w.moneyOut, kind: 'money', total: true, value: (row) => (row.amount < 0 ? -row.amount : null) },
    { header: w.balance, kind: 'money', value: (row) => (row.kind === 'count' ? null : row.balance) },
  ];
  const name = placeName(book.place);
  return {
    basename: `4vd-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'place'}-${book.from}-to-${book.to}`,
    sheet: {
      name: w.book,
      subtitle: `${name}${book.place.account ? ` (${book.place.account.number})` : ''}, ${w.range(book.from, book.to)}`,
      columns,
      rows: [opening, ...book.lines],
      totals: { inCsv: false },
    },
  };
}
