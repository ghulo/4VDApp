import { apiDownload, apiRequest, saveDownload } from './apiClient';

/** Settings → Import (backend services/import): read files, check, bring in, undo. */

export type ImportStatus = 'reading' | 'ready' | 'running' | 'done' | 'failed' | 'undone' | 'partly_undone' | 'discarded';
export type ImportKind = 'products' | 'suppliers' | 'customers';
export type UndoKind = ImportKind;
export type ProblemKey = 'dupBarcode' | 'barcodeCut' | 'costAbovePrice' | 'noPrice' | 'noCost' | 'oddVat' | 'similar' | 'noCategory' | 'dupPartner';
export type Cell = string | number | null;

export type HealthNote =
  | { file: string; key: 'password' | 'oldExcel' | 'notReadable' | 'notSpreadsheet' | 'emptySheet' | 'oldLetters' | 'zipTooBig' | 'skippedInZip'; sheet?: string | null }
  | { file: string; key: 'leftOut'; why: string };

export interface ImportSheet {
  key: string;
  index: number;
  file: string;
  sheet: string | null;
  kind: ImportKind | 'skip';
  kindSure: boolean;
  headerRow: number;
  headers: string[];
  mapping: Partial<Record<string, number>>;
  guessed: string[];
  remembered: boolean;
  examples: Cell[][];
  /** Rows under the headings. */
  rows: number;
}

export interface ImportProblem {
  key: ProblemKey;
  tone: 'danger' | 'warn' | 'info' | 'neutral';
  count: number;
  choices: string[];
  usual: string;
  chosen: string;
  sample: Array<{ rowKey: string; cells: Cell[] }>;
  rowKeys: string[];
}

export interface ImportWarning {
  key: 'stockConcentrated' | 'booksStarted' | 'owedKeptInNote';
  facts: Record<string, string | number>;
  rows?: Array<{ name: string; stock: number; cost: number; value: number }>;
  choices?: Array<'bring' | 'none'>;
  chosen?: 'bring' | 'none';
}

export interface ImportPreview {
  profile: { id: string; name: string } | null;
  shape: 'export' | 'products' | 'priceList' | 'partners' | 'nothing';
  sheets: ImportSheet[];
  counts: {
    products: { new: number; changed: number; same: number; skipped: number };
    suppliers: { new: number; same: number; skipped: number };
    customers: { new: number; same: number; skipped: number };
    categories: { new: number; total: number };
    barcodes: number;
  };
  stockValue: number;
  owed: { suppliers: number; customers: number };
  changes: Array<{ name: string; field: 'name' | 'price' | 'cost' | 'wholesale' | 'vat' | 'category'; from: string | number | null; to: string | number | null }>;
  problems: ImportProblem[];
  warnings: ImportWarning[];
  leftOut: { noName: number };
}

export interface ImportChoices {
  problems?: Partial<Record<ProblemKey, string>>;
  sheets?: Record<string, { kind?: ImportKind | 'skip'; mapping?: Record<string, number> }>;
  fixes?: Record<string, { price?: number; cost?: number | null }>;
  stock?: 'bring' | 'none';
}

export interface ImportSummary {
  from: string | null;
  products: { created: number; changed: number; same: number; skipped: number };
  categories: number;
  suppliers: number;
  customers: number;
  stockValue: number;
  owed: { suppliers: number; customers: number; asOpening: boolean };
  similar: number;
  checked?: boolean;
  undo?: { removed: number; restored: number; kept: number; changedSince: number };
}

export interface ImportView {
  id: number;
  status: ImportStatus;
  fileNames: string[];
  createdAt: string;
  finishedAt: string | null;
  undoneAt: string | null;
  error: string | null;
  progress: { phase: 'sorting' | 'writing' | 'undoing'; done: number; total: number } | null;
  health: HealthNote[];
  sorting: 'done' | 'noAi' | 'failed' | 'notNeeded' | null;
  preview: ImportPreview | null;
  choices: ImportChoices;
  summary: ImportSummary | null;
}

