# Editing our plan

Our plan is the file `plan.yaml` in our private GitHub repository. The page reads it and
shows, year by year, whether our savings last. You can't break anything permanently:
GitHub keeps every earlier version.

## How to edit

1. On github.com, open our private plan repository and click **plan.yaml**.
2. Click the **pencil** icon (Edit this file).
3. Make your change. Then click **Commit changes…** → **Commit changes**.
4. On the planner page, click **Reload** (next to "Loaded: …").

If the page finds a problem, it lists it in a red box saying exactly what's wrong and where:

> Jamie's salary: "growth" must be a percentage with a % sign, like 3% (got 0.03) [income.salaries[1].growth]

The part in brackets is where it is in the file: here, the second salary's `growth` line.
Yellow "warnings" don't stop the projection; they point out things that look like typos.

**Tip:** to try a change without saving it, download `plan.yaml`, edit it on your computer,
and use **Open local file…** on the page. Nothing is uploaded.

## The rules of the file

- **Indentation matters.** Use spaces (never tabs), lined up like the lines around them.
- **Percentages** always have a % sign: `return: 6%`, `inflation: 2.5%`.
- **Dollar amounts** are plain numbers: `95000`. (`$95,000` also works.)
- **Months** are written year-month: `2032-06`. **Dates** are year-month-day: `1968-04-15`.
- Lines starting with `#` are notes for us; the page ignores them.
- A list item starts with `- `. Copy an existing item (all its lines) to add another.

## Common changes

**Update balances** (once or twice a year, from statements): change each account's
`balance:` and the taxable account's `cost_basis:`, then set `as_of:` to the month you
read them, e.g. `as_of: 2027-01`.

**A raise:** change `amount:` under that person's salary.

**Change a retirement date:** `retirement_date:` under the person, as the first month
*not* working, e.g. `2033-01`.

**Add a one-time expense** (under `expenses:` → `items:`):

```yaml
    - name: Kitchen remodel
      amount: 40000
      year: 2029
```

**Add a recurring expense** (every year from start to end, or every few years with `every`):

```yaml
    - name: Help with grandkids' college
      amount: 10000
      start: 2035
      end: 2042
```

**Change when Social Security starts:** `claim_age:` (62–70) and `monthly_benefit:`,
the amount shown for that age on your ssa.gov statement.

**Everyday spending:** `base_annual:` under `expenses:`, in today's dollars, *not*
counting the mortgage or healthcare (those are separate).

## What the numbers mean

- **Today's dollars** (the default view) shows everything at today's prices, so
  numbers far in the future are comparable to now. **Future $** shows the actual
  dollar amounts in those years.
- Amounts we write for spending, healthcare and Social Security are in **today's
  dollars**; the page grows them with inflation. Salaries, balances, loans and pensions
  are **actual dollars**.
- Taxes are estimates (federal, California, payroll), not tax-return accurate.
- The **Assumptions in use** section at the bottom lists everything the page used,
  in plain words. If it doesn't match what we meant, the file needs a fix.
