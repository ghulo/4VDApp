import { sql } from 'kysely';
import type { DatabaseClient } from '../database/connection.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors/httpErrors.js';
import type { TransactionManager } from '../repositories/TransactionManager.js';
import { isUniqueViolation } from '../utils/databaseErrors.js';
import { roundMoney } from '../utils/money.js';
import { zonedDays } from '../utils/zonedDates.js';
import { zonedDaySql } from './books/postingRules.js';
import type { DateRange } from './reports/calculations.js';
import { readRules } from './shopRules.js';

export interface ProjectDto {
  id: number;
  name: string;
  note: string | null;
  closed: boolean;
  /** Documents tagged with it, of every kind. */
  documents: number;
}

/** What can carry a project. */
export const TAGGABLE = ['bill', 'invoice', 'stock_document', 'write_off'] as const;
export type Taggable = (typeof TAGGABLE)[number];

const TABLE: Record<Taggable, 'supplier_bills' | 'documents' | 'stock_documents' | 'write_offs'> = {
  bill: 'supplier_bills',
  invoice: 'documents',
  stock_document: 'stock_documents',
  write_off: 'write_offs',
};

const ENTITY = { bill: 'bill', invoice: 'document', stock_document: 'stock_document', write_off: 'write_off' } as const;

/** One project's figures for a period, all without VAT. */
export interface ProjectProfitRow {
  projectId: number;
  name: string;
  closed: boolean;
  /** Invoices less credit notes, without VAT. */
  income: number;
  /** What the goods on those invoices cost. */
  goodsCost: number;
  /** Bills and expenses: their costs and equipment (goods bought into stock count when they go out). */
  bills: number;
  /** Stock taken out for the project, at cost. */
  stockOut: number;
  /** Stock written off for the project, at cost. */
  writeOffs: number;
  profit: number;
}

/** One tagged document, for a project's detail list. */
export interface ProjectDocumentRow {
  kind: Taggable | 'credit_note';
  id: number;
  day: string;
  number: string | null;
  who: string | null;
  /** Positive for income, negative for a cost. */
  amount: number;
}

/**
 * Projects: tags on bills and expenses, invoices, stock out documents and
 * write-offs, and the profit each one made. Figures come from the documents
 * themselves (not the books), so they also cover the carwash and the days
 * before the books start, and re-tagging never touches a posted entry.
 */
export class ProjectService {
  constructor(
    private readonly db: DatabaseClient,
    private readonly transactions: TransactionManager,
    private readonly timeZone: string,
  ) {}

  async list(): Promise<ProjectDto[]> {
    const counted = (table: string) => sql<number>`(select count(*)::int from ${sql.table(table)} t where t.project_id = p.id)`;
    const rows = await this.db
      .selectFrom('projects as p')
      .select(['p.id', 'p.name', 'p.note', 'p.closed_at'])
      .select(sql<number>`${counted('supplier_bills')} + ${counted('documents')} + ${counted('stock_documents')} + ${counted('write_offs')}`.as('documents'))
      .orderBy(sql`p.closed_at is not null`)
      .orderBy(sql`lower(p.name)`)
      .execute();
    return rows.map((row) => ({ id: row.id, name: row.name, note: row.note, closed: row.closed_at !== null, documents: row.documents }));
  }

  async create(input: { name: string; note: string | null }, actorId: number): Promise<ProjectDto> {
    const id = await this.transactions.run(async (repos) => {
      await assertOn(repos.settings);
      const row = await this.unique(input.name, () =>
        repos.db.insertInto('projects').values({ name: input.name, note: input.note, created_by: actorId }).returning('id').executeTakeFirstOrThrow(),
      );
      await repos.activityLog.create({
        userId: actorId,
        action: 'project.created',
        entityType: 'project',
        entityId: row.id,
        say: { key: 'projectAdded', params: { name: input.name } },
        details: { name: input.name },
      });
      return row.id;
    });
    return this.get(id);
  }

