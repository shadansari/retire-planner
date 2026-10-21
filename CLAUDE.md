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
js/engine/{income,expenses,liabilities,accounts}.js   (accounts.js includes withdrawInOrder)
js/engine/simulate.js     year loop → { years[], summary }
js/engine/tax/            (M2) index, tables, payroll, federal, capgains, socialsecurity, state, rmd, hooks
js/ui/                    summary, table, chart (SVG), assumptions, errors, format
vendor/js-yaml.mjs        parse with CORE_SCHEMA so dates stay strings
tax/                      (M2) federal-2026.json, states/<st>-2026.json, rmd tables
examples/example.yaml
test/*.test.js, test/helpers.js
```

Local run: `python3 -m http.server` (ES modules need http, not file://), then open
`/?demo` to auto-load the example. Tests: `npm test`.

Page check (dev only, not served logic): `node tools/check-page.mjs <url> <width> <out.png> [dark]`
drives headless Chrome over DevTools with true device emulation; prints page scrollWidth
(must equal width → no horizontal scroll) and every console/CSP message (must be none),
and saves a screenshot. Use it at 375 (phone), ~1280, and dark before calling UI work done.
Note: plain `chrome --headless --window-size=375,…` can't go below ~500px, so its
screenshots look cropped; use the tool.

UI notes:
- "Open local file…" reads a YAML file with FileReader (nothing uploaded) so plan edits
  can be previewed before pushing to the private repo.
- All plan-derived text goes into the DOM via textContent (`js/ui/dom.js` `h()`/`s()`);
  never innerHTML. Pass arrays to `replaceChildren` spread (`...arr`), it doesn't flatten.
- Chart colors: validated 5-slot categorical palette (dataviz skill), fixed per account
  type (cash, taxable, traditional, roth, hsa → slots 1–5) in light and dark. Light-mode
  contrast < 3:1 for 3 slots is relieved by the legend + table view; keep both.
- Element positioning from JS uses `el.style.*` (CSSOM, allowed by CSP); never
  `setAttribute('style', …)` or inline `style=` (blocked).

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

## Taxes (M2, done 2026-10-20)

- Target "within a few percent of reality", not filing-grade.
- Tables are JSON data, not code. `tax/index.json` is the manifest the page reads
  (federal file, rmd file, state code → file). Current: `federal-2026.json`,
  `states/ca-2025.json`, `rmd.json`. Each has `sources: [{title, url}]`.
  **Look figures up from IRS/state primary sources, never memory; read the PDF/page
  itself** (WebFetch often can't parse IRS PDFs: download and extract text with pypdf
  in a scratch venv; FTB/SSA block WebFetch, curl with a browser UA usually works).
- CA uses 2025 because FTB hadn't published 2026 indexing (Oct 2026) and its own 2026
  540-ES instructions say to use 2025 figures. When FTB publishes (late Dec), add
  `ca-2026.json`, point the manifest at it, update goldens.
- Each section has `indexed: true|false`. Indexed dollar thresholds inflate by
  `assumptions.inflation` from the table year (`tax/tables.js`); rates never inflate.
  Statutory, not indexed: SS taxation thresholds (32k/44k, 25k/34k), Additional Medicare
  and NIIT thresholds, $3k loss limit, senior deduction, CA 1% surtax threshold.
  `provisions: [{id, start_year, end_year, ...}]` for temporary rules (senior deduction
  2025–2028, $6,000 per person 65+, 6% phase-out applied per person per Schedule 1-A).
- Modules (`js/engine/tax/`): `tables` (resolve year/status), `federal` (brackets,
  Pub. 915 SS taxation, std + 65+ + senior deduction, LTCG/qualified-dividend stacking,
  $3k loss cap), `state` (data-driven; CA-shaped: SS exempt, gains as ordinary, exemption
  credits, surtax), `payroll` (OASDI per-person wage base, Medicare, Additional Medicare
  on combined wages, state SDI), `rmd`, `hooks` (NIIT, IRMAA stubs returning 0), `index`
  (`computeTaxes(ctx, tables)`).
- `simulate(plan, { taxTables: { federal, state, rmd } })`; without `taxTables` the run
  is tax- and RMD-free (M1 tests and golden rely on this).
- Year flow with taxes: RMDs (start-of-year balance / divisor; start age 73 if born
  1951–59, 75 if 1960+) → contributions → outflows → bisection on the gross voluntary
  withdrawal (trial on a copy of accounts) until after-tax cash ≥ gap (±$0.50; leftover
  deposited as surplus). Taxes paid in the same year.
- Modeling choices: filing joint through the year of first death, then single; deceased
  spouse's accounts roll to the survivor (RMDs and 59½ test by survivor's age);
  dividends qualified; cash interest taxed annually; HSA withdrawals tax-free up to that
  year's healthcare spending; traditional withdrawals "early" if 59½ not reached by Dec 31
  (10% federal + CA 2.5%); 401(k)/HSA deferrals reduce income-tax wages, not payroll wages.
- Out of scope v1: itemized deductions, AMT, credits, ACA credits, Roth conversions, CA
  exemption-credit phase-out and HSA non-conformity, NIIT/IRMAA (hooks only).

## Milestones

- **M1 — demo mode, no taxes** (done 2026-10-20): skeleton, vendored js-yaml, example.yaml, validate/normalize,
  engine (timeline, income, expenses, amortization, accounts/withdrawals, simulate),
  index.html + CSP, summary/table/nominal-real toggle, SVG chart, assumptions panel,
  mobile pass, tests. Done when `npm test` is green, demo loads with zero CSP violations,
  usable at 375px width.
- **M2 — taxes** (done 2026-10-20): tables with sources, tax modules, gross-up, RMDs, hooks,
  tax breakdown in table/summary/assumptions, tests against published bracket amounts and
  worked examples.
- **M3 — GitHub** (code done 2026-10-20): `js/data/github.js` (contents API, friendly
  errors, token scrubbing; fetch injectable for tests), connect form in `index.html`/`app.js`
  (token in memory; sessionStorage only if "remember" ticked AND GitHub accepted it;
  owner/repo/path in localStorage; auto-load on tab reload), frame-busting,
  `docs/github-token.md` (setup), `docs/editing-plan.md` (plain-language guide for
  editing plan.yaml), `docs/security.md` (threat model + deploy checklist),
  `test/security.test.js` (CSP, sinks, storage, vendor checksum, gitignore).
  Public repo: `shadansari/retire-planner`, GitHub Pages from `main` / root, `.nojekyll`.
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
