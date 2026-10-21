// Extension points for costs the model doesn't compute yet. Each hook sees the year's
// tax context and resolved tables and returns a dollar amount that is added to the
// year's taxes (shown separately). Replace a stub's `compute` to model it.
//
//   ctx: { year, status, agi, investmentIncome, magiTwoYearsAgo?, people65, F, S }

export const taxHooks = [
  {
    id: 'niit',
    label: 'Net investment income tax (3.8%)',
    modeled: false,
    // Real rule: 3.8% × min(net investment income, MAGI − F.niit.threshold).
    compute: () => 0,
  },
  {
    id: 'irmaa',
    label: 'Medicare IRMAA surcharges',
    modeled: false,
    // Real rule: Part B/D surcharge tiers on MAGI from two years earlier, per person on Medicare.
    compute: () => 0,
  },
];
