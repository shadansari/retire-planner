# Retirement cash-flow projection

Static page (GitHub Pages) that loads a household plan (YAML) and simulates, year by
year, whether savings last through retirement, including taxes. Real data lives in a
**separate private repo**; this repo is public and contains only code, tax tables, and
fake example data.

The owner is an experienced Linux/systems engineer: skip basics. **Surface assumptions
explicitly** (in commit messages / replies) rather than choosing silently. Small commits
with clear messages.

## Hard rules

- **No build step, no runtime deps.** Plain HTML/CSS + vanilla JS ES modules. `package.json`
  exists only for `"type": "module"` and `npm test` → `node --test`. Node ≥ 20.
- **No third-party scripts at runtime.** Libraries are vendored in `vendor/` with
  LICENSE + `vendor/README.md` (version, source URL, sha256). Currently only js-yaml.
  Charts are hand-rolled SVG — do not add a chart library without asking.
- **CSP meta tag in index.html** (keep it this strict; no inline `<script>`/`<style>`/`style=`
  attributes, no `eval`):
  `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:;
  connect-src 'self' https://api.github.com; base-uri 'none'; form-action 'none'`
  plus `<meta name="referrer" content="no-referrer">`. `'self'` in connect-src is needed
  for demo mode to fetch `examples/example.yaml`.
- **Token handling (M3):** PAT lives in a module variable; optional "remember for this tab"
  uses sessionStorage. Never localStorage, never logged, never in URLs, scrub it from any
  displayed error. owner/repo/path (not the token) may go in localStorage.
- **Never commit real data.** `plan.yaml` and `*.private.yaml` are gitignored. All dev and
  tests use `examples/example.yaml` (obviously fake names, round numbers).
- **Engine purity:** everything under `js/engine/` is pure — no DOM, no fetch, no
  `Date.now()`/`new Date()` without args, no module-level mutable state. Tax tables and the
  parsed plan are passed in. This is what makes `node --test` work.

## Layout

```
index.html, css/app.css
js/app.js                 wiring only
js/data/load.js           text → js-yaml (CORE_SCHEMA) → validatePlan
js/data/github.js         (M3) GET /repos/{o}/{r}/contents/{path}, Accept: application/vnd.github.raw
js/engine/parse.js        primitive parsers: "3%"→0.03, "$1,000", YYYY-MM, monthIndex, typo hints
js/engine/validate.js     schema v1, one pass → { errors[], warnings[], plan } (plan = normalized,
                          null if any error). Engine code only ever sees the normalized plan.
js/engine/timeline.js     ages, alive/retired/claiming flags, partial-year fractions
js/engine/{income,expenses,liabilities,accounts,withdrawals}.js
js/engine/simulate.js     year loop → { years[], summary }
js/engine/tax/            (M2) index, tables, payroll, federal, capgains, socialsecurity, state, rmd, hooks
js/ui/                    summary, table, chart (SVG), assumptions, errors, format
vendor/js-yaml.mjs        parse with CORE_SCHEMA so dates stay strings
tax/                      (M2) federal-2026.json, states/<st>-2026.json, rmd tables
examples/example.yaml
test/*.test.js, test/helpers.js
```

