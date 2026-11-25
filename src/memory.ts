import { DatabaseSync } from 'node:sqlite';

export const MAX_TURNS = 20;
// ~4 chars per token. A stored turn is capped at 512 tokens: 128 for the user, 384 for the reply.
const USER_CHARS = 128 * 4;
const REPLY_CHARS = 384 * 4;

export interface Turn { user: string; reply: string }

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

export function createMemory(file = ':memory:') {
  const db = new DatabaseSync(file, { timeout: 5000 });
  db.exec(`
    PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS turns (id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id TEXT NOT NULL, user TEXT NOT NULL, reply TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS turns_chat ON turns (chat_id, id);
  `);
  const select = db.prepare('SELECT user, reply FROM (SELECT id, user, reply FROM turns WHERE chat_id=? ORDER BY id DESC LIMIT ?) ORDER BY id');
  const insert = db.prepare('INSERT INTO turns (chat_id, user, reply) VALUES (?, ?, ?)');
  const trim = db.prepare('DELETE FROM turns WHERE chat_id=? AND id NOT IN (SELECT id FROM turns WHERE chat_id=? ORDER BY id DESC LIMIT ?)');
  return {
    get: (chatId: string): Turn[] => select.all(chatId, MAX_TURNS).map((r) => ({ user: String(r.user), reply: String(r.reply) })),
    add(chatId: string, turn: Turn) {
      insert.run(chatId, clip(turn.user, USER_CHARS), clip(turn.reply, REPLY_CHARS));
      trim.run(chatId, chatId, MAX_TURNS);
    },
    clear: (chatId: string) => db.prepare('DELETE FROM turns WHERE chat_id=?').run(chatId),
    clearAll: () => db.exec('DELETE FROM turns'),
    close: () => db.close(),
  };
}
