// Primitive value parsers for plan.yaml fields. Each returns { value } on success
// or { error } with a human-readable message fragment (no path / label; the
// validator adds those).

const show = (v) => (typeof v === 'string' ? `"${v}"` : JSON.stringify(v));

// "6%" → 0.06. Bare numbers are rejected so 6 vs 0.06 is never ambiguous.
export function parseRate(v, { min = -100, max = 100 } = {}) {
  if (typeof v === 'number') {
    return { error: `must be a percentage with a % sign, like ${v < 1 && v > -1 ? v * 100 : v}% (got ${v})` };
  }
  if (typeof v !== 'string') return { error: `must be a percentage like 3% (got ${show(v)})` };
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*%\s*$/.exec(v);
  if (!m) return { error: `must be a percentage like 3% (got ${show(v)})` };
  const pct = Number(m[1]);
  if (pct < min || pct > max) return { error: `must be between ${min}% and ${max}% (got ${v})` };
  return { value: pct / 100 };
}

// Dollar amount: number, or "$150,000" / "150,000". Negative never allowed.
export function parseMoney(v) {
  let n = v;
  if (typeof v === 'string') {
    const s = v.trim().replace(/^\$/, '');
    if (!/^\d{1,3}(,\d{3})*(\.\d+)?$|^\d+(\.\d+)?$/.test(s)) {
      return { error: `must be a dollar amount like 150000 (got ${show(v)})` };
    }
    n = Number(s.replace(/,/g, ''));
  }
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    return { error: `must be a dollar amount like 150000 (got ${show(v)})` };
  }
  if (n < 0) return { error: `can't be negative (got ${v})` };
  return { value: n };
}

export function parseInteger(v, { min, max } = {}) {
  if (typeof v !== 'number' || !Number.isInteger(v)) {
    return { error: `must be a whole number (got ${show(v)})` };
  }
  if ((min !== undefined && v < min) || (max !== undefined && v > max)) {
    return { error: `must be between ${min} and ${max} (got ${v})` };
  }
  return { value: v };
}

export function parseYear(v) {
  const r = parseInteger(v, { min: 1900, max: 2200 });
  return r.error ? { error: `must be a year like 2030 (got ${show(v)})` } : r;
}

// "2032-06" → { year: 2032, month: 6 }
export function parseMonth(v) {
  const m = typeof v === 'string' && /^\s*(\d{4})-(\d{1,2})\s*$/.exec(v);
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) {
    return { error: `must be a month written year-month, like 2032-06 (got ${show(v)})` };
  }
  return { value: { year: Number(m[1]), month: Number(m[2]) } };
}

// "1968-04-15" → { year, month, day }
export function parseDate(v) {
  const m = typeof v === 'string' && /^\s*(\d{4})-(\d{2})-(\d{2})\s*$/.exec(v);
  if (m) {
    const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    if (month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth) {
      return { value: { year, month, day } };
    }
  }
  return { error: `must be a date written year-month-day, like 1968-04-15 (got ${show(v)})` };
}

export function parseEnum(v, allowed) {
  if (typeof v === 'string' && allowed.includes(v)) return { value: v };
  return { error: `must be one of: ${allowed.join(', ')} (got ${show(v)})` };
}

// Months as a single integer index for easy comparison: year*12 + (month-1).
export const monthIndex = ({ year, month }) => year * 12 + (month - 1);

// Levenshtein distance, for "did you mean" hints on misspelled keys.
export function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1,
        d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length][b.length];
}

export function closest(word, candidates) {
  let best = null;
  let bestD = Infinity;
  for (const c of candidates) {
    const dist = editDistance(word.toLowerCase(), c);
    if (dist < bestD) [best, bestD] = [c, dist];
  }
  return bestD <= Math.max(2, Math.floor(word.length / 3)) ? best : null;
}
