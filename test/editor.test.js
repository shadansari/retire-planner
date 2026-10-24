import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load as loadYaml, CORE_SCHEMA } from '../vendor/js-yaml.mjs';
import { exampleRaw } from './helpers.js';
import { validatePlan } from '../js/engine/validate.js';
import { serializePlan } from '../js/editor/serialize.js';
import { SECTIONS, LIST_BLOCKS } from '../js/editor/catalog.js';
import {
  fromInput, toInput, setTiming, getTiming, slug, uniqueId, syncId, removeItem, removalEffects,
  duplicateItem, messagesByPath, changeSummary, commitMessage, blankPlan, clone, getIn, setIn, addItem,
} from '../js/editor/model.js';

const reload = (text) => loadYaml(text, { schema: CORE_SCHEMA });

test('serialize → load round-trips the example exactly, and is stable', () => {
  const raw = exampleRaw();
  const text = serializePlan(raw);
  assert.deepEqual(reload(text), raw);
  assert.equal(serializePlan(reload(text)), text);
  assert.deepEqual(validatePlan(reload(text)), validatePlan(raw));
});

test('serialized layout: header, section notes, ordered keys, flow lists, nested lists', () => {
  const text = serializePlan(exampleRaw());
  assert.match(text, /^# Our retirement plan \(schema version 1\)\./);
  assert.match(text, /\n# Accounts, with balances as of the month above\.[^\n]*\naccounts:\n {2}- id: alex_401k\n {4}name: Alex 401\(k\)\n/);
  assert.match(text, /withdrawal_order: \[savings, taxable, hsa, traditional, roth\]/);
  assert.match(text, /contributions:\n {8}- account: alex_401k\n {10}employee: 10%\n {10}employer: 4%/);
  assert.match(text, /as_of: 2026-10\n/);
});

test('serialize drops empty values and quotes strings YAML would misread', () => {
  const raw = exampleRaw();
  raw.people[0].name = 'yes: no # really';
  raw.expenses.items[0].inflation = '';
  raw.income.part_time = [];
  raw.liabilities[0].note = null;
  const back = reload(serializePlan(raw));
  assert.equal(back.people[0].name, 'yes: no # really');
  assert.ok(!('inflation' in back.expenses.items[0]));
  assert.ok(!('part_time' in back.income));
  assert.ok(!('note' in back.liabilities[0]));
});

test('a blank plan serializes to a loadable file', () => {
  const raw = blankPlan({ year: 2026, month: 10 });
  const back = reload(serializePlan(raw));
  assert.equal(back.as_of, '2026-10');
  assert.deepEqual(back.people, []);
  assert.deepEqual(back.accounts, []);
  assert.ok(validatePlan(back).errors.length > 0); // incomplete, but no crash
});

test('input encoding', () => {
  assert.equal(fromInput('money', '$150,000'), 150000);
  assert.equal(fromInput('money', '12.5'), 12.5);
  assert.equal(fromInput('money', 'lots'), 'lots'); // kept so the validator reports it
  assert.equal(fromInput('money', '  '), undefined);
  assert.equal(fromInput('percent', '6'), '6%');
  assert.equal(fromInput('percent', '6.5%'), '6.5%');
  assert.equal(fromInput('percent', 'six'), 'six');
  assert.equal(fromInput('int', '67'), 67);
  assert.equal(fromInput('percentOrMoney', '10%'), '10%');
  assert.equal(fromInput('percentOrMoney', '23,000'), 23000);
  assert.equal(fromInput('month', '2032-06'), '2032-06');
  assert.equal(fromInput('bool', false), false);
  assert.equal(toInput('percent', '6%'), '6');
  assert.equal(toInput('money', 150000), '150000');
  assert.equal(toInput('money', undefined), '');
});

test('expense timing switches between one-time and recurring', () => {
  const item = { name: 'Roof', amount: 1, year: 2029 };
  assert.equal(getTiming(item), 'once');
  setTiming(item, 'recurring');
  assert.deepEqual(item, { name: 'Roof', amount: 1, start: 2029, end: 2029 });
  item.every = 8;
  setTiming(item, 'once');
  assert.deepEqual(item, { name: 'Roof', amount: 1, year: 2029 });
});

test('ids are derived from names, unique, valid, and stable once referenced', () => {
  assert.equal(slug('Pat Lee', { first: true }), 'pat');
  assert.equal(slug('Pat Lee 401(k)'), 'pat_lee_401_k');
  assert.equal(slug('401k'), 'x_401k');
  const raw = exampleRaw();
  assert.equal(uniqueId(raw, 'people', 'alex'), 'alex_2');
  assert.equal(uniqueId(raw, 'accounts', 'cash'), 'cash_1');
  const p = { id: '', name: 'Robin Doe' };
  raw.people.push(p);
  syncId(raw, 'people', p);
  assert.equal(p.id, 'robin');
  p.name = 'Rob Doe';
  syncId(raw, 'people', p);
  assert.equal(p.id, 'rob'); // unreferenced: follows the name
  raw.people[0].name = 'Alexander Sample';
  syncId(raw, 'people', raw.people[0]);
  assert.equal(raw.people[0].id, 'alex'); // referenced: kept
});

test('removing an account removes what points at it', () => {
  const raw = exampleRaw();
  const i = raw.accounts.findIndex((a) => a.id === 'brokerage');
  assert.deepEqual(removalEffects(raw, 'accounts', i), ['the choice of where surplus money goes (pick another account)']);
  removeItem(raw, 'accounts', i);
  assert.equal(raw.assumptions.deposit_surplus_to, undefined);

  const raw2 = exampleRaw();
  const k = raw2.accounts.findIndex((a) => a.id === 'alex_401k');
  assert.deepEqual(removalEffects(raw2, 'accounts', k), ["the contribution into it from Alex's salary"]);
  removeItem(raw2, 'accounts', k);
  assert.equal(raw2.income.salaries[0].contributions, undefined);
  assert.deepEqual(validatePlan(raw2).errors, []);
});

test('removing a person removes their income and accounts', () => {
  const raw = exampleRaw();
  assert.deepEqual(removalEffects(raw, 'people', 1), [
    "Jamie's salary", "Jamie's Social Security", 'Teachers pension', 'Jamie Roth 401(k)', 'Jamie IRA',
  ]);
  removeItem(raw, 'people', 1);
  assert.equal(raw.people.length, 1);
  assert.ok(raw.income.salaries.every((s) => s.owner === 'alex'));
  assert.ok(raw.accounts.every((a) => a.owner !== 'jamie'));
  assert.equal(raw.income.pensions.length, 0);
});

test('duplicate makes a fresh id and name', () => {
  const raw = exampleRaw();
  const j = duplicateItem(raw, 'accounts', 0);
  assert.equal(raw.accounts[j].name, 'Alex 401(k) (copy)');
  assert.equal(raw.accounts[j].id, 'alex_401_k_copy');
});

test('validation messages map to field paths in plain words', () => {
  const raw = exampleRaw();
  delete raw.accounts[0].balance;
  raw.accounts[1].return = 0.06;
  const map = messagesByPath(validatePlan(raw).errors);
  assert.deepEqual(map.get('accounts[0].balance'), ['Required.']);
  assert.match(map.get('accounts[1].return')[0], /^Must be a percentage/);
});

test('change summary and commit message name what changed', () => {
  const before = exampleRaw();
  const after = clone(before);
  after.accounts[0].balance = 750000;
  after.as_of = '2027-01';
  addItem(after, LIST_BLOCKS.find((b) => b.path === 'expenses.items'));
  after.expenses.items.at(-1).name = 'Boat';
  after.liabilities = [];
  const changes = changeSummary(before, after);
  assert.deepEqual(changes, [
    'Getting started: balances are as of',
    'Alex 401(k): balance',
    'added expense "Boat"',
    'removed loan "Mortgage"',
  ]);
  assert.equal(commitMessage(changes.slice(1, 2)), 'Update plan: Alex 401(k): balance');
  assert.match(commitMessage(changes), /^Update plan \(4 changes\)\n\n- Getting started/);
  assert.deepEqual(changeSummary(before, clone(before)), []);
});

test('path helpers create parents and delete on undefined', () => {
  const o = {};
  setIn(o, 'expenses.healthcare.medicare', 7000);
  assert.equal(getIn(o, 'expenses.healthcare.medicare'), 7000);
  setIn(o, 'expenses.healthcare.medicare', undefined);
  assert.deepEqual(o, { expenses: { healthcare: {} } });
});

// Every key the validator accepts must be editable somewhere (catches schema drift).
test('catalog covers every schema key', () => {
  const src = readFileSync(new URL('../js/engine/validate.js', import.meta.url), 'utf8');
  const allowed = [...src.matchAll(/c\.keys\([^,]+, \[([^\]]+)\]/g)]
    .flatMap((m) => m[1].split(',').map((s) => s.trim().replace(/'/g, '')));
  const containers = new Set(['schema_version', 'people', 'income', 'expenses', 'liabilities', 'accounts', 'assumptions',
    'salaries', 'social_security', 'pensions', 'part_time', 'items', 'healthcare', 'contributions', 'id']);
  const editable = new Set();
  const walk = (fields) => fields.forEach((f) => {
    editable.add(f.key.split('.').at(-1));
    if (f.itemFields) walk(f.itemFields);
  });
  for (const s of SECTIONS) for (const b of s.blocks) walk(b.kind === 'fields' ? b.fields : b.itemFields);
  const missing = [...new Set(allowed)].filter((k) => !containers.has(k) && !editable.has(k));
  assert.deepEqual(missing, []);
});
