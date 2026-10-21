// Account state during a simulation. These helpers mutate the working state object
// that simulate() owns (a private copy built from the plan); nothing outside it.

export function initAccounts(plan) {
  return plan.accounts.map((a) => ({
    id: a.id,
    name: a.name,
    type: a.type,
    owner: a.owner,
    return: a.return,
    dividendYield: a.dividendYield,
    balance: a.balance,
    basis: a.type === 'taxable' ? a.costBasis : 0,
  }));
}

export function deposit(acct, amount) {
  acct.balance += amount;
  if (acct.type === 'taxable') acct.basis += amount;
}

// Take up to `amount`. For taxable accounts the sale realizes gains pro rata to basis
// (average-cost); a basis above balance yields a negative gain (a loss).
// → { taken, gain }
export function withdraw(acct, amount) {
  const taken = Math.min(amount, Math.max(acct.balance, 0));
  if (taken <= 0) return { taken: 0, gain: 0 };
  let gain = 0;
  if (acct.type === 'taxable') {
    const basisOut = acct.basis * (taken / acct.balance);
    gain = taken - basisOut;
    acct.basis -= basisOut;
  }
  acct.balance -= taken;
  if (acct.balance < 0.005) {
    acct.balance = 0;
    if (acct.type === 'taxable') acct.basis = 0;
  }
  return { taken, gain };
}

// Cash dividends for the year, from the start-of-year balance (taxable accounts only).
export const dividendsOf = (acct) => (acct.type === 'taxable' ? acct.balance * acct.dividendYield : 0);

// Year-end growth. Dividends are paid out as cash, so price growth = return − yield.
export function grow(acct) {
  acct.balance *= 1 + acct.return - acct.dividendYield;
}

// Withdraw `need` following `order` (account ids). → { byAccount, gains, remaining }
export function withdrawInOrder(accounts, order, need) {
  const byAccount = {};
  let gains = 0;
  let remaining = need;
  for (const id of order) {
    if (remaining <= 0.005) break;
    const acct = accounts.find((a) => a.id === id);
    const { taken, gain } = withdraw(acct, remaining);
    if (taken > 0) {
      byAccount[id] = taken;
      gains += gain;
      remaining -= taken;
    }
  }
  return { byAccount, gains, remaining: remaining > 0.005 ? remaining : 0 };
}
