// Entry point: wiring only. Loading → validation → simulate → render.

import { parsePlanText } from './data/load.js';
import { validatePlan } from './engine/validate.js';
import { createEditor, loadDraft, clearDraft } from './editor/editor.js';
import { serializePlan } from './editor/serialize.js';
import { blankPlan, clone } from './editor/model.js';
import { fetchPlanText, scrub } from './data/github.js';
import { simulate } from './engine/simulate.js';
import { h } from './ui/dom.js';
import { renderSummary } from './ui/summary.js';
import { renderTable } from './ui/table.js';
import { renderChart } from './ui/chart.js';
import { renderAssumptions } from './ui/assumptions.js';

// Refuse to run inside a frame (GitHub Pages can't send frame-ancestors / X-Frame-Options).
if (window.top !== window.self) {
  document.body.replaceChildren(document.createTextNode('This page must be opened directly, not inside another site.'));
  throw new Error('framed');
}

const $ = (id) => document.getElementById(id);
const state = {
  plan: null, result: null, mode: 'real', taxTables: null,
  raw: null, // the loaded file as parsed YAML (what the editor edits)
  source: null, // { kind: 'github'|'demo'|'file'|'new', label, loc?, sha? }
};

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

// Show a validated plan: messages, results, and the source line with its actions.
// Returns true if the projection rendered.
async function showPlan({ errors, warnings, plan }, { label, reload = null, preview = false }) {
  showEditor(false);
  const actions = [];
  if (preview) {
    actions.push(['Back to editing', () => showEditor(true)], ['Save', () => { showEditor(true); $('editor-save')?.click(); }]);
  } else {
    if (reload) actions.push(['Reload', reload]);
    if (state.raw && typeof state.raw === 'object') actions.push(['Edit plan', () => openEditor()]);
  }
  $('source').hidden = false;
  // replaceChildren stringifies null, so only pass real nodes.
  $('source').replaceChildren(preview ? h('strong', {}, label) : `Loaded: ${label}`, ...actions.map(([text, fn]) => {
    const b = h('button', { type: 'button' }, text);
    b.addEventListener('click', fn);
    return b;
  }));
  $('source').classList.toggle('preview', preview);
  $('empty').hidden = true;
  showMessages($('errors'), `The plan ${preview ? 'still' : 'file'} has ${errors.length === 1 ? 'a problem' : `${errors.length} problems`} to fix${state.raw ? ' (use Edit plan)' : ''}`, errors);
  showMessages($('warnings'), errors.length ? 'Also worth checking' : 'Warnings (the projection still ran)', warnings);
  if (errors.length) {
    state.plan = null;
    $('results').hidden = true;
    return false;
  }
  let taxTables;
  try {
    const t = await loadTaxTables(plan.assumptions.state);
    taxTables = t.tables;
    if (t.missingState) showMessages($('warnings'), 'Warnings (the projection still ran)', [...warnings, t.missingState]);
  } catch (e) {
    showMessages($('errors'), "Couldn't load the tax tables", [String(e.message)]);
    $('results').hidden = true;
    return false;
  }
  state.plan = plan;
  state.taxTables = taxTables;
  state.result = simulate(plan, { taxTables });
  $('results').hidden = false;
  renderAssumptions($('assumptions'), plan, taxTables);
  render();
  $('connect-wrap').open = false;
  return true;
}

// Load plan text from a source and show it.
async function loadText(text, source, { reload = null } = {}) {
  const parsed = parsePlanText(text);
  state.raw = parsed.raw && typeof parsed.raw === 'object' ? parsed.raw : null;
  state.source = source;
  return showPlan(parsed, { label: source.label, reload });
}

// --- plan editor --------------------------------------------------------------------------
const editor = createEditor($('editor'), {
  onPreview: (raw) => showPlan(validatePlan(raw), { label: 'Preview including unsaved changes', preview: true }),
  onClose: () => {
    state.raw = clone(editor.raw);
    showPlan(validatePlan(editor.raw), editor.dirty
      ? { label: 'Showing your unsaved changes', preview: true }
      : { label: state.source?.label ?? 'your plan', reload: state.source?.kind === 'github' ? loadFromGitHub : null });
  },
  onSave: savePlan,
  saveLabel: () => 'Download plan.yaml',
});

function showEditor(on) {
  $('editor').hidden = !on;
  $('connect-wrap').hidden = on;
  if (on) for (const id of ['source', 'errors', 'warnings', 'results', 'empty']) $(id).hidden = true;
}

function openEditor({ raw = state.raw, mode = 'browse', step = 0 } = {}) {
  editor.open({ raw: clone(raw), base: clone(raw), source: state.source, mode, step });
  showEditor(true);
  window.scrollTo(0, 0);
}

