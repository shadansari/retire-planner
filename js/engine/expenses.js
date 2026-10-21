// Spending for one calendar year, in nominal dollars. Inputs are start-year dollars.
//
// Healthcare, per person per month alive:
//   age ≥ 65                → medicare
//   retired and under 65    → pre_medicare
//   working and under 65    → 0 (assumed covered by employer; premiums in base spending)

import {
  monthsOf, growthFactor, isAlive, isAliveInMonth, isRetiredInMonth, ageInMonth,
} from './timeline.js';

export function expensesForYear(plan, year) {
  const E = plan.expenses;
  const start = plan.startYear;

  const aliveCount = plan.people.filter((p) => isAlive(p, year)).length;
  const survivorScale = plan.people.length === 2 && aliveCount === 1 ? E.survivorPct : 1;
  const base = E.baseAnnual * growthFactor(E.inflation, year, start) * survivorScale;

  const itemList = [];
  for (const it of E.items) {
    if (year < it.startYear || year > it.endYear || (year - it.startYear) % it.every !== 0) continue;
    itemList.push({ name: it.name, amount: it.amount * growthFactor(it.inflation, year, start) });
  }
  const items = itemList.reduce((a, it) => a + it.amount, 0);

  const H = E.healthcare;
  const hcScale = growthFactor(H.inflation, year, start);
  let healthcare = 0;
  for (const p of plan.people) {
    for (const mi of monthsOf(year)) {
      if (!isAliveInMonth(p, mi)) continue;
      if (ageInMonth(p, mi) >= 65) healthcare += H.medicare / 12;
      else if (isRetiredInMonth(p, mi)) healthcare += H.preMedicare / 12;
    }
  }
  healthcare *= hcScale;

  return { base, items, itemList, healthcare, total: base + items + healthcare };
}
