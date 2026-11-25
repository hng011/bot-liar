import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPersona, MAX_FACTS } from '../src/persona.ts';

test('remember, list, overwrite and forget', () => {
  const p = createPersona();
  assert.match(p.command('u', '!remember Favorite Food = nasi goreng')!, /favorite_food = nasi goreng/);
  p.command('u', '!remember favorite_food: sate');
  assert.equal(p.command('u', '!me'), '- favorite_food: sate');
  assert.equal(p.prompt('other'), '');
  assert.match(p.prompt('u'), /favorite_food: sate/);
  assert.match(p.command('u', '!forget favorite_food')!, /Forgot/);
  assert.equal(p.prompt('u'), '');
});

test('rejects sensitive, tagged and long-number facts', () => {
  const p = createPersona();
  for (const t of ['!remember password = hunter2', '!remember note = <b>hi</b>', '!remember phone = 0812 3456 7890']) assert.match(p.command('u', t)!, /Can't save/);
  assert.equal(p.prompt('u'), '');
});

test('caps facts per user and ignores non-commands', () => {
  const p = createPersona();
  for (let i = 0; i < MAX_FACTS; i++) p.command('u', `!remember k${i} = v`);
  assert.match(p.command('u', '!remember extra = v')!, /!forget/);
  assert.match(p.command('u', '!remember k0 = changed')!, /Got it/);
  assert.equal(p.command('u', 'what is !me'), null);
});
