import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createAllowlist } from '../src/groups.ts';

test('set, has and clear', () => {
  const a = createAllowlist();
  a.set('1@g.us', true);
  assert.ok(a.has('1@g.us'));
  a.set('1@g.us', false);
  assert.ok(!a.has('1@g.us'));
  a.set('2@g.us', true);
  a.clear();
  assert.ok(!a.has('2@g.us'));
});

test('imports the old groups.json once and keeps data across reopen', () => {
  const dir = mkdtempSync(join(tmpdir(), 'grp-'));
  writeFileSync(join(dir, 'groups.json'), JSON.stringify(['old@g.us']));
  const db = join(dir, 'm.sqlite');
  assert.ok(createAllowlist(db, join(dir, 'groups.json')).has('old@g.us'));
  assert.ok(!existsSync(join(dir, 'groups.json')));
  assert.ok(createAllowlist(db, join(dir, 'groups.json')).has('old@g.us'));
});
