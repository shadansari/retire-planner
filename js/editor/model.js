// Editing operations on the *raw* plan (the parsed-YAML object, schema v1 encoding:
// "6%" strings, plain numbers, "2032-06" months). Pure: no DOM. The editor keeps one
// raw object, mutates it through these helpers, and re-runs validatePlan on it.

import { SECTIONS, LIST_BLOCKS } from './catalog.js';
import { ACCOUNT_TYPES } from '../engine/validate.js';

// --- paths ------------------------------------------------------------------------------
// "assumptions.state", "income.salaries". List items are addressed as (path, index).

export function getIn(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

// Sets (creating parent mappings); undefined deletes the key.
export function setIn(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (const k of keys.slice(0, -1)) {
    if (o[k] == null || typeof o[k] !== 'object' || Array.isArray(o[k])) o[k] = {};
    o = o[k];
  }
  const last = keys.at(-1);
  if (value === undefined) delete o[last];
  else o[last] = value;
}

export function listAt(raw, path, { create = false } = {}) {
  let list = getIn(raw, path);
  if (!Array.isArray(list)) {
    if (!create) return [];
    list = [];
    setIn(raw, path, list);
  }
  return list;
}

export const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

// --- input <-> raw encoding ----------------------------------------------------------------

const MONEY_RE = /^\$?\s*-?[\d,]+(\.\d+)?$/;
const toMoney = (s) => (MONEY_RE.test(s) ? Number(s.replace(/[$,\s]/g, '')) : s);
const toInt = (s) => (/^-?\d+$/.test(s) ? Number(s) : s);
const pctNumber = (s) => s.replace(/%$/, '').trim();

// Text typed into a control → raw value (undefined = remove the key). Invalid input is
// kept as typed so validatePlan reports it next to the field.
export function fromInput(kind, input) {
  if (kind === 'bool') return Boolean(input);
  const s = String(input ?? '').trim();
  if (s === '') return undefined;
  switch (kind) {
    case 'money': return toMoney(s);
    case 'percent': return /^-?\d+(\.\d+)?%?$/.test(s) ? `${pctNumber(s)}%` : s;
    case 'int': case 'year': return toInt(s);
    case 'percentOrMoney': return s.endsWith('%') ? `${pctNumber(s)}%` : toMoney(s);
    default: return s;
  }
}

// Raw value → text for a control.
export function toInput(kind, value) {
  if (value == null) return kind === 'bool' ? false : '';
  if (kind === 'bool') return value === true;
  if (kind === 'percent' && typeof value === 'string') return pctNumber(value);
  if ((kind === 'money' || kind === 'percentOrMoney') && typeof value === 'number') return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return String(value);
}

// --- virtual fields ------------------------------------------------------------------------

// Expense timing: one-time ("year") vs recurring ("start"/"end"/"every").
export const getTiming = (item) => (item?.start != null ? 'recurring' : 'once');
export function setTiming(item, timing) {
  if (timing === getTiming(item)) return;
  if (timing === 'recurring') {
    item.start = item.year ?? '';
    item.end = item.year ?? '';
    delete item.year;
  } else {
    item.year = item.start ?? '';
    delete item.start;
    delete item.end;
    delete item.every;
  }
}

// Field value read/write honoring virtual kinds.
export function readField(item, field) {
  if (field.kind === 'timing') return getTiming(item);
  return item?.[field.key];
}
export function writeField(item, field, value) {
  if (field.kind === 'timing') return setTiming(item, value);
  if (value === undefined) delete item[field.key];
  else item[field.key] = value;
}

// For a 'fields' block, fields have absolute paths and the "item" is the whole plan.
export const readAbs = (raw, field) => getIn(raw, field.key);
export const writeAbs = (raw, field, value) => setIn(raw, field.key, value);

// --- ids ---------------------------------------------------------------------------------------
// People and accounts are referenced by id. Ids are derived from the name and hidden from
// the user; renaming re-derives the id and updates every reference to it.

export function slug(text, { first = false } = {}) {
  let s = String(text ?? '').toLowerCase().replace(/[()'’.]/g, ''); // "401(k)" → "401k"
  if (first) s = s.trim().split(/\s+/)[0] ?? '';
  s = s.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30);
  if (s && !/^[a-z]/.test(s)) s = `x_${s}`;
  return s;
}

function idsInUse(raw, path, except) {
  return new Set(listAt(raw, path).filter((x) => x !== except).map((x) => x?.id).filter(Boolean));
}

export function uniqueId(raw, path, base, except) {
  const fallback = path === 'people' ? 'person' : 'account';
  let b = base || fallback;
  if (path === 'accounts' && ACCOUNT_TYPES.includes(b)) b = `${b}_1`;
  if (path === 'people' && b === 'joint') b = 'joint_1';
  const used = idsInUse(raw, path, except);
  if (!used.has(b)) return b;
  for (let n = 2; ; n++) if (!used.has(`${b}_${n}`)) return `${b}_${n}`;
}

// Everything in the plan that points at a person or account id.
export function referencesTo(raw, kind, id) {
  if (!id) return [];
  const refs = [];
  if (kind === 'person') {
    for (const path of ['income.salaries', 'income.social_security', 'income.pensions', 'income.part_time', 'accounts']) {
      listAt(raw, path).forEach((x, i) => { if (x?.owner === id) refs.push({ path, index: i }); });
    }
  } else {
    listAt(raw, 'income.salaries').forEach((s, i) => (Array.isArray(s?.contributions) ? s.contributions : []).forEach((c, j) => {
      if (c?.account === id) refs.push({ path: 'income.salaries', index: i, sub: j });
    }));
    if (Array.isArray(raw?.assumptions?.withdrawal_order) && raw.assumptions.withdrawal_order.includes(id)) refs.push({ path: 'assumptions.withdrawal_order' });
    if (raw?.assumptions?.deposit_surplus_to === id) refs.push({ path: 'assumptions.deposit_surplus_to' });
  }
  return refs;
}

// Point every reference at a new id.
export function renameId(raw, path, oldId, newId) {
  if (!oldId || oldId === newId) return;
  if (path === 'people') {
    for (const p of ['income.salaries', 'income.social_security', 'income.pensions', 'income.part_time', 'accounts']) {
      for (const x of listAt(raw, p)) if (x?.owner === oldId) x.owner = newId;
    }
    return;
  }
  for (const s of listAt(raw, 'income.salaries')) {
    for (const c of Array.isArray(s?.contributions) ? s.contributions : []) if (c?.account === oldId) c.account = newId;
  }
  const order = raw?.assumptions?.withdrawal_order;
  if (Array.isArray(order)) raw.assumptions.withdrawal_order = order.map((x) => (x === oldId ? newId : x));
  if (raw?.assumptions?.deposit_surplus_to === oldId) raw.assumptions.deposit_surplus_to = newId;
}

// After a name edit on a person/account: re-derive its id, carrying references along.
export function syncId(raw, path, item) {
  if (path !== 'people' && path !== 'accounts') return;
  const base = slug(item.name, { first: path === 'people' });
  if (!base) return;
  const next = uniqueId(raw, path, base, item);
  if (next === item.id) return;
  renameId(raw, path, item.id, next);
  item.id = next;
}

// Re-derive every person/account id from its name (used when the editor opens, so a
// file written before names were real ends up with readable ids on its next save).
export function normalizeIds(raw) {
  for (const path of ['people', 'accounts']) for (const item of listAt(raw, path)) if (item?.name) syncId(raw, path, item);
}

export const firstName = (name) => String(name ?? '').trim().split(/\s+/)[0] ?? '';
const escapeRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A person's first name changed: replace the old one (whole word) in the names of the
// accounts, pensions and part-time work they own. → number of names changed.
export function propagateFirstName(raw, personId, oldFirst, newFirst) {
  if (!personId || !oldFirst || !newFirst || oldFirst === newFirst) return 0;
  const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(oldFirst)}(?=$|[^\\p{L}\\p{N}])`, 'gu');
  let n = 0;
  for (const path of ['accounts', 'income.pensions', 'income.part_time']) {
    for (const x of listAt(raw, path)) {
      if (x?.owner !== personId || typeof x.name !== 'string') continue;
      const next = x.name.replace(re, `$1${newFirst}`);
      if (next !== x.name) { x.name = next; n++; }
    }
  }
  return n;
}

// Names still carrying an old first name, recognizable because ids came from first
// names: person id "alex" now named "Sam …" → "Alex 401(k)" (owned by them) becomes
// "Sam 401(k)". → number of names changed.
export function fixStaleNames(raw) {
  let n = 0;
  for (const p of listAt(raw, 'people')) {
    if (!p?.id || !/^[a-z]+$/.test(p.id)) continue;
    const old = p.id.charAt(0).toUpperCase() + p.id.slice(1);
    const now = firstName(p.name);
    if (now && now.toLowerCase() !== p.id) n += propagateFirstName(raw, p.id, old, now);
  }
  return n;
}

// --- add / duplicate / remove ----------------------------------------------------------------

export function addItem(raw, block, parent = null) {
  const list = parent ? (parent[block.key] ??= []) : listAt(raw, block.path, { create: true });
  const item = block.newItem(raw, parent);
  list.push(item);
  return list.length - 1;
}

export function duplicateItem(raw, path, index) {
  const list = listAt(raw, path);
  const copy = clone(list[index]);
  if (copy && typeof copy === 'object') {
    if (copy.name) copy.name = `${copy.name} (copy)`;
    if ('id' in copy) copy.id = uniqueId(raw, path, slug(copy.name, { first: path === 'people' }), copy);
  }
  list.splice(index + 1, 0, copy);
  return index + 1;
}

// What removing an item would also remove, as sentences for a confirm dialog.
export function removalEffects(raw, path, index) {
  const item = listAt(raw, path)[index];
  const out = [];
  const label = (p, i) => {
    const b = LIST_BLOCKS.find((x) => x.path === p);
    return b ? b.itemTitle(raw, listAt(raw, p)[i]) : p;
  };
  if (path === 'people' && item?.id) {
    for (const r of referencesTo(raw, 'person', item.id)) out.push(label(r.path, r.index));
  }
  if (path === 'accounts' && item?.id) {
    for (const r of referencesTo(raw, 'account', item.id)) {
      if (r.sub != null) out.push(`the contribution into it from ${label(r.path, r.index)}`);
      else if (r.path.endsWith('withdrawal_order')) out.push('its place in the withdrawal order');
      else out.push('the choice of where surplus money goes (pick another account)');
    }
  }
  return out;
}

function removeAccountRefs(raw, id) {
  for (const s of listAt(raw, 'income.salaries')) {
    if (Array.isArray(s?.contributions)) {
      s.contributions = s.contributions.filter((c) => c?.account !== id);
      if (!s.contributions.length) delete s.contributions;
    }
  }
  const order = raw?.assumptions?.withdrawal_order;
  if (Array.isArray(order)) raw.assumptions.withdrawal_order = order.filter((x) => x !== id);
  if (raw?.assumptions?.deposit_surplus_to === id) delete raw.assumptions.deposit_surplus_to;
}

export function removeItem(raw, path, index) {
  const list = listAt(raw, path);
  const [item] = list.splice(index, 1);
  if (path === 'accounts' && item?.id) removeAccountRefs(raw, item.id);
  if (path === 'people' && item?.id) {
    for (const p of ['income.salaries', 'income.social_security', 'income.pensions', 'income.part_time']) {
      const l = listAt(raw, p);
      for (let i = l.length - 1; i >= 0; i--) if (l[i]?.owner === item.id) l.splice(i, 1);
    }
    const accts = listAt(raw, 'accounts');
    for (let i = accts.length - 1; i >= 0; i--) {
      if (accts[i]?.owner === item.id) {
        const [a] = accts.splice(i, 1);
        if (a?.id) removeAccountRefs(raw, a.id);
      }
    }
  }
  return item;
}

export function moveItem(raw, path, index, delta) {
  const list = listAt(raw, path);
  const j = index + delta;
  if (j < 0 || j >= list.length) return index;
  [list[index], list[j]] = [list[j], list[index]];
  return j;
}

// --- validation messages → fields --------------------------------------------------------------
// validatePlan messages end with " [path]"; the editor shows each next to its field,
// without the "Alex's salary: " prefix, the path, or the leading "key" name.

export function messagesByPath(messages) {
  const map = new Map();
  for (const m of messages) {
    const match = / \[((?:[^[\]]|\[\d+\])+)\]$/.exec(m); // path may contain [n]
    const path = match ? match[1] : '';
    let text = match ? m.slice(0, match.index) : m;
    text = text.replace(/^[^:]+: /, ''); // "Alex's salary: " prefix
    text = text.replace(/^"[a-z_]+" is missing.*$/, 'Required.');
    text = text.replace(/^"[a-z_]+" /, '');
    text = text.charAt(0).toUpperCase() + text.slice(1);
    if (!map.has(path)) map.set(path, []);
    map.get(path).push(text);
  }
  return map;
}

// Paths for addressing: list item "accounts[2]", its field "accounts[2].balance",
// nested "income.salaries[0].contributions[1].employee".
export const itemPath = (path, index) => `${path}[${index}]`;

// --- starting points -------------------------------------------------------------------------

export function blankPlan({ year, month }) {
  const asOf = `${year}-${String(month).padStart(2, '0')}`;
  return {
    schema_version: 1,
    as_of: asOf,
    people: [],
    income: {},
    expenses: { healthcare: { inflation: '5%' } },
    liabilities: [],
    accounts: [],
    assumptions: {
      inflation: '2.5%',
      filing_status: 'married_joint',
      state: 'CA',
      withdrawal_order: ['cash', 'taxable', 'traditional', 'hsa', 'roth'],
    },
  };
}

// --- change summary (commit messages, "unsaved changes" marks) ----------------------------------

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// → ["Alex 401(k): balance", "added expense \"Boat\"", …]
export function changeSummary(before, after) {
  const out = [];
  // Carry id renames (same position, new id) into a copy of `before`, so references that
  // merely followed a rename don't show up as changes.
  before = clone(before) ?? {};
  for (const path of ['people', 'accounts']) {
    const a = listAt(before, path);
    const bIds = new Set(listAt(after, path).map((x) => x?.id));
    listAt(after, path).forEach((x, i) => {
      const old = a[i];
      if (old?.id && x?.id && old.id !== x.id && !bIds.has(old.id) && !a.some((y) => y?.id === x.id)) {
        renameId(before, path, old.id, x.id);
        old.id = x.id;
      }
    });
  }
  for (const section of SECTIONS) {
    for (const block of section.blocks) {
      if (block.kind === 'fields') {
        for (const f of block.fields) {
          if (!same(getIn(before, f.key), getIn(after, f.key))) out.push(`${section.title}: ${f.label.toLowerCase()}`);
        }
        continue;
      }
      const a = listAt(before, block.path);
      const b = listAt(after, block.path);
      // Match by id; an item whose id changed (renamed) matches the old one at its index.
      const bIds = new Set(b.map((x) => x?.id).filter(Boolean));
      const aIds = new Set(a.map((x) => x?.id).filter(Boolean));
      const key = (x, i, otherIds) => (x?.id && otherIds.has(x.id) ? `id:${x.id}` : `i:${i}`);
      const aMap = new Map(a.map((x, i) => [key(x, i, bIds), x]));
      const bMap = new Map(b.map((x, i) => [key(x, i, aIds), x]));
      for (const [k, x] of bMap) {
        const old = aMap.get(k);
        const title = block.itemTitle(after, x);
        if (!old) { out.push(`added ${block.noun} "${title}"`); continue; }
        if (same(old, x)) continue;
        const changed = block.itemFields
          .filter((f) => f.kind !== 'timing' && !same(old?.[f.key], x?.[f.key]))
          .map((f) => f.label.toLowerCase());
        out.push(`${title}: ${changed.length ? changed.join(', ') : 'edited'}`);
      }
      for (const [k, x] of aMap) if (!bMap.has(k)) out.push(`removed ${block.noun} "${block.itemTitle(before, x)}"`);
    }
  }
  if (!same(before?.as_of, after?.as_of) && !out.some((s) => s.startsWith('Getting started'))) out.push('balances date');
  return out;
}

export function commitMessage(changes) {
  if (!changes.length) return 'Update plan';
  const head = changes.length === 1 ? `Update plan: ${changes[0]}` : `Update plan (${changes.length} changes)`;
  return changes.length === 1 ? head : `${head}\n\n${changes.map((c) => `- ${c}`).join('\n')}`;
}
