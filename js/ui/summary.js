import { h } from './dom.js';
import { money, moneyShort, firstName } from './format.js';

const agesText = (plan, ages) => plan.people
  .filter((p) => ages[p.id] != null)
  .map((p) => `${firstName(p.name)} ${ages[p.id]}`)
  .join(' · ');

function tile(label, value, sub) {
  return h('div', { class: 'tile' },
    h('div', { class: 'tile-label' }, label),
    h('div', { class: 'tile-value' }, value),
    sub ? h('div', { class: 'tile-sub' }, sub) : null);
}

export function renderSummary(el, plan, result, mode) {
  const { summary, years } = result;
  const unit = mode === 'real' ? "today's $" : 'future $';
  const lastRetireYear = Math.max(...plan.people.map((p) => p.retire.year));

  let headline;
  if (summary.lasts) {
    headline = h('div', { class: 'headline ok' },
      h('span', { class: 'status-icon', 'aria-hidden': 'true' }, '✓'),
      h('div', {},
        h('p', { class: 'headline-main' }, `Savings last through ${summary.endYear}`),
        h('p', { class: 'headline-sub' },
          `${agesText(plan, summary.endAges)} at the end of the plan, with ${moneyShort(summary.endBalance[mode])} left (${unit}).`)));
  } else {
    const fs = summary.firstShortfall;
    headline = h('div', { class: 'headline bad' },
      h('span', { class: 'status-icon', 'aria-hidden': 'true' }, '!'),
      h('div', {},
        h('p', { class: 'headline-main' }, `Savings run out in ${fs.year}`),
        h('p', { class: 'headline-sub' },
          `${agesText(plan, fs.ages)} that year. Unfunded spending from then through ${summary.endYear}: ${moneyShort(summary.totalShortfall[mode])} (${unit}).`)));
  }

  const atRetire = years.find((y) => y.year === lastRetireYear) ?? years[0];
  const after = years.filter((y) => y.year >= lastRetireYear);
  const lowest = (after.length ? after : years).reduce((a, b) => (b[mode].balances.total < a[mode].balances.total ? b : a));
  const end = years.at(-1);

  el.replaceChildren(
    headline,
    h('div', { class: 'tiles' },
      tile('Savings now', money(summary.startBalance), `as of statements, ${plan.asOf.year}-${String(plan.asOf.month).padStart(2, '0')}`),
      tile(`End of ${atRetire.year}`, money(atRetire[mode].balances.total), 'year both are retired'),
      tile('Lowest after retiring', money(lowest[mode].balances.total), `in ${lowest.year}`),
      tile(`End of ${end.year}`, money(end[mode].balances.total), 'end of plan')),
  );
}
