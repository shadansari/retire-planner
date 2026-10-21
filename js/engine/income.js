// Income for one calendar year, in nominal dollars.
//
// Conventions (see CLAUDE.md):
// - Salary `amount` is the start-year salary; grows by `growth` each later year.
// - Social Security `monthly_benefit` is in start-year dollars; COLA = inflation.
// - Survivor Social Security: after a death, the survivor gets the larger of their own
//   benefit (once claimed) and the deceased's benefit (from the month the deceased
//   had/would have started claiming). Spousal benefits while both alive aren't modeled.
// - Pensions are nominal at `start`, then grow by `cola`; `survivor_pct` continues to
//   the surviving spouse.

import { monthsOf, growthFactor, isAliveInMonth, countMonths } from './timeline.js';

const contributionAmount = (spec, salaryFullYear, salaryGrowth, months) => (spec.pct !== undefined
  ? spec.pct * salaryFullYear * (months / 12)
  : spec.amount * salaryGrowth * (months / 12));

export function salariesForYear(plan, year) {
  const byPerson = Object.fromEntries(plan.people.map((p) => [p.id, 0]));
  const contributions = []; // { account, employee, employer }
  for (const s of plan.salaries) {
    const person = plan.people.find((p) => p.id === s.owner);
    const months = countMonths(year, (mi) => mi <= s.endMonth && isAliveInMonth(person, mi));
    if (!months) continue;
    const g = growthFactor(s.growth, year, plan.startYear);
    const fullYear = s.amount * g;
    byPerson[s.owner] += fullYear * (months / 12);
    for (const c of s.contributions) {
      contributions.push({
        account: c.account,
        employee: contributionAmount(c.employee, fullYear, g, months),
        employer: contributionAmount(c.employer, fullYear, g, months),
      });
    }
  }
  const total = Object.values(byPerson).reduce((a, b) => a + b, 0);
  return { total, byPerson, contributions };
}

export function socialSecurityForYear(plan, year) {
  const infl = growthFactor(plan.assumptions.inflation, year, plan.startYear);
  const byPerson = Object.fromEntries(plan.people.map((p) => [p.id, 0]));
  const ssOf = (id) => plan.socialSecurity.find((s) => s.owner === id);

  for (const person of plan.people) {
    const own = ssOf(person.id);
    const spouse = plan.people.find((p) => p.id !== person.id);
    const spouseSS = spouse && ssOf(spouse.id);
    for (const mi of monthsOf(year)) {
      if (!isAliveInMonth(person, mi)) continue;
      let monthly = own && mi >= own.startMonth ? own.monthlyBenefit : 0;
      if (spouseSS && !isAliveInMonth(spouse, mi) && mi >= spouseSS.startMonth) {
        monthly = Math.max(monthly, spouseSS.monthlyBenefit);
      }
      byPerson[person.id] += monthly * infl;
    }
  }
  const total = Object.values(byPerson).reduce((a, b) => a + b, 0);
  return { total, byPerson };
}

export function pensionsForYear(plan, year) {
  let total = 0;
  for (const p of plan.pensions) {
    const owner = plan.people.find((x) => x.id === p.owner);
    const spouse = plan.people.find((x) => x.id !== p.owner);
    const monthly = (p.annual / 12) * growthFactor(p.cola, year, p.startYear);
    for (const mi of monthsOf(year)) {
      if (mi < p.startMonth) continue;
      if (isAliveInMonth(owner, mi)) total += monthly;
      else if (spouse && isAliveInMonth(spouse, mi)) total += monthly * p.survivorPct;
    }
  }
  return { total };
}

export function partTimeForYear(plan, year) {
  let total = 0;
  const byPerson = Object.fromEntries(plan.people.map((p) => [p.id, 0]));
  for (const w of plan.partTime) {
    const owner = plan.people.find((x) => x.id === w.owner);
    const months = countMonths(year, (mi) => mi >= w.startMonth && mi <= w.endMonth && isAliveInMonth(owner, mi));
    const scale = w.todayDollars ? growthFactor(plan.assumptions.inflation, year, plan.startYear) : 1;
    const amt = (w.annual / 12) * months * scale;
    total += amt;
    byPerson[w.owner] += amt;
  }
  return { total, byPerson };
}
