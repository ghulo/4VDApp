import ExcelJS from 'exceljs';
import { sql } from 'kysely';
import type { DatabaseClient } from '../../database/connection.js';
import { currentBusinessId, runAsBusiness } from '../../database/businessContext.js';
import type { ImportStatus } from '../../database/types.js';
import { ConflictError, NotFoundError, ValidationError } from '../../errors/httpErrors.js';
import { ActivityLogRepository } from '../../repositories/ActivityLogRepository.js';
import { placeUnlocatedStock } from '../../repositories/LocationRepository.js';
import { NotificationRepository } from '../../repositories/NotificationRepository.js';
import { countryFromBarcode } from '../../utils/barcodeCountry.js';
import { logger } from '../../utils/logger.js';
import { roundMoney } from '../../utils/money.js';
import { describeProductChanges, type ProductSnapshot } from '../activity/describeProductChanges.js';
import type { AiProvider } from '../ai/aiProvider.js';
import type { OpeningService } from '../OpeningService.js';
import {
  type Choices,
  type Existing,
  fileHealth,
  OTHER_CATEGORY,
  plan as makePlan,
  type Plan,
  PROBLEM_CHOICES,
  type ProblemKey,
  recognise,
  type Recognised,
} from './analyse.js';
import { categorise, categoryList } from './categorise.js';
import { type Field, type ImportKind, PROFILES, baseName } from './fields.js';
import { type FileNote, type ReadSheet, readFiles } from './files.js';

/**
 * Settings → Import. One import is one batch: the files are read and kept as
 * a draft, the person checks the preview and picks what to do with each
 * problem, then it runs in the background in one transaction (nothing is
 * ever half done). Every row it creates or changes is recorded, so Undo can
 * remove the new ones and put the old values back on the changed ones,
 * keeping whatever has been used since (sold, on a bill, paid…).
 */

/** At most this much is sent in one import (base64 is a third bigger on the wire). */
export const MAX_IMPORT_BYTES = 30 * 1024 * 1024;
const CHUNK = 500;
/** A cached preview is reused this long while the person reads it. */
const PREVIEW_TTL_MS = 60_000;
/** Undo keeps these with the row they belong to (they mean nothing on their own). */
const OWNED = new Set(['inventory', 'location_stock', 'product_duplicate_flags', 'favorites', 'product_barcodes', 'bulk_pricing_tiers', 'opening_lines']);

export type UndoKind = 'products' | 'suppliers' | 'customers';
export const UNDO_KINDS: UndoKind[] = ['products', 'suppliers', 'customers'];

interface Draft {
  sheets: ReadSheet[];
  notes: FileNote[];
  recognised: Recognised;
  /** Files the browser didn't send, because 4VD knows they're history or not needed. */
  /** Files the browser left out by name (and older drafts kept plain names, read as history). */
  notSent: Array<LeftOut | string>;
  /** product code (or row) → category, from the AI sort. */
  guesses: Record<string, string>;
  sorting: 'done' | 'noAi' | 'failed' | 'notNeeded';
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
  createdAt: Date;
  finishedAt: Date | null;
  undoneAt: Date | null;
  error: string | null;
  progress: { phase: 'sorting' | 'writing' | 'undoing'; done: number; total: number } | null;
  health: ReturnType<typeof fileHealth>;
  sorting: Draft['sorting'] | null;
  preview: Plan['preview'] | null;
  choices: Choices;
  summary: ImportSummary | null;
}

export interface Blocker {
  kind: UndoKind;
  /** The table that uses the row: sales, bill_lines, supplier_payments… The dashboard words it. */
  usedBy: string;
  count: number;
  names: string[];
}

export interface UndoPlan {
  kinds: Array<{ kind: UndoKind; created: number; updated: number; kept: number; changedSince: Array<{ name: string; fields: string[] }>; editedSince: number }>;
  blockers: Blocker[];
}

interface Job {
  phase: 'sorting' | 'writing' | 'undoing';
  done: number;
  total: number;
}

type TrackedRow = { kind: string; table: string; rowId: number; action: 'created' | 'updated'; before?: unknown; after?: unknown };

const PRODUCT_COLUMNS = { name: 'name', price: 'base_price', cost: 'cost_price', wholesale: 'wholesale_price', vat: 'vat_rate', category: 'category_id' } as const;

export class ImportService {
  /** Imports running in this process; a "running" batch missing here was cut off by a restart. */
  private readonly jobs = new Map<number, Job>();
  private readonly previews = new Map<number, { key: string; at: number; plan: Plan }>();
  private foreignKeys: Array<{ ref: string; table: string; column: string; hasId: boolean }> | null = null;

  constructor(
    private readonly db: DatabaseClient,
    private readonly opening: OpeningService,
    private readonly ai: AiProvider | null,
  ) {}

  /**
   * Of the files in a drop, the ones worth sending: the rest are history 4VD
   * leaves out, or not spreadsheets. In a known program's export folder only
   * that program's own files go; its subfolders (raw tables, backups) are set
   * aside as one line each, so a 470 MB export folder sends under 1 MB.
   */
  wanted(names: string[]): { send: string[]; leaveOut: Array<{ file: string; why: LeftOut['why'] | 'notSpreadsheet' }> } {
    const send: string[] = [];
    const leaveOut: Array<{ file: string; why: LeftOut['why'] | 'notSpreadsheet' }> = [];
    const isSheet = (base: string) => /\.(csv|txt|tsv|xlsx|xlsm|xls|zip)$/i.test(base);
    const depth = (name: string) => name.split('/').length - 1;
    const own = (base: string) => PROFILES.some((profile) => profile.files.some((file) => file.name.test(base)) || profile.categories?.name.test(base));
    const ownDepths = names.filter((name) => own(baseName(name))).map(depth);
    const exportDepth = ownDepths.length > 0 ? Math.min(...ownDepths) : null;
    const folders = new Set<string>();
    for (const name of names) {
      const base = baseName(name);
      if (exportDepth !== null && depth(name) > exportDepth) {
        const folder = name.split('/').slice(0, exportDepth + 1).join('/');
        if (!folders.has(folder)) {
          folders.add(folder);
          leaveOut.push({ file: folder, why: 'otherData' });
        }
        continue;
      }
      const known = PROFILES.flatMap((profile) => profile.leftOut).find((item) => item.name.test(base));
      if (known) leaveOut.push({ file: name, why: known.why });
      else if (!isSheet(base)) leaveOut.push({ file: name, why: 'notSpreadsheet' });
      else if (exportDepth !== null && !own(base)) leaveOut.push({ file: name, why: 'notNeeded' });
      else send.push(name);
    }
    return { send, leaveOut };
  }

