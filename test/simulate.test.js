import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulate } from '../js/engine/simulate.js';
import { examplePlan } from './helpers.js';

const close = (a, e, tol = 0.01) => assert.ok(Math.abs(a - e) <= tol, `expected ${e}, got ${a}`);

test('runs start year through the longer life expectancy', () => {
  const { years, summary } = simulate(examplePlan());
  assert.equal(years[0].year, 2027);
  assert.equal(years.at(-1).year, 2065);
  assert.deepEqual(years.at(-1).ages, { alex: null, jamie: 95 });
  assert.deepEqual(summary.endAges, { alex: null, jamie: 95 });
});

test('first year cash flow by hand', () => {
  const y = simulate(examplePlan()).years[0].nominal;
  // 140k + 90k salary + 240k × 1.8% dividends
  close(y.income.total, 234320);
  close(y.contributions.employee, 14000 + 7200);
  close(y.contributions.employer, 5600 + 2700);
  close(y.debt.payment, 2150 * 12);
  close(y.net, 234320 - 21200 - 95000 - 25800);
  close(y.deposits.byAccount.brokerage, y.net);
  assert.equal(y.withdrawals.total, 0);
});

test('every account balance is conserved: (start + in − out) × growth = end', () => {
  const plan = examplePlan();
  const { years } = simulate(plan);
  const prev = Object.fromEntries(plan.accounts.map((a) => [a.id, a.balance]));
  for (const y of years) {
    for (const a of plan.accounts) {
      const n = y.nominal;
      const flows = prev[a.id] + (n.deposits.byAccount[a.id] ?? 0) - (n.withdrawals.byAccount[a.id] ?? 0);
      const expected = flows * (1 + a.return - a.dividendYield);
      close(n.balances.byAccount[a.id], expected, 1e-6 * Math.max(1, expected));
      prev[a.id] = n.balances.byAccount[a.id];
    }
  }
});

test('net cash flow identity holds every year', () => {
  for (const { nominal: n } of simulate(examplePlan()).years) {
    const lhs = n.income.total - n.contributions.employee - n.spending.total - n.debt.payment - n.taxes.total;
    close(lhs, n.net, 1e-6);
    if (n.net >= 0) assert.equal(n.withdrawals.total, 0);
    else close(n.withdrawals.total + n.shortfall, -n.net, 1e-6);
  }
});

test('real values are nominal deflated to start-year dollars', () => {
  const y = simulate(examplePlan()).years.find((r) => r.year === 2040);
  close(y.real.balances.total, y.nominal.balances.total / 1.025 ** 13, 1e-6);
  close(y.real.income.socialSecurity, (3300 + 2100) * 12, 1e-6); // SS is inflation-indexed
});

test('withdrawals follow the configured order', () => {
  const { years } = simulate(examplePlan());
  const firstGap = years.find((y) => y.nominal.net < 0);
  assert.equal(firstGap.year, 2033);
  assert.deepEqual(Object.keys(firstGap.nominal.withdrawals.byAccount), ['savings', 'brokerage']);
});

test('shortfall: records first year, floors balances at 0, keeps going', () => {
  const plan = examplePlan();
  plan.expenses.baseAnnual = 250000;
  const { years, summary } = simulate(plan);
  assert.equal(summary.lasts, false);
  const first = summary.firstShortfall;
  assert.ok(first.year > 2027 && first.year < 2065);
  const y = years.find((r) => r.year === first.year);
  assert.ok(y.events.includes('Savings run out'));
  assert.ok(y.nominal.shortfall > 0);
  // Every account still drawn from is empty; later years still simulated.
  for (const id of plan.assumptions.withdrawalOrder) assert.equal(y.nominal.balances.byAccount[id], 0);
  assert.equal(years.at(-1).year, 2065);
  assert.ok(summary.totalShortfall.nominal > y.nominal.shortfall);
});

test('events', () => {
  const ev = Object.fromEntries(simulate(examplePlan()).years.map((y) => [y.year, y.events]));
  assert.deepEqual(ev[2032], ['Alex retires (Jun)', 'Consulting starts']);
  assert.ok(ev[2035].includes('Alex starts Social Security (Apr)'));
  assert.ok(ev[2046].includes('Mortgage paid off (Jul)'));
  assert.deepEqual(ev[2060], ['Plan for Alex ends (age 92)']);
});

// Golden snapshot of the example (today's dollars, rounded). If engine semantics
// change on purpose, update these numbers in the same commit and say why.
test('golden: example.yaml key years (real $)', () => {
  const { years, summary } = simulate(examplePlan());
  const pick = (yr) => {
    const r = years.find((y) => y.year === yr).real;
    return [Math.round(r.income.total), Math.round(r.spending.total), Math.round(r.net), Math.round(r.balances.total)];
  };
  assert.deepEqual({
    2027: pick(2027), 2033: pick(2033), 2046: pick(2046), 2061: pick(2061), 2065: pick(2065),
  }, {
    2027: [234320, 95000, 92320, 1638047],
    2033: [43409, 139611, -118449, 2374849],
    2046: [77362, 118710, -49879, 2232853],
    2061: [49670, 83517, -33847, 2662789],
    2065: [49093, 85239, -36146, 2878609],
  });
  assert.equal(Math.round(summary.endBalance.real), 2878609);
});
