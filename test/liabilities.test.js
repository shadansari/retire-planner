import { test } from 'node:test';
import assert from 'node:assert/strict';
import { amortizeYear } from '../js/engine/liabilities.js';

const close = (a, e, tol = 0.01) => assert.ok(Math.abs(a - e) <= tol, `expected ${e}, got ${a}`);

// Closed-form balance after n payments: P(1+r)^n − pmt((1+r)^n − 1)/r
const balanceAfter = (P, r, pmt, n) => P * (1 + r) ** n - pmt * ((1 + r) ** n - 1) / r;

test('one year matches the closed-form schedule', () => {
  const loan = { balance: 100000, rate: 0.06, monthlyPayment: 599.55 }; // 30y fixed
  const y = amortizeYear(loan);
  close(y.balance, balanceAfter(100000, 0.005, 599.55, 12));
  close(y.payment, 599.55 * 12);
  close(y.principal, 100000 - y.balance);
  assert.equal(y.paidOffMonth, null);
});

test('chained years: 30-year mortgage pays off in year 30', () => {
  let loan = { balance: 100000, rate: 0.06, monthlyPayment: 599.56 };
  let year = 0;
  let r;
  do {
    r = amortizeYear(loan);
    loan = { ...loan, balance: r.balance };
    year++;
  } while (r.paidOffMonth === null && year < 40);
  assert.equal(year, 30);
  assert.equal(r.paidOffMonth, 12);
});

test('payoff mid-year: last payment is only what is owed', () => {
  const y = amortizeYear({ balance: 1000, rate: 0.12, monthlyPayment: 300 });
  // months: 1000→710→417.10→121.27→0 (pays 122.48)
  assert.equal(y.paidOffMonth, 4);
  assert.equal(y.balance, 0);
  close(y.payment, 300 * 3 + 121.2710 * 1.01, 0.01);
});

test('zero-rate loan and zero balance', () => {
  assert.equal(amortizeYear({ balance: 1200, rate: 0, monthlyPayment: 100 }).balance, 0);
  assert.deepEqual(amortizeYear({ balance: 0, rate: 0.05, monthlyPayment: 100 }),
    { payment: 0, interest: 0, principal: 0, balance: 0, paidOffMonth: null });
});