export type ImportListItem = Pick<ImportView, 'id' | 'status' | 'fileNames' | 'createdAt' | 'finishedAt' | 'undoneAt' | 'error' | 'progress' | 'summary'>;

export interface UndoPlan {
  kinds: Array<{ kind: UndoKind; created: number; updated: number; kept: number; changedSince: Array<{ name: string; fields: string[] }>; editedSince: number }>;
  blockers: Array<{ kind: UndoKind; usedBy: string; count: number; names: string[] }>;
}

export interface SpotRow {
  name: string;
  file: Record<string, Cell>;
  now: Record<string, Cell>;
}

/** A file as the browser read it, ready to send. */
export interface PickedFile {
  name: string;
  file: File;
}

/** More than the server takes at once (30 MB): stopped before reading or sending anything. */
export const MAX_IMPORT_BYTES = 30 * 1024 * 1024;
export class TooBig extends Error {
  readonly bytes: number;
  constructor(bytes: number) {
    super('Too big');
    this.bytes = bytes;
  }
}

/** Every dropped file was history or not a spreadsheet: nothing to read. */
export class NothingToSend extends Error {
  readonly leftOut: Array<{ file: string; why: string }>;
  constructor(leftOut: Array<{ file: string; why: string }>) {
    super('Nothing to read');
    this.leftOut = leftOut;
  }
}

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file'));
    reader.readAsDataURL(file);
  });
}

export const importsApi = {
  list: async () => (await apiRequest<ImportListItem[]>('/imports')).data,
  get: async (id: number) => (await apiRequest<ImportView>(`/imports/${id}`)).data,
  /** Sends only the files 4VD needs (history files are left out by name), then reads them. */
  async create(files: PickedFile[]): Promise<ImportView> {
    const { send, leaveOut } = (await apiRequest<{ send: string[]; leaveOut: Array<{ file: string; why: string }> }>('/imports/wanted', { method: 'POST', body: { names: files.map((f) => f.name) } })).data;
    const wanted = files.filter((f) => send.includes(f.name));
    if (wanted.length === 0) throw new NothingToSend(leaveOut);
    const bytes = wanted.reduce((sum, f) => sum + f.file.size, 0);
    if (bytes > MAX_IMPORT_BYTES) throw new TooBig(bytes);
    const encoded = await Promise.all(wanted.map(async (f) => ({ name: f.name, data: await toBase64(f.file) })));
    return (await apiRequest<ImportView>('/imports', { method: 'POST', body: { files: encoded, notSent: leaveOut.filter((l) => l.why !== 'notSpreadsheet') } })).data;
  },
  setChoices: async (id: number, choices: ImportChoices) => (await apiRequest<ImportView>(`/imports/${id}/choices`, { method: 'PUT', body: choices })).data,
  run: async (id: number) => (await apiRequest<ImportView>(`/imports/${id}/run`, { method: 'POST' })).data,
  discard: async (id: number) => {
    await apiRequest<null>(`/imports/${id}`, { method: 'DELETE' });
  },
  undoPlan: async (id: number, kinds?: UndoKind[]) => (await apiRequest<UndoPlan>(`/imports/${id}/undo`, { query: kinds ? { kinds: kinds.join(',') } : undefined })).data,
  undo: async (id: number, kinds: UndoKind[]) => (await apiRequest<ImportView>(`/imports/${id}/undo`, { method: 'POST', body: { kinds } })).data,
  spotCheck: async (id: number) => (await apiRequest<SpotRow[]>(`/imports/${id}/spot-check`)).data,
  markChecked: async (id: number) => {
    await apiRequest<null>(`/imports/${id}/checked`, { method: 'POST' });
  },
  async downloadProblems(id: number): Promise<void> {
    const { blob, filename } = await apiDownload(`/imports/${id}/problems.xlsx`);
    saveDownload(blob, filename ?? `import-${id}-problems.xlsx`);
  },
  async downloadTemplate(): Promise<void> {
    const { blob, filename } = await apiDownload('/imports/template');
    saveDownload(blob, filename ?? '4vd-import-template.xlsx');
  },
};
