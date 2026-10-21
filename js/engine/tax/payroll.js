// Payroll taxes on wages (salary + part-time). 401(k)/HSA payroll deferrals do not
// reduce these wages (true for 401(k); HSA cafeteria-plan deferrals actually are
// FICA-exempt — ignored, small). Social Security wage base applies per person;
// Additional Medicare threshold applies to combined wages on a joint return.

// wages: [person wage, ...]
export function payrollTaxes(wages, F, S) {
  const P = F.payroll;
  const total = wages.reduce((a, b) => a + b, 0);
  const socialSecurity = wages.reduce((a, w) => a + Math.min(w, P.ssWageBase) * P.ssRate, 0);
  const medicare = total * P.medicareRate;
  const additionalMedicare = Math.max(0, total - P.addlMedicareThreshold) * P.addlMedicareRate;
  const stateDisability = S ? total * S.sdiRate : 0;
  return {
    socialSecurity,
    medicare,
    additionalMedicare,
    stateDisability,
    total: socialSecurity + medicare + additionalMedicare + stateDisability,
  };
}
