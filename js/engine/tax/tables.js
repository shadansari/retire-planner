// Resolve a tax table (JSON from tax/) to the dollar figures for one year and filing
// status. Sections flagged indexed:true have their dollar thresholds inflated by the
// plan's inflation from the table year; rates are never inflated.

const factor = (table, year, inflation) => (1 + inflation) ** (year - table.year);

const scaleBrackets = (brackets, f) => brackets.map(([lo, rate]) => [lo * f, rate]);

export const isActive = (p, year) => year >= p.start_year && year <= p.end_year;

export function resolveFederal(t, year, inflation, status) {
  const f = factor(t, year, inflation);
  const ix = (section) => (section.indexed ? f : 1);
  const senior = t.provisions.find((p) => p.id === 'senior_deduction' && isActive(p, year));
  return {
    year,
    status,
    brackets: scaleBrackets(t.ordinary_brackets[status], ix(t.ordinary_brackets)),
    standardDeduction: t.standard_deduction[status] * ix(t.standard_deduction),
    additional65: t.additional_deduction_65[status] * ix(t.additional_deduction_65),
    capitalGainsBrackets: scaleBrackets(t.capital_gains_brackets[status], ix(t.capital_gains_brackets)),
    capitalLossLimit: t.capital_loss_limit.amount * ix(t.capital_loss_limit),
    ssTaxation: {
      base: t.social_security_taxation[status].base * ix(t.social_security_taxation),
      adjustedBase: t.social_security_taxation[status].adjusted_base * ix(t.social_security_taxation),
    },
    payroll: {
      ssRate: t.payroll.social_security.rate,
      ssWageBase: t.payroll.social_security.wage_base * ix(t.payroll.social_security),
      medicareRate: t.payroll.medicare.rate,
      addlMedicareRate: t.payroll.additional_medicare.rate,
      addlMedicareThreshold: t.payroll.additional_medicare[status] * ix(t.payroll.additional_medicare),
    },
    niit: { rate: t.niit.rate, threshold: t.niit[status] * ix(t.niit) },
    earlyPenalty: { rate: t.early_withdrawal_penalty.rate, beforeAgeMonths: t.early_withdrawal_penalty.before_age_months },
    seniorDeduction: senior ? {
      perPerson: senior.amount_per_person * (senior.indexed ? f : 1),
      minAge: senior.min_age,
      phaseoutRate: senior.phaseout_rate,
      phaseoutStart: senior[status] * (senior.indexed ? f : 1),
    } : null,
  };
}

export function resolveState(t, year, inflation, status) {
  const f = factor(t, year, inflation);
  const ix = (section) => (section.indexed ? f : 1);
  return {
    year,
    status,
    jurisdiction: t.jurisdiction,
    brackets: scaleBrackets(t.ordinary_brackets[status], ix(t.ordinary_brackets)),
    standardDeduction: t.standard_deduction[status] * ix(t.standard_deduction),
    personalCredit: t.exemption_credits.personal[status] * ix(t.exemption_credits),
    seniorCreditPerPerson: t.exemption_credits.senior_per_person_65 * ix(t.exemption_credits),
    surtax: t.surtax ? { rate: t.surtax.rate, over: t.surtax.over * ix(t.surtax) } : null,
    taxesSocialSecurity: t.taxes_social_security,
    capitalLossLimit: t.capital_loss_limit.amount * ix(t.capital_loss_limit),
    sdiRate: t.payroll?.sdi?.rate ?? 0,
    earlyPenalty: { rate: t.early_withdrawal_penalty.rate, beforeAgeMonths: t.early_withdrawal_penalty.before_age_months },
  };
}