function startNewPlan() {
  const now = new Date();
  state.source = { kind: 'new', label: 'new plan (not saved yet)' };
  editor.open({ raw: blankPlan({ year: now.getFullYear(), month: now.getMonth() + 1 }), base: {}, source: state.source, mode: 'wizard', fresh: true });
  showEditor(true);
  window.scrollTo(0, 0);
}

// Save = download for now; saving to GitHub comes with a write-enabled token.
async function savePlan(raw) {
  const text = serializePlan(raw);
  const url = URL.createObjectURL(new Blob([text], { type: 'text/yaml' }));
  const a = h('a', { href: url, download: 'plan.yaml' });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return 'Downloaded plan.yaml. Upload it to your plan repository on GitHub to keep it.';
}

// --- GitHub connection ------------------------------------------------------------
// Token: module variable; sessionStorage only if "remember" is ticked. Never
// localStorage, never logged, never in a URL. Location (no token) → localStorage.
const TOKEN_KEY = 'retire.token';
const LOC_KEY = 'retire.location';
const store = (area, fn) => { try { return fn(window[area]); } catch { return null; } };
let token = store('sessionStorage', (s) => s.getItem(TOKEN_KEY)) || '';

function readLocation() {
  return { owner: $('gh-owner').value.trim(), repo: $('gh-repo').value.trim(), path: $('gh-path').value.trim() };
}

function showTokenStatus(msg) {
  $('gh-status').textContent = msg ?? (token ? 'Token remembered for this tab.' : '');
}

async function loadFromGitHub() {
  const typed = $('gh-token').value.trim();
  if (typed) token = typed;
  const loc = readLocation();
  store('localStorage', (s) => s.setItem(LOC_KEY, JSON.stringify(loc)));
  showTokenStatus('Loading…');
  $('gh-load').disabled = true;
  try {
    const text = await fetchPlanText({ ...loc, token });
    // Remember only a token GitHub accepted, and only if asked.
    if ($('gh-remember').checked) store('sessionStorage', (s) => s.setItem(TOKEN_KEY, token));
    else store('sessionStorage', (s) => s.removeItem(TOKEN_KEY));
    await loadText(text, { kind: 'github', label: `${loc.owner}/${loc.repo}/${loc.path} (from GitHub)`, loc }, { reload: loadFromGitHub });
    showTokenStatus();
  } catch (e) {
    showTokenStatus('');
    showMessages($('errors'), "Couldn't load the plan from GitHub", [scrub(e.message, token)]);
  } finally {
    // Cleared only after the request so password managers see a completed sign-in
    // and offer to save the token; it doesn't stay sitting in the field.
    $('gh-token').value = '';
    $('gh-load').disabled = false;
  }
}

$('connect-form').addEventListener('submit', (e) => {
  e.preventDefault();
  loadFromGitHub();
});

$('gh-forget').addEventListener('click', () => {
  token = '';
  $('gh-token').value = '';
  $('gh-remember').checked = false;
  store('sessionStorage', (s) => s.removeItem(TOKEN_KEY));
  showTokenStatus('Token forgotten.');
});

const savedLoc = store('localStorage', (s) => JSON.parse(s.getItem(LOC_KEY) || 'null'));
if (savedLoc) {
  $('gh-owner').value = savedLoc.owner ?? '';
  $('gh-repo').value = savedLoc.repo ?? '';
  $('gh-path').value = savedLoc.path || 'plan.yaml';
}
$('gh-remember').checked = Boolean(token);
showTokenStatus();

async function loadDemo() {
  try {
    const res = await fetch('examples/example.yaml', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await loadText(await res.text(), { kind: 'demo', label: 'demo plan (made-up example data)' });
  } catch (e) {
    showMessages($('errors'), "Couldn't load the demo", [String(e.message)]);
  }
}

$('load-demo').addEventListener('click', loadDemo);

$('load-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (file) await loadText(await file.text(), { kind: 'file', label: `${file.name} (local file, not uploaded anywhere)` });
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

$('new-plan').addEventListener('click', startNewPlan);

// Unsaved edits from earlier in this tab: offer to resume before loading anything.
const draft = loadDraft();
function offerDraft() {
  const resume = h('button', { type: 'button' }, 'Resume editing');
  const discard = h('button', { type: 'button' }, 'Discard them');
  resume.addEventListener('click', () => {
    state.source = draft.source;
    editor.open(draft);
    showEditor(true);
  });
  discard.addEventListener('click', () => {
    clearDraft();
    $('source').hidden = true;
    startup();
  });
  $('source').hidden = false;
  $('source').replaceChildren('You have unsaved plan edits from earlier in this tab. ', resume, discard);
}

function startup() {
  if (new URLSearchParams(location.search).has('demo')) loadDemo();
  else if (token && savedLoc) loadFromGitHub(); // tab reload with a remembered token
}

if (draft?.raw && JSON.stringify(draft.raw) !== JSON.stringify(draft.base)) offerDraft();
else startup();
