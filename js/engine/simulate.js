// Annual simulation. Pure: takes the normalized plan (from validatePlan) and optional
// tax tables, returns
//   { years: Row[], summary }
// Row = { year, ages, events, deflator, nominal: Money, real: Money }
// real = nominal / (1 + inflation)^(year − startYear), i.e. start-year ("today's") dollars.
//
// Per-year order (CLAUDE.md "Engine semantics"): inflows; payroll contributions;
// outflows; RMDs; then taxes and withdrawals are solved together (gross-up by
// bisection, since withdrawing from pre-tax accounts creates more tax); surplus is
// deposited; accounts grow.
//
// simulate(plan, { taxTables: { federal, state, rmd } }) — without taxTables, taxes
// and RMDs are skipped (used by M1 tests and as a no-tax comparison).

import { salariesForYear, socialSecurityForYear, pensionsForYear, partTimeForYear } from './income.js';
import { expensesForYear } from './expenses.js';
import { amortizeYear } from './liabilities.js';
import { initAccounts, deposit, withdraw, dividendsOf, grow, withdrawInOrder } from './accounts.js';
import { isAlive, ageAtYearEnd, growthFactor } from './timeline.js';
import { ACCOUNT_TYPES } from './validate.js';
import { monthIndex } from './parse.js';
import { computeTaxes } from './tax/index.js';
import { rmdAmount, rmdStartAge } from './tax/rmd.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtMonth = (mi) => MONTHS[mi % 12];
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const addTo = (obj, k, v) => { obj[k] = (obj[k] ?? 0) + v; };

// Recursively divide every number in a plain object tree (strings left alone).
const scaleTree = (v, d) => {
  if (typeof v === 'number') return v / d;
  if (Array.isArray(v)) return v.map((x) => scaleTree(x, d));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scaleTree(x, d)]));
  return v;
};

const firstName = (p) => p.name.split(' ')[0];

function eventsForYear(plan, year, rmd) {
  const ev = [];
  const byId = (id) => plan.people.find((p) => p.id === id);
  for (const p of plan.people) {
    if (p.retire.year === year) ev.push(`${firstName(p)} retires (${MONTHS[p.retire.month - 1]})`);
    if (p.birth.year + 65 === year) ev.push(`${firstName(p)} turns 65 (Medicare)`);
    if (rmd && p.birth.year + rmdStartAge(p.birth.year, rmd) === year
        && plan.accounts.some((a) => a.type === 'traditional' && a.owner === p.id)) {
      ev.push(`${firstName(p)}'s required withdrawals (RMDs) begin`);
    }
    if (p.deathYear === year) ev.push(`Plan for ${firstName(p)} ends (age ${p.lifeExpectancy})`);
  }
  for (const s of plan.socialSecurity) {
    if (Math.floor(s.startMonth / 12) === year) ev.push(`${firstName(byId(s.owner))} starts Social Security (${fmtMonth(s.startMonth)})`);
  }
  for (const p of plan.pensions) if (p.startYear === year) ev.push(`${p.name} starts`);
  for (const w of plan.partTime) {
    if (Math.floor(w.startMonth / 12) === year) ev.push(`${w.name} starts`);
    if (Number.isFinite(w.endMonth) && Math.floor(w.endMonth / 12) === year) ev.push(`${w.name} ends`);
  }
  return ev;
}

const noTaxes = { total: 0 };