  /** Reads the files into a new batch; sorting products into categories goes on in the background. */
  async create(files: Array<{ name: string; data: string }>, notSent: LeftOut[], actorId: number): Promise<ImportView> {
    if (files.length === 0) throw new ValidationError('Add at least one file.');
    const decoded = files.map((file) => ({ name: file.name.slice(0, 200), bytes: Buffer.from(file.data, 'base64') }));
    const total = decoded.reduce((sum, file) => sum + file.bytes.length, 0);
    if (total > MAX_IMPORT_BYTES) throw new ValidationError(`The files are bigger than ${MAX_IMPORT_BYTES / 1024 / 1024} MB together. Leave out sales history and send only products, suppliers and customers.`);
    const read = await readFiles(decoded);
    const layouts = await this.db.selectFrom('import_layouts').select(['signature', 'kind', 'header_row', 'mapping']).execute();
    const recognised = recognise(
      read.sheets,
      layouts.map((layout) => ({ signature: layout.signature, kind: layout.kind as ImportKind, headerRow: layout.header_row, mapping: layout.mapping as Partial<Record<Field, number>> })),
    );
    // History files read inside a zip are left out too: keep their headings only, so the draft stays small.
    const leftOut = new Set(recognised.leftOut.map((item) => item.file));
    const sheets = read.sheets.map((sheet) => (leftOut.has(sheet.file) ? { ...sheet, rows: sheet.rows.slice(0, 1) } : sheet));
    const draft: Draft = { sheets, notes: read.notes, recognised, notSent: [...notSent.slice(0, 50), ...read.leftOut.slice(0, 50).map((file) => ({ file, why: leftOutWhy(file) }))], guesses: {}, sorting: 'notNeeded' };

    const existing = await this.existing(this.db);
    const first = makePlan(sheets, recognised, existing, {});
    const toSort = first.products.filter((p) => p.action === 'new' && !p.record.category && p.record.name);
    if (toSort.length > 0) draft.sorting = this.ai ? 'done' : 'noAi';

    const batch = await this.db
      .insertInto('import_batches')
      .values({
        status: toSort.length > 0 && this.ai ? 'reading' : 'ready',
        source: recognised.profile?.id ?? 'sheet',
        file_names: [...files.map((file) => file.name.slice(0, 200)), ...notSent.slice(0, 50).map((item) => item.file.slice(0, 200))],
        draft: JSON.stringify(draft),
        created_by: actorId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    if (toSort.length > 0 && this.ai) {
      const businessId = currentBusinessId()!;
      const products = toSort.map((p) => ({ key: p.record.code ?? p.record.rowKey, name: p.record.name! }));
      const job: Job = { phase: 'sorting', done: 0, total: products.length };
      this.jobs.set(batch.id, job);
      void runAsBusiness(businessId, async () => {
        try {
          const { guesses, sorted } = await categorise(this.ai, products, categoryList(existing.categories), (done) => (job.done = done));
          draft.guesses = guesses;
          draft.sorting = sorted ? 'done' : 'failed';
          await this.db.updateTable('import_batches').set({ draft: JSON.stringify(draft), status: 'ready' }).where('id', '=', batch.id).where('status', '=', 'reading').execute();
        } catch (error) {
          logger.error('Import: sorting into categories failed', { batchId: batch.id, error });
          draft.sorting = 'failed';
          await this.db.updateTable('import_batches').set({ draft: JSON.stringify(draft), status: 'ready' }).where('id', '=', batch.id).where('status', '=', 'reading').execute();
        } finally {
          this.jobs.delete(batch.id);
        }
      });
    }
    return this.get(batch.id);
  }

  async list(): Promise<Array<Omit<ImportView, 'health' | 'preview' | 'choices' | 'sorting'>>> {
    const rows = await this.db
      .selectFrom('import_batches')
      .select(['id', 'status', 'file_names', 'created_at', 'finished_at', 'undone_at', 'error', 'summary'])
      .where('status', '!=', 'discarded')
      .orderBy('created_at', 'desc')
      .limit(30)
      .execute();
    const out = [];
    for (const row of rows) {
      const status = await this.settleStale(row.id, row.status);
      out.push({
        id: row.id,
        status,
        fileNames: row.file_names,
        createdAt: row.created_at,
        finishedAt: row.finished_at,
        undoneAt: row.undone_at,
        error: status !== row.status ? STALE_ERROR : row.error,
        progress: this.jobs.get(row.id) ?? null,
        summary: (row.summary as ImportSummary | null) ?? null,
      });
    }
    return out;
  }

  async get(id: number): Promise<ImportView> {
    // The draft can be megabytes: read it only when the preview needs it, not on every progress poll.
    const row = await this.db
      .selectFrom('import_batches')
      .select(['id', 'status', 'file_names', 'created_at', 'finished_at', 'undone_at', 'error', 'choices', 'summary'])
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) throw new NotFoundError(`Import ${id} does not exist`);
    const status = await this.settleStale(row.id, row.status);
    const draft =
      status === 'ready' ? ((await this.db.selectFrom('import_batches').select('draft').where('id', '=', id).executeTakeFirstOrThrow()).draft as Draft | null) : null;
    const choices = (row.choices ?? {}) as Choices;
    let preview: Plan['preview'] | null = null;
    if (draft && status === 'ready') preview = (await this.planFor(id, draft, choices)).preview;
    return {
      id: row.id,
      status,
      fileNames: row.file_names,
      createdAt: row.created_at,
      finishedAt: row.finished_at,
      undoneAt: row.undone_at,
      error: status !== row.status ? STALE_ERROR : row.error,
      progress: this.jobs.get(row.id) ?? null,
      health: draft ? [...fileHealth(draft.notes, draft.recognised), ...draft.notSent.map((item) => ({ key: 'leftOut' as const, ...(typeof item === 'string' ? { file: item, why: 'history' } : item) }))] : [],
      sorting: draft?.sorting ?? null,
      preview,
      choices,
      summary: (row.summary as ImportSummary | null) ?? null,
    };
  }

  /** What the person picked for the problems, the sheets and the stock; the preview follows. */
  async setChoices(id: number, choices: Choices): Promise<ImportView> {
    const row = await this.db.selectFrom('import_batches').select(['status']).where('id', '=', id).executeTakeFirst();
    if (!row) throw new NotFoundError(`Import ${id} does not exist`);
    if (row.status !== 'ready') throw new ConflictError('This import is no longer waiting to be checked.');
    for (const [key, value] of Object.entries(choices.problems ?? {})) {
      if (!(key in PROBLEM_CHOICES) || !PROBLEM_CHOICES[key as ProblemKey].includes(value)) throw new ValidationError(`Unknown choice ${value} for ${key}`);
    }
    await this.db.updateTable('import_batches').set({ choices: JSON.stringify(choices) }).where('id', '=', id).execute();
    return this.get(id);
  }

  async discard(id: number): Promise<void> {
    const result = await this.db
      .updateTable('import_batches')
      .set({ status: 'discarded', draft: null })
      .where('id', '=', id)
      .where('status', 'in', ['reading', 'ready', 'failed'])
      .executeTakeFirst();
    if (Number(result.numUpdatedRows) === 0) throw new ConflictError('Only an import that has not run can be thrown away.');
    this.previews.delete(id);
  }

  /** Starts the import in the background; the dashboard follows its progress. */
  async run(id: number, actorId: number): Promise<ImportView> {
    const started = await this.db
      .updateTable('import_batches')
      .set({ status: 'running', started_at: new Date(), error: null })
      .where('id', '=', id)
      .where('status', '=', 'ready')
      .returning('id')
      .executeTakeFirst();
    if (!started) throw new ConflictError('This import is not ready to run (it may be running already).');
    const businessId = currentBusinessId()!;
    const job: Job = { phase: 'writing', done: 0, total: 1 };
    this.jobs.set(id, job);
    void runAsBusiness(businessId, async () => {
      try {
        await this.execute(id, actorId, job);
      } catch (error) {
        logger.error('Import failed', { batchId: id, error });
        const message = error instanceof Error && 'statusCode' in error ? error.message : 'Something went wrong while importing. Nothing was saved; try again.';
        await this.db.updateTable('import_batches').set({ status: 'ready', error: message, started_at: null }).where('id', '=', id).execute();
      } finally {
        this.jobs.delete(id);
        this.previews.delete(id);
      }
    });
    return this.get(id);
  }

  // ---------- Running ----------

  private async execute(id: number, actorId: number, job: Job): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      const batch = await trx.selectFrom('import_batches').selectAll().where('id', '=', id).forUpdate().executeTakeFirstOrThrow();
      const draft = batch.draft as Draft;
      const choices = (batch.choices ?? {}) as Choices;
      const existing = await this.existing(trx);
      const plan = makePlan(draft.sheets, draft.recognised, existing, choices, draft.guesses);
      const from = draft.recognised.profile?.name ?? null;
      const tracked: TrackedRow[] = [];
      const changed = plan.products.filter((p) => p.action === 'changed');
      const fresh = plan.products.filter((p) => p.action === 'new');
      job.total = fresh.length + changed.length + plan.partners.filter((p) => p.action === 'new').length + 1;

      // Categories
      const categoryRows = await trx.selectFrom('categories').select(['id', 'name']).where('deleted_at', 'is', null).execute();
      const categoryId = new Map(categoryRows.map((row) => [row.name.toLowerCase(), row.id]));
      const needed = new Set([...fresh.map((p) => p.final.category), ...changed.flatMap((p) => p.changes.filter((c) => c.field === 'category').map((c) => String(c.to)))]);
      let categoriesCreated = 0;
      for (const name of needed) {
        if (categoryId.has(name.toLowerCase())) continue;
        const created = await trx.insertInto('categories').values({ name: name.slice(0, 100), description: null }).returning('id').executeTakeFirstOrThrow();
        categoryId.set(name.toLowerCase(), created.id);
        tracked.push({ kind: 'products', table: 'categories', rowId: created.id, action: 'created', after: { name } });
        categoriesCreated++;
      }

      // New products, their stock and barcodes
      const taken = new Set((await sql<{ barcode: string }>`select barcode from products where barcode is not null and deleted_at is null union select barcode from product_barcodes`.execute(trx)).rows.map((r) => r.barcode));
      const skus = new Set((await trx.selectFrom('products').select('sku').where('sku', 'is not', null).where('deleted_at', 'is', null).execute()).map((r) => r.sku!));
      const productIdByRow = new Map<string, number>();
      let stockValue = 0;
      for (let i = 0; i < fresh.length; i += CHUNK) {
        const chunk = fresh.slice(i, i + CHUNK);
        const rows = chunk.map((p) => {
          const barcode = p.final.barcode && !taken.has(p.final.barcode) ? p.final.barcode : null;
          if (barcode) taken.add(barcode);
          const sku = p.record.code && !skus.has(p.record.code) ? p.record.code : null;
          if (sku) skus.add(sku);
          return {
            name: p.record.name!.slice(0, 255),
            description: null,
            category_id: categoryId.get(p.final.category.toLowerCase()) ?? categoryId.get(OTHER_CATEGORY.toLowerCase())!,
            base_price: p.final.price,
            cost_price: p.final.cost,
            wholesale_price: p.record.wholesale && p.record.wholesale > 0 && Math.abs(p.record.wholesale - p.final.price) >= 0.005 ? roundMoney(p.record.wholesale) : null,
            sku,
            barcode,
            vat_rate: p.final.vat,
            unit: p.record.unit,
            origin_country: countryFromBarcode(barcode),
            is_active: p.final.active,
          };
        });
        const inserted = await trx.insertInto('products').values(rows).returning('id').execute();
        chunk.forEach((p, n) => productIdByRow.set(p.record.rowKey, inserted[n]!.id));
        await trx
          .insertInto('inventory')
          .values(chunk.map((p) => ({ product_id: productIdByRow.get(p.record.rowKey)!, quantity_on_hand: p.final.stock, reorder_level: Math.max(0, Math.round(p.record.reorder ?? 0)) })))
          .execute();
        const others = chunk.flatMap((p) =>
          p.record.otherBarcodes.filter((code) => !taken.has(code) && taken.add(code)).map((code) => ({ product_id: productIdByRow.get(p.record.rowKey)!, barcode: code, added_by: actorId })),
        );
        if (others.length > 0) await trx.insertInto('product_barcodes').values(others).execute();
        chunk.forEach((p, n) => {
          stockValue += p.final.stock * (p.final.cost ?? 0);
          tracked.push({ kind: 'products', table: 'products', rowId: inserted[n]!.id, action: 'created', after: { rowKey: p.record.rowKey, ...productAfter(rows[n]!) } });
        });
        job.done += chunk.length;
      }
      if (fresh.length > 0) await placeUnlocatedStock(trx);

      // Products 4VD had: only what the file says differently; the old values are kept for Undo.
      const activity = new ActivityLogRepository(trx);
      for (const p of changed) {
        const current = await trx
          .selectFrom('products')
          .select(['id', 'name', 'description', 'base_price', 'cost_price', 'wholesale_price', 'vat_rate', 'category_id', 'image_url', 'sku', 'is_active', 'vat_exempt', 'origin_country'])
          .where('id', '=', p.existingId!)
          .where('deleted_at', 'is', null)
          .forUpdate()
          .executeTakeFirst();
        if (!current) continue;
        const before = productAfter(current);
        const set: Record<string, string | number | null> = {};
        for (const change of p.changes) {
          if (change.field === 'category') set.category_id = categoryId.get(String(change.to).toLowerCase())!;
          else set[PRODUCT_COLUMNS[change.field]] = change.to;
        }
        await trx.updateTable('products').set(set).where('id', '=', current.id).execute();
        const after = { ...before, ...normaliseProduct(set) };
        tracked.push({ kind: 'products', table: 'products', rowId: current.id, action: 'updated', before, after });
        const described = describeProductChanges(snapshot(current, before), snapshot(current, after));
        if (described) {
          await activity.create({
            userId: actorId,
            action: 'product.updated',
            entityType: 'product',
            entityId: current.id,
            say: described.say,
            details: { ...described.details, source: 'import', importId: id },
          });
        }
        job.done++;
      }

      // Suppliers and customers, and what is owed
      const books = await this.opening.bookState(trx);
      const asOpening = books.startDay !== null && !books.openingPosted;
      const owed = { suppliers: 0, customers: 0 };
      let suppliers = 0;
      let customers = 0;
      for (const p of plan.partners) {
        if (p.action !== 'new') continue;
        const r = p.record;
        const amount = r.owed ? roundMoney(r.owed) : 0;
        const kept = amount !== 0 && !asOpening ? owedNote(p.kind, amount, from) : null;
        const common = {
          name: r.name!.slice(0, 200),
          nui: r.nui,
          phone: r.phone ?? r.mobile,
          note: kept,
          external_code: r.code,
          address: r.address,
          city: r.city,
          business_no: r.businessNo,
          fiscal_no: r.fiscalNo,
          vat_no: r.vatNo,
          iban: r.iban,
          contact_person: r.contact,
          mobile: r.mobile,
        };
        let partnerId: number;
        if (p.kind === 'suppliers') {
          partnerId = (await trx.insertInto('suppliers').values({ ...common, email: r.email }).returning('id').executeTakeFirstOrThrow()).id;
          suppliers++;
        } else {
          partnerId = (
            await trx
              .insertInto('customers')
              .values({ ...common, kind: r.nui || r.businessNo ? 'business' : 'person', credit_limit: r.creditLimit, discount_percent: r.discount, created_by: actorId })
              .returning('id')
              .executeTakeFirstOrThrow()
          ).id;
          customers++;
        }
        tracked.push({ kind: p.kind, table: p.kind, rowId: partnerId, action: 'created', after: { name: r.name } });
        if (amount !== 0) {
          owed[p.kind] += amount;
          if (asOpening) {
            const written = await this.opening.bringOverPartner(trx, { kind: p.kind === 'suppliers' ? 'supplier' : 'customer', partnerId, owed: amount, startDay: books.startDay!, from: from ?? 'your file', actorId });
            for (const row of written) tracked.push({ kind: p.kind, table: row.table, rowId: row.id, action: 'created', after: { partnerId } });
          }
        }
        job.done++;
      }

      // Look-alike names go to Possible duplicates.
      let similar = 0;
      for (const pair of plan.similarPairs) {
        const a = productIdByRow.get(pair.a);
        const b = typeof pair.b === 'number' ? pair.b : productIdByRow.get(pair.b);
        if (!a || !b || a === b) continue;
        const result = await sql`
          insert into product_duplicate_flags (product_id, other_product_id, reason, similarity)
          values (${Math.min(a, b)}, ${Math.max(a, b)}, 'very similar name', ${pair.similarity})
          on conflict do nothing
        `.execute(trx);
        similar += Number(result.numAffectedRows ?? 0);
      }

      // Layouts of files 4VD didn't know, so the next one like it is read by itself.
      for (const sheet of draft.recognised.sheets) {
        if (draft.recognised.profile || sheet.kind === 'skip') continue;
        const override = choices.sheets?.[sheet.key];
        const kind = override?.kind ?? sheet.kind;
        if (kind === 'skip') continue;
        const mapping = { ...sheet.mapping };
        for (const [field, column] of Object.entries(override?.mapping ?? {})) {
          if (column === undefined || column < 0) delete mapping[field as Field];
          else mapping[field as Field] = column;
        }
        await trx
          .insertInto('import_layouts')
          .values({ signature: sheet.signature, kind, header_row: sheet.headerRow, mapping: JSON.stringify(mapping), updated_by: actorId })
          .onConflict((oc) => oc.columns(['business_id', 'signature']).doUpdateSet({ kind, header_row: sheet.headerRow, mapping: JSON.stringify(mapping), updated_by: actorId, updated_at: new Date() }))
          .execute();
      }

      for (let i = 0; i < tracked.length; i += 1000) {
        await trx
          .insertInto('import_batch_rows')
          .values(
            tracked.slice(i, i + 1000).map((row) => ({
              batch_id: id,
              kind: row.kind,
              table_name: row.table,
              row_id: row.rowId,
              action: row.action,
              before: row.before === undefined ? null : JSON.stringify(row.before),
              after: row.after === undefined ? null : JSON.stringify(row.after),
            })),
          )
          .execute();
      }

      const counts = plan.preview.counts.products;
      const summary: ImportSummary = {
        from,
        products: { created: fresh.length, changed: changed.length, same: counts.same, skipped: counts.skipped },
        categories: categoriesCreated,
        suppliers,
        customers,
        stockValue: roundMoney(stockValue),
        owed: { suppliers: roundMoney(owed.suppliers), customers: roundMoney(owed.customers), asOpening },
        similar,
      };
      await trx.updateTable('import_batches').set({ status: 'done', finished_at: new Date(), summary: JSON.stringify(summary), error: null }).where('id', '=', id).execute();
      await activity.create({
        userId: actorId,
        action: 'import.done',
        entityType: 'import',
        entityId: id,
        say: { key: 'importDone', params: { from, products: fresh.length, changed: changed.length, suppliers, customers } },
        details: { files: batch.file_names },
      });
      await new NotificationRepository(trx).createForUser(actorId, {
        type: 'import_done',
        write: (t) => ({ title: t.importDoneTitle, message: t.importDoneMessage({ products: fresh.length, changed: changed.length, suppliers, customers }) }),
        link: `/settings/import?batch=${id}`,
      });
      job.done = job.total;
    });
  }

  // ---------- Undo ----------

  /** What Undo would do for the chosen kinds: how many go, how many go back, and what stays because it's been used. */
  async undoPlan(id: number, kinds: UndoKind[] = UNDO_KINDS, db: DatabaseClient = this.db): Promise<UndoPlan & { keep: Set<string> }> {
    const batch = await db.selectFrom('import_batches').select(['status']).where('id', '=', id).executeTakeFirst();
    if (!batch) throw new NotFoundError(`Import ${id} does not exist`);
    if (batch.status !== 'done' && batch.status !== 'partly_undone') throw new ConflictError('Only a finished import can be undone.');
    const rows = await db
      .selectFrom('import_batch_rows')
      .select(['id', 'kind', 'table_name', 'row_id', 'action', 'before', 'after'])
      .where('batch_id', '=', id)
      .where('undone_at', 'is', null)
      .where('kind', 'in', kinds)
      .execute();

    const created = new Map<string, number[]>();
    for (const row of rows) if (row.action === 'created') created.set(row.table_name, [...(created.get(row.table_name) ?? []), row.row_id]);
    const keep = new Set<string>();
    const blockers: Blocker[] = [];
    const fks = await this.loadForeignKeys(db);
    const kindOf = (table: string): UndoKind => (table === 'suppliers' || table === 'supplier_bills' ? 'suppliers' : table === 'customers' || table === 'tab_entries' ? 'customers' : 'products');

    // Rows something else uses (a sale, a bill line, a payment) stay; categories go only when nothing is left in them.
    for (const table of ['supplier_bills', 'tab_entries', 'products', 'suppliers', 'customers']) {
      const ids = created.get(table) ?? [];
      if (ids.length === 0) continue;
      // Each row is named once, by the use that says most (a sale before the stock movement it made).
      const usedIds = new Map<number, string>();
      const byPriority = fks.filter((f) => f.ref === table && !OWNED.has(f.table)).sort((a, b) => usePriority(a.table) - usePriority(b.table));
      for (const fk of byPriority) {
        const mine = fk.hasId ? (created.get(fk.table) ?? []) : [];
        const result = await sql<{ target: number }>`
          select distinct ${sql.ref(fk.column)} as target from ${sql.table(fk.table)}
          where ${sql.ref(fk.column)} = any(${ids}::int[]) ${mine.length > 0 ? sql`and id <> all(${mine}::int[])` : sql``}
        `.execute(db);
        const fresh = result.rows.map((r) => r.target).filter((target) => !usedIds.has(target));
        if (fresh.length === 0) continue;
        for (const target of fresh) usedIds.set(target, fk.table);
        blockers.push({ kind: kindOf(table), usedBy: fk.table, count: fresh.length, names: await this.names(db, table, fresh.slice(0, 8)) });
      }
      for (const target of usedIds.keys()) keep.add(`${table}:${target}`);
    }
    // A bill or tab charge that stays keeps its partner, and a partner that stays keeps what it was brought over with.
    const partnerOf = async (table: 'supplier_bills' | 'tab_entries' | 'opening_lines', ids: number[]) =>
      ids.length === 0
        ? []
        : (
            await sql<{ id: number; supplier_id: number | null; customer_id: number | null }>`
              select id, ${table === 'tab_entries' ? sql`null::int` : sql`supplier_id`} as supplier_id, ${table === 'supplier_bills' ? sql`null::int` : sql`customer_id`} as customer_id
              from ${sql.table(table)} where id = any(${ids}::int[])
            `.execute(db)
          ).rows;
    const owedRows = [
      ...(await partnerOf('supplier_bills', created.get('supplier_bills') ?? [])).map((r) => ({ ...r, table: 'supplier_bills' })),
      ...(await partnerOf('tab_entries', created.get('tab_entries') ?? [])).map((r) => ({ ...r, table: 'tab_entries' })),
      ...(await partnerOf('opening_lines', created.get('opening_lines') ?? [])).map((r) => ({ ...r, table: 'opening_lines' })),
    ];
    for (const row of owedRows) {
      if (keep.has(`${row.table}:${row.id}`)) {
        if (row.supplier_id) keep.add(`suppliers:${row.supplier_id}`);
        if (row.customer_id) keep.add(`customers:${row.customer_id}`);
      }
    }
    for (const row of owedRows) {
      if ((row.supplier_id && keep.has(`suppliers:${row.supplier_id}`)) || (row.customer_id && keep.has(`customers:${row.customer_id}`))) keep.add(`${row.table}:${row.id}`);
    }

    // Files attached to a supplier or customer since (not a foreign key: attachments point at any kind of row).
    for (const table of ['suppliers', 'customers'] as const) {
      const ids = (created.get(table) ?? []).filter((target) => !keep.has(`${table}:${target}`));
      if (ids.length === 0) continue;
      const result = await sql<{ target: number }>`
        select distinct entity_id as target from attachments
        where entity_type = ${table === 'suppliers' ? 'supplier' : 'customer'} and entity_id = any(${ids}::int[]) and removed_at is null
      `.execute(db);
      if (result.rows.length === 0) continue;
      for (const row of result.rows) keep.add(`${table}:${row.target}`);
      blockers.push({ kind: table, usedBy: 'attachments', count: result.rows.length, names: await this.names(db, table, result.rows.slice(0, 8).map((r) => r.target)) });
    }
    // Once the opening balances are posted, the stock it brought in is in the books: those products stay.
    const productIds = (created.get('products') ?? []).filter((target) => !keep.has(`products:${target}`));
    if (productIds.length > 0 && (await this.opening.bookState(db)).openingPosted) {
      const stocked = await sql<{ target: number }>`
        select product_id as target from inventory where product_id = any(${productIds}::int[]) and quantity_on_hand > 0
      `.execute(db);
      if (stocked.rows.length > 0) {
        for (const row of stocked.rows) keep.add(`products:${row.target}`);
        blockers.push({ kind: 'products', usedBy: 'openingPosted', count: stocked.rows.length, names: await this.names(db, 'products', stocked.rows.slice(0, 8).map((r) => r.target)) });
      }
    }
    // A partner kept for an attachment keeps what it was brought over with.
    for (const row of owedRows) {
      if ((row.supplier_id && keep.has(`suppliers:${row.supplier_id}`)) || (row.customer_id && keep.has(`customers:${row.customer_id}`))) keep.add(`${row.table}:${row.id}`);
    }

    // Changed products: put back unless someone has changed them again since.
    const changedSince: Record<UndoKind, Array<{ name: string; fields: string[] }>> = { products: [], suppliers: [], customers: [] };
    const updated = rows.filter((row) => row.action === 'updated');
    if (updated.length > 0) {
      const current = await db
        .selectFrom('products')
        .select(['id', 'name', 'base_price', 'cost_price', 'wholesale_price', 'vat_rate', 'category_id', 'deleted_at'])
        .where('id', 'in', updated.map((row) => row.row_id))
        .execute();
      const byId = new Map(current.map((row) => [row.id, row]));
      for (const row of updated) {
        const now = byId.get(row.row_id);
        if (!now || now.deleted_at) {
          keep.add(`gone:${row.id}`);
          continue;
        }
        const after = row.after as Record<string, unknown>;
        const fields = Object.keys(after).filter((field) => JSON.stringify(productAfter(now)[field as keyof ReturnType<typeof productAfter>]) !== JSON.stringify(after[field]));
        if (fields.length > 0) {
          keep.add(`products:${row.row_id}`);
          changedSince.products.push({ name: now.name, fields });
        }
      }
    }

    // New products someone edited since (they still go; the dialog says so).
    let editedSince = 0;
    const createdProducts = rows.filter((row) => row.action === 'created' && row.table_name === 'products' && !keep.has(`products:${row.row_id}`));
    if (createdProducts.length > 0) {
      const current = await db
        .selectFrom('products')
        .select(['id', 'name', 'base_price', 'cost_price', 'wholesale_price', 'vat_rate', 'category_id'])
        .where('id', 'in', createdProducts.map((row) => row.row_id))
        .execute();
      const byId = new Map(current.map((row) => [row.id, row]));
      for (const row of createdProducts) {
        const now = byId.get(row.row_id);
        if (!now) continue;
        const after = row.after as Record<string, unknown>;
        const mine = productAfter(now);
        if ((['name', 'price', 'cost', 'wholesale', 'vat'] as const).some((field) => JSON.stringify(mine[field]) !== JSON.stringify(after[field]))) editedSince++;
      }
    }

    const summaryFor = (kind: UndoKind) => {
      const own = rows.filter((row) => row.table_name === kind);
      const keptCount = own.filter((row) => keep.has(`${row.table_name}:${row.row_id}`)).length;
      return {
        kind,
        created: own.filter((row) => row.action === 'created').length,
        updated: own.filter((row) => row.action === 'updated').length,
        kept: keptCount,
        changedSince: changedSince[kind],
        editedSince: kind === 'products' ? editedSince : 0,
      };
    };
    return { kinds: kinds.map(summaryFor), blockers, keep };
  }

  /** Takes the import back for the chosen kinds, in one transaction; what has been used since stays. */
  async undo(id: number, kinds: UndoKind[], actorId: number): Promise<ImportView> {
    if (kinds.length === 0) throw new ValidationError('Pick what to undo.');
    const job: Job = { phase: 'undoing', done: 0, total: 1 };
    this.jobs.set(id, job);
    try {
      await this.db.transaction().execute(async (trx) => {
        const batch = await trx.selectFrom('import_batches').select(['id', 'summary']).where('id', '=', id).forUpdate().executeTakeFirst();
        if (!batch) throw new NotFoundError(`Import ${id} does not exist`);
        const activity = new ActivityLogRepository(trx);
        const undo = await this.undoPlan(id, kinds, trx);
        const { keep } = undo;
        const rows = await trx
          .selectFrom('import_batch_rows')
          .select(['id', 'table_name', 'row_id', 'action', 'before'])
          .where('batch_id', '=', id)
          .where('undone_at', 'is', null)
          .where('kind', 'in', kinds)
          .execute();
        job.total = rows.length;
        const done: string[] = [];
        let removed = 0;
        let restored = 0;

        // Changed products get their old values back.
        for (const row of rows.filter((r) => r.action === 'updated')) {
          if (keep.has(`gone:${row.id}`)) {
            done.push(row.id);
            continue;
          }
          if (keep.has(`products:${row.row_id}`)) continue;
          const before = row.before as ReturnType<typeof productAfter>;
          const current = await trx
            .selectFrom('products')
            .select(['id', 'name', 'description', 'base_price', 'cost_price', 'wholesale_price', 'vat_rate', 'category_id', 'image_url', 'sku', 'is_active', 'vat_exempt', 'origin_country'])
            .where('id', '=', row.row_id)
            .executeTakeFirstOrThrow();
          await trx
            .updateTable('products')
            .set({ name: before.name, base_price: before.price, cost_price: before.cost, wholesale_price: before.wholesale, vat_rate: before.vat, category_id: before.category })
            .where('id', '=', row.row_id)
            .execute();
          const described = describeProductChanges(snapshot(current, productAfter(current)), snapshot(current, before));
          if (described) {
            await activity.create({ userId: actorId, action: 'product.updated', entityType: 'product', entityId: current.id, say: described.say, details: { ...described.details, source: 'importUndo', importId: id } });
          }
          restored++;
          done.push(row.id);
        }

        // New rows go, children first. A row already gone (merged, replaced) just counts as undone.
        const order = ['opening_lines', 'tab_entries', 'supplier_bills', 'products', 'suppliers', 'customers'];
        for (const table of order) {
          const mine = rows.filter((r) => r.action === 'created' && r.table_name === table);
          const going = mine.filter((r) => !keep.has(`${table}:${r.row_id}`));
          if (going.length === 0) continue;
          const result = await sql`delete from ${sql.table(table)} where id = any(${going.map((r) => r.row_id)}::int[])`.execute(trx);
          if (table === 'products' || table === 'suppliers' || table === 'customers') removed += Number(result.numAffectedRows ?? 0);
          done.push(...going.map((r) => r.id));
          job.done += going.length;
        }
        // Categories it made go once nothing is left in them.
        const categories = rows.filter((r) => r.action === 'created' && r.table_name === 'categories');
        if (categories.length > 0) {
          const ids = categories.map((r) => r.row_id);
          const busy = await sql<{ id: number }>`
            select c.id from categories c where c.id = any(${ids}::int[]) and (
              exists (select 1 from products p where p.category_id = c.id)
              or exists (select 1 from promotions x where x.category_id = c.id)
              or exists (select 1 from stock_counts x where x.category_id = c.id)
              or exists (select 1 from customers x where c.id = any(x.portal_categories))
            )
          `.execute(trx);
          const stay = new Set(busy.rows.map((r) => r.id));
          const going = categories.filter((r) => !stay.has(r.row_id));
          if (going.length > 0) {
            await sql`delete from categories where id = any(${going.map((r) => r.row_id)}::int[])`.execute(trx);
            done.push(...going.map((r) => r.id));
          }
        }
        if (done.length > 0) await trx.updateTable('import_batch_rows').set({ undone_at: new Date() }).where('id', 'in', done).execute();

        const left = await trx.selectFrom('import_batch_rows').select((eb) => eb.fn.countAll<string>().as('n')).where('batch_id', '=', id).where('undone_at', 'is', null).executeTakeFirstOrThrow();
        const kept = undo.kinds.reduce((sum, k) => sum + k.kept, 0);
        const summary = { ...(batch.summary as ImportSummary), undo: { removed, restored, kept, changedSince: undo.kinds.reduce((sum, k) => sum + k.changedSince.length, 0) } };
        const allGone = Number(left.n) === 0;
        await trx
          .updateTable('import_batches')
          .set({ status: allGone ? 'undone' : 'partly_undone', undone_at: new Date(), undone_by: actorId, summary: JSON.stringify(summary), ...(allGone && { draft: null }) })
          .where('id', '=', id)
          .execute();
        await activity.create({
          userId: actorId,
          action: 'import.undone',
          entityType: 'import',
          entityId: id,
          say: { key: 'importUndone', params: { from: (batch.summary as ImportSummary | null)?.from ?? null, removed, restored, kept } },
          details: { kinds },
        });
      });
    } finally {
      this.jobs.delete(id);
    }
    return this.get(id);
  }

  // ---------- After the import ----------

  /** A handful of new products side by side with the file, so the person can check by eye that it came in right. */
  async spotCheck(id: number): Promise<Array<{ name: string; file: Record<string, string | number | null>; now: Record<string, string | number | null> }>> {
    const batch = await this.db.selectFrom('import_batches').select(['draft', 'status']).where('id', '=', id).executeTakeFirst();
    if (!batch) throw new NotFoundError(`Import ${id} does not exist`);
    const rows = await sql<{ row_id: number; after: { rowKey: string } }>`
      select row_id, after from import_batch_rows
      where batch_id = ${id} and table_name = 'products' and action = 'created' and undone_at is null
      order by random() limit 8
    `.execute(this.db);
    if (rows.rows.length === 0) return [];
    const draft = batch.draft as Draft | null;
    const products = await sql<{ id: number; name: string; base_price: string; cost_price: string | null; barcode: string | null; quantity_on_hand: number | null; category: string }>`
      select p.id, p.name, p.base_price, p.cost_price, p.barcode, i.quantity_on_hand, c.name as category
      from products p join categories c on c.id = p.category_id left join inventory i on i.product_id = p.id
      where p.id = any(${rows.rows.map((r) => r.row_id)}::int[])
    `.execute(this.db);
    const byId = new Map(products.rows.map((p) => [p.id, p]));
    return rows.rows.flatMap((row) => {
      const now = byId.get(row.row_id);
      if (!now) return [];
      const fileRow = draft ? this.fileRow(draft, row.after.rowKey) : null;
      return [
        {
          name: now.name,
          file: fileRow ?? {},
          now: { price: Number(now.base_price), cost: now.cost_price === null ? null : Number(now.cost_price), barcode: now.barcode, stock: now.quantity_on_hand, category: now.category },
        },
      ];
    });
  }

  async markChecked(id: number): Promise<void> {
    await sql`update import_batches set summary = summary || '{"checked": true}'::jsonb where id = ${id} and status = 'done'`.execute(this.db);
  }

  /** The rows with a problem, as an Excel file to fix and import again. */
  async problemRows(id: number): Promise<Buffer> {
    const batch = await this.db.selectFrom('import_batches').select(['draft', 'choices']).where('id', '=', id).executeTakeFirst();
    if (!batch?.draft) throw new NotFoundError('This import has no rows to download any more.');
    const draft = batch.draft as Draft;
    const plan = await this.planFor(id, draft, (batch.choices ?? {}) as Choices);
    const workbook = new ExcelJS.Workbook();
    for (const problem of plan.preview.problems) {
      const bySheet = new Map<number, string[]>();
      for (const key of problem.rowKeys) {
        const [index] = key.split(':');
        bySheet.set(Number(index), [...(bySheet.get(Number(index)) ?? []), key]);
      }
      const sheet = workbook.addWorksheet(PROBLEM_SHEET[problem.key].slice(0, 31));
      let headerDone = false;
      for (const [index, keys] of bySheet) {
        const sheetPlan = draft.recognised.sheets.find((s) => s.index === index);
        if (!sheetPlan) continue;
        if (!headerDone) {
          sheet.addRow(['Rreshti / Row', ...sheetPlan.headers.map(safeCell)]).font = { bold: true };
          headerDone = true;
        }
        for (const key of keys) {
          const row = Number(key.split(':')[1]);
          sheet.addRow([row, ...(draft.sheets[index]?.rows[row - 1] ?? []).map(safeCell)]);
        }
      }
    }
    if (workbook.worksheets.length === 0) workbook.addWorksheet('OK').addRow(['No problems / Asnjë problem']);
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  /** An empty file with the columns 4VD reads best, for a business starting from paper or another sheet. */
  static async template(): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const add = (name: string, headers: string[], example: Array<string | number>) => {
      const sheet = workbook.addWorksheet(name);
      sheet.addRow(headers).font = { bold: true };
      sheet.addRow(example);
      sheet.columns.forEach((column) => (column.width = 18));
    };
    add('Produktet', ['Barkodi', 'Emri', 'Kategoria', 'Çmimi', 'Kosto', 'TVSH', 'Stoku', 'Njësia', 'Kodi'], ['3830000000001', 'Ujë Rugove 0.5L', 'Ujë', 0.5, 0.3, 18, 24, 'copë', 'A001']);
    add('Furnitorët', ['Kodi', 'Emri', 'NUI', 'Telefoni', 'Email', 'Adresa', 'Qyteti', 'Borxhi'], ['F001', 'Shembull SH.P.K.', '810000000', '044 000 000', '', 'Rruga 1', 'Prishtinë', 0]);
    add('Klientët', ['Kodi', 'Emri', 'NUI', 'Telefoni', 'Adresa', 'Qyteti', 'Borxhi', 'Limiti i kreditit'], ['K001', 'Klient Shembull', '', '045 000 000', '', 'Prizren', 0, 0]);
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  // ---------- Helpers ----------

  private async planFor(id: number, draft: Draft, choices: Choices): Promise<Plan> {
    const key = JSON.stringify(choices) + draft.sorting;
    const cached = this.previews.get(id);
    if (cached && cached.key === key && Date.now() - cached.at < PREVIEW_TTL_MS) return cached.plan;
    const plan = makePlan(draft.sheets, draft.recognised, await this.existing(this.db), choices, draft.guesses);
    this.previews.set(id, { key, at: Date.now(), plan });
    if (this.previews.size > 20) this.previews.delete(this.previews.keys().next().value!);
    return plan;
  }

  /** A batch left "running" with no job in this process was cut off by a restart: nothing was saved (one transaction). */
  private async settleStale(id: number, status: ImportStatus): Promise<ImportStatus> {
    if ((status === 'running' || status === 'reading') && !this.jobs.has(id)) {
      await this.db
        .updateTable('import_batches')
        .set({ status: 'ready', error: STALE_ERROR, started_at: null })
        .where('id', '=', id)
        .where('status', '=', status)
        .execute();
      return 'ready';
    }
    return status;
  }

  private async existing(db: DatabaseClient): Promise<Existing> {
    const [products, barcodes, suppliers, customers, categories, books] = await Promise.all([
      db
        .selectFrom('products as p')
        .innerJoin('categories as c', 'c.id', 'p.category_id')
        .select(['p.id', 'p.name', 'p.sku', 'p.barcode', 'p.base_price', 'p.cost_price', 'p.wholesale_price', 'p.vat_rate', 'c.name as category'])
        .where('p.deleted_at', 'is', null)
        .execute(),
      db.selectFrom('product_barcodes').select(['product_id', 'barcode']).execute(),
      db.selectFrom('suppliers').select(['id', 'name', 'external_code', 'nui']).where('archived_at', 'is', null).execute(),
      db.selectFrom('customers').select(['id', 'name', 'external_code', 'nui']).where('archived_at', 'is', null).execute(),
      db.selectFrom('categories').select('name').where('deleted_at', 'is', null).execute(),
      this.opening.bookState(db),
    ]);
    const others = new Map<number, string[]>();
    for (const row of barcodes) others.set(row.product_id, [...(others.get(row.product_id) ?? []), row.barcode]);
    return {
      products: products.map((p) => ({
        id: p.id,
        name: p.name,
        sku: p.sku,
        barcodes: [...(p.barcode ? [p.barcode] : []), ...(others.get(p.id) ?? [])],
        price: Number(p.base_price),
        cost: p.cost_price === null ? null : Number(p.cost_price),
        wholesale: p.wholesale_price === null ? null : Number(p.wholesale_price),
        vat: p.vat_rate,
        category: p.category,
      })),
      suppliers: suppliers.map((s) => ({ id: s.id, name: s.name, code: s.external_code, nui: s.nui })),
      customers: customers.map((c) => ({ id: c.id, name: c.name, code: c.external_code, nui: c.nui })),
      categories: categories.map((c) => c.name),
      books,
    };
  }

  private async loadForeignKeys(db: DatabaseClient) {
    if (this.foreignKeys) return this.foreignKeys;
    const result = await sql<{ ref: string; table: string; column: string; has_id: boolean }>`
      select c.confrelid::regclass::text as ref, c.conrelid::regclass::text as "table", a.attname as "column",
        exists (select 1 from pg_attribute x where x.attrelid = c.conrelid and x.attname = 'id' and not x.attisdropped) as has_id
      from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
      where c.contype = 'f' and array_length(c.conkey, 1) = 1
        and c.confrelid::regclass::text in ('products', 'suppliers', 'customers', 'supplier_bills', 'tab_entries')
    `.execute(db);
    this.foreignKeys = result.rows.map((row) => ({ ref: row.ref, table: row.table, column: row.column, hasId: row.has_id }));
    return this.foreignKeys;
  }

  private async names(db: DatabaseClient, table: string, ids: number[]): Promise<string[]> {
    if (ids.length === 0) return [];
    if (table === 'products' || table === 'suppliers' || table === 'customers') {
      const rows = await sql<{ name: string }>`select name from ${sql.table(table)} where id = any(${ids}::int[]) order by name`.execute(db);
      return rows.rows.map((r) => r.name);
    }
    if (table === 'supplier_bills') {
      const rows = await sql<{ name: string }>`select s.name from supplier_bills b join suppliers s on s.id = b.supplier_id where b.id = any(${ids}::int[])`.execute(db);
      return rows.rows.map((r) => r.name);
    }
    const rows = await sql<{ name: string }>`select c.name from tab_entries t join customers c on c.id = t.customer_id where t.id = any(${ids}::int[])`.execute(db);
    return rows.rows.map((r) => r.name);
  }

  private fileRow(draft: Draft, rowKey: string): Record<string, string | number | null> | null {
    const [index, row] = rowKey.split(':').map(Number);
    const sheetPlan = draft.recognised.sheets.find((s) => s.index === index);
    const cells = draft.sheets[index!]?.rows[row! - 1];
    if (!sheetPlan || !cells) return null;
    const pick = (field: Field) => (sheetPlan.mapping[field] === undefined ? null : (cells[sheetPlan.mapping[field]!] ?? null));
    return { price: pick('price'), cost: pick('cost'), barcode: pick('barcode'), stock: pick('stock'), category: pick('category') };
  }
}

