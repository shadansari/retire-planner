const full = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

// $245,310 ; negatives as −$1,200
export const money = (v) => (Math.round(v) === 0 ? '$0' : full.format(Math.round(v)).replace('-', '−'));

// $2.9M, $245K, $900
export function moneyShort(v) {
  const a = Math.abs(v);
  const sign = v < 0 ? '−' : '';
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e3) return `${sign}$${Math.round(a / 1e3)}K`;
  return `${sign}$${Math.round(a)}`;
}

export const pct = (r) => `${+(r * 100).toFixed(2)}%`;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const monthName = (mi) => `${MONTHS[mi % 12]} ${Math.floor(mi / 12)}`;
export const ym = ({ year, month }) => `${MONTHS[month - 1]} ${year}`;

export const firstName = (name) => name.split(' ')[0];

export const TYPE_LABELS = {
  cash: 'Cash',
  taxable: 'Taxable',
  traditional: 'Traditional (pre-tax)',
  roth: 'Roth',
  hsa: 'HSA',
};
