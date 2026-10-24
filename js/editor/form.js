// Form controls for the plan editor (DOM). Renders catalog fields against the raw plan.
//
// ctx = {
//   raw,                       the plan being edited (mutated in place)
//   messages: { errors: Map, warnings: Map }   from model.messagesByPath
//   changed(structural)        call after every edit; structural=true re-renders
//   confirm(text) → boolean
// }
// Text inputs write on 'input' (no re-render, keeps focus and caret) and re-render on
// 'change'; choices re-render immediately because they can show/hide other fields.

import { h } from '../ui/dom.js';
import {
  fromInput, toInput, readField, writeField, readAbs, writeAbs, listAt, addItem, removeItem,
  removalEffects, duplicateItem, moveItem, syncId, itemPath,
} from './model.js';
import { TYPE_INFO } from './catalog.js';
import { ACCOUNT_TYPES } from '../engine/validate.js';

const domId = (path) => `f-${path.replace(/[^A-Za-z0-9]+/g, '-')}`;

function messagesFor(ctx, path, { prefix = false } = {}) {
  const pick = (map) => (prefix
    ? [...map].filter(([p]) => p === path || p.startsWith(`${path}[`)).flatMap(([, m]) => m)
    : map.get(path) ?? []);
  return { errors: pick(ctx.messages.errors), warnings: pick(ctx.messages.warnings) };
}

function messageEls({ errors, warnings }) {
  return [
    ...errors.map((m) => h('p', { class: 'field-msg error' }, m)),
    ...warnings.map((m) => h('p', { class: 'field-msg warn' }, m)),
  ];
}

function helpEls(field) {
  return [
    field.why ? h('p', { class: 'field-why' }, field.why) : null,
    field.where ? h('p', { class: 'field-where' }, h('span', {}, 'Where to find it: '), field.where) : null,
    field.note ? h('p', { class: 'field-where' }, field.note) : null,
  ];
}

// --- single controls --------------------------------------------------------------------

function textInput(field, id, value, set, ctx) {
  const attrs = { id, type: 'text', value: toInput(field.kind, value), autocomplete: 'off', spellcheck: 'false' };
  if (field.placeholder) attrs.placeholder = field.placeholder;
  switch (field.kind) {
    case 'money': case 'percent': case 'percentOrMoney': attrs.inputmode = 'decimal'; break;
    case 'int': case 'year': attrs.inputmode = 'numeric'; break;
    case 'month': attrs.type = 'month'; attrs.placeholder = 'YYYY-MM'; break;
    case 'date': attrs.type = 'date'; break;
    default: break;
  }
  if (field.kind === 'percentOrMoney') attrs.placeholder = '10% or 23000';
  if (field.kind === 'year') attrs.placeholder = 'YYYY';
  const input = h('input', attrs);
  input.addEventListener('input', () => { set(fromInput(field.kind, input.value)); ctx.changed(false); });
  input.addEventListener('change', () => { set(fromInput(field.kind, input.value)); ctx.changed(true); });
  const prefix = field.kind === 'money' ? h('span', { class: 'affix' }, '$') : null;
  const suffix = field.kind === 'percent' ? h('span', { class: 'affix' }, '%') : field.unit ? h('span', { class: 'affix unit' }, field.unit) : null;
  return h('div', { class: `input-row kind-${field.kind}` }, prefix, input, suffix);
}

function choiceList(name, options, value, onPick, { cards = false } = {}) {
  return h('div', { class: `choices${cards ? ' cards' : ''}`, role: 'radiogroup' }, options.map((o) => {
    const input = h('input', { type: 'radio', name, value: String(o.value), checked: String(value) === String(o.value) });
    input.addEventListener('change', () => onPick(o.value));
    return h('label', { class: 'choice' }, input, h('span', { class: 'choice-text' },
      h('span', { class: 'choice-label' }, o.label), o.help ? h('span', { class: 'choice-help' }, o.help) : null));
  }));
}

function selectInput(id, options, value, onPick, placeholder = 'Choose…') {
  const sel = h('select', { id },
    h('option', { value: '' }, placeholder),
    options.map((o) => h('option', { value: o.value, selected: o.value === value }, o.label)));
  if (value && !options.some((o) => o.value === value)) sel.append(h('option', { value, selected: true }, `${value} (not available)`));
  sel.addEventListener('change', () => onPick(sel.value || undefined));
  return sel;
}