/** A file the browser didn't send, and why: history, worked out by 4VD, or the program's own working files. */
export interface LeftOut {
  file: string;
  why: 'history' | 'notNeeded' | 'otherData';
}

/** Why a file left out of a zip was left out. */
function leftOutWhy(file: string): LeftOut['why'] {
  return PROFILES.flatMap((profile) => profile.leftOut).find((item) => item.name.test(baseName(file)))?.why ?? 'notNeeded';
}

/** Uses that explain a kept row best come first; bookkeeping traces of another use last. */
const FIRST_USES = ['sales', 'bill_lines', 'supplier_payments', 'document_lines', 'offer_lines', 'portal_order_lines', 'purchase_order_lines', 'supplier_bills', 'tab_entries', 'ledger_lines'];
const LAST_USES = ['stock_adjustments', 'counter_events'];
function usePriority(table: string): number {
  const first = FIRST_USES.indexOf(table);
  if (first >= 0) return first;
  return LAST_USES.includes(table) ? 1000 + LAST_USES.indexOf(table) : 100;
}

const STALE_ERROR = 'The import was stopped halfway (4VD was updated or restarted). Nothing was saved: start it again.';

const PROBLEM_SHEET: Record<ProblemKey, string> = {
  dupBarcode: 'Barkod i përsëritur',
  barcodeCut: 'Barkod i prerë',
  costAbovePrice: 'Kosto mbi çmim',
  noPrice: 'Pa çmim',
  noCost: 'Pa kosto',
  oddVat: 'TVSH e çuditshme',
  similar: 'Emra të ngjashëm',
  noCategory: 'Pa kategori',
  dupPartner: 'Partner i përsëritur',
};

