// Everything the engine is using, in plain language, so the plan file and the
// projection can be checked against each other.

import { h } from './dom.js';
import { money, pct, ym, monthName, firstName, TYPE_LABELS } from './format.js';

const dl = (pairs) => h('dl', { class: 'kv' },
  pairs.filter(Boolean).flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));

const list = (items) => (items.length ? h('ul', {}, items.map((i) => h('li', {}, i))) : h('p', { class: 'muted' }, 'None'));

export function renderAssumptions(el, plan) {
  const nameOf = (id) => firstName(plan.people.find((p) => p.id === id)?.name ?? id);
  const acctName = (id) => plan.accounts.find((a) => a.id === id)?.name ?? id;
  const A = plan.assumptions;
  const E = plan.expenses;
  const contrib = (c) => (c.pct !== undefined ? `${pct(c.pct)} of salary` : `${money(c.amount)}/yr`);

  el.replaceChildren(
    h('h3', {}, 'General'),
    dl([
      ['Projection', `Jan ${plan.startYear} – Dec ${plan.endYear} (balances as of ${ym(plan.asOf)})`],
      ['Inflation', pct(A.inflation)],
      ['Filing status', A.filingStatus === 'married_joint' ? 'Married filing jointly' : 'Single'],
      ['State', A.state],
      ['Withdrawal order', A.withdrawalOrder.map(acctName).join(' → ')],
      ['Surplus goes to', acctName(A.depositSurplusTo)],
    ]),

    h('h3', {}, 'People'),
    list(plan.people.map((p) => `${p.name}: born ${p.birth.year}-${String(p.birth.month).padStart(2, '0')}, `
      + `retires ${ym(p.retire)} (age ${p.retire.year - p.birth.year}), planned through ${p.deathYear} (age ${p.lifeExpectancy})`)),

    h('h3', {}, 'Income'),
    list([
      ...plan.salaries.map((s) => `${nameOf(s.owner)}'s salary: ${money(s.amount)} in ${plan.startYear}, +${pct(s.growth)}/yr, last paid ${monthName(s.endMonth)}`
        + s.contributions.map((c) => `; to ${acctName(c.account)}: ${contrib(c.employee)} + employer ${contrib(c.employer)}`).join('')),
      ...plan.socialSecurity.map((x) => `${nameOf(x.owner)}'s Social Security: ${money(x.monthlyBenefit)}/month (today's $) from ${monthName(x.startMonth)} (age ${x.claimAge}${x.claimMonths ? ` and ${x.claimMonths} months` : ''})`),
      ...plan.pensions.map((x) => `${x.name} (${nameOf(x.owner)}): ${money(x.annual)}/yr from ${monthName(x.startMonth)}, COLA ${pct(x.cola)}, survivor ${pct(x.survivorPct)}`),
      ...plan.partTime.map((x) => `${x.name} (${nameOf(x.owner)}): ${money(x.annual)}/yr${x.todayDollars ? " (today's $)" : ''}, ${monthName(x.startMonth)}${Number.isFinite(x.endMonth) ? ` – ${monthName(x.endMonth)}` : ' onward'}`),
    ]),

    h('h3', {}, "Spending (today's $)"),
    dl([
      ['Everyday', `${money(E.baseAnnual)}/yr, grows ${pct(E.inflation)}/yr`],
      plan.people.length === 2 && ['After one death', `${pct(E.survivorPct)} of everyday spending`],
      ['Healthcare, per person', `${money(E.healthcare.preMedicare)}/yr retired before 65; ${money(E.healthcare.medicare)}/yr from 65; grows ${pct(E.healthcare.inflation)}/yr`],
    ]),
    list(E.items.map((i) => `${i.name}: ${money(i.amount)} ${i.startYear === i.endYear ? `in ${i.startYear}` : `${i.every > 1 ? `every ${i.every} years` : 'yearly'} ${i.startYear}–${i.endYear}`}`)),

    h('h3', {}, 'Loans'),
    list(plan.liabilities.map((l) => `${l.name}: ${money(l.balance)} at ${pct(l.rate)}, ${money(l.monthlyPayment)}/month`)),

    h('h3', {}, 'Accounts'),
    list(plan.accounts.map((a) => `${a.name} (${TYPE_LABELS[a.type]}, ${a.owner === 'joint' ? 'joint' : nameOf(a.owner)}): ${money(a.balance)}, return ${pct(a.return)}`
      + (a.type === 'taxable' ? `, dividends ${pct(a.dividendYield)}, cost basis ${money(a.costBasis)}` : ''))),

    h('h3', {}, 'How the projection works'),
    list([
      "Each year: income − money saved from pay − spending − loan payments − taxes. A surplus goes to the surplus account; a gap is withdrawn in the order above.",
      'Money moves at the start of each year; balances then grow by their return for the year.',
      'Dividends from taxable accounts are paid out as cash and count as income.',
      "\"Today's dollars\" means January " + plan.startYear + ' dollars.',
      'Healthcare while working is assumed covered by the employer (premiums inside everyday spending).',
      'After a death, the survivor keeps the larger Social Security benefit; spending drops to the survivor percentage the following year.',
      'Taxes are not modeled yet.',
    ]),
  );
}
