// Schema v1 validation. Walks the raw parsed YAML once, collecting every problem
// as a human-readable message, and builds the normalized plan the engine uses.
//
//   validatePlan(raw) → { errors: string[], warnings: string[], plan: object|null }
//
// plan is null whenever errors is non-empty. Messages name the human-level thing
// first ("Alex's salary: ...") and end with the YAML path in brackets.

import {
  parseRate, parseMoney, parseInteger, parseYear, parseMonth, parseDate, parseEnum,
  monthIndex, closest, editDistance,
} from './parse.js';

export const SCHEMA_VERSION = 1;
export const ACCOUNT_TYPES = ['cash', 'taxable', 'traditional', 'roth', 'hsa'];
export const FILING_STATUSES = ['married_joint', 'single'];
const ID_RE = /^[a-z][a-z0-9_]*$/;

class Ctx {
  constructor() {
    this.errors = [];
    this.warnings = [];
  }

  error(label, path, msg) { this.errors.push(`${label}: ${msg} [${path}]`); }
  warn(label, path, msg) { this.warnings.push(`${label}: ${msg} [${path}]`); }

  // Read obj[key] through parser. Missing (absent or null) → default, or an error if required.
  field(obj, key, parser, { path, label, required = false, dflt } = {}) {
    const v = obj?.[key];
    const p = path ? `${path}.${key}` : key;
    if (v === undefined || v === null || v === '') {
      if (required) {
        // Point at a likely misspelling of this key in the same group.
        const near = Object.keys(obj ?? {}).find((k) => k !== key && editDistance(k.toLowerCase(), key) <= 2);
        this.error(label, p, `"${key}" is missing${near ? ` (is "${near}" a misspelling of it?)` : ''}`);
      }
      return dflt;
    }
    const r = parser(v);
    if (r.error) {
      this.error(label, p, `"${key}" ${r.error}`);
      return undefined;
    }
    return r.value;
  }

  // Unknown keys are warnings (usually typos); they're ignored.
  keys(obj, allowed, path, label) {
    for (const k of Object.keys(obj)) {
      if (allowed.includes(k)) continue;
      const guess = closest(k, allowed);
      const hint = guess ? ` — did you mean "${guess}"?` : '';
      this.warn(label, path, `unknown setting "${k}" will be ignored${hint}`);
    }
  }

  // Optional list. Returns [] when absent; error if present but not a list.
  list(obj, key, path, label, { required = false } = {}) {
    const v = obj?.[key];
    if (v === undefined || v === null) {
      if (required) this.error(label, path ? `${path}.${key}` : key, `"${key}" is missing`);
      return [];
    }
    if (!Array.isArray(v)) {
      this.error(label, path ? `${path}.${key}` : key, `"${key}" must be a list (each entry starting with "- ")`);
      return [];
    }
    return v;
  }

  // Each list entry must be a mapping.
  isMap(v, path, label) {
    if (v && typeof v === 'object' && !Array.isArray(v)) return true;
    this.error(label, path, 'must be a group of settings (key: value lines)');
    return false;
  }
}

const isMapping = (v) => v && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' && v.trim() ? { value: v.trim() } : { error: `must be text (got ${JSON.stringify(v)})` });
const bool = (v) => (typeof v === 'boolean' ? { value: v } : { error: `must be true or false (got ${JSON.stringify(v)})` });

// Contribution amount: "10%" of salary, or dollars per year.
const rateOrMoney = (v) => {
  if (typeof v === 'string' && v.includes('%')) {
    const r = parseRate(v, { min: 0, max: 100 });
    return r.error ? r : { value: { pct: r.value } };
  }
  const r = parseMoney(v);
  return r.error ? { error: 'must be a percentage of salary like 10%, or a yearly dollar amount' } : { value: { amount: r.value } };
};

