import { test } from 'node:test';
import assert from 'node:assert/strict';
import { salariesForYear, socialSecurityForYear, pensionsForYear, partTimeForYear } from '../js/engine/income.js';
import { expensesForYear } from '../js/engine/expenses.js';
import { examplePlan } from './helpers.js';

const close = (actual, expected, tol = 0.01) =>
  assert.ok(Math.abs(actual - expected) <= tol, `expected ${expected}, got ${actual}`);

test('salaries: start year is the stated amount; contributions % of salary', () => {
  const s = salariesForYear(examplePlan(), 2027);
  assert.deepEqual(s.byPerson, { alex: 140000, jamie: 90000 });
  assert.deepEqual(s.contributions, [
    { account: 'alex_401k', employee: 14000, employer: 5600 },
    { account: 'jamie_roth401k', employee: 7200, employer: 2700 },
  ]);
});

test('salaries: retirement 2032-06 → paid Jan–May, with 5 years of growth', () => {
  const s = salariesForYear(examplePlan(), 2032);
  close(s.byPerson.alex, 140000 * 1.03 ** 5 * 5 / 12);
  close(s.byPerson.jamie, 90000 * 1.025 ** 5); // retires 2033-01, full 2032
  assert.equal(salariesForYear(examplePlan(), 2033).total, 0);
});

test('salaries: dollar contribution grows with salary and prorates', () => {
  const plan = examplePlan();
  plan.salaries[0].contributions[0].employee = { amount: 20000 };
  const c = salariesForYear(plan, 2032).contributions[0];
  close(c.employee, 20000 * 1.03 ** 5 * 5 / 12);
});

test('social security: starts in claim month, inflated from start year', () => {
  const plan = examplePlan();
  // Alex born 1968-04, claims at 67 → from 2035-04 (9 months of 2035)
  close(socialSecurityForYear(plan, 2035).byPerson.alex, 3300 * 1.025 ** 8 * 9);
  assert.equal(socialSecurityForYear(plan, 2034).byPerson.alex, 0);
  // Jamie born 1970-09, 66y6m → 2037-03 (10 months)
  close(socialSecurityForYear(plan, 2037).byPerson.jamie, 2100 * 1.025 ** 10 * 10);
});

test('social security: survivor keeps the larger benefit', () => {
  const plan = examplePlan();
  // Alex alive through 2060; in 2061 Jamie gets Alex's larger benefit
  close(socialSecurityForYear(plan, 2060).total, (3300 + 2100) * 12 * 1.025 ** 33);
  close(socialSecurityForYear(plan, 2061).total, 3300 * 12 * 1.025 ** 34);
});

test('pensions: cola after start; survivor percentage', () => {
  const plan = examplePlan();
  assert.equal(pensionsForYear(plan, 2034).total, 0);
  close(pensionsForYear(plan, 2035).total, 18000);
  close(pensionsForYear(plan, 2036).total, 18180);
  // Make Jamie (pension owner) die first: life expectancy 80 → through 2050
  plan.people[1].deathYear = 2050;
  close(pensionsForYear(plan, 2051).total, 18000 * 1.01 ** 16 * 0.5);
});

test('part-time: months in range, today dollars', () => {
  const plan = examplePlan();
  close(partTimeForYear(plan, 2032).total, 2500 * 4 * 1.025 ** 5); // Sep–Dec
  close(partTimeForYear(plan, 2035).total, 30000 * 1.025 ** 8);
  assert.equal(partTimeForYear(plan, 2036).total, 0);
});

test('expenses: start year is base only (no items, both working)', () => {
  const e = expensesForYear(examplePlan(), 2027);
  assert.deepEqual([e.base, e.items, e.healthcare, e.total], [95000, 0, 0, 95000]);
});

test('expenses: recurring "every" items and inflation', () => {
  const plan = examplePlan();
  close(expensesForYear(plan, 2028).items, 40000 * 1.025); // car
  const e2036 = expensesForYear(plan, 2036);
  assert.deepEqual(e2036.itemList.map((i) => i.name), ['Travel', 'Replace car']);
  assert.equal(expensesForYear(plan, 2037).itemList.length, 1); // travel only
  close(expensesForYear(plan, 2029).items, 28000 * 1.025 ** 2); // roof
});

test('expenses: healthcare pre-65 vs Medicare by month', () => {
  // 2033: Alex turns 65 in April → 3 months pre-Medicare + 9 Medicare.
  // Jamie retired, age 62–63 → 12 months pre-Medicare.
  const hc = expensesForYear(examplePlan(), 2033).healthcare;
  close(hc, (16000 * 3 / 12 + 7500 * 9 / 12 + 16000) * 1.05 ** 6);
});

test('expenses: survivor spending percentage', () => {
  const plan = examplePlan();
  close(expensesForYear(plan, 2061).base, 95000 * 1.025 ** 34 * 0.7);
});
