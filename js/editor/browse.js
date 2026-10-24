// Browse & edit: a list of sections (and their entries) beside the selected form.
// On a phone the two are separate screens (list → form, with a back link).

import { h } from '../ui/dom.js';
import { SECTIONS, sectionById } from './catalog.js';
import { listAt } from './model.js';
import { renderFieldsBlock, renderItem, addButton, listMessages, messageEls, button } from './form.js';
import { countBySection, countForItem, looseMessages } from './status.js';

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// Was this item edited since the last save? Match by id when there is one.
function itemChanged(base, path, item, index) {
  const old = listAt(base, path);
  const prev = item?.id ? old.find((x) => x?.id === item.id) : old[index];
  return !same(prev, item);
}

function sectionChanged(section, base, raw) {
  return section.blocks.some((b) => (b.kind === 'fields'
    ? b.fields.some((f) => !same(f.key.split('.').reduce((o, k) => o?.[k], base), f.key.split('.').reduce((o, k) => o?.[k], raw)))
    : !same(listAt(base, b.path), listAt(raw, b.path))));
}

export function renderBrowse(ctx, nav, base) {
  const { sel } = nav;
  const counts = countBySection(ctx.messages.errors);
  const tree = h('nav', { class: 'tree', 'aria-label': 'Plan sections' }, h('ul', {}, SECTIONS.map((s) => {
    const n = counts.get(s.id) ?? 0;
    const lists = s.blocks.filter((b) => b.kind === 'list');
    const head = h('button', {
      type: 'button', class: `tree-section${sel.section === s.id && sel.index == null ? ' current' : ''}`,
      'aria-current': sel.section === s.id && sel.index == null ? 'true' : null,
    }, h('span', {}, s.title),
    sectionChanged(s, base, ctx.raw) ? h('span', { class: 'changed-dot', title: 'Unsaved changes' }) : null,
    n ? h('span', { class: 'badge', title: `${n} to fix` }, String(n)) : null);
    head.addEventListener('click', () => nav.select({ section: s.id }));
    const items = lists.flatMap((b) => listAt(ctx.raw, b.path).map((item, i) => {
      const k = countForItem(ctx.messages.errors, b.path, i);
      const current = sel.path === b.path && sel.index === i;
      const btn = h('button', { type: 'button', class: `tree-item${current ? ' current' : ''}`, 'aria-current': current ? 'true' : null },
        h('span', { class: 'tree-item-title' }, b.itemTitle(ctx.raw, item)),
        itemChanged(base, b.path, item, i) ? h('span', { class: 'changed-dot', title: 'Unsaved changes' }) : null,
        k ? h('span', { class: 'badge' }, String(k)) : null);
      btn.addEventListener('click', () => nav.select({ section: s.id, path: b.path, index: i }));
      return h('li', {}, btn);
    }));
    return h('li', {}, head, items.length ? h('ul', {}, items) : null);
  })));

  const detail = h('div', { class: 'detail' }, detailView(ctx, nav));
  return h('div', { class: 'browse', 'data-pane': sel.section ? 'detail' : 'tree' }, tree, detail);
}

function backLink(nav, label, sel, { root = false } = {}) {
  return button(`← ${label}`, `Back to ${label}`, () => nav.select(sel), { cls: `link back${root ? ' root' : ''}` });
}

function detailView(ctx, nav) {
  const { sel } = nav;
  if (!sel.section) {
    return h('div', { class: 'detail-empty' },
      h('h2', {}, 'Your plan'),
      h('p', { class: 'intro' }, 'Pick a section to review or update. Sections and entries with a number need attention; a dot marks unsaved changes.'),
      h('p', { class: 'muted' }, 'Updating balances once or twice a year? Change "Balances are as of" under Getting started, then each account under Savings & investments.'));
  }
  const section = sectionById(sel.section);
  if (sel.path != null && sel.index != null) {
    const block = section.blocks.find((b) => b.path === sel.path);
    const list = listAt(ctx.raw, sel.path);
    if (!block || !list[sel.index]) return detailView(ctx, { ...nav, sel: { section: sel.section } });
    return h('div', {},
      h('div', { class: 'detail-back' }, backLink(nav, section.title, { section: section.id })),
      renderItem(block, sel.index, ctx, {
        headingLevel: 'h2',
        onRemoved: () => { nav.sel.index = null; nav.sel.path = null; },
        onDuplicated: (j) => { nav.sel.index = j; },
      }));
  }
  return h('div', {},
    h('div', { class: 'detail-back' }, backLink(nav, 'All sections', {}, { root: true })),
    h('h2', {}, section.title),
    h('p', { class: 'intro' }, section.intro),
    ...messageEls({ errors: looseMessages(ctx.messages.errors, section.id), warnings: [] }),
    section.blocks.map((b) => (b.kind === 'fields' ? renderFieldsBlock(b, ctx) : listOverview(b, section, ctx, nav))));
}

function listOverview(block, section, ctx, nav) {
  const list = listAt(ctx.raw, block.path);
  return h('div', { class: 'list-block' },
    block.heading ? h('h3', { class: 'block-heading' }, block.heading) : null,
    ...listMessages(block, ctx),
    list.length
      ? h('ul', { class: 'entry-list' }, list.map((item, i) => {
        const n = countForItem(ctx.messages.errors, block.path, i);
        const b = h('button', { type: 'button', class: 'entry' },
          h('span', { class: 'entry-title' }, block.itemTitle(ctx.raw, item)),
          h('span', { class: 'muted' }, block.itemSubtitle?.(ctx.raw, item) ?? ''),
          n ? h('span', { class: 'badge' }, `${n} to fix`) : h('span', { class: 'entry-go', 'aria-hidden': 'true' }, '›'));
        b.addEventListener('click', () => nav.select({ section: section.id, path: block.path, index: i }));
        return h('li', {}, b);
      }))
      : h('p', { class: 'muted empty-list' }, 'None.'),
    addButton(block, ctx, (i) => { nav.sel.path = block.path; nav.sel.index = i; }));
}