/** A cell that Excel would run as a formula (= + - @) is written as text. */
function safeCell(value: string | number | null | undefined): string | number | null {
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(value)) return `'${value}`;
  return value ?? null;
}

function owedNote(kind: 'suppliers' | 'customers', amount: number, from: string | null): string {
  const source = from ?? 'the imported file';
  const euros = `€${Math.abs(amount).toFixed(2)}`;
  if (kind === 'suppliers') return amount > 0 ? `In ${source} you owed them ${euros} on the day of the import.` : `In ${source} you had paid them ${euros} ahead.`;
  return amount > 0 ? `In ${source} they owed you ${euros} on the day of the import.` : `In ${source} they had paid ${euros} ahead.`;
}

type ProductValues = { name: string; base_price: string | number; cost_price: string | number | null; wholesale_price: string | number | null; vat_rate: number; category_id: number };

/** The values Undo compares and puts back, as numbers. */
function productAfter(row: ProductValues) {
  return {
    name: row.name,
    price: Number(row.base_price),
    cost: row.cost_price === null ? null : Number(row.cost_price),
    wholesale: row.wholesale_price === null ? null : Number(row.wholesale_price),
    vat: row.vat_rate,
    category: row.category_id,
  };
}

function normaliseProduct(set: Record<string, string | number | null>): Partial<ReturnType<typeof productAfter>> {
  const out: Partial<ReturnType<typeof productAfter>> = {};
  if ('name' in set) out.name = String(set.name);
  if ('base_price' in set) out.price = Number(set.base_price);
  if ('cost_price' in set) out.cost = set.cost_price === null ? null : Number(set.cost_price);
  if ('wholesale_price' in set) out.wholesale = set.wholesale_price === null ? null : Number(set.wholesale_price);
  if ('vat_rate' in set) out.vat = Number(set.vat_rate);
  if ('category_id' in set) out.category = Number(set.category_id);
  return out;
}

