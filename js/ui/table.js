import { h } from './dom.js';
import { money } from './format.js';

const COLUMNS = [
  ['Income', (m) => m.income.total, (m) => [
    ['Salary', m.income.salary], ['Social Security', m.income.socialSecurity], ['Pension', m.income.pension],
    ['Part-time', m.income.partTime], ['Dividends', m.income.dividends]]],
  ['Saved from pay', (m) => m.contributions.employee, (m) => [['Employer match', m.contributions.employer]]],
  ['Spending', (m) => m.spending.total, (m) => [
    ['Everyday', m.spending.base], ['Extras', m.spending.items], ['Healthcare', m.spending.healthcare]]],
  ['Debt', (m) => m.debt.payment, (m) => [['Interest', m.debt.interest], ['Balance left', m.debt.balance]]],
  ['Taxes', (m) => m.taxes.total, (m) => (m.taxes.federal ? [
    ['Federal income tax', m.taxes.federal.income], ['Federal early-withdrawal penalty', m.taxes.federal.penalty],
    ['State income tax', m.taxes.state.income], ['State early-withdrawal tax', m.taxes.state.penalty],
    ['Social Security tax', m.taxes.payroll.socialSecurity], ['Medicare tax', m.taxes.payroll.medicare + m.taxes.payroll.additionalMedicare],
    ['State disability (SDI)', m.taxes.payroll.stateDisability],
    ['Federal taxable income (for reference)', m.taxes.details.taxableIncome]] : [])],
  ['Net', (m) => m.net],
  ['Withdrawn', (m) => m.withdrawals.total],
  ['Shortfall', (m) => m.shortfall],
  ['Savings at year end', (m) => m.balances.total],
];

// Native title tooltip with each cell's breakdown (supplemental detail; the totals
// shown in the cells are the primary data).
const breakdown = (parts, nameOf) => parts
  .filter(([, v]) => Math.round(v) !== 0)
  .map(([k, v]) => `${nameOf ? nameOf(k) : k}: ${money(v)}`)
  .join('\n');

export function renderTable(el, noteEl, plan, result, mode) {
  const accountName = (id) => plan.accounts.find((a) => a.id === id)?.name ?? id;
  const showShortfall = !result.summary.lasts;
  const cols = COLUMNS.filter(([name]) => name !== 'Shortfall' || showShortfall);

  const head = h('tr', {},
    h('th', { scope: 'col', class: 'sticky' }, 'Year'),
    h('th', { scope: 'col' }, 'Ages'),
    cols.map(([name]) => h('th', { scope: 'col', class: 'num' }, name)),
    h('th', { scope: 'col' }, 'Notes'));

  const rows = result.years.map((y) => {
    const m = y[mode];
    const ages = plan.people.map((p) => y.ages[p.id] ?? '—').join(' / ');
    const cells = cols.map(([name, get, parts]) => {
      let title = parts ? breakdown(parts(m)) : '';
      if (name === 'Withdrawn') {
        title = breakdown(Object.entries(m.withdrawals.byAccount), accountName);
        if (m.rmd > 0.5) title += `\nincludes required (RMD): ${money(m.rmd)}`;
      }
      const v = get(m);
      return h('td', { class: `num${v < -0.5 ? ' neg' : ''}`, title: title || null }, money(v));
    });
    const shortfall = m.shortfall > 0.5;
    return h('tr', { class: shortfall ? 'shortfall' : null },
      h('th', { scope: 'row', class: 'sticky' }, String(y.year)),
      h('td', { class: 'ages' }, ages),
      cells,
      h('td', { class: 'notes' },
        shortfall ? h('span', { class: 'badge critical' }, '! Short') : null,
        y.events.join('; ')));
  });

  const names = plan.people.map((p) => p.name.split(' ')[0]).join(' / ');
  noteEl.textContent = `${mode === 'real' ? "Today's dollars" : 'Future (nominal) dollars'}. Ages: ${names}. Hover a number for its breakdown.`;
  el.replaceChildren(h('table', { 'aria-describedby': noteEl.id },
    h('thead', {}, head),
    h('tbody', {}, rows)));
}
