// Monthly amortization of a loan over one calendar year.
// Payments stop once the balance hits zero; the final payment is only what's owed.
//
// amortizeYear({ balance, rate, monthlyPayment }) → { payment, interest, principal, balance, paidOffMonth }
// paidOffMonth: 1–12 if the loan was paid off during this year, else null.

export function amortizeYear({ balance, rate, monthlyPayment }) {
  let bal = balance;
  let payment = 0;
  let interest = 0;
  let paidOffMonth = null;
  for (let m = 1; m <= 12 && bal > 0; m++) {
    const i = bal * rate / 12;
    const pay = Math.min(monthlyPayment, bal + i);
    interest += i;
    payment += pay;
    bal = bal + i - pay;
    if (bal < 0.005) {
      bal = 0;
      paidOffMonth = m;
    }
  }
  return { payment, interest, principal: payment - interest, balance: bal, paidOffMonth };
}
