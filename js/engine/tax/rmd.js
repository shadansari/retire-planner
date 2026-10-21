// Required minimum distributions from traditional accounts (tax/rmd.json).
// RMD for a year = prior Dec 31 balance (= our start-of-year balance) / Uniform
// Lifetime divisor at the owner's age at year end.

export function rmdStartAge(birthYear, R) {
  return R.start_age.find((s) => birthYear < s.born_before).age;
}

export function rmdAmount(balance, owner, year, R) {
  const age = year - owner.birth.year;
  if (balance <= 0 || age < rmdStartAge(owner.birth.year, R)) return 0;
  const divisor = R.uniform_lifetime[String(Math.min(age, 120))];
  return balance / divisor;
}
