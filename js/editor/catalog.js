// What the plan editor asks for, and how it explains each question.
//
// Pure data + small pure helpers (no DOM), shared by the setup wizard and the
// browse/edit view, and by the serializer for key order and section notes.
//
// A *block* is either
//   { kind: 'fields', fields: [field] }            fields at absolute paths ("assumptions.state")
//   { kind: 'list', path, itemFields: [field], … } a list of mappings ("accounts")
// A *field* has: key (relative to its item, or absolute in a 'fields' block), label,
// kind, and optionally required, why ("why we ask"), where ("where to find it"),
// suggest ([{ value, label }]), placeholder, show(item, raw), options(raw, item),
// unit ("/year"), and for kind 'list' a nested itemFields.
//
// Kinds and how they are stored in the raw plan (schema v1):
//   text, money (number), percent ("6%"), int, year (number), month ("2032-06"),
//   date ("1968-04-15"), enum (string), bool, person (person id, or "joint"),
//   account (account id), end ("retirement" | month), percentOrMoney ("10%" | number),
//   order (list of account types / ids), timing (virtual: one-time vs recurring),
//   list (nested list of mappings).

import { ACCOUNT_TYPES } from '../engine/validate.js';

const people = (raw) => (Array.isArray(raw?.people) ? raw.people : []);
const accounts = (raw) => (Array.isArray(raw?.accounts) ? raw.accounts : []);
const personName = (raw, id) => {
  const p = people(raw).find((x) => x?.id === id);
  return (p?.name && String(p.name).split(/\s+/)[0]) || id || 'Someone';
};
const personOptions = (raw, { joint = false } = {}) => [
  ...people(raw).filter((p) => p?.id).map((p) => ({ value: p.id, label: p.name || p.id })),
  ...(joint ? [{ value: 'joint', label: 'Joint (both of us)' }] : []),
];

export const TYPE_INFO = {
  cash: { label: 'Cash', help: 'Checking, savings, money market, CDs.' },
  taxable: { label: 'Taxable investments', help: 'A regular brokerage account: you pay tax on dividends and on gains when you sell.' },
  traditional: { label: 'Traditional (pre-tax)', help: '401(k), 403(b), 457, traditional IRA, SEP or rollover IRA: every dollar taken out is taxed as income.' },
  roth: { label: 'Roth', help: 'Roth IRA or Roth 401(k): withdrawals are tax-free.' },
  hsa: { label: 'HSA', help: 'Health savings account: tax-free when spent on healthcare.' },
};

const RETURN_SUGGEST = [
  { value: '3%', label: '3% cash' },
  { value: '4.5%', label: '4.5% mostly bonds' },
  { value: '5.5%', label: '5.5% balanced' },
  { value: '6.5%', label: '6.5% mostly stocks' },
];

const accountLabel = (raw, a) => a?.name || a?.id || 'New account';

// --- the sections, in wizard order ------------------------------------------------------

