// One year's taxes from an income breakdown. Pure; tables are the raw JSON objects
// from tax/ ({ federal, state }) and are resolved here for the year/status.
//
// ctx: {
//   year, inflation, status ('married_joint'|'single'), people65,
//   wages: [per-person gross wages],      preTaxDeferrals,
//   pension, socialSecurity, interest, dividends (all treated as qualified),
//   realizedGains (net long-term; may be negative),
//   traditional (withdrawals incl. RMDs), hsaTaxable (non-medical HSA withdrawals),
//   earlyDistributions (traditional withdrawals before 59½, subject to penalties)
// }

import { resolveFederal, resolveState } from './tables.js';
import { federalIncomeTax } from './federal.js';
import { stateIncomeTax } from './state.js';
import { payrollTaxes } from './payroll.js';
import { taxHooks } from './hooks.js';

export function computeTaxes(ctx, tables) {
  const F = resolveFederal(tables.federal, ctx.year, ctx.inflation, ctx.status);
  const S = tables.state ? resolveState(tables.state, ctx.year, ctx.inflation, ctx.status) : null;

  const wageTotal = ctx.wages.reduce((a, b) => a + b, 0);
  const income = {
    ordinary: wageTotal - ctx.preTaxDeferrals + ctx.pension + ctx.interest + ctx.traditional + ctx.hsaTaxable,
    socialSecurity: ctx.socialSecurity,
    qualifiedDividends: ctx.dividends,
    capitalGains: ctx.realizedGains,
  };

  const fed = federalIncomeTax(income, ctx.people65, F);
  const fedPenalty = ctx.earlyDistributions * F.earlyPenalty.rate;
  const st = S ? stateIncomeTax(income, ctx.people65, S) : null;
  const statePenalty = S ? ctx.earlyDistributions * S.earlyPenalty.rate : 0;
  const payroll = payrollTaxes(ctx.wages, F, S);

  const hookCtx = { ...ctx, agi: fed.agi, investmentIncome: ctx.interest + ctx.dividends + Math.max(0, ctx.realizedGains), F, S };
  const other = Object.fromEntries(taxHooks.map((h) => [h.id, h.compute(hookCtx)]));
  const otherTotal = Object.values(other).reduce((a, b) => a + b, 0);

  const federal = { income: fed.total, penalty: fedPenalty, total: fed.total + fedPenalty };
  const state = { income: st ? st.total : 0, penalty: statePenalty, total: (st ? st.total : 0) + statePenalty };
  return {
    total: federal.total + state.total + payroll.total + otherTotal,
    federal,
    state,
    payroll,
    other,
    details: {
      status: ctx.status,
      agi: fed.agi,
      taxableSocialSecurity: fed.taxableSS,
      deductions: fed.deductions,
      seniorDeduction: fed.seniorDeduction,
      taxableIncome: fed.taxableIncome,
      federalMarginalRate: fed.marginalRate,
      stateTaxableIncome: st ? st.taxableIncome : 0,
      stateMarginalRate: st ? st.marginalRate : 0,
    },
  };
}
