import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { simulate } from '../js/engine/simulate.js';
import { examplePlan } from './helpers.js';

const json = (p) => JSON.parse(readFileSync(new URL(`../tax/${p}`, import.meta.url), 'utf8'));
const taxTables = { federal: json('federal-2026.json'), state: json('states/ca-2025.json'), rmd: json('rmd.json') };
const run = (plan = examplePlan()) => simulate(plan, { taxTables });
const close = (a, e, tol = 0.01) => assert.ok(Math.abs(a - e) <= tol, `expected ${e}, got ${a}`);
const yearOf = (r, y) => r.years.find((x) => x.year === y);

test('2027 taxes by hand (MFJ, both working, indexed one year)', () => {
  const t = yearOf(run(), 2027).nominal.taxes;
  // AGI: 230k wages − 14k pre-tax 401k + 1.8k savings interest + 4.32k dividends
  close(t.details.agi, 222120);
  const i = 1.025;
  const ordinaryTI = 222120 - 32200 * i - 4320;
  close(t.federal.income, 11600 * i + 0.22 * (ordinaryTI - 100800 * i) + 0.15 * 4320, 0.05);
  close(t.payroll.socialSecurity, 230000 * 0.062);
  close(t.payroll.medicare, 230000 * 0.0145);
  close(t.payroll.stateDisability, 230000 * 0.013);
  assert.equal(t.details.status, 'married_joint');
});

test('gross-up: in withdrawal years, after-tax cash covers the gap to within $1', () => {
  for (const y of run().years) {
    const n = y.nominal;
    if (n.withdrawals.total > n.rmd + 1) assert.ok(n.surplus < 1, `${y.year}: surplus ${n.surplus}`);
    assert.equal(n.shortfall, 0);
  }
});

test('taxes increase withdrawals versus the no-tax run', () => {
  const withTax = run().years;
  const noTax = simulate(examplePlan()).years;
  const y = 2040;
  assert.ok(yearOf({ years: withTax }, y).nominal.withdrawals.total > yearOf({ years: noTax }, y).nominal.withdrawals.total);
});

test('RMDs: Alex (born 1968) starts at 75 in 2043; amount = prior year-end balance / 24.6', () => {
  const r = run();
  assert.equal(yearOf(r, 2042).nominal.rmd, 0);
  const prior = yearOf(r, 2042).nominal.balances.byAccount.alex_401k;
  close(yearOf(r, 2043).nominal.rmd, prior / 24.6, 0.01);
  assert.ok(yearOf(r, 2043).events.includes("Alex's required withdrawals (RMDs) begin"));
});

test('filing status: joint through year of first death, single after', () => {
  const r = run();
  assert.equal(yearOf(r, 2060).nominal.taxes.details.status, 'married_joint');
  assert.equal(yearOf(r, 2061).nominal.taxes.details.status, 'single');
});

test('survivor inherits traditional accounts for RMD purposes', () => {
  const plan = examplePlan();
  plan.people[0].lifeExpectancy = 80;
  plan.people[0].deathYear = 2048; // Alex's plan ends while the 401(k) still has money
  const r = run(plan);
  // 2049: Alex's 401(k) RMD uses Jamie's age (79 → divisor 21.1), not Alex's (81 → 19.4)
  const prior = yearOf(r, 2048).nominal.balances.byAccount.alex_401k;
  assert.ok(prior > 0);
  close(yearOf(r, 2049).nominal.rmdByAccount.alex_401k, prior / 21.1);
});

test('early withdrawal penalty when drawing traditional money before 59½', () => {
  const plan = examplePlan();
  // Jamie (born 1970-09, 57 in 2027) retires now and draws from the IRA first.
  // (Alex reaches 59½ in Oct 2027; the rule waives the penalty if 59½ is reached by year end.)
  plan.people[1].retire = { year: 2027, month: 1 };
  plan.salaries[1].endMonth = 2026 * 12 + 11;
  plan.assumptions.withdrawalOrder = ['jamie_ira', ...plan.assumptions.withdrawalOrder.filter((id) => id !== 'jamie_ira')];
  plan.expenses.baseAnnual = 200000;
  const t = yearOf(simulate(plan, { taxTables }), 2027).nominal.taxes;
  assert.ok(t.federal.penalty > 0);
  close(t.state.penalty, t.federal.penalty * 0.25, 0.01); // 2.5% vs 10%
});

test('golden: example.yaml with taxes, key years (real $)', () => {
  const r = run();
  const pick = (yr) => {
    const n = yearOf(r, yr).real;
    return [Math.round(n.taxes.total), Math.round(n.withdrawals.total), Math.round(n.balances.total)];
  };
  assert.deepEqual({ 2027: pick(2027), 2036: pick(2036), 2043: pick(2043), 2061: pick(2061), 2065: pick(2065) }, {
    2027: [62785, 0, 1572626],
    2036: [7534, 141255, 1762647],
    2043: [17402, 88908, 1490226],
    2061: [11067, 44915, 932668],
    2065: [624, 36770, 892519],
  });
  assert.equal(Math.round(r.summary.totalTaxes.real), 743319);
});
