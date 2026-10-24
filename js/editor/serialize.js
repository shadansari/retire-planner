// Raw plan → plan.yaml text, in a stable, readable layout with short section notes.
// Pure. Round-trip guarantee (tested): loading the output with CORE_SCHEMA gives back
// the same raw object, minus empty values (undefined, null, "", empty optional groups).
//
// Hand-written comments in a loaded file are not preserved: the editor rewrites the file.

import { dump, CORE_SCHEMA } from '../../vendor/js-yaml.mjs';
import { SECTIONS } from './catalog.js';

const itemKeys = (path, extra = []) => {
  const block = SECTIONS.flatMap((s) => s.blocks).find((b) => b.path === path);
  return [...extra, ...block.itemFields.filter((f) => f.kind !== 'timing').map((f) => f.key)];
};

// Key order per position ("[]" = any list item).
const ORDER = {
  '': ['schema_version', 'as_of', 'people', 'income', 'expenses', 'liabilities', 'accounts', 'assumptions'],
  'people[]': itemKeys('people', ['id']),
  income: ['salaries', 'social_security', 'pensions', 'part_time'],
  'income.salaries[]': itemKeys('income.salaries'),
  'income.salaries[].contributions[]': ['account', 'employee', 'employer'],
  'income.social_security[]': itemKeys('income.social_security'),
  'income.pensions[]': itemKeys('income.pensions'),
  'income.part_time[]': itemKeys('income.part_time'),
  expenses: ['base_annual', 'survivor_pct', 'inflation', 'items', 'healthcare'],
  'expenses.items[]': ['name', 'amount', 'year', 'start', 'end', 'every', 'inflation'],
  'expenses.healthcare': ['pre_medicare', 'medicare', 'inflation'],
  'liabilities[]': itemKeys('liabilities'),
  'accounts[]': itemKeys('accounts', ['id']),
  assumptions: ['inflation', 'filing_status', 'state', 'withdrawal_order', 'deposit_surplus_to'],
};

// Notes written above top-level sections.
const NOTES = {
  as_of: 'Month the balances below were read. The projection starts the following January.',
  people: 'Who the plan is for. retirement_date = first month not working; life_expectancy = plan-to age.',
  income: "Income. Social Security and part-time amounts are in today's dollars; salaries and pensions in actual dollars.",
  expenses: "Spending in today's dollars (grows with inflation). Mortgage and healthcare are separate.",
  liabilities: 'Loans: monthly_payment is principal + interest only.',
  accounts: 'Accounts, with balances as of the month above. Types: cash, taxable, traditional, roth, hsa.',
  assumptions: 'Assumptions and strategy.',
};

const HEADER = [
  '# Our retirement plan (schema version 1).',
  '# Written by the planner page; you can also edit it by hand: see docs/editing-plan.md.',
  '# Percentages have a % sign (6%), months are year-month (2032-06), amounts are plain numbers.',
];

const isEmpty = (v) => v === undefined || v === null || v === ''
  || (Array.isArray(v) && v.length === 0)
  || (typeof v === 'object' && !Array.isArray(v) && Object.values(v).every(isEmpty));

// Lists that must stay present even when empty (the validator requires them).
const KEEP_EMPTY = new Set(['people', 'accounts']);

function scalar(v) {
  if (typeof v === 'string') v = v.replace(/\s*\n\s*/g, ' ');
  return dump(v, { schema: CORE_SCHEMA, lineWidth: -1 }).trimEnd();
}

function flowItem(v) {
  if (typeof v === 'string' && /^[A-Za-z0-9_.-]+$/.test(v)) return scalar(v);
  return typeof v === 'string' ? JSON.stringify(v) : scalar(v);
}

const orderedKeys = (obj, pos) => {
  const known = ORDER[pos] ?? [];
  return [...known.filter((k) => k in obj), ...Object.keys(obj).filter((k) => !known.includes(k))];
};

const child = (pos, key) => (pos ? `${pos}.${key}` : key);

// Lines for a mapping at `indent`; `first` is the prefix for the first line ("- " for list items).
function mapLines(obj, pos, indent) {
  const lines = [];
  const pad = ' '.repeat(indent);
  for (const key of orderedKeys(obj, pos)) {
    const v = obj[key];
    const kpos = child(pos, key);
    if (isEmpty(v) && !(pos === '' && KEEP_EMPTY.has(key))) continue;
    if (pos === '' && NOTES[key]) lines.push('', `${pad}# ${NOTES[key]}`);
    if (Array.isArray(v)) {
      if (v.length === 0) lines.push(`${pad}${key}: []`);
      else if (v.every((x) => x === null || typeof x !== 'object')) lines.push(`${pad}${key}: [${v.map(flowItem).join(', ')}]`);
      else {
        lines.push(`${pad}${key}:`);
        for (const item of v) lines.push(...itemLines(item, `${kpos}[]`, indent + 2));
      }
    } else if (v && typeof v === 'object') {
      lines.push(`${pad}${key}:`, ...mapLines(v, kpos, indent + 2));
    } else {
      lines.push(`${pad}${key}: ${scalar(v)}`);
    }
  }
  return lines;
}

function itemLines(item, pos, indent) {
  const pad = ' '.repeat(indent);
  if (item === null || typeof item !== 'object') return [`${pad}- ${scalar(item)}`];
  const inner = mapLines(item, pos, indent + 2).filter((l) => l !== '');
  if (!inner.length) return [`${pad}- {}`];
  inner[0] = `${pad}- ${inner[0].slice(indent + 2)}`;
  return inner;
}

export function serializePlan(raw) {
  return `${[...HEADER, ...mapLines(raw, '', 0)].join('\n')}\n`;
}
