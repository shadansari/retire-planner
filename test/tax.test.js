import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveFederal, resolveState } from '../js/engine/tax/tables.js';
import { bracketTax, taxableSocialSecurity, federalIncomeTax } from '../js/engine/tax/federal.js';
import { stateIncomeTax } from '../js/engine/tax/state.js';
import { payrollTaxes } from '../js/engine/tax/payroll.js';
import { rmdStartAge, rmdAmount } from '../js/engine/tax/rmd.js';
import { computeTaxes } from '../js/engine/tax/index.js';

const json = (p) => JSON.parse(readFileSync(new URL(`../tax/${p}`, import.meta.url), 'utf8'));
const FED = json('federal-2026.json');
const CA = json('states/ca-2025.json');
const RMD = json('rmd.json');

const close = (a, e, tol = 0.01) => assert.ok(Math.abs(a - e) <= tol, `expected ${e}, got ${a}`);
const F26 = (status) => resolveFederal(FED, 2026, 0.03, status); // table year: no indexing
const CA25 = (status) => resolveState(CA, 2025, 0.03, status);
const inc = (o) => ({ ordinary: 0, socialSecurity: 0, qualifiedDividends: 0, capitalGains: 0, ...o });

test('every tax table cites sources', () => {
  for (const t of [FED, CA, RMD]) {
    assert.ok(t.sources.length > 0);
    for (const s of t.sources) assert.match(s.url, /^https:\/\//);
  }
});

test('bracket tax matches Rev. Proc. 2025-32 "plus" amounts at each threshold', () => {
  // Table 1 (MFJ): tax at the start of each bracket
  const mfj = F26('married_joint').brackets;
  for (const [ti, expected] of [[24800, 2480], [100800, 11600], [211400, 35932], [403550, 82048], [512450, 116896], [768700, 206583.5]]) {
    close(bracketTax(mfj, ti), expected);
  }
  // Table 3 (single)
  const single = F26('single').brackets;
  for (const [ti, expected] of [[12400, 1240], [50400, 5800], [105700, 17966], [201775, 41024], [256225, 58448], [640600, 192979.25]]) {
    close(bracketTax(single, ti), expected);
  }
});

test('CA 2025 bracket tax matches FTB schedule "plus" amounts', () => {
  const y = CA25('married_joint').brackets;
  for (const [ti, expected] of [[22158, 221.58], [52528, 828.98], [82904, 2044.02], [115084, 3974.82], [145448, 6403.94], [742958, 61972.37], [1485906, 144439.65]]) {
    close(bracketTax(y, ti), expected, 0.05);
  }
  const x = CA25('single').brackets;
  for (const [ti, expected] of [[11079, 110.79], [41452, 1022.01], [72724, 3201.97], [742953, 72219.84]]) {
    close(bracketTax(x, ti), expected, 0.05);
  }
});

test('worked example: MFJ, two $100k salaries, 2026', () => {
  const F = F26('married_joint');
  const r = federalIncomeTax(inc({ ordinary: 200000 }), 0, F);
  // TI = 200,000 − 32,200 = 167,800 → 11,600 + 22% × 67,000
  close(r.taxableIncome, 167800);
  close(r.total, 11600 + 0.22 * 67000);
  const p = payrollTaxes([100000, 100000], F, null);
  close(p.socialSecurity, 12400);
  close(p.medicare, 2900);
  assert.equal(p.additionalMedicare, 0);
});

test('worked example: single retiree 70, $30k SS + $40k IRA, 2026 (Pub. 915 + senior deduction)', () => {
  const F = F26('single');
  // provisional = 40,000 + 15,000 = 55,000; taxable SS = min(25,500, 0.85×21,000 + min(15,000, 4,500)) = 22,350
  close(taxableSocialSecurity(30000, 40000, F.ssTaxation), 22350);
  const r = federalIncomeTax(inc({ ordinary: 40000, socialSecurity: 30000 }), 1, F);
  close(r.agi, 62350);
  // deductions: 16,100 + 2,050 (65+) + 6,000 senior (AGI under 75k) = 24,150
  close(r.deductions, 24150);
  close(r.taxableIncome, 38200);
  close(r.total, 1240 + 0.12 * (38200 - 12400));
});

test('social security taxable portion tiers', () => {
  const t = { base: 32000, adjustedBase: 44000 };
  assert.equal(taxableSocialSecurity(30000, 10000, t), 0); // provisional 25k
  close(taxableSocialSecurity(30000, 24000, t), 3500); // provisional 39k → (39k − 32k) / 2
  close(taxableSocialSecurity(40000, 200000, t), 34000); // capped at 85%
});

test('senior deduction phases out per person and ends after 2028', () => {
  const F = F26('married_joint');
  // AGI 200k: each $6,000 − 6% × 50,000 = 3,000 → 6,000 for two
  const r = federalIncomeTax(inc({ ordinary: 200000 }), 2, F);
  close(r.seniorDeduction, 6000);
  // fully gone at 250k for each person
  assert.equal(federalIncomeTax(inc({ ordinary: 260000 }), 2, F).seniorDeduction, 0);
  assert.equal(resolveFederal(FED, 2029, 0.03, 'single').seniorDeduction, null);
  assert.ok(resolveFederal(FED, 2028, 0.03, 'single').seniorDeduction);
});

test('LTCG and qualified dividends stack on ordinary income', () => {
  const F = F26('married_joint');
  // ordinary taxable 80,000 after deduction; 50,000 preferential: 18,900 at 0%, 31,100 at 15%
  const r = federalIncomeTax(inc({ ordinary: 80000 + 32200, qualifiedDividends: 20000, capitalGains: 30000 }), 0, F);
  close(r.taxableIncome, 130000);
  close(r.capitalGainsTax, 31100 * 0.15);
  close(r.ordinaryTax, 2480 + 0.12 * (80000 - 24800));
});

test('capital losses offset at most $3,000 of ordinary income', () => {
  const F = F26('single');
  const r = federalIncomeTax(inc({ ordinary: 60000, capitalGains: -10000 }), 0, F);
  close(r.agi, 57000);
  assert.equal(r.capitalGainsTax, 0);
});

test('indexing: indexed thresholds inflate, statutory ones do not', () => {
  const F = resolveFederal(FED, 2028, 0.03, 'married_joint');
  close(F.standardDeduction, 32200 * 1.03 ** 2);
  close(F.brackets[1][0], 24800 * 1.03 ** 2);
  assert.equal(F.brackets[1][1], 0.12);
  assert.equal(F.ssTaxation.base, 32000);
  assert.equal(F.payroll.addlMedicareThreshold, 250000);
  close(F.payroll.ssWageBase, 184500 * 1.03 ** 2);
  const S = resolveState(CA, 2027, 0.03, 'single');
  close(S.standardDeduction, 5706 * 1.03 ** 2);
  assert.equal(S.surtax.over, 1000000);
});

test('CA: Social Security exempt, gains as ordinary, exemption credits, worked example', () => {
  const S = CA25('married_joint');
  const r = stateIncomeTax(inc({ ordinary: 90000, socialSecurity: 40000, qualifiedDividends: 5000, capitalGains: 16412 }), 2, S);
  // agi = 111,412 (no SS); TI = 100,000 → 2,044.02 + 6% × 17,096 = 3,069.78; credits 306 + 2×153
  close(r.taxableIncome, 100000);
  close(r.bracketTax, 3069.78, 0.05);
  close(r.total, 3069.78 - 612, 0.05);
});

test('CA surtax over $1M taxable income', () => {
  const S = CA25('single');
  const r = stateIncomeTax(inc({ ordinary: 1205706 }), 0, S);
  close(r.surtax, 2000);
});

test('payroll: SS wage base per person, additional Medicare on combined wages, CA SDI', () => {
  const F = F26('married_joint');
  const S = CA25('married_joint');
  const p = payrollTaxes([250000, 50000], F, S);
  close(p.socialSecurity, (184500 + 50000) * 0.062);
  close(p.additionalMedicare, 50000 * 0.009);
  close(p.stateDisability, 300000 * 0.013);
});

test('RMD start age by birth year and Uniform Lifetime divisor', () => {
  assert.equal(rmdStartAge(1955, RMD), 73);
  assert.equal(rmdStartAge(1959, RMD), 73);
  assert.equal(rmdStartAge(1960, RMD), 75);
  const owner = { birth: { year: 1960 } };
  assert.equal(rmdAmount(1e6, owner, 2034, RMD), 0); // age 74
  close(rmdAmount(1e6, owner, 2035, RMD), 1e6 / 24.6); // age 75
  close(rmdAmount(1e6, owner, 2090, RMD), 1e6 / 2.0); // 130 → 120+ row
});

test('computeTaxes: totals add up; early-withdrawal penalties federal 10% + CA 2.5%', () => {
  const t = computeTaxes({
    year: 2026, inflation: 0.03, status: 'single', people65: 0,
    wages: [0], preTaxDeferrals: 0, pension: 0, socialSecurity: 0, interest: 0, dividends: 0,
    realizedGains: 0, traditional: 50000, hsaTaxable: 0, earlyDistributions: 50000,
  }, { federal: FED, state: CA });
  close(t.federal.penalty, 5000);
  close(t.state.penalty, 1250);
  close(t.total, t.federal.total + t.state.total + t.payroll.total);
  assert.deepEqual(t.other, { niit: 0, irmaa: 0 });
});

test('tax/index.json manifest points at existing, well-formed tables', () => {
  const idx = json('index.json');
  assert.equal(json(idx.federal).jurisdiction, 'federal');
  assert.ok(json(idx.rmd).uniform_lifetime);
  for (const [code, file] of Object.entries(idx.states)) assert.equal(json(file).jurisdiction, code);
});
