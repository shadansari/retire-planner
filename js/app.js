// Entry point: wiring only. Loading → validation → simulate → render.

import { parsePlanText } from './data/load.js';
import { simulate } from './engine/simulate.js';
import { h } from './ui/dom.js';
import { renderSummary } from './ui/summary.js';
import { renderTable } from './ui/table.js';
import { renderChart } from './ui/chart.js';
import { renderAssumptions } from './ui/assumptions.js';

const $ = (id) => document.getElementById(id);
const state = { plan: null, result: null, mode: 'real', taxTables: null };

const getJson = async (path) => {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
};

// Federal + RMD tables once; the state table per plan (cached by code).
let baseTables;
const stateTables = {};
async function loadTaxTables(stateCode) {
  baseTables ??= (async () => {
    const index = await getJson('tax/index.json');
    const [federal, rmd] = await Promise.all([getJson(`tax/${index.federal}`), getJson(`tax/${index.rmd}`)]);
    return { index, federal, rmd };
  })();
  const { index, federal, rmd } = await baseTables;
  const file = index.states[stateCode];
  if (file && !stateTables[stateCode]) stateTables[stateCode] = await getJson(`tax/${file}`);
  return {
    tables: { federal, rmd, state: stateTables[stateCode] ?? null },
    missingState: file ? null : `No tax table for state "${stateCode}" yet (available: ${Object.keys(index.states).join(', ')}). The projection includes federal taxes only.`,
  };
}

function showMessages(el, title, items) {
  el.hidden = items.length === 0;
  if (!items.length) return;
  el.replaceChildren(h('h2', {}, title), h('ul', {}, items.map((m) => h('li', {}, m))));
}

function render() {
  const { plan, result, mode } = state;
  if (!plan) return;
  renderSummary($('summary'), plan, result, mode);
  renderChart($('chart'), plan, result, mode);
  renderTable($('table'), $('table-note'), plan, result, mode);
}

async function loadText(text, sourceLabel) {
  const { errors, warnings, plan } = parsePlanText(text);
  $('source').hidden = false;
  $('source').textContent = `Loaded: ${sourceLabel}`;
  $('empty').hidden = true;
  showMessages($('errors'), `The plan file has ${errors.length === 1 ? 'a problem' : `${errors.length} problems`} to fix`, errors);
  showMessages($('warnings'), errors.length ? 'Also worth checking' : 'Warnings (the projection still ran)', warnings);
  if (errors.length) {
    state.plan = null;
    $('results').hidden = true;
    return;
  }
  let taxTables;
  try {
    const t = await loadTaxTables(plan.assumptions.state);
    taxTables = t.tables;
    if (t.missingState) showMessages($('warnings'), 'Warnings (the projection still ran)', [...warnings, t.missingState]);
  } catch (e) {
    showMessages($('errors'), "Couldn't load the tax tables", [String(e.message)]);
    $('results').hidden = true;
    return;
  }
  state.plan = plan;
  state.taxTables = taxTables;
  state.result = simulate(plan, { taxTables });
  $('results').hidden = false;
  renderAssumptions($('assumptions'), plan, taxTables);
  render();
}

async function loadDemo() {
  try {
    const res = await fetch('examples/example.yaml', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await loadText(await res.text(), 'demo plan (made-up example data)');
  } catch (e) {
    showMessages($('errors'), "Couldn't load the demo", [String(e.message)]);
  }
}

$('load-demo').addEventListener('click', loadDemo);

$('load-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (file) await loadText(await file.text(), `${file.name} (local file, not uploaded anywhere)`);
  e.target.value = '';
});

$('dollars').addEventListener('change', (e) => {
  state.mode = e.target.value;
  render();
});

// Re-render the chart at the new width.
let lastWidth = 0;
new ResizeObserver(([entry]) => {
  const w = Math.round(entry.contentRect.width);
  if (state.plan && w !== lastWidth) {
    lastWidth = w;
    renderChart($('chart'), state.plan, state.result, state.mode);
  }
}).observe($('chart'));

if (new URLSearchParams(location.search).has('demo')) loadDemo();
