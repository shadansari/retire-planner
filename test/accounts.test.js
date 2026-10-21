import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deposit, withdraw, grow, dividendsOf, withdrawInOrder } from '../js/engine/accounts.js';

const taxable = () => ({ id: 'b', type: 'taxable', balance: 100000, basis: 60000, return: 0.06, dividendYield: 0.02 });
const cash = () => ({ id: 'c', type: 'cash', balance: 10000, basis: 0, return: 0.03, dividendYield: 0 });

test('taxable withdrawal realizes gain pro rata to basis', () => {
  const a = taxable();
  const r = withdraw(a, 25000);
  assert.deepEqual(r, { taken: 25000, gain: 10000 }); // 40% gain fraction
  assert.equal(a.balance, 75000);
  assert.equal(a.basis, 45000);
});

test('taxable withdrawal at a loss gives negative gain', () => {
  const a = { ...taxable(), basis: 120000 };
  assert.equal(withdraw(a, 50000).gain, -10000);
});

test('withdraw caps at balance and zeroes basis', () => {
  const a = taxable();
  assert.deepEqual(withdraw(a, 1e9), { taken: 100000, gain: 40000 });
  assert.equal(a.balance, 0);
  assert.equal(a.basis, 0);
  assert.deepEqual(withdraw(a, 10), { taken: 0, gain: 0 });
});

test('deposit adds basis only for taxable', () => {
  const a = taxable();
  deposit(a, 5000);
  assert.equal(a.basis, 65000);
  const c = cash();
  deposit(c, 5000);
  assert.equal(c.basis, 0);
});

test('dividends paid out; growth excludes the dividend', () => {
  const a = taxable();
  assert.equal(dividendsOf(a), 2000);
  grow(a);
  assert.ok(Math.abs(a.balance - 104000) < 1e-9);
  assert.equal(dividendsOf(cash()), 0);
});

test('withdrawInOrder follows order and reports shortfall', () => {
  const accts = [taxable(), cash()];
  const r = withdrawInOrder(accts, ['c', 'b'], 30000);
  assert.deepEqual(r.byAccount, { c: 10000, b: 20000 });
  assert.equal(r.gains, 8000);
  assert.equal(r.remaining, 0);
  const r2 = withdrawInOrder(accts, ['c', 'b'], 100000);
  assert.deepEqual(r2.byAccount, { b: 80000 });
  assert.equal(r2.remaining, 20000);
});