export const SECTIONS = [
  {
    id: 'start',
    title: 'Getting started',
    intro: "Let's set the starting point. Gather your latest account statements before you begin: the projection is only as good as the balances you put in.",
    blocks: [{
      kind: 'fields',
      fields: [
        {
          key: 'as_of', label: 'Balances are as of', kind: 'month', required: true,
          why: 'The projection starts on January 1 after this month, using the balances you enter as the starting point.',
          where: 'The statement date on your most recent account statements.',
        },
        {
          key: 'assumptions.filing_status', label: 'Tax filing status', kind: 'enum', required: true,
          options: () => [{ value: 'married_joint', label: 'Married filing jointly' }, { value: 'single', label: 'Single' }],
          why: 'Sets the tax brackets. If one of you dies, the plan switches to single filing the following year automatically.',
        },
        {
          key: 'assumptions.state', label: 'State you live in (for taxes)', kind: 'text', required: true, placeholder: 'CA',
          why: 'State income tax can be a large share of retirement taxes. Use the two-letter code.',
          suggest: [{ value: 'CA', label: 'CA' }],
          note: 'Only California has a state tax table so far; other states get federal taxes only.',
        },
      ],
    }],
  },
  {
    id: 'people',
    title: 'About you',
    intro: 'Who the plan is for. Ages drive everything: when paychecks stop, when Social Security and Medicare start, and how long the money needs to last.',
    blocks: [{
      kind: 'list', path: 'people', min: 1, max: 2, noun: 'person', idFrom: 'name',
      itemTitle: (raw, p) => p?.name || 'New person',
      newItem: () => ({ id: '', name: '', birth_date: '', retirement_date: '', life_expectancy: 92 }),
      itemFields: [
        { key: 'name', label: 'Name', kind: 'text', required: true, placeholder: 'First and last name', why: 'Shown on the page; the first name labels this person\'s accounts and income.' },
        { key: 'birth_date', label: 'Birth date', kind: 'date', required: true },
        {
          key: 'retirement_date', label: 'First month not working', kind: 'month', required: true,
          why: 'Salary stops the month before this. If you have already retired, enter the month you stopped.',
          where: "Your target date. If you're unsure, try a likely date now and compare a later one in the preview.",
        },
        {
          key: 'life_expectancy', label: 'Plan to age', kind: 'int', required: true, unit: 'years old',
          why: 'Planning to live too long costs little; running out of money at 88 costs a lot. Planners often use 92–95.',
          where: "SSA's life expectancy calculator gives averages; family history and health matter more.",
          suggest: [{ value: 90, label: '90' }, { value: 92, label: '92' }, { value: 95, label: '95' }],
        },
      ],
    }],
  },
  {
    id: 'accounts',
    title: 'Savings & investments',
    intro: 'Every account that holds money for the future. Each type is taxed differently when you take money out, so the type matters as much as the balance.',
    blocks: [{
      kind: 'list', path: 'accounts', min: 1, noun: 'account', idFrom: 'name',
      itemTitle: accountLabel,
      itemSubtitle: (raw, a) => [TYPE_INFO[a?.type]?.label, a?.owner === 'joint' ? 'Joint' : a?.owner && personName(raw, a.owner)].filter(Boolean).join(' · '),
      newItem: (raw) => ({ id: '', name: '', owner: people(raw)[0]?.id ?? '', type: '', balance: '', return: '' }),
      itemFields: [
        { key: 'name', label: 'Account name', kind: 'text', required: true, placeholder: 'e.g. Alex 401(k) at Fidelity' },
        {
          key: 'type', label: 'Type', kind: 'enum', required: true,
          options: () => ACCOUNT_TYPES.map((t) => ({ value: t, label: TYPE_INFO[t].label, help: TYPE_INFO[t].help })),
          why: 'Decides how withdrawals are taxed and which accounts have required minimum distributions.',
        },
        {
          key: 'owner', label: 'Whose account', kind: 'person', required: true,
          options: (raw, a) => personOptions(raw, { joint: ['cash', 'taxable'].includes(a?.type) }),
          why: 'Retirement accounts belong to one person (it matters for age 59½ and required withdrawals). Cash and brokerage accounts can be joint.',
        },
        { key: 'balance', label: 'Balance', kind: 'money', required: true, where: 'Your latest statement, from the month under "Balances are as of".' },
        {
          key: 'return', label: 'Expected yearly return', kind: 'percent', required: true,
          why: 'Before inflation, after fees. Small differences compound over decades, so lean conservative.',
          where: 'Think about what the account holds: mostly stocks, bonds, cash, or a mix.',
          suggest: RETURN_SUGGEST,
        },
        {
          key: 'cost_basis', label: 'Cost basis (what you paid in)', kind: 'money', required: true,
          show: (a) => a?.type === 'taxable',
          why: 'Only the gain above what you paid is taxed when you sell.',
          where: 'Your brokerage\'s "unrealized gain/loss" or cost basis page: cost basis = balance − unrealized gain.',
        },
        {
          key: 'dividend_yield', label: 'Dividend yield', kind: 'percent',
          show: (a) => a?.type === 'taxable',
          why: 'Dividends are paid out and taxed every year even if you don\'t sell. It is part of the return above, not extra.',
          where: "Last year's 1099-DIV total ÷ balance, or the funds' yield. Broad stock index funds are around 1.5%.",
          suggest: [{ value: '1.5%', label: '1.5%' }, { value: '2%', label: '2%' }],
        },
      ],
    }],
  },
  {
    id: 'salaries',
    title: 'Paychecks',
    intro: 'Pay from current jobs, until each of you retires, and what goes into retirement accounts from each paycheck.',
    blocks: [{
      kind: 'list', path: 'income.salaries', noun: 'paycheck',
      itemTitle: (raw, s) => (s?.owner ? `${personName(raw, s.owner)}'s salary` : 'New salary'),
      newItem: (raw) => ({ owner: people(raw).find((p) => !(raw.income?.salaries ?? []).some((s) => s?.owner === p.id))?.id ?? '', amount: '', growth: '3%', end: 'retirement' }),
      itemFields: [
        { key: 'owner', label: 'Whose job', kind: 'person', required: true, options: (raw) => personOptions(raw) },
        { key: 'amount', label: 'Yearly salary, before tax', kind: 'money', required: true, unit: '/year', where: 'Your base pay on a pay stub or offer letter. Include regular bonuses if you count on them.' },
        {
          key: 'growth', label: 'Yearly raise', kind: 'percent',
          why: 'Raises compound until retirement. Matching inflation (2.5–3%) is a reasonable default.',
          suggest: [{ value: '0%', label: 'None' }, { value: '2.5%', label: '2.5%' }, { value: '3%', label: '3%' }, { value: '4%', label: '4%' }],
        },
        {
          key: 'end', label: 'Paid until', kind: 'end',
          why: 'Usually until retirement. Use a specific month if this job ends earlier.',
        },
        {
          key: 'contributions', label: 'Retirement savings from this paycheck', kind: 'list', noun: 'contribution',
          why: 'Money set aside from each paycheck, plus any employer match. Pre-tax contributions also lower income tax.',
          where: 'Your 401(k) or benefits website, under contribution rate and company match.',
          newItem: () => ({ account: '', employee: '', employer: '' }),
          itemTitle: (raw, c) => accounts(raw).find((a) => a?.id === c?.account)?.name || 'New contribution',
          itemFields: [
            {
              key: 'account', label: 'Into account', kind: 'account', required: true,
              options: (raw, c, parent) => accounts(raw)
                .filter((a) => ['traditional', 'roth', 'hsa'].includes(a?.type) && (!parent?.owner || a.owner === parent.owner))
                .map((a) => ({ value: a.id, label: a.name || a.id })),
              note: "Only this person's 401(k), Roth or HSA accounts are listed. Add the account under Savings & investments first if it's missing.",
            },
            { key: 'employee', label: 'You contribute', kind: 'percentOrMoney', why: 'A percentage of salary (10%) or dollars per year (23000).' },
            { key: 'employer', label: 'Employer adds', kind: 'percentOrMoney', why: 'The match, as a percentage of salary or dollars per year.' },
          ],
        },
      ],
    }],
  },
  {
    id: 'social_security',
    title: 'Social Security',
    intro: 'For most couples this is the largest income in retirement, and when you claim is one of the biggest decisions in the plan.',
    blocks: [{
      kind: 'list', path: 'income.social_security', noun: 'benefit', max: 2,
      itemTitle: (raw, s) => (s?.owner ? `${personName(raw, s.owner)}'s Social Security` : 'New benefit'),
      newItem: (raw) => ({ owner: people(raw).find((p) => !(raw.income?.social_security ?? []).some((s) => s?.owner === p.id))?.id ?? '', claim_age: 67, monthly_benefit: '' }),
      itemFields: [
        { key: 'owner', label: 'Whose benefit', kind: 'person', required: true, options: (raw) => personOptions(raw) },
        {
          key: 'claim_age', label: 'Start at age', kind: 'int', required: true,
          why: 'From 62 to 70. Each year you wait past full retirement age (67 for most people today) raises the benefit about 8%, for life.',
          suggest: [{ value: 62, label: '62' }, { value: 67, label: '67' }, { value: 70, label: '70' }],
        },
        { key: 'claim_months', label: 'Plus months', kind: 'int', why: 'Optional, 0–11: for example 66 and 6 months.' },
        {
          key: 'monthly_benefit', label: 'Monthly benefit at that age', kind: 'money', required: true, unit: '/month',
          why: "In today's dollars, as SSA shows it. The page adds cost-of-living increases.",
          where: 'ssa.gov/myaccount → "Plan for retirement" shows the estimate for each starting age.',
        },
      ],
    }],
  },
  {
    id: 'other_income',
    title: 'Pensions & other income',
    intro: 'Guaranteed income and planned work in retirement. Skip this step if neither applies.',
    blocks: [
      {
        kind: 'list', path: 'income.pensions', noun: 'pension', heading: 'Pensions',
        itemTitle: (raw, p) => p?.name || 'New pension',
        newItem: (raw) => ({ owner: people(raw)[0]?.id ?? '', name: '', start: '', annual: '', cola: '0%', survivor_pct: '0%' }),
        itemFields: [
          { key: 'name', label: 'Pension name', kind: 'text', placeholder: 'e.g. Teachers pension' },
          { key: 'owner', label: 'Whose pension', kind: 'person', required: true, options: (raw) => personOptions(raw) },
          { key: 'start', label: 'First month paid', kind: 'month', required: true },
          { key: 'annual', label: 'Yearly amount when it starts', kind: 'money', required: true, unit: '/year', where: "Your pension statement's estimate for that start date (monthly × 12)." },
          { key: 'cola', label: 'Yearly increase', kind: 'percent', why: 'Many private pensions never increase (0%); many public ones have a cost-of-living adjustment.' },
          { key: 'survivor_pct', label: 'Continues to spouse', kind: 'percent', why: 'The share your spouse keeps if you die first, depending on the payout option you chose (e.g. 50% or 100% joint-and-survivor).' },
        ],
      },
      {
        kind: 'list', path: 'income.part_time', noun: 'job', heading: 'Part-time work in retirement',
        itemTitle: (raw, p) => p?.name || 'New part-time work',
        newItem: (raw) => ({ owner: people(raw)[0]?.id ?? '', name: '', annual: '', start: '', end: '' }),
        itemFields: [
          { key: 'name', label: 'Description', kind: 'text', placeholder: 'e.g. Consulting' },
          { key: 'owner', label: 'Who', kind: 'person', required: true, options: (raw) => personOptions(raw) },
          { key: 'annual', label: 'Yearly pay', kind: 'money', required: true, unit: '/year' },
          { key: 'start', label: 'First month', kind: 'month', required: true },
          { key: 'end', label: 'Last month', kind: 'month', why: 'Leave blank to keep it going for life.' },
          { key: 'today_dollars', label: "Amount is in today's dollars", kind: 'bool', why: 'Ticked: the amount grows with inflation. Unticked: a fixed dollar amount.' },
        ],
      },
    ],
  },
  {
    id: 'spending',
    title: 'Everyday spending',
    intro: 'What you spend in a normal year: the single most important number in the plan. Healthcare, debts and big one-off expenses come next, so leave them out here.',
    blocks: [{
      kind: 'fields',
      fields: [
        {
          key: 'expenses.base_annual', label: 'Yearly spending', kind: 'money', required: true, unit: '/year',
          why: "In today's dollars. Include property tax, insurance, utilities, food, travel you do every year. Leave out mortgage payments, healthcare and income taxes: the page adds those.",
          where: "A year of bank and credit-card statements is the most reliable source. Many people find they spend more than they think.",
        },
        {
          key: 'expenses.survivor_pct', label: 'Spending for one person', kind: 'percent',
          show: (raw) => people(raw).length === 2,
          why: 'After one of you dies, household costs drop, but not by half. 70–80% is typical.',
          suggest: [{ value: '70%', label: '70%' }, { value: '75%', label: '75%' }, { value: '80%', label: '80%' }],
        },
        {
          key: 'expenses.inflation', label: 'Spending inflation (optional)', kind: 'percent',
          why: 'Leave blank to use the general inflation rate from the last step.',
        },
      ],
    }],
  },
  {
    id: 'items',
    title: 'Big expenses',
    intro: "The lumpy costs that a yearly budget misses: cars, a roof, travel while you're active, helping family. In today's dollars.",
    blocks: [{
      kind: 'list', path: 'expenses.items', noun: 'expense',
      itemTitle: (raw, it) => it?.name || 'New expense',
      itemSubtitle: (raw, it) => (it?.year != null ? String(it.year) : it?.start != null ? `${it.start}–${it.end ?? '?'}${it.every > 1 ? `, every ${it.every} years` : ''}` : ''),
      newItem: () => ({ name: '', amount: '', year: '' }),
      itemFields: [
        { key: 'name', label: 'What for', kind: 'text', required: true, placeholder: 'e.g. Replace car' },
        { key: 'amount', label: 'Amount each time', kind: 'money', required: true },
        { key: 'timing', label: 'How often', kind: 'timing' },
        { key: 'year', label: 'Year', kind: 'year', required: true, show: (it) => it?.start == null },
        { key: 'start', label: 'First year', kind: 'year', required: true, show: (it) => it?.start != null },
        { key: 'end', label: 'Last year', kind: 'year', required: true, show: (it) => it?.start != null },
        { key: 'every', label: 'Every how many years', kind: 'int', show: (it) => it?.start != null, why: '1 for every year; 8 for a car every eight years.' },
        { key: 'inflation', label: 'Inflation for this item (optional)', kind: 'percent', why: 'Leave blank to use spending inflation. College costs, for example, have risen faster.' },
      ],
    }],
  },
  {
    id: 'healthcare',
    title: 'Healthcare',
    intro: 'Healthcare is often the fastest-growing cost in retirement, and the gap between retiring and Medicare at 65 is the most expensive stretch.',
    blocks: [{
      kind: 'fields',
      fields: [
        {
          key: 'expenses.healthcare.pre_medicare', label: 'Per person, retired and under 65', kind: 'money', unit: '/year',
          why: "Premiums plus out-of-pocket costs, in today's dollars. Only applies after retiring (before that, your employer plan is in your paycheck).",
          where: 'Covered California (or healthcare.gov) quotes for your ages, plus the deductible you expect to use.',
        },
        {
          key: 'expenses.healthcare.medicare', label: 'Per person, 65 and over', kind: 'money', unit: '/year',
          why: 'Medicare Part B and D premiums, a supplement or Advantage plan, and out-of-pocket costs.',
          where: 'medicare.gov plan finder, or what parents and friends pay.',
        },
        {
          key: 'expenses.healthcare.inflation', label: 'Healthcare inflation', kind: 'percent',
          why: 'Healthcare costs have usually risen faster than general inflation; 5% is a common planning figure.',
          suggest: [{ value: '4%', label: '4%' }, { value: '5%', label: '5%' }, { value: '6%', label: '6%' }],
        },
      ],
    }],
  },
  {
    id: 'liabilities',
    title: 'Debts',
    intro: 'Mortgage and other loans. Payments stop automatically when each is paid off.',
    blocks: [{
      kind: 'list', path: 'liabilities', noun: 'loan',
      itemTitle: (raw, l) => l?.name || 'New loan',
      newItem: () => ({ name: '', balance: '', rate: '', monthly_payment: '' }),
      itemFields: [
        { key: 'name', label: 'Loan', kind: 'text', required: true, placeholder: 'e.g. Mortgage' },
        { key: 'balance', label: 'Balance owed', kind: 'money', required: true, where: 'Your latest loan statement.' },
        { key: 'rate', label: 'Interest rate', kind: 'percent', required: true },
        {
          key: 'monthly_payment', label: 'Monthly payment', kind: 'money', required: true, unit: '/month',
          why: 'Principal and interest only. Property tax and insurance belong in everyday spending, because they continue after payoff.',
        },
      ],
    }],
  },
  {
    id: 'strategy',
    title: 'Strategy',
    intro: 'Last step: the economic assumption and how money moves between accounts.',
    blocks: [{
      kind: 'fields',
      fields: [
        {
          key: 'assumptions.inflation', label: 'General inflation', kind: 'percent', required: true,
          why: "Grows spending, Social Security and today's-dollar amounts. The Fed targets 2%; 2.5–3% builds in some caution.",
          suggest: [{ value: '2.5%', label: '2.5%' }, { value: '3%', label: '3%' }],
        },
        {
          key: 'assumptions.withdrawal_order', label: 'When spending exceeds income, draw from', kind: 'order', required: true,
          why: 'A common order is cash and taxable accounts first, then pre-tax, with Roth last so it keeps growing tax-free. Required minimum distributions happen regardless.',
          suggest: [{ value: ['cash', 'taxable', 'traditional', 'hsa', 'roth'], label: 'Usual order' }],
        },
        {
          key: 'assumptions.deposit_surplus_to', label: 'In years with money left over, put it in', kind: 'account', required: true,
          options: (raw) => accounts(raw).filter((a) => ['cash', 'taxable'].includes(a?.type)).map((a) => ({ value: a.id, label: a.name || a.id })),
          why: 'A cash or brokerage account (retirement accounts have contribution limits).',
        },
      ],
    }],
  },
];

export const sectionById = (id) => SECTIONS.find((s) => s.id === id);

// Every list block, by path (for item labels in messages and commit summaries).
export const LIST_BLOCKS = SECTIONS.flatMap((s) => s.blocks.filter((b) => b.kind === 'list'));
export const listBlock = (path) => LIST_BLOCKS.find((b) => b.path === path);