  async update(id: number, input: { name?: string; note?: string | null; closed?: boolean }, actorId: number, now = new Date()): Promise<ProjectDto> {
    const before = await this.get(id);
    await this.transactions.run(async (repos) => {
      const patch: { name?: string; note?: string | null; closed_at?: Date | null } = {};
      if (input.name !== undefined) patch.name = input.name;
      if (input.note !== undefined) patch.note = input.note;
      if (input.closed !== undefined && input.closed !== before.closed) patch.closed_at = input.closed ? now : null;
      if (Object.keys(patch).length === 0) return;
      await this.unique(input.name ?? before.name, () => repos.db.updateTable('projects').set(patch).where('id', '=', id).execute());
      await repos.activityLog.create({
        userId: actorId,
        action: 'project.updated',
        entityType: 'project',
        entityId: id,
        say: { key: 'projectChanged', params: { name: input.name ?? before.name, closed: input.closed === undefined || input.closed === before.closed ? null : input.closed } },
        details: { from: before, to: input },
      });
    });
    return this.get(id);
  }

  /** A project goes only while nothing carries it; otherwise it is closed instead. */
  async remove(id: number, actorId: number): Promise<void> {
    const project = await this.get(id);
    if (project.documents > 0) throw new ConflictError(`${project.name} is on ${project.documents} documents: close it instead`);
    await this.transactions.run(async (repos) => {
      await repos.db.deleteFrom('projects').where('id', '=', id).execute();
      await repos.activityLog.create({
        userId: actorId,
        action: 'project.removed',
        entityType: 'project',
        entityId: id,
        say: { key: 'projectRemoved', params: { name: project.name } },
        details: { name: project.name },
      });
    });
  }

  async get(id: number): Promise<ProjectDto> {
    const found = (await this.list()).find((project) => project.id === id);
    if (!found) throw new NotFoundError(`Project ${id} does not exist`);
    return found;
  }

  /** Puts a document on a project, moves it to another, or takes it off (null). */
  async tag(kind: Taggable, id: number, projectId: number | null, actorId: number): Promise<void> {
    await this.transactions.run(async (repos) => {
      await assertOn(repos.settings);
      await checkProject(repos.db, projectId);
      const table = TABLE[kind];
      if (kind === 'invoice') {
        const document = await repos.db.selectFrom('documents').select('kind').where('id', '=', id).executeTakeFirst();
        if (document?.kind === 'credit_note') throw new ValidationError('A credit note follows the project of the invoice it corrects');
      }
      if (kind === 'stock_document') {
        const document = await repos.db.selectFrom('stock_documents').select('direction').where('id', '=', id).executeTakeFirst();
        if (document?.direction === 'in') throw new ValidationError('Only stock going out goes on a project');
      }
      const result = await repos.db.updateTable(table).set({ project_id: projectId }).where('id', '=', id).executeTakeFirst();
      if (Number(result.numUpdatedRows) === 0) throw new NotFoundError(`${kind} ${id} does not exist`);
      await repos.activityLog.create({
        userId: actorId,
        action: 'project.tagged',
        entityType: ENTITY[kind],
        entityId: id,
        say: { key: 'projectTagged', params: { kind, projectId } },
        details: { kind, id, projectId },
      });
    });
  }

  /** Each project's income, costs and profit for the period; projects with nothing in it are left out. */
  async profit(range: DateRange): Promise<ProjectProfitRow[]> {
    const documents = await this.documentsIn(range, null);
    const projects = await this.db.selectFrom('projects').select(['id', 'name', 'closed_at']).execute();
    const rows = new Map<number, ProjectProfitRow>();
    for (const project of projects) {
      rows.set(project.id, { projectId: project.id, name: project.name, closed: project.closed_at !== null, income: 0, goodsCost: 0, bills: 0, stockOut: 0, writeOffs: 0, profit: 0 });
    }
    for (const doc of documents) {
      const row = rows.get(doc.projectId);
      if (!row) continue;
      if (doc.kind === 'invoice' || doc.kind === 'credit_note') {
        row.income = roundMoney(row.income + doc.amount);
        row.goodsCost = roundMoney(row.goodsCost + doc.goodsCost);
      } else if (doc.kind === 'bill') row.bills = roundMoney(row.bills - doc.amount);
      else if (doc.kind === 'stock_document') row.stockOut = roundMoney(row.stockOut - doc.amount);
      else row.writeOffs = roundMoney(row.writeOffs - doc.amount);
    }
    return [...rows.values()]
      .filter((row) => documents.some((doc) => doc.projectId === row.projectId))
      .map((row) => ({ ...row, profit: roundMoney(row.income - row.goodsCost - row.bills - row.stockOut - row.writeOffs) }))
      .sort((a, b) => b.profit - a.profit || a.name.localeCompare(b.name));
  }

