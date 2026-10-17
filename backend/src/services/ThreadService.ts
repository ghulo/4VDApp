import { sql } from 'kysely';
import type { DatabaseClient } from '../database/connection.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../errors/httpErrors.js';
import type { QuestionOn } from '../i18n/activityText.js';
import type { ServerMessages } from '../i18n/messages.js';
import { ActivityLogRepository } from '../repositories/ActivityLogRepository.js';
import { NotificationRepository } from '../repositories/NotificationRepository.js';
import type { PublicUser } from '../types/auth.js';
import { canOversee, canReadBooks } from '../utils/roles.js';

/** What a question can be about: a supplier bill (expenses too), an invoice, an entry in the books. */
export const THREAD_SUBJECTS = ['bill', 'document', 'entry'] as const;
export type ThreadSubjectKind = (typeof THREAD_SUBJECTS)[number];

export interface ThreadNoteDto {
  id: number;
  author: string | null;
  /** Asked by the accountant, or answered by someone who runs the shop. */
  side: 'question' | 'answer';
  body: string;
  createdAt: string;
}

export interface ThreadDto {
  id: number | null;
  subject: string;
  status: 'open' | 'answered' | 'none';
  notes: ThreadNoteDto[];
}

export interface OpenQuestion {
  threadId: number;
  kind: ThreadSubjectKind;
  id: number;
  /** "Fresh Foods 123", an invoice number, "#40". */
  label: string;
  askedBy: string | null;
  /** The newest question, for the To do line. */
  text: string;
}

const pageOf = (kind: ThreadSubjectKind, id: number) => (kind === 'bill' ? `/bills/${id}` : kind === 'document' ? `/documents/${id}` : `/books/journal?entry=${id}`);

/**
 * Questions the accountant leaves on a document. A thread is open while the
 * last word is the accountant's, and lands in the To do of the people who run
 * the shop; their reply on the document answers it and tells the accountant.
 */
export class ThreadService {
  constructor(private readonly db: DatabaseClient) {}

  async get(kind: ThreadSubjectKind, id: number): Promise<ThreadDto> {
    const subject = `${kind}:${id}`;
    const thread = await this.db.selectFrom('document_threads').select(['id', 'status']).where('subject', '=', subject).executeTakeFirst();
    if (!thread) return { id: null, subject, status: 'none', notes: [] };
    const notes = await this.db
      .selectFrom('document_notes as n')
      .leftJoin('users as u', 'u.id', 'n.author_id')
      .select(['n.id', 'n.body', 'n.created_at', 'u.name', 'u.role'])
      .where('n.thread_id', '=', thread.id)
      .orderBy('n.id')
      .execute();
    return {
      id: thread.id,
      subject,
      status: thread.status,
      notes: notes.map((note) => ({
        id: note.id,
        author: note.name,
        side: note.role === 'accountant' ? 'question' : 'answer',
        body: note.body,
        createdAt: note.created_at.toISOString(),
      })),
    };
  }

  /** Ask (the accountant) or answer (someone who runs the shop) on a document. */
  async post(kind: ThreadSubjectKind, id: number, body: string, actor: PublicUser): Promise<ThreadDto> {
    if (!canReadBooks(actor.role)) throw new ForbiddenError('Only the accountant and the people who run the shop write here');
    const text = body.trim();
    if (text === '') throw new ValidationError('Write the question or the answer first');
    const asking = actor.role === 'accountant';
    const label = await this.labelOf(kind, id);
    if (label === null) throw new NotFoundError('That document does not exist');
    const subject = `${kind}:${id}`;
    await this.db.transaction().execute(async (trx) => {
      const existing = await trx.selectFrom('document_threads').select(['id', 'opened_by']).where('subject', '=', subject).forUpdate().executeTakeFirst();
      if (!existing && !asking) throw new ValidationError('There is no question on this document to answer');
      const threadId =
        existing?.id ??
        (await trx.insertInto('document_threads').values({ subject, opened_by: actor.id }).returning('id').executeTakeFirstOrThrow()).id;
      await trx
        .updateTable('document_threads')
        .set({ status: asking ? 'open' : 'answered', updated_at: new Date() })
        .where('id', '=', threadId)
        .execute();
      await trx.insertInto('document_notes').values({ thread_id: threadId, author_id: actor.id, body: text }).execute();
      const on: QuestionOn = { kind, label };
      const short = text.length > 140 ? `${text.slice(0, 137)}…` : text;
      await new ActivityLogRepository(trx).create({
        userId: actor.id,
        action: asking ? 'question.asked' : 'question.answered',
        entityType: kind === 'bill' ? 'bill' : kind === 'document' ? 'document' : 'ledger_entry',
        entityId: id,
        say: { key: asking ? 'questionAsked' : 'questionAnswered', params: { on, text: short } },
      });
      // The accountant hears back in their Updates; the question itself is a To do for the shop (AttentionService).
      if (!asking) {
        const askers = await trx
          .selectFrom('document_notes as n')
          .innerJoin('users as u', 'u.id', 'n.author_id')
          .select('u.id')
          .distinct()
          .where('n.thread_id', '=', threadId)
          .where('u.role', '=', 'accountant')
          .execute();
        const notifications = new NotificationRepository(trx);
        for (const asker of askers) {
          await notifications.createForUser(asker.id, {
            type: 'question_answered',
            write: (t: ServerMessages) => ({ title: t.questions.answeredTitle(on), message: `${actor.name}: ${short}` }),
            link: pageOf(kind, id),
          });
        }
      }
    });
    return this.get(kind, id);
  }

  /** Open questions, newest first, for the To do of the people who run the shop. */
  async open(): Promise<OpenQuestion[]> {
    const { rows } = await sql<{ id: number; subject: string; asked_by: string | null; text: string }>`
      select t.id, t.subject, u.name as asked_by,
        (select n.body from document_notes n where n.thread_id = t.id order by n.id desc limit 1) as text
      from document_threads t
      left join users u on u.id = t.opened_by
      where t.status = 'open'
      order by t.updated_at desc
      limit 50
    `.execute(this.db);
    const questions: OpenQuestion[] = [];
    for (const row of rows) {
      const [kind, ref] = row.subject.split(':') as [ThreadSubjectKind, string];
      const label = await this.labelOf(kind, Number(ref));
      if (label === null) continue;
      questions.push({ threadId: row.id, kind, id: Number(ref), label, askedBy: row.asked_by, text: row.text });
    }
    return questions;
  }

  /** How the document is named in a sentence; null when it doesn't exist. */
  private async labelOf(kind: ThreadSubjectKind, id: number): Promise<string | null> {
    if (kind === 'bill') {
      const bill = await this.db
        .selectFrom('supplier_bills as b')
        .leftJoin('suppliers as s', 's.id', 'b.supplier_id')
        .select(['b.number', 's.name', 'b.note'])
        .where('b.id', '=', id)
        .executeTakeFirst();
      if (!bill) return null;
      return [bill.name ?? bill.note ?? `#${id}`, bill.number].filter(Boolean).join(' ');
    }
    if (kind === 'document') {
      const doc = await this.db.selectFrom('documents').select('number').where('id', '=', id).executeTakeFirst();
      return doc?.number ?? null;
    }
    const entry = await this.db.selectFrom('ledger_entries').select('id').where('id', '=', id).executeTakeFirst();
    return entry ? `#${entry.id}` : null;
  }
}

/** Whether this person's note answers (rather than asks). */
export const answers = (actor: PublicUser) => canOversee(actor.role);
