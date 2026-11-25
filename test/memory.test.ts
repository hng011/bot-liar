import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMemory, MAX_GROUPS, MAX_TURNS } from '../src/memory.ts';

test('keeps only the last 30 turns per group', () => {
  const m = createMemory();
  for (let i = 0; i < 40; i++) m.add('g', { user: `u${i}`, reply: `r${i}` });
  assert.equal(m.get('g').length, MAX_TURNS);
  assert.equal(m.get('g')[0].user, 'u10');
  assert.equal(m.get('other').length, 0);
});

test('caps a stored turn at 512 tokens (~2048 chars)', () => {
  const m = createMemory();
  m.add('g', { user: 'x'.repeat(5000), reply: 'y'.repeat(5000) });
  const [t] = m.get('g');
  assert.ok(t.user.length + t.reply.length <= 2048);
});

test('evicts the least recently used group when history reaches its limit', () => {
  const m = createMemory();
  for (let i = 0; i < MAX_GROUPS; i++) m.add(`g${i}`, { user: 'u', reply: 'r' });
  m.add('g0', { user: 'again', reply: 'r' });
  m.add('new', { user: 'u', reply: 'r' });
  assert.equal(m.get('g1').length, 0);
  assert.equal(m.get('g0').length, 2);
  assert.equal(m.get('new').length, 1);
});
