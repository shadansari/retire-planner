// Which section each validation message belongs to (for "2 to fix" badges and the
// review step). Pure.

import { SECTIONS } from './catalog.js';

const under = (path, base) => path === base || path.startsWith(`${base}[`) || path.startsWith(`${base}.`);

// Paths owned by a section: its absolute fields and its lists.
function owns(section, path) {
  return section.blocks.some((b) => (b.kind === 'fields'
    ? b.fields.some((f) => under(path, f.key))
    : under(path, b.path)));
}

// Section-level paths that no field owns ("expenses" missing, "income" not a group…).
const EXTRA = { spending: ['expenses'], other_income: ['income'], strategy: ['assumptions'], start: ['schema_version', 'as_of', '(top level)', ''] };

export function sectionOf(path) {
  for (const s of SECTIONS) if (owns(s, path)) return s.id;
  for (const [id, paths] of Object.entries(EXTRA)) if (paths.includes(path)) return id;
  return 'start';
}

// messages: Map(path → [text]) → Map(sectionId → count)
export function countBySection(messages) {
  const counts = new Map(SECTIONS.map((s) => [s.id, 0]));
  for (const [path, list] of messages) counts.set(sectionOf(path), counts.get(sectionOf(path)) + list.length);
  return counts;
}

// Count for one list item (and anything nested under it).
export function countForItem(messages, listPath, index) {
  const base = `${listPath}[${index}]`;
  let n = 0;
  for (const [path, list] of messages) if (under(path, base)) n += list.length;
  return n;
}

// Messages no rendered field shows (section-level), for one section.
export function looseMessages(messages, sectionId) {
  const s = SECTIONS.find((x) => x.id === sectionId);
  const out = [];
  for (const [path, list] of messages) {
    if (sectionOf(path) !== sectionId) continue;
    const shown = s.blocks.some((b) => (b.kind === 'fields'
      ? b.fields.some((f) => under(path, f.key))
      : path === b.path || path.startsWith(`${b.path}[`)));
    if (!shown) out.push(...list);
  }
  return out;
}