Local run: `python3 -m http.server` (ES modules need http, not file://). Tests: `npm test`.

## Schema v1 conventions (plan.yaml)

The file is hand-edited by a non-programmer. Validation must be friendly.

- `schema_version: 1` required. Bump on breaking changes; keep a migration note here.
- **Rates are percent strings**: `return: 6%`, `inflation: 2.7%`. Bare numbers for rates are
  an error (no guessing between 0.06 and 6).
- **Dates**: `birth_date: YYYY-MM-DD`; `retirement_date` and other event dates `YYYY-MM`;
  expense items use plain years. `life_expectancy` is an age; person is modeled through
  the end of the calendar year they reach it.
- **Dollar basis**:
  - *Today's dollars* (inflated each year by `assumptions.inflation`, or a per-item override):
    base spending, expense items, healthcare, Social Security benefit (as on SSA statement;
    COLA = inflation), part-time work unless `today_dollars: false`.
  - *Nominal*: salaries (own `growth`), account balances, debts, pensions (own `cola`).
  - "Today" = start of the simulation (Jan 1 of start year); the gap from `as_of` is ignored.
- **References by id**: `people[].id`, `accounts[].id`; `owner: <person id>|joint`,
  `deposit_surplus_to: <account id>`, contributions target account ids. Validator checks
  they resolve.
- `withdrawal_order` accepts account types (`cash, taxable, traditional, roth, hsa`) and/or
  account ids; types expand to all accounts of that type in file order.
- Included beyond the original brief (approved): `salaries[].contributions`
  (pre-tax/Roth 401k + employer match; pre-tax reduces taxable wages in M2), survivor
  handling (survivor keeps larger SS benefit, `pensions[].survivor_pct`,
  `expenses.survivor_pct`, filing status → single the year after first death).

### Validation messages

Collect all errors (don't stop at first). Name the human-level thing, then the path:
`Alex's salary: "end" must be "retirement" or a month like 2031-06 (got "2031"). [income.salaries[0].end]`
YAML syntax errors include line number. Unknown keys → warnings (catches typos).
Every new schema field needs a validation rule and an invalid-fixture test.

## Engine semantics

- **Timeline**: `as_of: YYYY-MM` is when balances were read. Simulation starts **Jan 1 of the
  year after `as_of`** (or `as_of` year if month is 01); `as_of` balances are treated as
  Jan 1 balances. No partial first year. Runs through the year the longer-lived person
  reaches life expectancy.
- Partial years from events (retirement month, SS claim month, pension start) are prorated
  by months.
- **Per year order**:
  1. Inflows: salaries (net of deferrals), SS, pensions, part-time, taxable-account dividends
     (paid as cash, not reinvested).
  2. Outflows: spending (base + items + healthcare per person: pre-65 rate vs Medicare rate
     from 65), debt payments (amortized monthly, stop at payoff), taxes (0 in M1).
  3. RMDs (M2) are forced traditional withdrawals; excess over need is deposited as surplus.
  4. Net: surplus → `deposit_surplus_to`; gap → withdraw in `withdrawal_order`. Taxable sales
     realize gains pro rata to basis; basis is tracked.
  5. Growth: flows at start of year, then each balance grows by `return − dividend_yield`
     (dividend portion already paid out as cash).
- **HSA**: withdrawals tax-free up to that year's healthcare spending; beyond that treated as
  traditional (ordinary income).
- **Shortfall**: if all accounts are empty, record the unmet amount, keep simulating with
  balances floored at 0. Summary: first shortfall year + ages, cumulative unfunded.
- **Real vs nominal**: engine emits both for every money field.
  `real = nominal / (1 + inflation)^(year − start_year)`.

## Taxes (M2)

- Target "within a few percent of reality", not filing-grade.
- Tables are JSON data, not code: `tax/federal-2026.json`, `tax/states/<st>-2026.json`.
  Each has `sources: [{title, url}]`. **Look figures up from IRS/state primary sources;
  never from memory.**
- Each threshold flagged `indexed: true|false` (SS provisional-income thresholds and NIIT
  thresholds are NOT indexed). Indexed values inflate by `assumptions.inflation` after the
  table year. `provisions: [{id, start_year, end_year, ...}]` for temporary rules (e.g. the
  senior deduction through 2028).
- Model: payroll (SS wage base, Medicare, additional Medicare); federal ordinary brackets +
  standard deduction + 65+ add-on; LTCG/qualified dividends stacked on ordinary; SS
  taxable portion (0/50/85% via provisional income); state tax (brackets/flat, SS exemption
  flag, retirement exclusion); 10% early-withdrawal penalty before 59½ (with warning).
- RMDs implemented (start age 73 or 75 by birth year, Uniform Lifetime Table as data).
- NIIT and IRMAA: hooks only (`tax/hooks.js` beforeTax/afterTax per year), no-op stubs.
- Gross-up: bisection on gross withdrawal (monotone, guaranteed convergence), $1 tolerance,
  ≤ 50 iterations.
- Out of scope v1: itemized deductions, AMT, ACA credits, Roth conversions.

## Milestones

- **M1 — demo mode, no taxes**: skeleton, vendored js-yaml, example.yaml, validate/normalize,
  engine (timeline, income, expenses, amortization, accounts/withdrawals, simulate),
  index.html + CSP, summary/table/nominal-real toggle, SVG chart, assumptions panel,
  mobile pass, tests. Done when `npm test` is green, demo loads with zero CSP violations,
  usable at 375px width.
- **M2 — taxes**: tables with sources, tax modules, gross-up, RMDs, hooks, tax columns, tests
  against worked examples.
- **M3 — GitHub**: connect form, token handling, error scrubbing, Pages deploy, security
  review, plain-language guide for editing plan.yaml.
- **Later**: Roth conversions, NIIT/IRMAA real, ACA, scenario comparison, Monte Carlo, CSV export.

## Testing

- `node --test` (built-in runner + `node:assert/strict`), no test deps.
- Engine tests use hand-computed small fixtures (to the dollar) and a golden snapshot of key
  years of `examples/example.yaml`. When engine semantics change intentionally, update the
  snapshot in the same commit and say why.
- Each validation rule has a case in `test/validate.test.js`: mutate a fresh copy of the
  example's raw object, assert the exact message. (Text fixtures only for YAML-syntax cases.)
- Months internally are `monthIndex = year*12 + (month-1)`; salary `endMonth` is the last
  month paid (inclusive); `retirement_date` is the first month not working.