  /** The documents on one project in the period, newest first. An invoice's amount is its income less its goods' cost. */
  async documents(projectId: number, range: DateRange): Promise<ProjectDocumentRow[]> {
    await this.get(projectId);
    const rows = await this.documentsIn(range, projectId);
    return rows
      .map(({ projectId: _, goodsCost, ...row }) => ({ ...row, amount: roundMoney(row.amount - goodsCost) }))
      .sort((a, b) => b.day.localeCompare(a.day) || b.id - a.id);
  }

  private async documentsIn(range: DateRange, projectId: number | null) {
    const { from, to } = zonedDays(range, this.timeZone);
    const tz = this.timeZone;
    const only = (column: string) => (projectId === null ? sql`${sql.ref(column)} is not null` : sql`${sql.ref(column)} = ${projectId}`);
    const { rows } = await sql<{ kind: Taggable | 'credit_note'; id: number; project_id: number; day: string; number: string | null; who: string | null; amount: string; goods_cost: string }>`
      select * from (
        select d.kind, d.id, coalesce(d.project_id, o.project_id) as project_id, ${zonedDaySql(sql.ref('d.issued_at'), tz)} as day, d.number,
          d.buyer->>'name' as who,
          (case when d.kind = 'credit_note' then -d.net_total else d.net_total end)::text as amount,
          coalesce((select sum(case when d.kind = 'credit_note' then -1 else 1 end * dl.quantity * s.unit_cost)
            from document_lines dl join sales s on s.id = dl.sale_id where dl.document_id = d.id), 0)::text as goods_cost
        from documents d left join documents o on o.id = d.corrects_id
        where d.trefin_ref is null
      ) inv where ${only('inv.project_id')} and inv.day between ${from} and ${to}
      union all
      select 'bill', b.id, b.project_id, to_char(b.issued_on, 'YYYY-MM-DD'), b.number, sp.name,
        (-(case when b.kind = 'credit' then -1 else 1 end) * coalesce((select sum(l.landed) from bill_lines l where l.bill_id = b.id and l.kind <> 'product'), 0))::text,
        '0'
      from supplier_bills b left join suppliers sp on sp.id = b.supplier_id
      where ${only('b.project_id')} and b.voided_at is null and b.trefin_ref is null and b.issued_on between ${from} and ${to}
      union all
      select 'stock_document', sd.id, sd.project_id, to_char(sd.day, 'YYYY-MM-DD'), sd.number, null,
        (-coalesce((select sum(round((l.quantity * l.unit_cost)::numeric, 2)) from stock_document_lines l where l.document_id = sd.id), 0))::text,
        '0'
      from stock_documents sd
      where ${only('sd.project_id')} and sd.voided_at is null and sd.direction = 'out' and sd.day between ${from} and ${to}
      union all
      select 'write_off', w.id, w.project_id, ${zonedDaySql(sql.ref('w.decided_at'), tz)}, null, p.name,
        (-round((w.quantity * coalesce(w.unit_cost, p.cost_price, 0))::numeric, 2))::text,
        '0'
      from write_offs w join products p on p.id = w.product_id
      where ${only('w.project_id')} and w.status = 'approved' and w.undone_at is null and w.decided_at is not null
        and ${zonedDaySql(sql.ref('w.decided_at'), tz)} between ${from} and ${to}
    `.execute(this.db);
    return rows.map((row) => ({
      kind: row.kind,
      id: row.id,
      projectId: row.project_id,
      day: row.day,
      number: row.number,
      who: row.who,
      amount: roundMoney(Number(row.amount)),
      goodsCost: roundMoney(Number(row.goods_cost)),
    }));
  }

  private async unique<T>(name: string, write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (error) {
      if (isUniqueViolation(error, 'projects_name_idx')) throw new ConflictError(`There is already a project called ${name}`);
      throw error;
    }
  }
}

async function assertOn(settings: { all(): Promise<Map<string, unknown>> }): Promise<void> {
  if (!(await readRules(settings)).features.projects) throw new ValidationError('Projects are switched off in Settings');
}

/** A project to put a document on: it must exist, and be open unless `allowClosed`. */
export async function checkProject(db: DatabaseClient, projectId: number | null | undefined, allowClosed = false): Promise<void> {
  if (projectId === null || projectId === undefined) return;
  const project = await db.selectFrom('projects').select(['name', 'closed_at']).where('id', '=', projectId).executeTakeFirst();
  if (!project) throw new ValidationError(`projectId: project ${projectId} does not exist`);
  if (project.closed_at && !allowClosed) throw new ValidationError(`projectId: ${project.name} is closed`);
}
