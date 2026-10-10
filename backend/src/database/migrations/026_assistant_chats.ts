import { type Kysely, sql } from 'kysely';

/**
 * Ask keeps conversations: each person's chats, and every question and answer
 * in them, so a follow-up knows what came before and old chats can be reopened.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE assistant_chats (
      id SERIAL PRIMARY KEY,
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title VARCHAR(120) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.execute(db);
  await sql`CREATE INDEX idx_assistant_chats_user ON assistant_chats (user_id, updated_at DESC)`.execute(db);
  await sql`
    CREATE TABLE assistant_messages (
      id SERIAL PRIMARY KEY,
      chat_id INT NOT NULL REFERENCES assistant_chats(id) ON DELETE CASCADE,
      role VARCHAR(10) NOT NULL CHECK (role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      -- An answer's tables, charts and links.
      extras JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.execute(db);
  await sql`CREATE INDEX idx_assistant_messages_chat ON assistant_messages (chat_id, id)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS assistant_messages`.execute(db);
  await sql`DROP TABLE IF EXISTS assistant_chats`.execute(db);
}
