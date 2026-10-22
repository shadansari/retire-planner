import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { parsePlanText } from '../js/data/load.js';

const root = new URL('..', import.meta.url).pathname;
const read = (p) => readFileSync(join(root, p), 'utf8');

test('vendored js-yaml matches the checksum recorded in vendor/README.md', () => {
  const recorded = /sha256\(js-yaml\.mjs\): `([0-9a-f]{64})`/.exec(read('vendor/README.md'))[1];
  const actual = createHash('sha256').update(readFileSync(join(root, 'vendor/js-yaml.mjs'))).digest('hex');
  assert.equal(actual, recorded);
});

test('index.html carries the strict CSP and no-referrer', () => {
  const html = read('index.html');
  assert.ok(html.includes(`content="default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' https://api.github.com; base-uri 'none'; form-action 'none'"`));
  assert.ok(html.includes('<meta name="referrer" content="no-referrer">'));
  assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/.test(html), 'no inline <script>');
  assert.ok(!/<style/.test(html) && !/\sstyle=/.test(html), 'no inline styles');
});

const jsFiles = (dir) => readdirSync(join(root, dir)).flatMap((f) => {
  const p = join(dir, f);
  return statSync(join(root, p)).isDirectory() ? jsFiles(p) : p.endsWith('.js') ? [p] : [];
});

test('app code has no HTML-injection sinks, eval, or logging', () => {
  for (const f of jsFiles('js')) {
    const src = read(f);
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function|console\./.test(src), f);
  }
});

test('the token is never written to localStorage', () => {
  const src = read('js/app.js');
  for (const m of src.matchAll(/store\('localStorage'[^;]*;/g)) assert.ok(!/TOKEN_KEY|token\b/.test(m[0]), m[0]);
});

test('real plan files are gitignored', () => {
  const gi = read('.gitignore');
  assert.match(gi, /^plan\.yaml$/m);
  assert.match(gi, /^\*\.private\.yaml$/m);
});

test('YAML __proto__ keys do not pollute prototypes', () => {
  parsePlanText('__proto__:\n  polluted: yes\nschema_version: 1\n');
  assert.equal(({}).polluted, undefined);
});

test('_headers (Cloudflare) carries the same CSP as index.html plus frame-ancestors', () => {
  const meta = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(read('index.html'))[1];
  const hdr = /Content-Security-Policy: (.+)/.exec(read('_headers'))[1].trim();
  assert.equal(hdr, `${meta}; frame-ancestors 'none'`);
});

test('server code has no secrets or logging', () => {
  for (const f of [...jsFiles('functions'), ...jsFiles('js/server')]) {
    const src = read(f);
    assert.ok(!/console\.|github_pat_[A-Za-z0-9]|gh[pousr]_[A-Za-z0-9]{20}/.test(src), f);
  }
});
