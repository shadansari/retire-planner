import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePlan } from '../js/engine/validate.js';
import { parsePlanText } from '../js/data/load.js';
import { parseRate, parseMoney, parseMonth, parseDate } from '../js/engine/parse.js';
import { exampleRaw, exampleText } from './helpers.js';

test('example.yaml is valid with no warnings', () => {
  const r = parsePlanText(exampleText());
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.plan.startYear, 2027);
  assert.equal(r.plan.endYear, 2065); // Jamie: 1970 + 95
});

test('normalization: rates, money, ids, withdrawal order expansion', () => {
  const { plan } = parsePlanText(exampleText());
  assert.equal(plan.assumptions.inflation, 0.025);
  assert.deepEqual(plan.assumptions.withdrawalOrder,
    ['savings', 'brokerage', 'alex_hsa', 'alex_401k', 'jamie_ira', 'jamie_roth401k']);
  assert.deepEqual(plan.salaries[0].contributions[0].employee, { pct: 0.1 });
  // retirement 2032-06 → last paid month 2032-05
  assert.equal(plan.salaries[0].endMonth, 2032 * 12 + 4);
  // Jamie born 1970-09, claims at 66y6m → 2037-03
  assert.equal(plan.socialSecurity[1].startMonth, 2037 * 12 + 2);
});

test('primitive parsers', () => {
  assert.equal(parseRate('6%').value, 0.06);
  assert.equal(parseRate(' -1.5 % ').value, -0.015);
  assert.match(parseRate(0.06).error, /like 6%/);
  assert.match(parseRate(6).error, /like 6%/);
  assert.equal(parseMoney('$150,000').value, 150000);
  assert.equal(parseMoney('150000.50').value, 150000.5);
  assert.ok(parseMoney('15,00').error);
  assert.ok(parseMoney(-5).error);
  assert.deepEqual(parseMonth('2032-06').value, { year: 2032, month: 6 });
  assert.ok(parseMonth('2032-13').error);
  assert.ok(parseMonth(2032).error);
  assert.ok(parseDate('1970-02-30').error);
  assert.deepEqual(parseDate('1972-02-29').value, { year: 1972, month: 2, day: 29 });
});

// Each case: mutate a fresh copy of example.yaml's raw object, expect this exact
// error (or warning) message among the results.
const cases = [
  ['missing schema_version', (r) => { delete r.schema_version; },
    'File: "schema_version: 1" is missing at the top [schema_version]'],
  ['future schema_version', (r) => { r.schema_version = 2; },
    'File: this page understands schema_version 1, but the file says 2 [schema_version]'],
  ['bad as_of', (r) => { r.as_of = '2026/10'; },
    'File: "as_of" must be a month written year-month, like 2032-06 (got "2026/10") [as_of]'],
  ['rate without %', (r) => { r.assumptions.inflation = 0.025; },
    'Assumptions: "inflation" must be a percentage with a % sign, like 2.5% (got 0.025) [assumptions.inflation]'],
  ['bad birth date', (r) => { r.people[0].birth_date = '1968-4-15'; },
    'Alex Sample: "birth_date" must be a date written year-month-day, like 1968-04-15 (got "1968-4-15") [people[0].birth_date]'],
  ['missing life expectancy', (r) => { delete r.people[1].life_expectancy; },
    'Jamie Sample: "life_expectancy" is missing [people[1].life_expectancy]'],
  ['life expectancy already past', (r) => { r.people[0].life_expectancy = 55; },
    "Alex Sample: life expectancy 55 is already past (that's 2023, before the plan starts in 2027) [people[0].life_expectancy]"],
  ['duplicate person id', (r) => { r.people[1].id = 'alex'; },
    'Jamie Sample: id "alex" is used twice [people[1].id]'],
  ['three people', (r) => { r.people.push({ ...r.people[0], id: 'kid' }); },
    'People: list one or two people (found 3) [people]'],
  ['salary end as a bare year', (r) => { r.income.salaries[0].end = 2031; },
    'Alex Sample\'s salary: "end" must be "retirement" or the last month paid, like 2031-12 (got 2031) [income.salaries[0].end]'],
  ['salary owner unknown', (r) => { r.income.salaries[1].owner = 'jaime'; },
    'Salary #2: "owner" must be one of: alex, jamie (got "jaime") [income.salaries[1].owner]'],
  ['contribution to taxable account', (r) => { r.income.salaries[0].contributions[0].account = 'brokerage'; },
    'Alex Sample\'s salary, contribution #1: "account" must be a traditional, roth or hsa account ("brokerage" is taxable) [income.salaries[0].contributions[0].account]'],
  ['contribution to spouse account', (r) => { r.income.salaries[0].contributions[0].account = 'jamie_ira'; },
    'Alex Sample\'s salary, contribution #1: "account" "jamie_ira" belongs to Jamie Sample, not Alex Sample [income.salaries[0].contributions[0].account]'],
  ['claim age too early', (r) => { r.income.social_security[0].claim_age = 60; },
    'Alex Sample\'s Social Security: "claim_age" must be between 62 and 70 (got 60) [income.social_security[0].claim_age]'],
  ['money with words', (r) => { r.income.social_security[0].monthly_benefit = '3300 per month'; },
    'Alex Sample\'s Social Security: "monthly_benefit" must be a dollar amount like 150000 (got "3300 per month") [income.social_security[0].monthly_benefit]'],
  ['expense with both year and start', (r) => { r.expenses.items[0].start = 2029; },
    'Expense "New roof": use either "year" (one-time) or "start"/"end" (recurring), not both [expenses.items[0]]'],
  ['expense with neither', (r) => { delete r.expenses.items[0].year; },
    'Expense "New roof": needs "year" for a one-time expense, or "start" and "end" for a recurring one [expenses.items[0]]'],
  ['expense end before start', (r) => { r.expenses.items[1].end = 2030; },
    'Expense "Travel": "end" is before "start" [expenses.items[1].end]'],
  ['loan payment below interest', (r) => { r.liabilities[0].monthly_payment = 1000; },
    'Loan "Mortgage": $1000/month doesn\'t cover the ~$1544/month interest, so it would never be paid off [liabilities[0].monthly_payment]'],
  ['joint traditional account', (r) => { r.accounts[0].owner = 'joint'; },
    'Account "Alex 401(k)": a traditional account belongs to one person; "owner" can\'t be joint [accounts[0].owner]'],
  ['taxable missing cost basis', (r) => { delete r.accounts[3].cost_basis; },
    'Account "Joint brokerage": "cost_basis" is missing [accounts[3].cost_basis]'],
  ['account id equal to a type', (r) => { r.accounts[5].id = 'cash'; r.assumptions.withdrawal_order[0] = 'cash'; },
    'Account "High-yield savings": "id" can\'t be an account type name ("cash"), since withdrawal_order uses those; try "cash_1" [accounts[5].id]'],
  ['bad account type', (r) => { r.accounts[2].type = 'ira'; },
    'Account "Jamie IRA": "type" must be one of: cash, taxable, traditional, roth, hsa (got "ira") [accounts[2].type]'],
  ['unknown withdrawal order entry', (r) => { r.assumptions.withdrawal_order.push('401k'); },
    'Assumptions: withdrawal_order entry "401k" is not an account type (cash, taxable, traditional, roth, hsa) or an account id [assumptions.withdrawal_order[5]]'],
  ['surplus to a retirement account', (r) => { r.assumptions.deposit_surplus_to = 'alex_401k'; },
    'Assumptions: "deposit_surplus_to" must be a cash or taxable account; "alex_401k" is traditional, which has contribution limits [assumptions.deposit_surplus_to]'],
  ['single with two people', (r) => { r.assumptions.filing_status = 'single'; },
    'Assumptions: single filing supports exactly one person in "people" [assumptions.filing_status]'],
  ['state lowercase', (r) => { r.assumptions.state = 'ca'; },
    'Assumptions: "state" must be a two-letter state code like CA (got "ca") [assumptions.state]'],
  ['list given as a single item', (r) => { r.liabilities = r.liabilities[0]; },
    'Loans: "liabilities" must be a list (each entry starting with "- ") [liabilities]'],
];

