// Stacked area of year-end balances by account type, hand-rolled SVG.
// Colors come from CSS classes (.fill-<type>, .key-<type>) so light/dark themes and the
// CSP (no inline styles) both work. Crosshair + tooltip on hover/focus; arrow keys step years.

import { h, s } from './dom.js';
import { money, moneyShort, TYPE_LABELS, firstName } from './format.js';
import { ACCOUNT_TYPES } from '../engine/validate.js';

const M = { top: 12, right: 12, bottom: 28, left: 52 };

// Clean tick step (1/2/2.5/5 × 10^k) giving at most ~4 intervals.
function niceScale(v) {
  if (v <= 0) return { max: 1, step: 1 };
  const raw = v / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].find((f) => f * mag >= raw) * mag;
  return { max: Math.ceil(v / step) * step, step };
}

export function renderChart(el, plan, result, mode) {
  const { years } = result;
  const types = ACCOUNT_TYPES.filter((t) => plan.accounts.some((a) => a.type === t));
  const width = Math.max(300, el.clientWidth || 600);
  const height = width < 500 ? 240 : 320;
  const iw = width - M.left - M.right;
  const ih = height - M.top - M.bottom;

  const y0 = years[0].year;
  const y1 = years.at(-1).year;
  const xOf = (yr) => M.left + ((yr - y0) / Math.max(1, y1 - y0)) * iw;
  const { max: yMax, step: yStep } = niceScale(Math.max(...years.map((y) => y[mode].balances.total)));
  const yOf = (v) => M.top + ih - (v / yMax) * ih;

  // Stack, bottom → top in fixed type order.
  const stacks = years.map((y) => {
    let acc = 0;
    return Object.fromEntries(types.map((t) => {
      const lo = acc;
      acc += y[mode].balances.byType[t];
      return [t, [lo, acc]];
    }));
  });

  const svg = s('svg', { viewBox: `0 0 ${width} ${height}`, width, height, role: 'img',
    'aria-label': `Stacked area chart of savings by account type, ${y0} to ${y1}. Same data as the year-by-year table.` });

  // Grid + y ticks
  const grid = s('g', { class: 'grid' });
  for (let v = 0; v <= yMax + yStep / 2; v += yStep) {
    const y = yOf(v);
    grid.append(s('line', { x1: M.left, x2: width - M.right, y1: y, y2: y, class: v === 0 ? 'baseline' : 'gridline' }));
    grid.append(s('text', { x: M.left - 6, y: y + 4, class: 'tick', 'text-anchor': 'end' }, moneyShort(v)));
  }
  const xStep = iw / (y1 - y0) < 14 ? 10 : 5;
  for (let yr = Math.ceil(y0 / xStep) * xStep; yr <= y1; yr += xStep) {
    grid.append(s('text', { x: xOf(yr), y: height - 8, class: 'tick', 'text-anchor': 'middle' }, yr));
  }
  svg.append(grid);

  // Areas, then a 2px surface-colored line on each layer's top edge as the gap.
  for (const t of types) {
    const top = years.map((y, i) => `${xOf(y.year)},${yOf(stacks[i][t][1])}`);
    const bottom = years.map((y, i) => `${xOf(y.year)},${yOf(stacks[i][t][0])}`).reverse();
    svg.append(s('polygon', { points: [...top, ...bottom].join(' '), class: `area fill-${t}` }));
  }
  for (const t of types.slice(0, -1)) {
    const top = years.map((y, i) => `${xOf(y.year)},${yOf(stacks[i][t][1])}`);
    svg.append(s('polyline', { points: top.join(' '), class: 'gap' }));
  }

  // Markers: last retirement year; first shortfall year.
  const markers = [];
  const retireYear = Math.max(...plan.people.map((p) => p.retire.year));
  if (retireYear > y0 && retireYear <= y1) markers.push([retireYear, 'Both retired', 'marker']);
  if (result.summary.firstShortfall) markers.push([result.summary.firstShortfall.year, 'Savings run out', 'marker critical']);
  for (const [yr, label, cls] of markers) {
    const x = xOf(yr);
    svg.append(s('line', { x1: x, x2: x, y1: M.top, y2: M.top + ih, class: cls }));
    const anchor = x > width - 110 ? 'end' : 'start';
    svg.append(s('text', { x: x + (anchor === 'start' ? 4 : -4), y: M.top + 10, class: 'marker-label', 'text-anchor': anchor }, label));
  }

  // Crosshair + hit layer
  const cross = s('line', { y1: M.top, y2: M.top + ih, class: 'crosshair', visibility: 'hidden' });
  const hit = s('rect', { x: M.left, y: M.top, width: iw, height: ih, class: 'hit', tabindex: 0,
    'aria-label': 'Chart: use left and right arrow keys to read each year' });
  svg.append(cross, hit);

  const legend = h('div', { class: 'legend' },
    types.map((t) => h('span', { class: 'legend-item' }, h('span', { class: `swatch key-${t}` }), TYPE_LABELS[t])));
  const tip = h('div', { class: 'tooltip', hidden: true, role: 'status' });
  const frame = h('div', { class: 'chart-frame' }, svg, tip);

  let idx = null;
  const show = (i) => {
    idx = Math.max(0, Math.min(years.length - 1, i));
    const y = years[idx];
    const x = xOf(y.year);
    cross.setAttribute('x1', x);
    cross.setAttribute('x2', x);
    cross.setAttribute('visibility', 'visible');
    const ages = plan.people.filter((p) => y.ages[p.id] != null).map((p) => `${firstName(p.name)} ${y.ages[p.id]}`).join(', ');
    tip.replaceChildren(
      h('div', { class: 'tip-head' }, `${y.year}`, h('span', { class: 'tip-ages' }, ages)),
      ...[...types].reverse().map((t) => h('div', { class: 'tip-row' },
        h('span', { class: `tip-key key-${t}` }),
        h('strong', {}, money(y[mode].balances.byType[t])),
        h('span', { class: 'tip-name' }, TYPE_LABELS[t]))),
      h('div', { class: 'tip-row tip-total' }, h('span', { class: 'tip-key' }),
        h('strong', {}, money(y[mode].balances.total)), h('span', { class: 'tip-name' }, 'Total')));
    tip.hidden = false;
    // Position beside the crosshair, flipping left near the right edge.
    const tw = tip.offsetWidth;
    const left = x + 12 + tw > width ? x - 12 - tw : x + 12;
    tip.style.transform = `translate(${Math.max(0, left)}px, ${M.top}px)`;
  };
  const hide = () => {
    cross.setAttribute('visibility', 'hidden');
    tip.hidden = true;
  };
  const idxAt = (clientX) => {
    const r = svg.getBoundingClientRect();
    const px = ((clientX - r.left) / r.width) * width;
    return Math.round(((px - M.left) / iw) * (y1 - y0));
  };
  hit.addEventListener('pointermove', (e) => show(idxAt(e.clientX)));
  hit.addEventListener('pointerdown', (e) => show(idxAt(e.clientX)));
  hit.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hide(); });
  hit.addEventListener('focus', () => show(idx ?? 0));
  hit.addEventListener('blur', hide);
  hit.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') show((idx ?? -1) + 1);
    else if (e.key === 'ArrowLeft') show((idx ?? 1) - 1);
    else if (e.key === 'Escape') hide();
    else return;
    e.preventDefault();
  });

  el.replaceChildren(legend, frame);
}