function orderControl(field, id, value, set, ctx) {
  const list = Array.isArray(value) ? [...value] : [];
  const accts = listAt(ctx.raw, 'accounts');
  const labelOf = (v) => (ACCOUNT_TYPES.includes(v) ? `All ${TYPE_INFO[v].label.toLowerCase()} accounts` : accts.find((a) => a?.id === v)?.name ?? v);
  const commit = (next) => { set(next); ctx.changed(true); };
  const rows = list.map((v, i) => h('li', { class: 'order-row' },
    h('span', { class: 'order-n' }, `${i + 1}.`),
    h('span', { class: 'order-label' }, labelOf(v)),
    button('↑', `Move ${labelOf(v)} up`, () => commit(swap(list, i, -1)), { disabled: i === 0 }),
    button('↓', `Move ${labelOf(v)} down`, () => commit(swap(list, i, 1)), { disabled: i === list.length - 1 }),
    button('✕', `Remove ${labelOf(v)}`, () => commit(list.filter((_, j) => j !== i)))));
  const available = [
    ...ACCOUNT_TYPES.filter((t) => !list.includes(t)).map((t) => ({ value: t, label: `All ${TYPE_INFO[t].label.toLowerCase()} accounts` })),
    ...accts.filter((a) => a?.id && !list.includes(a.id)).map((a) => ({ value: a.id, label: a.name || a.id })),
  ];
  const add = available.length ? selectInput(id, available, '', (v) => v && commit([...list, v]), 'Add to the order…') : null;
  return h('div', { class: 'order' }, h('ol', {}, rows), add);
}

function swap(list, i, d) {
  const next = [...list];
  [next[i], next[i + d]] = [next[i + d], next[i]];
  return next;
}

function button(text, label, onClick, { cls = 'icon', disabled = false } = {}) {
  const b = h('button', { type: 'button', class: cls, 'aria-label': label, title: label, disabled }, text);
  b.addEventListener('click', onClick);
  return b;
}

function suggestions(field, set, ctx) {
  if (!field.suggest?.length) return null;
  return h('div', { class: 'suggest' }, h('span', { class: 'suggest-label' }, 'Suggestions:'),
    field.suggest.map((sg) => button(sg.label, `Use ${sg.label}`, () => { set(structuredClone(sg.value)); ctx.changed(true); }, { cls: 'chip' })));
}

// One field. `item` is the object the key lives in (or the whole plan for absolute
// fields); `path` is the field's full path for messages and ids.
function renderField(field, { item, parent, abs = false, path }, ctx) {
  if (field.show && !field.show(abs ? ctx.raw : item, ctx.raw)) return null;
  const id = domId(path);
  const value = abs ? readAbs(ctx.raw, field) : readField(item, field);
  const set = (v) => {
    ctx.touch?.(path);
    return abs ? writeAbs(ctx.raw, field, v) : writeField(item, field, v);
  };
  const msgs = messagesFor(ctx, path, { prefix: field.kind === 'order' || field.kind === 'list' });
  let control;
  switch (field.kind) {
    case 'enum': {
      const opts = field.options(ctx.raw, item);
      control = choiceList(id, opts, value, (v) => { set(v); ctx.changed(true); }, { cards: opts.some((o) => o.help) });
      break;
    }
    case 'person': case 'account':
      control = selectInput(id, field.options(ctx.raw, item, parent), value, (v) => { set(v); ctx.changed(true); });
      break;
    case 'bool': {
      const input = h('input', { id, type: 'checkbox', checked: value !== false });
      input.addEventListener('change', () => { set(input.checked ? undefined : false); ctx.changed(true); });
      return h('div', { class: `field${msgs.errors.length ? ' has-error' : ''}` },
        h('label', { class: 'check' }, input, ` ${field.label}`), ...helpEls(field), ...messageEls(msgs));
    }
    case 'timing':
      control = choiceList(id, [{ value: 'once', label: 'One time' }, { value: 'recurring', label: 'Every year, or every few years' }],
        value, (v) => { set(v); ctx.changed(true); });
      break;
    case 'end': {
      const mode = value == null || value === 'retirement' ? 'retirement' : 'month';
      const month = mode === 'month' ? textInput({ ...field, kind: 'month' }, id, value, set, ctx) : null;
      control = h('div', {},
        choiceList(`${id}-mode`, [{ value: 'retirement', label: 'Until retirement' }, { value: 'month', label: 'Until a specific month' }],
          mode, (v) => { set(v === 'retirement' ? undefined : ''); ctx.changed(true); }),
        month);
      break;
    }
    case 'order':
      control = orderControl(field, id, value, set, ctx);
      break;
    case 'list':
      control = renderSubList(field, item, path, ctx);
      break;
    default:
      control = textInput(field, id, value, set, ctx);
  }
  const labelAttrs = ['enum', 'timing', 'end', 'order', 'list'].includes(field.kind) ? { class: 'field-label' } : { class: 'field-label', for: id };
  return h('div', { class: `field${msgs.errors.length ? ' has-error' : ''}` },
    h(['enum', 'timing', 'end', 'order', 'list'].includes(field.kind) ? 'p' : 'label', labelAttrs,
      field.label, field.required ? null : h('span', { class: 'optional' }, ' (optional)')),
    ...helpEls(field),
    control,
    suggestions(field, set, ctx),
    ...messageEls(msgs));
}

