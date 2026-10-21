// Federal income tax for one year (resolved table F from tables.resolveFederal).
// Model: AGI → standard deduction (+65 add-on, + senior deduction provision) → taxable
// income; qualified dividends and long-term gains stacked on top of ordinary income
// in the 0/15/20% brackets. No itemizing, AMT, credits.

// Tax on `income` through [[threshold, rate], ...] brackets (thresholds ascending, first 0).
export function bracketTax(brackets, income) {
  let tax = 0;
  for (let i = 0; i < brackets.length; i++) {
    const [lo, rate] = brackets[i];
    const hi = i + 1 < brackets.length ? brackets[i + 1][0] : Infinity;
    if (income <= lo) break;
    tax += (Math.min(income, hi) - lo) * rate;
  }
  return tax;
}

// Marginal rate at `income`.
export function marginalRate(brackets, income) {
  let rate = brackets[0][1];
  for (const [lo, r] of brackets) if (income > lo) rate = r;
  return rate;
}

// Taxable part of Social Security benefits (IRS Pub. 915 worksheet).
// otherIncome: AGI before Social Security (plus tax-exempt interest, which we don't model).
export function taxableSocialSecurity(benefits, otherIncome, { base, adjustedBase }) {
  if (benefits <= 0) return 0;
  const provisional = otherIncome + benefits / 2;
  if (provisional <= base) return 0;
  const tier1 = Math.min(benefits / 2, (provisional - base) / 2);
  if (provisional <= adjustedBase) return tier1;
  return Math.min(0.85 * benefits, 0.85 * (provisional - adjustedBase) + Math.min(tier1, (adjustedBase - base) / 2));
}

// Tax on the preferential slice [ordinaryTI, ordinaryTI + pref] through 0/15/20% brackets.
function capitalGainsTax(brackets, ordinaryTI, pref) {
  let tax = 0;
  const top = ordinaryTI + pref;
  for (let i = 0; i < brackets.length; i++) {
    const [lo, rate] = brackets[i];
    const hi = i + 1 < brackets.length ? brackets[i + 1][0] : Infinity;
    const overlap = Math.min(top, hi) - Math.max(ordinaryTI, lo);
    if (overlap > 0) tax += overlap * rate;
  }
  return tax;
}

// income: { ordinary, socialSecurity, qualifiedDividends, capitalGains (net; may be < 0) }
// people65: number of filers aged 65+ at year end.
export function federalIncomeTax(income, people65, F) {
  const gains = Math.max(income.capitalGains, -F.capitalLossLimit);
  const otherIncome = income.ordinary + income.qualifiedDividends + gains;
  const taxableSS = taxableSocialSecurity(income.socialSecurity, otherIncome, F.ssTaxation);
  const agi = otherIncome + taxableSS;

  let seniorDeduction = 0;
  if (F.seniorDeduction) {
    const s = F.seniorDeduction;
    const each = Math.max(0, s.perPerson - s.phaseoutRate * Math.max(0, agi - s.phaseoutStart));
    seniorDeduction = each * people65;
  }
  const deductions = F.standardDeduction + F.additional65 * people65 + seniorDeduction;
  const taxableIncome = Math.max(0, agi - deductions);
  const pref = Math.min(taxableIncome, income.qualifiedDividends + Math.max(0, gains));
  const ordinaryTI = taxableIncome - pref;
  const ordinaryTax = bracketTax(F.brackets, ordinaryTI);
  const cgTax = capitalGainsTax(F.capitalGainsBrackets, ordinaryTI, pref);
  return {
    agi,
    taxableSS,
    deductions,
    seniorDeduction,
    taxableIncome,
    ordinaryTax,
    capitalGainsTax: cgTax,
    total: ordinaryTax + cgTax,
    marginalRate: marginalRate(F.brackets, ordinaryTI),
  };
}
