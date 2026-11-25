import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMemory, MAX_TURNS } from '../src/memory.ts';

test('keeps only the last 20 turns per group', () => {
  const m = createMemory();
  for (let i = 0; i < 40; i++) m.add('g', { user: `u${i}`, reply: `r${i}` });
  assert.equal(m.get('g').length, MAX_TURNS);
  assert.equal(m.get('g')[0].user, 'u20');
  assert.equal(m.get('other').length, 0);
});

test('caps a stored turn at 512 tokens (~2048 chars)', () => {
  const m = createMemory();
  m.add('g', { user: 'x'.repeat(5000), reply: 'y'.repeat(5000) });
  const [t] = m.get('g');
  assert.ok(t.user.length + t.reply.length <= 2048);
});

test('clearAll wipes every chat', () => {
  const m = createMemory();
  m.add('a', { user: 'u', reply: 'r' });
  m.add('b', { user: 'u', reply: 'r' });
  m.clearAll();
  assert.equal(m.get('a').length + m.get('b').length, 0);
});

test('survives reopening the database file', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const file = `${mkdtempSync(`${tmpdir()}/mem-`)}/m.sqlite`;
  const a = createMemory(file);
  a.add('g', { user: 'hello', reply: 'hi' });
  a.close();
  assert.deepEqual(createMemory(file).get('g'), [{ user: 'hello', reply: 'hi' }]);
});
