import fs from 'node:fs';
import path from 'node:path';
import { clean, filled, GENERIC_PARTNERS, money, num, parseCsv, TREFIN_DATABASES } from './trefinHistory.js';

type Row = Record<string, string>;

/** TREFIN's offers and activity log, as read from the export's `raw` folder. */
export interface TrefinExtras {
  /** tblOferta of each database: offers (price quotes). */
  offers: Record<string, Row[]>;
  /** tblOferta_Detaje of each database: their lines. */
  offerLines: Record<string, Row[]>;
  /** tblUserHistori of MasterDB and MasterDB1 (an older copy): what each user did. */
  activity: Row[];
  /** TREFIN's users, number → name. Only these two columns are ever read: never a password. */
  users: Map<string, string>;
}

/** The program's own databases: settings, users and the activity log. */
const MASTER_DATABASES = ['MasterDB', 'MasterDB1'];

export function readTrefinExtras(dir: string): TrefinExtras | undefined {
  const raw = path.join(dir, 'raw');
  if (!fs.existsSync(raw)) return undefined;
  const table = (db: string, name: string): Row[] => {
    const file = path.join(raw, db, `${name}.csv`);
    return fs.existsSync(file) ? parseCsv(fs.readFileSync(file, 'utf8')) : [];
  };
  const each = (name: string) => Object.fromEntries(TREFIN_DATABASES.map((db) => [db, table(db, name)]));
  const users = new Map<string, string>();
  for (const db of MASTER_DATABASES) {
    for (const row of table(db, 'tblUser')) {
      const name = clean(row.EmerUser);
      if (name && !users.has(clean(row.NrUser))) users.set(clean(row.NrUser), name);
    }
  }
  return {
    offers: each('tblOferta'),
    offerLines: each('tblOferta_Detaje'),
    activity: MASTER_DATABASES.flatMap((db) => table(db, 'tblUserHistori')),
    users,
  };
}

const day = (value: string | undefined) => clean(value).slice(0, 10);

/** One of TREFIN's offers. */
export interface TrefinOffer {
  ref: string;
  db: string;
  number: string | null;
  day: string;
  partnerKey: string | null;
  partnerName: string | null;
  total: number;
  lines: Array<{ code: string; quantity: number; unitPrice: number; total: number }>;
}

/**
 * TREFIN's offers, each once: a newer database copies an older one's, and the
 * older one, where it was made, wins.
 */
export function trefinOffers(extras: TrefinExtras, partners: Record<string, Row[]>): TrefinOffer[] {
  const offers = new Map<string, TrefinOffer>();
  for (const db of TREFIN_DATABASES) {
    const names = new Map((partners[db] ?? []).map((row) => [clean(row.NrKlient), clean(row.EmerKlient)]));
    const lines = new Map<string, Row[]>();
    for (const row of extras.offerLines[db] ?? []) {
      const key = clean(row.NrFatura);
      const rows = lines.get(key);
      if (rows) rows.push(row);
      else lines.set(key, [row]);
    }
    for (const row of extras.offers[db] ?? []) {
      const number = clean(row.NrFatura);
      const twin = `${number}|${day(row.Data)}`;
      const code = clean(row.NrKlient);
      offers.set(twin, {
        ref: `${db}/${clean(row.NrRen)}`,
        db,
        number: filled(number),
        day: day(row.Data),
        partnerKey: code && !GENERIC_PARTNERS.has(code) ? `${db}/${code}` : null,
        partnerName: code && !GENERIC_PARTNERS.has(code) ? names.get(code) || null : null,
        total: money(num(row.Totali)),
        lines: (lines.get(number) ?? []).map((line) => ({
          code: clean(line.NrArt),
          quantity: num(line.Sasia),
          // TREFIN keeps the price with VAT in CmimiBTVSH (Cmimi is often 0).
          unitPrice: Math.round(num(line.CmimiBTVSH) * 10000) / 10000,
          total: money(num(line.Totali)),
        })),
      });
    }
  }
  return [...offers.values()].sort((a, b) => a.day.localeCompare(b.day) || a.ref.localeCompare(b.ref));
}

/** What a line of TREFIN's activity log was about: 4VD's area (for the kind filters) and a word. */
const SUBJECTS: Record<string, { area: string; what: string }> = {
  KUP: { area: 'sale', what: 'receipt' },
  FSM: { area: 'document', what: 'invoice' },
  EKS: { area: 'document', what: 'invoice' },
  FH: { area: 'document', what: 'invoice' },
  Mall: { area: 'product', what: 'product' },
  'Lista e Çmimeve': { area: 'pricing', what: 'prices' },
  FBM: { area: 'bill', what: 'bill' },
  FBS: { area: 'bill', what: 'bill' },
  FBI: { area: 'bill', what: 'bill' },
  IMM: { area: 'bill', what: 'bill' },
  KB: { area: 'bill', what: 'supplier_return' },
  Sbujekt: { area: 'supplier', what: 'partner' },
  Shpenzim: { area: 'expense', what: 'expense' },
  EB: { area: 'cash', what: 'payment' },
  APK: { area: 'cash', what: 'payment' },
  PFF: { area: 'cash', what: 'payment' },
  GJF: { area: 'stock', what: 'stock' },
  INV: { area: 'count', what: 'count' },
  'Mjetë Themelor': { area: 'bill', what: 'equipment' },
  Përdorues: { area: 'user', what: 'user' },
  Kyçje: { area: 'auth', what: 'login' },
};
const VERBS: Record<string, string> = { Regjistrim: 'created', Ndryshim: 'updated', NdrFshiyshim: 'updated', Fshi: 'deleted', Mbyllja: 'closed', Kyçje: 'login' };

/** A line of TREFIN's activity log. */
export interface TrefinActivity {
  /** "YYYY-MM-DD HH:MM:SS", the shop's time. */
  at: string;
  person: string | null;
  action: string;
  what: string;
  subject: string | null;
}

/**
 * TREFIN's activity log, each line once (MasterDB1 is an older copy of
 * MasterDB's), people by name. Lines dated before TREFIN's books began or
 * after the export (a wrong clock on the PC) are left out and counted.
 */
export function trefinActivity(extras: TrefinExtras, until: string): { lines: TrefinActivity[]; wrongClock: number } {
  const seen = new Set<string>();
  const lines: TrefinActivity[] = [];
  let wrongClock = 0;
  for (const row of extras.activity) {
    const at = clean(row.Krijuar).slice(0, 19);
    const key = [at, clean(row.LlojDok), clean(row.NrFatura), clean(row.Veprim), clean(row.NrUser)].join('|');
    if (!at || seen.has(key)) continue;
    seen.add(key);
    if (at < '2022-01-01' || at.slice(0, 10) > until) {
      wrongClock++;
      continue;
    }
    const subject = SUBJECTS[clean(row.LlojDok)] ?? { area: 'settings', what: 'settings' };
    const verb = clean(row.Veprim) === 'Kyçje' || clean(row.LlojDok) === 'Kyçje' ? 'login' : (VERBS[clean(row.Veprim)] ?? 'updated');
    const user = clean(row.NrUser);
    // Logins and settings name no record ("Kyçje", "Periudha").
    const named = subject.what !== 'login' && subject.what !== 'settings';
    lines.push({
      at,
      person: extras.users.get(user) ?? null,
      action: `${subject.area}.${verb}`,
      what: subject.what,
      subject: named ? filled(row.NrFatura) : null,
    });
  }
  lines.sort((a, b) => a.at.localeCompare(b.at));
  return { lines, wrongClock };
}
