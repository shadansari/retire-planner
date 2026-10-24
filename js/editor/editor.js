// Plan editor controller: toolbar, guided setup vs browse & edit, re-rendering, and the
// per-tab draft. The page (app.js) supplies preview/save/close callbacks.
//
// Draft: the plan being edited is kept in sessionStorage (this tab only, gone when the
// tab closes), never localStorage, so a reload doesn't lose work.

import { h } from '../ui/dom.js';
import { validatePlan } from '../engine/validate.js';
import { messagesByPath, changeSummary, clone } from './model.js';
import { renderWizard } from './wizard.js';
import { renderBrowse } from './browse.js';
import { SECTIONS } from './catalog.js';
import { sectionOf } from './status.js';

const DRAFT_KEY = 'retire.draft';
const store = (fn) => { try { return fn(window.sessionStorage); } catch { return null; } };

export function loadDraft() {
  return store((s) => JSON.parse(s.getItem(DRAFT_KEY) || 'null'));
}
export function clearDraft() {
  store((s) => s.removeItem(DRAFT_KEY));
}

// hooks: { onPreview(raw), onSave(raw, changes) → Promise<string|void>, onClose(), saveLabel() }
export function createEditor(root, hooks) {
  const st = {
    raw: null, base: null, source: null, mode: 'wizard', step: 0,
    sel: { section: null, path: null, index: null },
    messages: { errors: new Map(), warnings: new Map() },
    status: '',
    // A brand-new plan starts out "fresh": problems show only for fields the user has
    // touched and steps already passed, so step 1 isn't a wall of red.
    fresh: false, touched: new Set(), furthest: 0,
  };

  const stepOf = (path) => SECTIONS.findIndex((x) => x.id === sectionOf(path));
  function visible(map) {
    if (!st.fresh) return map;
    return new Map([...map].filter(([path]) => st.touched.has(path) || stepOf(path) < st.furthest));
  }

  // --- re-render without eating clicks ------------------------------------------------------
  // A text field's 'change' fires on blur, i.e. on mousedown of whatever was clicked next;
  // re-rendering then would replace that button before its click. So wait for pointerup.
  let pointerDown = false;
  let pending = false;
  document.addEventListener('pointerdown', () => { pointerDown = true; }, true);
  document.addEventListener('pointerup', () => { pointerDown = false; if (pending) setTimeout(flush, 0); }, true);
  document.addEventListener('pointercancel', () => { pointerDown = false; }, true);

  function requestRender() {
    pending = true;
    if (!pointerDown) setTimeout(flush, 0);
  }
  function flush() {
    if (!pending) return;
    pending = false;
    render();
  }

  let draftTimer;
  function saveDraft() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => store((s) => s.setItem(DRAFT_KEY, JSON.stringify({
      raw: st.raw, base: st.base, source: st.source, mode: st.mode, step: st.step,
      fresh: st.fresh, furthest: st.furthest, touched: [...st.touched],
    }))), 300);
  }

  function revalidate() {
    const { errors, warnings } = validatePlan(st.raw);
    st.messages = { errors: messagesByPath(errors), warnings: messagesByPath(warnings) };
    st.errorCount = errors.length;
  }

  const ctx = {
    get raw() { return st.raw; },
    get messages() { return { errors: visible(st.messages.errors), warnings: visible(st.messages.warnings) }; },
    touch(path) { st.touched.add(path); },
    changed(structural) {
      revalidate();
      st.status = '';
      saveDraft();
      if (structural) requestRender();
      else updateBar();
    },
    confirm: (text) => window.confirm(text),
  };

  const nav = {
    get step() { return st.step; },
    goStep(i) { st.furthest = Math.max(st.furthest, st.step, i > st.step ? i : 0); st.step = i; saveDraft(); render(); scrollTop(); },
    get sel() { return st.sel; },
    select(sel) { st.sel = { section: null, path: null, index: null, ...sel }; render(); scrollTop(); },
    preview: () => hooks.onPreview(st.raw),
    save: () => doSave(),
    get errorCount() { return st.errorCount; },
    browse(sel) { st.mode = 'browse'; nav.select(sel ?? {}); },
  };

  function scrollTop() {
    root.scrollIntoView({ block: 'start' });
  }

  async function doSave() {
    const changes = changeSummary(st.base, st.raw);
    st.status = 'Saving…';
    updateBar();
    try {
      const msg = await hooks.onSave(st.raw, changes);
      st.base = clone(st.raw);
      st.fresh = false;
      st.status = msg || 'Saved.';
      saveDraft();
    } catch (e) {
      st.status = e.message === 'Not saved.' ? '' : `Not saved: ${e.message}`;
    }
    render();
  }

  // --- toolbar --------------------------------------------------------------------------------
  let bar;
  function toolbar() {
    const modeBtn = (mode, label) => {
      const b = h('button', { type: 'button', class: st.mode === mode ? 'tab active' : 'tab', 'aria-pressed': String(st.mode === mode) }, label);
      b.addEventListener('click', () => { st.mode = mode; saveDraft(); render(); });
      return b;
    };
    const preview = h('button', { type: 'button' }, 'Preview');
    preview.addEventListener('click', () => hooks.onPreview(st.raw));
    const save = h('button', { type: 'button', class: 'primary', id: 'editor-save' }, hooks.saveLabel());
    save.addEventListener('click', doSave);
    const close = h('button', { type: 'button' }, 'Close');
    close.addEventListener('click', () => {
      const n = changeSummary(st.base, st.raw).length;
      if (n && !window.confirm(`You have ${n} unsaved change${n === 1 ? '' : 's'}. Close the editor anyway? (They stay in this tab until you discard them or close it.)`)) return;
      hooks.onClose();
    });
    bar = h('div', { class: 'editor-bar' },
      h('div', { class: 'tabs', role: 'group', 'aria-label': 'Editor view' }, modeBtn('wizard', 'Guided setup'), modeBtn('browse', 'Browse & edit')),
      h('span', { class: 'editor-status', role: 'status' }),
      h('div', { class: 'editor-actions' }, preview, save, close));
    updateBar();
    return bar;
  }

  function updateBar() {
    if (!bar) return;
    const n = changeSummary(st.base, st.raw).length;
    const status = bar.querySelector('.editor-status');
    status.textContent = st.status || (st.fresh ? 'New plan, not saved yet'
      : n ? `${n} unsaved change${n === 1 ? '' : 's'}` : 'No unsaved changes');
    status.classList.toggle('dirty', Boolean(n) && !st.status);
    bar.querySelector('#editor-save').disabled = !n;
  }

  function discardButton() {
    const n = changeSummary(st.base, st.raw).length;
    if (!n || st.fresh) return null;
    const b = h('button', { type: 'button', class: 'link danger' }, 'Discard all unsaved changes');
    b.addEventListener('click', () => {
      if (!window.confirm('Discard all unsaved changes and go back to the last saved plan?')) return;
      st.raw = clone(st.base);
      revalidate();
      saveDraft();
      render();
    });
    return h('p', { class: 'discard' }, b);
  }

  // --- render ---------------------------------------------------------------------------------
  function render() {
    pending = false;
    const active = document.activeElement;
    const focusKey = active && root.contains(active) ? (active.id ? `#${CSS.escape(active.id)}` : active.getAttribute('aria-label') ? `[aria-label="${CSS.escape(active.getAttribute('aria-label'))}"]` : null) : null;
    const body = st.mode === 'wizard' ? renderWizard(ctx, nav) : renderBrowse(ctx, nav, st.base);
    root.replaceChildren(toolbar(), body, ...[discardButton()].filter(Boolean));
    if (focusKey) root.querySelector(focusKey)?.focus({ preventScroll: true });
  }

  return {
    // source: { kind: 'github'|'demo'|'file'|'new', label, ... } (owned by app.js)
    open({ raw, base, source, mode = 'browse', step = 0, fresh = false, furthest = 0, touched = [] }) {
      st.fresh = fresh;
      st.furthest = furthest;
      st.touched = new Set(touched);
      st.raw = raw;
      st.base = base ?? clone(raw);
      st.source = source;
      st.mode = mode;
      st.step = step;
      st.sel = { section: null, path: null, index: null };
      st.status = '';
      revalidate();
      saveDraft();
      render();
    },
    get raw() { return st.raw; },
    get source() { return st.source; },
    get dirty() { return changeSummary(st.base, st.raw).length > 0; },
    render,
  };
}
