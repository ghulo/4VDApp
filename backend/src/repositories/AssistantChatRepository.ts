import type { DatabaseClient } from '../database/connection.js';

export interface AssistantChatRecord {
  id: number;
  title: string;
  updated_at: Date;
}

export interface AssistantMessageRecord {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  extras: unknown | null;
  created_at: Date;
}

/** Each person's Ask conversations. Every read is scoped to the owner, so nobody opens someone else's chat. */
export class AssistantChatRepository {
  constructor(private readonly db: DatabaseClient) {}

  listForUser(userId: number, limit: number): Promise<AssistantChatRecord[]> {
    return this.db
      .selectFrom('assistant_chats')
      .select(['id', 'title', 'updated_at'])
      .where('user_id', '=', userId)
      .orderBy('updated_at', 'desc')
      .orderBy('id', 'desc')
      .limit(limit)
      .execute();
  }

  find(chatId: number, userId: number): Promise<AssistantChatRecord | undefined> {
    return this.db
      .selectFrom('assistant_chats')
      .select(['id', 'title', 'updated_at'])
      .where('id', '=', chatId)
      .where('user_id', '=', userId)
      .executeTakeFirst();
  }

  messages(chatId: number): Promise<AssistantMessageRecord[]> {
    return this.db
      .selectFrom('assistant_messages')
      .select(['id', 'role', 'content', 'extras', 'created_at'])
      .where('chat_id', '=', chatId)
      .orderBy('id')
      .execute() as Promise<AssistantMessageRecord[]>;
  }

  async create(userId: number, title: string): Promise<number> {
    const row = await this.db.insertInto('assistant_chats').values({ user_id: userId, title }).returning('id').executeTakeFirstOrThrow();
    return row.id;
  }

  /** Adds the question and its answer together, and moves the chat to the top of the list. */
  async addExchange(chatId: number, question: string, answer: string, extras: unknown): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      await trx
        .insertInto('assistant_messages')
        .values([
          { chat_id: chatId, role: 'user', content: question, extras: null },
          { chat_id: chatId, role: 'assistant', content: answer, extras: JSON.stringify(extras) },
        ])
        .execute();
      await trx.updateTable('assistant_chats').set({ updated_at: new Date() }).where('id', '=', chatId).execute();
    });
  }

  async delete(chatId: number, userId: number): Promise<boolean> {
    const result = await this.db.deleteFrom('assistant_chats').where('id', '=', chatId).where('user_id', '=', userId).executeTakeFirst();
    return Number(result.numDeletedRows) > 0;
  }
}