// Nested list inside an item (salary → contributions).
function renderSubList(field, parent, path, ctx) {
  const list = Array.isArray(parent[field.key]) ? parent[field.key] : [];
  const items = list.map((sub, j) => {
    const subPath = `${path}[${j}]`;
    return h('fieldset', { class: 'subitem' },
      h('legend', {}, field.itemTitle(ctx.raw, sub)),
      field.itemFields.map((f) => renderField(f, { item: sub, parent, path: `${subPath}.${f.key}` }, ctx)),
      ...messageEls(messagesFor(ctx, subPath)),
      button(`Remove this ${field.noun}`, `Remove this ${field.noun}`, () => {
        list.splice(j, 1);
        if (!list.length) delete parent[field.key];
        ctx.changed(true);
      }, { cls: 'link danger' }));
  });
  const add = button(`+ Add a ${field.noun}`, `Add a ${field.noun}`, () => {
    (parent[field.key] ??= []).push(field.newItem(ctx.raw, parent));
    ctx.changed(true);
  }, { cls: 'link' });
  return h('div', { class: 'sublist' }, items, add);
}

// --- blocks -------------------------------------------------------------------------------------

export function renderFieldsBlock(block, ctx) {
  return h('div', { class: 'fields-block' },
    block.fields.map((f) => renderField(f, { abs: true, path: f.key }, ctx)));
}

// One list item as a card: title, its fields, and actions.
export function renderItem(block, index, ctx, { onRemoved, onDuplicated, headingLevel = 'h3' } = {}) {
  const list = listAt(ctx.raw, block.path);
  const item = list[index];
  const path = itemPath(block.path, index);
  const fields = block.itemFields.map((f) => {
    const el = renderField(f, { item, path: `${path}.${f.key}` }, ctx);
    // Keep the hidden id in step with the name while nothing refers to it.
    if (el && block.idFrom && f.key === block.idFrom) {
      el.querySelector('input')?.addEventListener('input', () => syncId(ctx.raw, block.path, item));
    }
    return el;
  });
  // Messages under this item that no visible field shows (e.g. a hidden id).
  const shownPaths = block.itemFields.filter((f) => !f.show || f.show(item, ctx.raw)).map((f) => `${path}.${f.key}`);
  const isShown = (p) => shownPaths.some((sp) => p === sp || p.startsWith(`${sp}[`));
  const pick = (map) => [...map]
    .filter(([p]) => (p === path || p.startsWith(`${path}.`)) && !isShown(p))
    .filter(([p]) => !(p.endsWith('.id') && block.idFrom && !item?.[block.idFrom])) // name missing says it
    .flatMap(([, m]) => m);
  const loose = { errors: pick(ctx.messages.errors), warnings: pick(ctx.messages.warnings) };
  const sub = block.itemSubtitle?.(ctx.raw, item);
  const remove = button('Remove', `Remove ${block.itemTitle(ctx.raw, item)}`, () => {
    const effects = removalEffects(ctx.raw, block.path, index);
    const title = block.itemTitle(ctx.raw, item);
    const text = effects.length
      ? `Remove "${title}"? This also removes:\n• ${effects.join('\n• ')}`
      : `Remove "${title}"?`;
    if (!ctx.confirm(text)) return;
    removeItem(ctx.raw, block.path, index);
    onRemoved?.();
    ctx.changed(true);
  }, { cls: 'link danger' });
  const dup = ['accounts', 'expenses.items', 'liabilities'].includes(block.path)
    ? button('Duplicate', `Duplicate ${block.itemTitle(ctx.raw, item)}`, () => {
      const j = duplicateItem(ctx.raw, block.path, index);
      onDuplicated?.(j);
      ctx.changed(true);
    }, { cls: 'link' })
    : null;
  const atMin = block.min && list.length <= block.min;
  return h('section', { class: 'item-card', id: domId(path) },
    h('div', { class: 'item-head' },
      h(headingLevel, {}, block.itemTitle(ctx.raw, item)), sub ? h('span', { class: 'muted' }, sub) : null),
    ...messageEls(loose),
    fields,
    h('div', { class: 'item-actions' }, dup, atMin ? null : remove));
}

export function addButton(block, ctx, onAdded) {
  const list = listAt(ctx.raw, block.path);
  if (block.max && list.length >= block.max) return null;
  const article = /^[aeiou]/.test(block.noun) ? 'an' : 'a';
  return button(list.length ? `+ Add another ${block.noun}` : `+ Add ${article} ${block.noun}`, `Add ${article} ${block.noun}`, () => {
    const i = addItem(ctx.raw, block);
    onAdded?.(i);
    ctx.changed(true);
  }, { cls: 'add' });
}

// Messages that belong to a list as a whole ("list one or two people"), not an item.
export function listMessages(block, ctx) {
  return messageEls(messagesFor(ctx, block.path));
}

export { messageEls, messagesFor, button, domId, moveItem };
