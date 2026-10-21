// Annual simulation. Pure: takes the normalized plan (from validatePlan), returns
//   { years: Row[], summary }
// Row = { year, ages, events, nominal: Money, real: Money }
// real = nominal / (1 + inflation)^(year − startYear), i.e. start-year ("today's") dollars.
//
// Per-year order (CLAUDE.md "Engine semantics"): inflows, outflows, net; surplus is
// deposited, a gap is withdrawn in withdrawal order; then accounts grow.
// Taxes are 0 until M2 plugs in a tax model + gross-up.

import { salariesForYear, socialSecurityForYear, pensionsForYear, partTimeForYear } from './income.js';
import { expensesForYear } from './expenses.js';
import { amortizeYear } from './liabilities.js';
import { initAccounts, deposit, dividendsOf, grow, withdrawInOrder } from './accounts.js';
import { isAlive, ageAtYearEnd, growthFactor } from './timeline.js';
import { ACCOUNT_TYPES } from './validate.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtMonth = (mi) => MONTHS[mi % 12];
const sum = (xs) => xs.reduce((a, b) => a + b, 0);

// Recursively divide every number in a plain object tree.
const scaleTree = (v, d) => {
  if (typeof v === 'number') return v / d;
  if (Array.isArray(v)) return v.map((x) => scaleTree(x, d));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scaleTree(x, d)]));
  return v;
};

function eventsForYear(plan, year) {
  const ev = [];
  const firstName = (id) => plan.people.find((p) => p.id === id).name.split(' ')[0];
  for (const p of plan.people) {
    const n = p.name.split(' ')[0];
    if (p.retire.year === year) ev.push(`${n} retires (${MONTHS[p.retire.month - 1]})`);
    if (p.birth.year + 65 === year) ev.push(`${n} turns 65 (Medicare)`);
    if (p.deathYear === year) ev.push(`Plan for ${n} ends (age ${p.lifeExpectancy})`);
  }
  for (const s of plan.socialSecurity) {
    if (Math.floor(s.startMonth / 12) === year) ev.push(`${firstName(s.owner)} starts Social Security (${fmtMonth(s.startMonth)})`);
  }
  for (const p of plan.pensions) if (p.startYear === year) ev.push(`${p.name} starts`);
  for (const w of plan.partTime) {
    if (Math.floor(w.startMonth / 12) === year) ev.push(`${w.name} starts`);
    if (Number.isFinite(w.endMonth) && Math.floor(w.endMonth / 12) === year) ev.push(`${w.name} ends`);
  }
  return ev;
}

const noTaxes = () => ({ total: 0 });

export function simulate(plan, { taxModel = noTaxes } = {}) {
  const accounts = initAccounts(plan);
  const loans = plan.liabilities.map((l) => ({ ...l }));
  const order = plan.assumptions.withdrawalOrder;
  const years = [];
  let firstShortfall = null;

  for (let year = plan.startYear; year <= plan.endYear; year++) {
    const ages = Object.fromEntries(plan.people.map((p) => [p.id, isAlive(p, year) ? ageAtYearEnd(p, year) : null]));
    const events = eventsForYear(plan, year);

    // Inflows
    const sal = salariesForYear(plan, year);
    const ss = socialSecurityForYear(plan, year);
    const pen = pensionsForYear(plan, year);
    const pt = partTimeForYear(plan, year);
    const dividends = sum(accounts.map(dividendsOf));
    const income = {
      salary: sal.total,
      socialSecurity: ss.total,
      pension: pen.total,
      partTime: pt.total,
      dividends,
      total: sal.total + ss.total + pen.total + pt.total + dividends,
    };

    // Payroll contributions go straight into their accounts.
    const contributions = { employee: 0, employer: 0 };
    const deposits = {};
    for (const c of sal.contributions) {
      const amt = c.employee + c.employer;
      deposit(accounts.find((a) => a.id === c.account), amt);
      deposits[c.account] = (deposits[c.account] ?? 0) + amt;
      contributions.employee += c.employee;
      contributions.employer += c.employer;
    }

    // Outflows
    const exp = expensesForYear(plan, year);
    const spending = { base: exp.base, items: exp.items, healthcare: exp.healthcare, total: exp.total };
    const debt = { payment: 0, interest: 0, balance: 0 };
    for (const loan of loans) {
      const r = amortizeYear(loan);
      loan.balance = r.balance;
      debt.payment += r.payment;
      debt.interest += r.interest;
      debt.balance += r.balance;
      if (r.paidOffMonth) events.push(`${loan.name} paid off (${MONTHS[r.paidOffMonth - 1]})`);
    }

    const taxes = taxModel({ plan, year, income, contributions, withdrawals: {}, realizedGains: 0 });

    // Net cash flow: surplus saved, gap withdrawn.
    const net = income.total - contributions.employee - spending.total - debt.payment - taxes.total;
    let withdrawals = {};
    let realizedGains = 0;
    let shortfall = 0;
    if (net >= 0) {
      deposit(accounts.find((a) => a.id === plan.assumptions.depositSurplusTo), net);
      deposits[plan.assumptions.depositSurplusTo] = (deposits[plan.assumptions.depositSurplusTo] ?? 0) + net;
    } else {
      const w = withdrawInOrder(accounts, order, -net);
      withdrawals = w.byAccount;
      realizedGains = w.gains;
      shortfall = w.remaining;
    }
    if (shortfall > 0 && !firstShortfall) {
      firstShortfall = { year, ages };
      events.push('Savings run out');
    }

    accounts.forEach(grow);

    const byAccount = Object.fromEntries(accounts.map((a) => [a.id, a.balance]));
    const byType = Object.fromEntries(ACCOUNT_TYPES.map((t) => [t, sum(accounts.filter((a) => a.type === t).map((a) => a.balance))]));
    const nominal = {
      income,
      contributions,
      spending,
      debt,
      taxes,
      net,
      withdrawals: { total: sum(Object.values(withdrawals)), byAccount: withdrawals },
      deposits: { total: sum(Object.values(deposits)), byAccount: deposits },
      realizedGains,
      shortfall,
      balances: { byAccount, byType, total: sum(Object.values(byAccount)) },
    };
    const deflator = growthFactor(plan.assumptions.inflation, year, plan.startYear);
    years.push({ year, ages, events, deflator, nominal, real: scaleTree(nominal, deflator) });
  }

  const last = years[years.length - 1];
  const totalShortfall = sum(years.map((y) => y.nominal.shortfall));
  const totalShortfallReal = sum(years.map((y) => y.real.shortfall));
  return {
    years,
    summary: {
      startYear: plan.startYear,
      endYear: plan.endYear,
      lasts: firstShortfall === null,
      firstShortfall,
      endAges: last.ages,
      totalShortfall: { nominal: totalShortfall, real: totalShortfallReal },
      endBalance: { nominal: last.nominal.balances.total, real: last.real.balances.total },
      startBalance: sum(plan.accounts.map((a) => a.balance)),
    },
  };
}
