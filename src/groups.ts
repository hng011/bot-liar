import { existsSync, readFileSync, renameSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

export function createAllowlist(file = ':memory:', legacyJson?: string) {
  const db = new DatabaseSync(file, { timeout: 5000 });
  db.exec('CREATE TABLE IF NOT EXISTS allowed_groups (id TEXT PRIMARY KEY)');
  const insert = db.prepare('INSERT OR IGNORE INTO allowed_groups VALUES (?)');
  // One-time import of the old groups.json so existing ticks survive the move to SQLite.
  if (legacyJson && existsSync(legacyJson)) {
    for (const id of JSON.parse(readFileSync(legacyJson, 'utf8')) as string[]) insert.run(id);
    renameSync(legacyJson, `${legacyJson}.migrated`);
  }
  const has = db.prepare('SELECT 1 FROM allowed_groups WHERE id=?');
  return {
    has: (id: string) => has.get(id) !== undefined,
    set(id: string, enabled: boolean) {
      if (enabled) insert.run(id); else db.prepare('DELETE FROM allowed_groups WHERE id=?').run(id);
    },
    clear() { db.exec('DELETE FROM allowed_groups'); },
  };
}