function snapshot(
  row: { description: string | null; image_url: string | null; sku: string | null; is_active: boolean; vat_exempt: boolean; origin_country: string | null },
  values: ReturnType<typeof productAfter>,
): ProductSnapshot {
  return {
    name: values.name,
    description: row.description,
    categoryId: values.category,
    price: values.price,
    costPrice: values.cost,
    wholesalePrice: values.wholesale,
    imageUrl: row.image_url,
    sku: row.sku,
    isActive: row.is_active,
    vatRate: values.vat,
    vatExempt: row.vat_exempt,
    originCountry: row.origin_country,
  };
}

/** Finished imports of the last two weeks nobody has marked checked yet: one To do item each. */
export async function importsToCheck(db: DatabaseClient): Promise<Array<{ id: number; products: number; day: Date }>> {
  const rows = await db
    .selectFrom('import_batches')
    .select(['id', 'summary', 'finished_at'])
    .where('status', '=', 'done')
    .where('finished_at', '>', new Date(Date.now() - 14 * 86_400_000))
    .execute();
  return rows.flatMap((row) => {
    const summary = row.summary as ImportSummary | null;
    if (!summary || summary.checked || summary.products.created + summary.products.changed === 0) return [];
    return [{ id: row.id, products: summary.products.created + summary.products.changed, day: row.finished_at! }];
  });
}
