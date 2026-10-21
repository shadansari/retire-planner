// State income tax (resolved table S from tables.resolveState). Data-driven so other
// states can be added as JSON; currently shaped around California:
// gains/dividends taxed as ordinary, optional Social Security exemption, standard
// deduction, exemption credits (personal + per-person 65+), surtax over a threshold.

import { bracketTax, marginalRate } from './federal.js';

// income: { ordinary, socialSecurity, qualifiedDividends, capitalGains }
export function stateIncomeTax(income, people65, S) {
  const gains = Math.max(income.capitalGains, -S.capitalLossLimit);
  const agi = income.ordinary + income.qualifiedDividends + gains + (S.taxesSocialSecurity ? income.socialSecurity : 0);
  const taxableIncome = Math.max(0, agi - S.standardDeduction);
  const bracket = bracketTax(S.brackets, taxableIncome);
  const credits = Math.min(bracket, S.personalCredit + S.seniorCreditPerPerson * people65);
  const surtax = S.surtax ? Math.max(0, taxableIncome - S.surtax.over) * S.surtax.rate : 0;
  return {
    agi,
    taxableIncome,
    bracketTax: bracket,
    credits,
    surtax,
    total: bracket - credits + surtax,
    marginalRate: marginalRate(S.brackets, taxableIncome),
  };
}
