import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export function createAllowlist(file: string) {
  mkdirSync(dirname(file), { recursive: true });
  const ids = new Set<string>(existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : []);
  const save = () => {
    writeFileSync(`${file}.tmp`, JSON.stringify([...ids]));
    renameSync(`${file}.tmp`, file);
  };
  return {
    has: (id: string) => ids.has(id),
    set(id: string, enabled: boolean) {
      if (enabled) ids.add(id); else ids.delete(id);
      save();
    },
    clear() { ids.clear(); save(); },
  };
}
