# Editing our plan

Our plan is the file `plan.yaml` in our private GitHub repository. The page reads it and
shows, year by year, whether our savings last. You can't break anything permanently:
GitHub keeps every earlier version.

## How to edit (on the page)

1. Open the planner and load our plan (owner, repository, path, and the token from the
   password manager).
2. Click **Edit plan** (next to "Loaded: …").
3. **Browse & edit** lists every part of the plan: Getting started, About you, Savings &
   investments, and so on. Pick a section, then an entry (like an account), and change it.
   Each question says *why* it's asked and *where to find* the number.
4. **Preview** shows the projection with your changes before saving.
5. **Save to GitHub** saves it. Each save is recorded on GitHub with a note of what
   changed, so any change can be looked up or undone later.

Starting from scratch? **Guided setup** (or **Start a new plan** on the opening screen)
walks through everything step by step, with **Back** and **Next**. You can skip a step
and come back; the last step lists anything still missing.

Notes:
- Something wrong is shown in red right next to the question, in plain words.
- Unsaved edits survive reloading the page, but not closing the tab. Save first.
- If the plan was changed somewhere else after you loaded it, the page won't overwrite
  it: it offers to download your version instead. Reload, then make the change again.
- Saving needs a token with **Contents: Read and write** (see the setup guide). With a
  read-only token the button says **Download plan.yaml** instead.

## Editing the file directly (optional)

The editor writes `plan.yaml` for us, but it is a plain text file and can be edited by hand
on github.com (open it, click the **pencil**, then **Commit changes**). Notes typed into
the file by hand are replaced the next time the page saves it.

If the page finds a problem in the file, it lists it in a red box saying exactly what's
wrong and where:

> Jamie's salary: "growth" must be a percentage with a % sign, like 3% (got 0.03) [income.salaries[1].growth]

The part in brackets is where it is in the file: here, the second salary's `growth` line.
Yellow "warnings" don't stop the projection; they point out things that look like typos.

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