export function validatePlan(raw) {
  const c = new Ctx();
  if (!isMapping(raw)) {
    c.errors.push('The file is empty or is not a set of "key: value" settings.');
    return { errors: c.errors, warnings: c.warnings, plan: null };
  }

  c.keys(raw, ['schema_version', 'as_of', 'people', 'income', 'expenses', 'liabilities', 'accounts', 'assumptions'], '(top level)', 'File');

  // --- header -----------------------------------------------------------------
  const version = raw.schema_version;
  if (version === undefined) {
    c.error('File', 'schema_version', '"schema_version: 1" is missing at the top');
  } else if (version !== SCHEMA_VERSION) {
    c.error('File', 'schema_version', `this page understands schema_version ${SCHEMA_VERSION}, but the file says ${JSON.stringify(version)}`);
  }
  const asOf = c.field(raw, 'as_of', parseMonth, { path: '', label: 'File', required: true });
  if (asOf && (asOf.year < 2000 || asOf.year > 2100)) {
    c.error('File', 'as_of', `"as_of" year looks wrong (got ${asOf.year})`);
  }
  // Simulation starts Jan 1 after as_of (or that January itself).
  const startYear = asOf ? (asOf.month === 1 ? asOf.year : asOf.year + 1) : undefined;

  // --- people -------------------------------------------------------------------
  const people = [];
  const rawPeople = c.list(raw, 'people', '', 'People', { required: true });
  if (Array.isArray(raw.people) && (rawPeople.length < 1 || rawPeople.length > 2)) {
    c.error('People', 'people', `list one or two people (found ${rawPeople.length})`);
  }
  rawPeople.forEach((rp, i) => {
    const path = `people[${i}]`;
    const label = isMapping(rp) && typeof rp.name === 'string' && rp.name.trim() ? rp.name.trim() : `Person #${i + 1}`;
    if (!c.isMap(rp, path, label)) return;
    c.keys(rp, ['id', 'name', 'birth_date', 'retirement_date', 'life_expectancy'], path, label);
    const id = c.field(rp, 'id', str, { path, label, required: true });
    if (id && !ID_RE.test(id)) {
      c.error(label, `${path}.id`, `"id" must be lowercase letters, digits or _ and start with a letter, like "alex" (got "${id}")`);
    } else if (id === 'joint') {
      c.error(label, `${path}.id`, '"joint" is reserved for jointly owned accounts; pick another id');
    } else if (id && people.some((p) => p.id === id)) {
      c.error(label, `${path}.id`, `id "${id}" is used twice`);
    }
    const name = c.field(rp, 'name', str, { path, label, required: true });
    const birth = c.field(rp, 'birth_date', parseDate, { path, label, required: true });
    const retire = c.field(rp, 'retirement_date', parseMonth, { path, label, required: true });
    const lifeExpectancy = c.field(rp, 'life_expectancy', (v) => parseInteger(v, { min: 50, max: 120 }), { path, label, required: true });
    if (birth && retire && monthIndex(retire) < monthIndex(birth)) {
      c.error(label, `${path}.retirement_date`, '"retirement_date" is before the birth date');
    }
    const deathYear = birth && lifeExpectancy ? birth.year + lifeExpectancy : undefined;
    if (deathYear && startYear && deathYear < startYear) {
      c.error(label, `${path}.life_expectancy`, `life expectancy ${lifeExpectancy} is already past (that's ${deathYear}, before the plan starts in ${startYear})`);
    }
    if (deathYear && startYear && deathYear >= startYear && retire && retire.year > deathYear) {
      c.warn(label, `${path}.retirement_date`, `retires in ${retire.year}, after life expectancy (${deathYear})`);
    }
    people.push({ id, name, birth, retire, lifeExpectancy, deathYear });
  });
  const personIds = people.map((p) => p.id).filter(Boolean);
  const nameOf = (id) => people.find((p) => p.id === id)?.name ?? id;
  const personById = (id) => people.find((p) => p.id === id);

  // owner: must name a person (or "joint" where allowed)
  const ownerField = (obj, path, label, { allowJoint = false } = {}) => c.field(obj, 'owner', (v) => {
    if (allowJoint && v === 'joint') return { value: v };
    if (typeof v === 'string' && personIds.includes(v)) return { value: v };
    const choices = allowJoint ? [...personIds, 'joint'] : personIds;
    return { error: `must be one of: ${choices.join(', ')} (got ${JSON.stringify(v)})` };
  }, { path, label, required: true });

  // --- accounts (before income: contributions reference them) --------------------
  const accounts = [];
  c.list(raw, 'accounts', '', 'Accounts', { required: true }).forEach((ra, i) => {
    const path = `accounts[${i}]`;
    const label = isMapping(ra) ? `Account "${ra.name ?? ra.id ?? `#${i + 1}`}"` : `Account #${i + 1}`;
    if (!c.isMap(ra, path, label)) return;
    c.keys(ra, ['id', 'name', 'owner', 'type', 'balance', 'return', 'dividend_yield', 'cost_basis'], path, label);
    const id = c.field(ra, 'id', str, { path, label, required: true });
    if (id && !ID_RE.test(id)) {
      c.error(label, `${path}.id`, `"id" must be lowercase letters, digits or _ and start with a letter, like "alex_401k" (got "${id}")`);
    } else if (id && ACCOUNT_TYPES.includes(id)) {
      c.error(label, `${path}.id`, `"id" can't be an account type name ("${id}"), since withdrawal_order uses those; try "${id}_1"`);
    } else if (id && accounts.some((a) => a.id === id)) {
      c.error(label, `${path}.id`, `id "${id}" is used twice`);
    }
    const name = c.field(ra, 'name', str, { path, label, dflt: id });
    const type = c.field(ra, 'type', (v) => parseEnum(v, ACCOUNT_TYPES), { path, label, required: true });
    const owner = ownerField(ra, path, label, { allowJoint: true });
    if (owner === 'joint' && type && !['cash', 'taxable'].includes(type)) {
      c.error(label, `${path}.owner`, `a ${type} account belongs to one person; "owner" can't be joint`);
    }
    const balance = c.field(ra, 'balance', parseMoney, { path, label, required: true });
    const ret = c.field(ra, 'return', (v) => parseRate(v, { min: -50, max: 50 }), { path, label, required: true });
    let dividendYield = 0;
    let costBasis;
    if (type === 'taxable') {
      dividendYield = c.field(ra, 'dividend_yield', (v) => parseRate(v, { min: 0, max: 50 }), { path, label, dflt: 0 });
      costBasis = c.field(ra, 'cost_basis', parseMoney, { path, label, required: true });
    } else {
      for (const k of ['dividend_yield', 'cost_basis']) {
        if (ra[k] !== undefined) c.warn(label, `${path}.${k}`, `"${k}" only applies to taxable accounts and will be ignored`);
      }
    }
    accounts.push({ id, name, owner, type, balance, return: ret, dividendYield, costBasis });
  });
  const accountById = (id) => accounts.find((a) => a.id === id);

  // --- income ------------------------------------------------------------------------
  const income = isMapping(raw.income) ? raw.income : {};
  if (raw.income !== undefined && !isMapping(raw.income)) c.error('Income', 'income', 'must be a group of settings');
  c.keys(income, ['salaries', 'social_security', 'pensions', 'part_time'], 'income', 'Income');

  const salaries = [];
  c.list(income, 'salaries', 'income', 'Income').forEach((rs, i) => {
    const path = `income.salaries[${i}]`;
    const label = isMapping(rs) && personIds.includes(rs.owner) ? `${nameOf(rs.owner)}'s salary` : `Salary #${i + 1}`;
    if (!c.isMap(rs, path, label)) return;
    c.keys(rs, ['owner', 'amount', 'growth', 'end', 'contributions'], path, label);
    const owner = ownerField(rs, path, label);
    const amount = c.field(rs, 'amount', parseMoney, { path, label, required: true });
    const growth = c.field(rs, 'growth', (v) => parseRate(v, { min: -20, max: 50 }), { path, label, dflt: 0 });
    // endMonth: last month paid (inclusive)
    let endMonth;
    const end = rs.end ?? 'retirement';
    if (end === 'retirement') {
      const retire = personById(owner)?.retire;
      if (retire) endMonth = monthIndex(retire) - 1;
    } else {
      const m = c.field(rs, 'end', (v) => {
        const r = parseMonth(v);
        return r.error ? { error: `must be "retirement" or the last month paid, like 2031-12 (got ${JSON.stringify(v)})` } : r;
      }, { path, label });
      if (m) endMonth = monthIndex(m);
    }
    const contributions = [];
    c.list(rs, 'contributions', path, label).forEach((rc, j) => {
      const cpath = `${path}.contributions[${j}]`;
      const clabel = `${label}, contribution #${j + 1}`;
      if (!c.isMap(rc, cpath, clabel)) return;
      c.keys(rc, ['account', 'employee', 'employer'], cpath, clabel);
      const account = c.field(rc, 'account', (v) => {
        const a = accountById(v);
        if (!a) return { error: `must be one of the account ids: ${accounts.map((x) => x.id).join(', ')} (got ${JSON.stringify(v)})` };
        if (!['traditional', 'roth', 'hsa'].includes(a.type)) return { error: `must be a traditional, roth or hsa account ("${v}" is ${a.type})` };
        if (owner && a.owner !== owner) return { error: `"${v}" belongs to ${nameOf(a.owner)}, not ${nameOf(owner)}` };
        return { value: v };
      }, { path: cpath, label: clabel, required: true });
      const employee = c.field(rc, 'employee', rateOrMoney, { path: cpath, label: clabel, dflt: { amount: 0 } });
      const employer = c.field(rc, 'employer', rateOrMoney, { path: cpath, label: clabel, dflt: { amount: 0 } });
      if (rc.employee == null && rc.employer == null) {
        c.error(clabel, cpath, 'give at least one of "employee" or "employer"');
      }
      contributions.push({ account, employee, employer });
    });
    salaries.push({ owner, amount, growth, endMonth, contributions });
  });

  const socialSecurity = [];
  c.list(income, 'social_security', 'income', 'Income').forEach((rs, i) => {
    const path = `income.social_security[${i}]`;
    const label = isMapping(rs) && personIds.includes(rs.owner) ? `${nameOf(rs.owner)}'s Social Security` : `Social Security #${i + 1}`;
    if (!c.isMap(rs, path, label)) return;
    c.keys(rs, ['owner', 'claim_age', 'claim_months', 'monthly_benefit'], path, label);
    const owner = ownerField(rs, path, label);
    if (owner && socialSecurity.some((s) => s.owner === owner)) {
      c.error(label, `${path}.owner`, `${nameOf(owner)} already has a Social Security entry`);
    }
    const claimAge = c.field(rs, 'claim_age', (v) => parseInteger(v, { min: 62, max: 70 }), { path, label, required: true });
    const claimMonths = c.field(rs, 'claim_months', (v) => parseInteger(v, { min: 0, max: 11 }), { path, label, dflt: 0 });
    if (claimAge === 70 && claimMonths > 0) c.error(label, `${path}.claim_months`, 'benefits stop growing at 70; claim_months must be 0 when claim_age is 70');
    const monthlyBenefit = c.field(rs, 'monthly_benefit', parseMoney, { path, label, required: true });
    const birth = personById(owner)?.birth;
    // First month of benefits: the month they reach claim age + claim_months.
    const startMonth = birth && claimAge !== undefined && claimMonths !== undefined
      ? monthIndex(birth) + claimAge * 12 + claimMonths : undefined;
    socialSecurity.push({ owner, claimAge, claimMonths, monthlyBenefit, startMonth });
  });

  const pensions = [];
  c.list(income, 'pensions', 'income', 'Income').forEach((rp, i) => {
    const path = `income.pensions[${i}]`;
    const label = `Pension "${isMapping(rp) && rp.name ? rp.name : `#${i + 1}`}"`;
    if (!c.isMap(rp, path, label)) return;
    c.keys(rp, ['owner', 'name', 'start', 'annual', 'cola', 'survivor_pct'], path, label);
    const owner = ownerField(rp, path, label);
    const name = c.field(rp, 'name', str, { path, label, dflt: 'Pension' });
    const start = c.field(rp, 'start', parseMonth, { path, label, required: true });
    const annual = c.field(rp, 'annual', parseMoney, { path, label, required: true });
    const cola = c.field(rp, 'cola', (v) => parseRate(v, { min: 0, max: 20 }), { path, label, dflt: 0 });
    const survivorPct = c.field(rp, 'survivor_pct', (v) => parseRate(v, { min: 0, max: 100 }), { path, label, dflt: 0 });
    pensions.push({ owner, name, startMonth: start && monthIndex(start), startYear: start?.year, annual, cola, survivorPct });
  });

  const partTime = [];
  c.list(income, 'part_time', 'income', 'Income').forEach((rp, i) => {
    const path = `income.part_time[${i}]`;
    const label = `Part-time work "${isMapping(rp) && rp.name ? rp.name : `#${i + 1}`}"`;
    if (!c.isMap(rp, path, label)) return;
    c.keys(rp, ['owner', 'name', 'annual', 'start', 'end', 'today_dollars'], path, label);
    const owner = ownerField(rp, path, label);
    const name = c.field(rp, 'name', str, { path, label, dflt: 'Part-time work' });
    const annual = c.field(rp, 'annual', parseMoney, { path, label, required: true });
    const start = c.field(rp, 'start', parseMonth, { path, label, required: true });
    const end = c.field(rp, 'end', parseMonth, { path, label });
    if (start && end && monthIndex(end) < monthIndex(start)) c.error(label, `${path}.end`, '"end" is before "start"');
    const todayDollars = c.field(rp, 'today_dollars', bool, { path, label, dflt: true });
    partTime.push({ owner, name, annual, startMonth: start && monthIndex(start), endMonth: end ? monthIndex(end) : Infinity, todayDollars });
  });

  // --- assumptions (inflation is a default for expenses below) -------------------------
  const ra = raw.assumptions;
  if (!isMapping(ra)) c.error('Assumptions', 'assumptions', ra === undefined ? '"assumptions" section is missing' : 'must be a group of settings');
  const A = isMapping(ra) ? ra : {};
  c.keys(A, ['inflation', 'filing_status', 'state', 'withdrawal_order', 'deposit_surplus_to'], 'assumptions', 'Assumptions');
  const L = 'Assumptions';
  const inflation = c.field(A, 'inflation', (v) => parseRate(v, { min: -5, max: 20 }), { path: 'assumptions', label: L, required: true });
  const filingStatus = c.field(A, 'filing_status', (v) => parseEnum(v, FILING_STATUSES), { path: 'assumptions', label: L, required: true });
  if (filingStatus === 'married_joint' && Array.isArray(raw.people) && rawPeople.length !== 2) {
    c.error(L, 'assumptions.filing_status', 'married_joint needs two people in "people"');
  }
  if (filingStatus === 'single' && rawPeople.length !== 1) {
    c.error(L, 'assumptions.filing_status', 'single filing supports exactly one person in "people"');
  }
  const state = c.field(A, 'state', (v) => (typeof v === 'string' && /^[A-Z]{2}$/.test(v.trim())
    ? { value: v.trim() } : { error: `must be a two-letter state code like CA (got ${JSON.stringify(v)})` }),
  { path: 'assumptions', label: L, required: true });

  const withdrawalOrder = [];
  const rawOrder = c.list(A, 'withdrawal_order', 'assumptions', L, { required: true });
  rawOrder.forEach((entry, i) => {
    const p = `assumptions.withdrawal_order[${i}]`;
    if (ACCOUNT_TYPES.includes(entry)) {
      const matches = accounts.filter((a) => a.type === entry && !withdrawalOrder.includes(a.id));
      if (!accounts.some((a) => a.type === entry)) c.warn(L, p, `no accounts of type "${entry}"`);
      withdrawalOrder.push(...matches.map((a) => a.id));
    } else if (accountById(entry)) {
      if (withdrawalOrder.includes(entry)) c.warn(L, p, `"${entry}" is already covered earlier in withdrawal_order`);
      else withdrawalOrder.push(entry);
    } else {
      c.error(L, p, `withdrawal_order entry ${JSON.stringify(entry)} is not an account type (${ACCOUNT_TYPES.join(', ')}) or an account id`);
    }
  });
  if (rawOrder.length) {
    for (const a of accounts) {
      if (a.id && !withdrawalOrder.includes(a.id)) {
        c.warn(L, 'assumptions.withdrawal_order', `account "${a.id}" is not in withdrawal_order, so it will never be drawn from`);
      }
    }
  }
  const depositSurplusTo = c.field(A, 'deposit_surplus_to', (v) => {
    const a = accountById(v);
    if (!a) return { error: `must be an account id (got ${JSON.stringify(v)})` };
    if (!['cash', 'taxable'].includes(a.type)) return { error: `must be a cash or taxable account; "${v}" is ${a.type}, which has contribution limits` };
    return { value: v };
  }, { path: 'assumptions', label: L, required: true });

  // --- expenses ------------------------------------------------------------------------------
  const re = raw.expenses;
  if (!isMapping(re)) c.error('Spending', 'expenses', re === undefined ? '"expenses" section is missing' : 'must be a group of settings');
  const E = isMapping(re) ? re : {};
  c.keys(E, ['base_annual', 'survivor_pct', 'inflation', 'items', 'healthcare'], 'expenses', 'Spending');
  const baseAnnual = c.field(E, 'base_annual', parseMoney, { path: 'expenses', label: 'Spending', required: isMapping(re) });
  const survivorPct = c.field(E, 'survivor_pct', (v) => parseRate(v, { min: 0, max: 200 }), { path: 'expenses', label: 'Spending', dflt: 1 });
  const expInflation = c.field(E, 'inflation', (v) => parseRate(v, { min: -5, max: 30 }), { path: 'expenses', label: 'Spending', dflt: inflation });

  const items = [];
  c.list(E, 'items', 'expenses', 'Spending').forEach((ri, i) => {
    const path = `expenses.items[${i}]`;
    const label = `Expense "${isMapping(ri) && ri.name ? ri.name : `#${i + 1}`}"`;
    if (!c.isMap(ri, path, label)) return;
    c.keys(ri, ['name', 'amount', 'year', 'start', 'end', 'every', 'inflation'], path, label);
    const name = c.field(ri, 'name', str, { path, label, required: true });
    const amount = c.field(ri, 'amount', parseMoney, { path, label, required: true });
    let startYear;
    let endYear;
    if (ri.year != null) {
      if (ri.start != null || ri.end != null) c.error(label, path, 'use either "year" (one-time) or "start"/"end" (recurring), not both');
      startYear = endYear = c.field(ri, 'year', parseYear, { path, label });
    } else if (ri.start != null) {
      startYear = c.field(ri, 'start', parseYear, { path, label });
      endYear = c.field(ri, 'end', parseYear, { path, label, required: true });
      if (startYear && endYear && endYear < startYear) c.error(label, `${path}.end`, '"end" is before "start"');
    } else {
      c.error(label, path, 'needs "year" for a one-time expense, or "start" and "end" for a recurring one');
    }
    const every = c.field(ri, 'every', (v) => parseInteger(v, { min: 1, max: 50 }), { path, label, dflt: 1 });
    const itemInflation = c.field(ri, 'inflation', (v) => parseRate(v, { min: -5, max: 30 }), { path, label, dflt: expInflation });
    items.push({ name, amount, startYear, endYear, every, inflation: itemInflation });
  });

  let healthcare = { preMedicare: 0, medicare: 0, inflation: expInflation };
  if (E.healthcare != null) {
    const path = 'expenses.healthcare';
    const label = 'Healthcare';
    if (c.isMap(E.healthcare, path, label)) {
      const H = E.healthcare;
      c.keys(H, ['pre_medicare', 'medicare', 'inflation'], path, label);
      healthcare = {
        preMedicare: c.field(H, 'pre_medicare', parseMoney, { path, label, dflt: 0 }),
        medicare: c.field(H, 'medicare', parseMoney, { path, label, dflt: 0 }),
        inflation: c.field(H, 'inflation', (v) => parseRate(v, { min: -5, max: 30 }), { path, label, dflt: expInflation }),
      };
    }
  }

  // --- liabilities --------------------------------------------------------------------------
  const liabilities = [];
  c.list(raw, 'liabilities', '', 'Loans').forEach((rl, i) => {
    const path = `liabilities[${i}]`;
    const label = `Loan "${isMapping(rl) && rl.name ? rl.name : `#${i + 1}`}"`;
    if (!c.isMap(rl, path, label)) return;
    c.keys(rl, ['name', 'balance', 'rate', 'monthly_payment'], path, label);
    const name = c.field(rl, 'name', str, { path, label, required: true });
    const balance = c.field(rl, 'balance', parseMoney, { path, label, required: true });
    const rate = c.field(rl, 'rate', (v) => parseRate(v, { min: 0, max: 40 }), { path, label, required: true });
    const monthlyPayment = c.field(rl, 'monthly_payment', parseMoney, { path, label, required: true });
    if (balance > 0 && rate !== undefined && monthlyPayment !== undefined && monthlyPayment <= balance * rate / 12) {
      const interest = Math.ceil(balance * rate / 12);
      c.error(label, `${path}.monthly_payment`, `$${monthlyPayment}/month doesn't cover the ~$${interest}/month interest, so it would never be paid off`);
    }
    liabilities.push({ name, balance, rate, monthlyPayment });
  });

  if (c.errors.length) return { errors: c.errors, warnings: c.warnings, plan: null };

  const endYear = Math.max(...people.map((p) => p.deathYear));
  return {
    errors: [],
    warnings: c.warnings,
    plan: {
      schemaVersion: version,
      asOf,
      startYear,
      endYear,
      people,
      salaries,
      socialSecurity,
      pensions,
      partTime,
      expenses: { baseAnnual, survivorPct, inflation: expInflation, items, healthcare },
      liabilities,
      accounts,
      assumptions: { inflation, filingStatus, state, withdrawalOrder, depositSurplusTo },
    },
  };
}