for (const [name, mutate, expected] of cases) {
  test(`error: ${name}`, () => {
    const raw = exampleRaw();
    mutate(raw);
    const r = validatePlan(raw);
    assert.equal(r.plan, null);
    assert.ok(r.errors.includes(expected), `expected:\n  ${expected}\ngot:\n  ${r.errors.join('\n  ')}`);
  });
}

const warningCases = [
  ['misspelled key', (r) => { r.people[0].life_expectency = r.people[0].life_expectancy; },
    'Alex Sample: unknown setting "life_expectency" will be ignored — did you mean "life_expectancy"? [people[0]]'],
  ['account left out of withdrawal order', (r) => { r.assumptions.withdrawal_order = ['savings', 'taxable', 'traditional', 'roth']; },
    'Assumptions: account "alex_hsa" is not in withdrawal_order, so it will never be drawn from [assumptions.withdrawal_order]'],
  ['cost basis on a non-taxable account', (r) => { r.accounts[0].cost_basis = 1000; },
    'Account "Alex 401(k)": "cost_basis" only applies to taxable accounts and will be ignored [accounts[0].cost_basis]'],
];

for (const [name, mutate, expected] of warningCases) {
  test(`warning: ${name}`, () => {
    const raw = exampleRaw();
    mutate(raw);
    const r = validatePlan(raw);
    assert.deepEqual(r.errors, []);
    assert.ok(r.warnings.includes(expected), `expected:\n  ${expected}\ngot:\n  ${r.warnings.join('\n  ')}`);
  });
}

test('collects multiple errors at once', () => {
  const raw = exampleRaw();
  raw.assumptions.inflation = 3;
  raw.accounts[0].balance = 'lots';
  raw.people[0].retirement_date = 'June 2032';
  assert.equal(validatePlan(raw).errors.length, 3);
});

test('YAML syntax error reports the line number', () => {
  const r = parsePlanText('schema_version: 1\npeople:\n  - id: alex\n   name: bad indent\n');
  assert.equal(r.plan, null);
  assert.match(r.errors[0], /^The file couldn't be read on line 4:/);
});

test('empty file', () => {
  assert.deepEqual(parsePlanText('').errors, ['The file is empty or is not a set of "key: value" settings.']);
});

test('dates are not converted to Date objects', () => {
  const raw = exampleRaw();
  assert.equal(typeof raw.people[0].birth_date, 'string');
});
