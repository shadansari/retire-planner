// Guided setup: one section per step, Back / Next, progress, and a final review.
// Steps can be skipped; nothing blocks moving on. Problems are listed at review.

import { h } from '../ui/dom.js';
import { SECTIONS } from './catalog.js';
import { listAt, addItem } from './model.js';
import { renderFieldsBlock, renderItem, addButton, listMessages, messageEls, button } from './form.js';
import { countBySection, looseMessages } from './status.js';

const STEPS = [...SECTIONS.map((s) => ({ id: s.id, title: s.title })), { id: 'review', title: 'Review' }];

export function renderWizard(ctx, nav) {
  const i = Math.min(nav.step, STEPS.length - 1);
  const step = STEPS[i];
  const counts = countBySection(ctx.messages.errors);

  const progress = h('nav', { class: 'wiz-progress', 'aria-label': 'Setup steps' },
    h('div', { class: 'wiz-bar' }, h('div', { class: 'wiz-bar-fill', 'data-pct': '' })),
    h('ol', { class: 'wiz-steps' }, STEPS.map((s, j) => {
      const n = counts.get(s.id) ?? 0;
      const b = h('button', {
        type: 'button', class: `wiz-step${j === i ? ' current' : ''}${j < i ? ' done' : ''}`,
        'aria-current': j === i ? 'step' : null,
        'aria-label': `Step ${j + 1}: ${s.title}${n ? `, ${n} to fix` : ''}`,
      }, h('span', { class: 'wiz-n' }, String(j + 1)), h('span', { class: 'wiz-t' }, s.title), n ? h('span', { class: 'badge' }, String(n)) : null);
      b.addEventListener('click', () => nav.goStep(j));
      return h('li', {}, b);
    })));
  progress.querySelector('.wiz-bar-fill').style.width = `${Math.round((i / (STEPS.length - 1)) * 100)}%`;

  const body = step.id === 'review' ? reviewStep(ctx, nav, counts) : sectionStep(SECTIONS[i], ctx);

  const back = i > 0 ? button('← Back', `Back to ${STEPS[i - 1].title}`, () => nav.goStep(i - 1), { cls: '' }) : h('span');
  const next = i < STEPS.length - 1
    ? button(`Next: ${STEPS[i + 1].title} →`, `Next: ${STEPS[i + 1].title}`, () => nav.goStep(i + 1), { cls: 'primary' })
    : null;

  return h('div', { class: 'wizard' },
    progress,
    h('p', { class: 'wiz-count muted' }, `Step ${i + 1} of ${STEPS.length}`),
    body,
    h('div', { class: 'wiz-nav' }, back, next));
}

function sectionStep(section, ctx) {
  // A first person/account appears ready to fill in, rather than an empty list.
  const empty = section.blocks.filter((b) => b.kind === 'list' && b.min && listAt(ctx.raw, b.path).length === 0);
  if (empty.length) {
    empty.forEach((b) => addItem(ctx.raw, b));
    ctx.changed(true); // revalidate and render again with the new item
  }
  return h('section', { class: 'wiz-section' },
    h('h2', {}, section.title),
    h('p', { class: 'intro' }, section.intro),
    ...messageEls({ errors: looseMessages(ctx.messages.errors, section.id), warnings: [] }),
    section.blocks.map((b) => (b.kind === 'fields' ? renderFieldsBlock(b, ctx) : listBlock(b, ctx))));
}

function listBlock(block, ctx) {
  const list = listAt(ctx.raw, block.path);
  return h('div', { class: 'list-block' },
    block.heading ? h('h3', { class: 'block-heading' }, block.heading) : null,
    ...listMessages(block, ctx),
    list.length ? null : h('p', { class: 'muted empty-list' }, 'None yet. Add one if it applies, or go on to the next step.'),
    list.map((_, idx) => renderItem(block, idx, ctx)),
    addButton(block, ctx));
}

function reviewStep(ctx, nav, counts) {
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  const rows = SECTIONS.map((s, j) => {
    const n = counts.get(s.id) ?? 0;
    const lists = s.blocks.filter((b) => b.kind === 'list');
    const none = !n && lists.length === s.blocks.length && lists.every((b) => listAt(ctx.raw, b.path).length === 0);
    const [cls, mark, text] = n ? ['todo', '!', `${n} to fix`] : none ? ['none', '–', 'Nothing added yet'] : ['ok', '✓', 'Complete'];
    const go = button(n ? 'Fix' : none ? 'Add' : 'Review', `${n ? 'Fix' : none ? 'Add to' : 'Review'} ${s.title}`, () => nav.goStep(j), { cls: 'link' });
    return h('li', { class: cls },
      h('span', { class: 'review-mark', 'aria-hidden': 'true' }, mark),
      h('span', { class: 'review-title' }, s.title),
      h('span', { class: 'muted' }, text),
      go);
  });
  const see = button('See the projection', 'See the projection', () => nav.preview(), { cls: 'primary', disabled: total > 0 });
  return h('section', { class: 'wiz-section' },
    h('h2', {}, 'Review'),
    h('p', { class: 'intro' }, total
      ? `Almost there: ${total} thing${total === 1 ? '' : 's'} still need${total === 1 ? 's' : ''} attention before the projection can run.`
      : 'Everything needed is filled in. Look at the projection, then save the plan so it is there next time.'),
    h('ul', { class: 'review' }, rows),
    h('div', { class: 'review-actions' }, see));
}