export function simulate(plan, { taxTables = null } = {}) {
  const accounts = initAccounts(plan);
  const loans = plan.liabilities.map((l) => ({ ...l }));
  const order = plan.assumptions.withdrawalOrder;
  const surplusAcct = accounts.find((a) => a.id === plan.assumptions.depositSurplusTo);
  const personById = (id) => plan.people.find((p) => p.id === id);
  const years = [];
  let firstShortfall = null;

  for (let year = plan.startYear; year <= plan.endYear; year++) {
    const alive = plan.people.filter((p) => isAlive(p, year));
    const ages = Object.fromEntries(plan.people.map((p) => [p.id, isAlive(p, year) ? ageAtYearEnd(p, year) : null]));
    const events = eventsForYear(plan, year, taxTables?.rmd);
    // An account whose owner has died passes to the surviving spouse (spousal rollover).
    const effectiveOwner = (acct) => {
      const o = personById(acct.owner);
      if (!o || isAlive(o, year)) return o;
      return alive[0] ?? o;
    };

    // --- Inflows (before any withdrawals) ---
    const sal = salariesForYear(plan, year);
    const ss = socialSecurityForYear(plan, year);
    const pen = pensionsForYear(plan, year);
    const pt = partTimeForYear(plan, year);
    const dividends = sum(accounts.map(dividendsOf));
    // Cash-account interest stays in the account (it's in `return`) but is taxable.
    const interest = sum(accounts.filter((a) => a.type === 'cash').map((a) => a.balance * a.return));
    const income = {
      salary: sal.total,
      socialSecurity: ss.total,
      pension: pen.total,
      partTime: pt.total,
      dividends,
      total: sal.total + ss.total + pen.total + pt.total + dividends,
    };

    // --- RMDs: from start-of-year (= prior Dec 31) balances, before contributions ---
    const withdrawals = {};
    const rmdByAccount = {};
    let rmdTotal = 0;
    if (taxTables?.rmd) {
      for (const a of accounts) {
        if (a.type !== 'traditional') continue;
        const owner = effectiveOwner(a);
        const amt = owner ? rmdAmount(a.balance, owner, year, taxTables.rmd) : 0;
        if (amt > 0) {
          withdraw(a, amt);
          addTo(withdrawals, a.id, amt);
          rmdByAccount[a.id] = amt;
          rmdTotal += amt;
        }
      }
    }

    // --- Payroll contributions go straight into their accounts ---
    const contributions = { employee: 0, employer: 0, preTax: 0 };
    const deposits = {};
    for (const c of sal.contributions) {
      const acct = accounts.find((a) => a.id === c.account);
      deposit(acct, c.employee + c.employer);
      addTo(deposits, c.account, c.employee + c.employer);
      contributions.employee += c.employee;
      contributions.employer += c.employer;
      if (acct.type !== 'roth') contributions.preTax += c.employee;
    }

    // --- Outflows ---
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

    // Cash available before taxes and voluntary withdrawals.
    const preTaxCash = income.total + rmdTotal - contributions.employee - spending.total - debt.payment;

    // Taxes given a set of voluntary withdrawals { byAccount, gains }.
    const status = plan.people.length === 2 && alive.length === 2 ? 'married_joint' : 'single';
    const taxesFor = (w) => {
      if (!taxTables) return noTaxes;
      let traditional = rmdTotal;
      let early = 0;
      let hsa = 0;
      for (const [id, amt] of Object.entries(w.byAccount)) {
        const a = accounts.find((x) => x.id === id);
        if (a.type === 'traditional') {
          traditional += amt;
          // Early if the owner hasn't reached 59½ by the end of this year.
          const o = effectiveOwner(a);
          if (o && monthIndex(o.birth) + 714 > year * 12 + 11) early += amt;
        } else if (a.type === 'hsa') hsa += amt;
      }
      return computeTaxes({
        year,
        inflation: plan.assumptions.inflation,
        status,
        people65: alive.filter((p) => ageAtYearEnd(p, year) >= 65).length,
        wages: plan.people.map((p) => sal.byPerson[p.id] + pt.byPerson[p.id]),
        preTaxDeferrals: contributions.preTax,
        pension: pen.total,
        socialSecurity: ss.total,
        interest,
        dividends,
        realizedGains: w.gains,
        traditional,
        hsaTaxable: Math.max(0, hsa - spending.healthcare),
        earlyDistributions: early,
      }, taxTables);
    };

    // Trial withdrawal of `gross` on a copy of the accounts → net cash after taxes.
    const trial = (gross) => {
      const copy = accounts.map((a) => ({ ...a }));
      const w = withdrawInOrder(copy, order, gross);
      const taxes = taxesFor(w);
      return { w, taxes, net: preTaxCash + (gross - w.remaining) - taxes.total };
    };

    // Solve: smallest gross withdrawal whose after-tax cash covers the gap.
    let gross = 0;
    let solved = trial(0);
    if (solved.net < 0) {
      const available = sum(order.map((id) => accounts.find((a) => a.id === id).balance));
      const all = trial(available);
      if (all.net < 0) {
        gross = available;
        solved = all;
      } else {
        let lo = 0;
        let hi = available;
        for (let i = 0; i < 60 && hi - lo > 0.5; i++) {
          const mid = (lo + hi) / 2;
          if (trial(mid).net >= 0) hi = mid; else lo = mid;
        }
        gross = hi;
        solved = trial(hi);
      }
    }

    // Apply for real.
    let realizedGains = 0;
    if (gross > 0) {
      const w = withdrawInOrder(accounts, order, gross);
      for (const [id, amt] of Object.entries(w.byAccount)) addTo(withdrawals, id, amt);
      realizedGains = w.gains;
    }
    const taxes = solved.taxes;
    const net = preTaxCash - rmdTotal - taxes.total; // before any withdrawals (RMDs included in withdrawals)
    const cashAfter = solved.net;
    let shortfall = 0;
    let surplus = 0;
    if (cashAfter >= 0) {
      surplus = cashAfter;
      deposit(surplusAcct, surplus);
      addTo(deposits, surplusAcct.id, surplus);
    } else {
      shortfall = -cashAfter;
    }
    if (shortfall > 0.5 && !firstShortfall) {
      firstShortfall = { year, ages };
      events.push('Savings run out');
    }
    if (shortfall <= 0.5) shortfall = 0;

    accounts.forEach(grow);

    const byAccount = Object.fromEntries(accounts.map((a) => [a.id, a.balance]));
    const byType = Object.fromEntries(ACCOUNT_TYPES.map((t) => [t, sum(accounts.filter((a) => a.type === t).map((a) => a.balance))]));
    const nominal = {
      income,
      contributions: { employee: contributions.employee, employer: contributions.employer },
      spending,
      debt,
      taxes,
      net,
      rmd: rmdTotal,
      rmdByAccount,
      withdrawals: { total: sum(Object.values(withdrawals)), byAccount: withdrawals },
      deposits: { total: sum(Object.values(deposits)), byAccount: deposits },
      surplus,
      realizedGains,
      shortfall,
      balances: { byAccount, byType, total: sum(Object.values(byAccount)) },
    };
    const deflator = growthFactor(plan.assumptions.inflation, year, plan.startYear);
    years.push({ year, ages, events, deflator, nominal, real: scaleTree(nominal, deflator) });
  }

  const last = years[years.length - 1];
  return {
    years,
    summary: {
      startYear: plan.startYear,
      endYear: plan.endYear,
      taxesModeled: Boolean(taxTables),
      lasts: firstShortfall === null,
      firstShortfall,
      endAges: last.ages,
      totalShortfall: { nominal: sum(years.map((y) => y.nominal.shortfall)), real: sum(years.map((y) => y.real.shortfall)) },
      totalTaxes: { nominal: sum(years.map((y) => y.nominal.taxes.total)), real: sum(years.map((y) => y.real.taxes.total)) },
      endBalance: { nominal: last.nominal.balances.total, real: last.real.balances.total },
      startBalance: sum(plan.accounts.map((a) => a.balance)),
    },
  };
}
