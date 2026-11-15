import type { AssetCategory } from '../../database/types.js';
import type { ExportColumn, Sheet } from '../../utils/spreadsheet.js';
import type { BooksLanguage } from '../books/booksExport.js';
import type { AssetDto, AssetStatus, ScheduleRow } from '../FixedAssetService.js';

const WORDS = {
  sq: {
    register: 'Regjistri i pasurive fikse',
    schedule: 'Zhvlerësimi',
    asOf: (day: string) => `Gjendja më ${day}`,
    year: (year: number) => `Viti ${year}`,
    name: 'Emri',
    code: 'Kodi',
    category: 'Lloji',
    bought: 'Blerë më',
    inUse: 'Në përdorim nga',
    rate: 'Norma %',
    cost: 'Kostoja historike',
    depreciated: 'Zhvlerësimi i akumuluar',
    value: 'Vlera neto',
    monthly: 'Zhvlerësimi mujor',
    wornOut: 'Zhvlerësohet plotësisht',
    status: 'Gjendja',
    bill: 'Fatura',
    left: 'Doli më',
    result: 'Fitimi ose humbja',
    openingValue: 'Vlera në fillim të vitit',
    added: 'Shtuar gjatë vitit',
    depreciation: 'Zhvlerësimi i vitit',
    disposedValue: 'Vlera e daljes',
    closingValue: 'Vlera në fund të vitit',
    categories: {
      furniture: 'Mobilje dhe orendi',
      equipment: 'Pajisje',
      vehicle: 'Automjete',
      building: 'Ndërtesa',
      land: 'Toka',
      intangible: 'Pasuri e paprekshme',
      other: 'Pasuri tjetër',
    } satisfies Record<AssetCategory, string>,
    statuses: { in_use: 'Në përdorim', worn_out: 'E zhvlerësuar plotësisht', sold: 'E shitur', scrapped: 'E hedhur', returned: 'E kthyer furnitorit' } satisfies Record<AssetStatus, string>,
  },
  en: {
    register: 'Fixed assets register',
    schedule: 'Depreciation',
    asOf: (day: string) => `As of ${day}`,
    year: (year: number) => `Year ${year}`,
    name: 'Name',
    code: 'Code',
    category: 'Kind',
    bought: 'Bought',
    inUse: 'In use from',
    rate: 'Rate %',
    cost: 'Cost',
    depreciated: 'Depreciated so far',
    value: 'Value now',
    monthly: 'A month',
    wornOut: 'Fully worn by',
    status: 'Status',
    bill: 'Bill',
    left: 'Left on',
    result: 'Gain or loss',
    openingValue: 'Value at the start of the year',
    added: 'Bought in the year',
    depreciation: 'Depreciation in the year',
    disposedValue: 'Value when it left',
    closingValue: 'Value at the end of the year',
    categories: {
      furniture: 'Furniture',
      equipment: 'Equipment',
      vehicle: 'Vehicles',
      building: 'Buildings',
      land: 'Land',
      intangible: 'Intangible',
      other: 'Other',
    } satisfies Record<AssetCategory, string>,
    statuses: { in_use: 'In use', worn_out: 'Fully depreciated', sold: 'Sold', scrapped: 'Thrown away', returned: 'Given back to the supplier' } satisfies Record<AssetStatus, string>,
  },
};

/** The register as it stands: one row per asset, still owned or not. */
export function registerSheet(assets: AssetDto[], today: string, language: BooksLanguage): { basename: string; sheet: Sheet<AssetDto> } {
  const w = WORDS[language];
  const columns: ExportColumn<AssetDto>[] = [
    { header: w.name, value: (row) => row.name },
    { header: w.code, value: (row) => row.code },
    { header: w.category, value: (row) => w.categories[row.category] },
    { header: w.bought, kind: 'date', value: (row) => row.boughtOn },
    { header: w.inUse, kind: 'date', value: (row) => row.inUseFrom },
    { header: w.rate, kind: 'number', value: (row) => row.rate },
    { header: w.cost, kind: 'money', total: true, value: (row) => row.cost },
    { header: w.depreciated, kind: 'money', total: true, value: (row) => row.depreciated },
    { header: w.value, kind: 'money', total: true, value: (row) => (row.disposal ? 0 : row.value) },
    { header: w.monthly, kind: 'money', value: (row) => (row.disposal ? null : row.monthly) },
    { header: w.wornOut, value: (row) => row.wornOutIn?.slice(0, 7) ?? null },
    { header: w.status, value: (row) => w.statuses[row.status] },
    { header: w.left, kind: 'date', value: (row) => row.disposal?.day ?? null },
    { header: w.result, kind: 'money', total: true, value: (row) => (row.disposal ? row.disposal.result : null) },
    { header: w.bill, value: (row) => (row.bill ? [row.bill.supplier, row.bill.number].filter(Boolean).join(' ') : null) },
  ];
  return {
    basename: `4vd-fixed-assets-${today}`,
    sheet: { name: w.register, subtitle: w.asOf(today), columns, rows: assets, totals: { inCsv: false } },
  };
}

/** The year's depreciation schedule: value at the start, bought, depreciation, left, value at the end. */
export function scheduleSheet(rows: ScheduleRow[], year: number, language: BooksLanguage): { basename: string; sheet: Sheet<ScheduleRow> } {
  const w = WORDS[language];
  const columns: ExportColumn<ScheduleRow>[] = [
    { header: w.name, value: (row) => row.name },
    { header: w.code, value: (row) => row.code },
    { header: w.category, value: (row) => w.categories[row.category] },
    { header: w.inUse, kind: 'date', value: (row) => row.inUseFrom },
    { header: w.rate, kind: 'number', value: (row) => row.rate },
    { header: w.cost, kind: 'money', total: true, value: (row) => row.cost },
    { header: w.openingValue, kind: 'money', total: true, value: (row) => row.openingValue },
    { header: w.added, kind: 'money', total: true, value: (row) => row.added },
    { header: w.depreciation, kind: 'money', total: true, value: (row) => row.depreciation },
    { header: w.disposedValue, kind: 'money', total: true, value: (row) => row.disposedValue },
    { header: w.closingValue, kind: 'money', total: true, value: (row) => row.closingValue },
    { header: w.left, kind: 'date', value: (row) => row.disposedOn },
    { header: w.result, kind: 'money', total: true, value: (row) => row.result },
  ];
  return {
    basename: `4vd-depreciation-${year}`,
    sheet: { name: w.schedule, subtitle: w.year(year), columns, rows, totals: { inCsv: false } },
  };
}
