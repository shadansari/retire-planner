import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchPlanText, contentsUrl, validateLocation, scrub } from '../js/data/github.js';

const TOKEN = 'github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz0123456789';
const loc = { owner: 'alexsample', repo: 'our-plan', path: 'plan.yaml', token: TOKEN };

function fakeFetch(status, body = '', headers = {}) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (k) => headers[k.toLowerCase()] ?? null },
      text: async () => body,
    };
  };
  return { impl, calls };
}

test('request: contents URL, raw accept header, token only in Authorization', async () => {
  const f = fakeFetch(200, 'schema_version: 1\n', { 'content-type': 'application/vnd.github.raw' });
  const text = await fetchPlanText(loc, f.impl);
  assert.equal(text, 'schema_version: 1\n');
  const { url, init } = f.calls[0];
  assert.equal(url, 'https://api.github.com/repos/alexsample/our-plan/contents/plan.yaml');
  assert.ok(!url.includes(TOKEN));
  assert.equal(init.headers.Accept, 'application/vnd.github.raw');
  assert.equal(init.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(init.credentials, 'omit');
  assert.equal(init.referrerPolicy, 'no-referrer');
  assert.equal(init.cache, 'no-store');
});

test('path segments are encoded; traversal and junk rejected', () => {
  assert.equal(contentsUrl({ owner: 'a', repo: 'b', path: 'my plans/plan #1.yaml' }),
    'https://api.github.com/repos/a/b/contents/my%20plans/plan%20%231.yaml');
  assert.equal(validateLocation({ owner: 'a', repo: 'b', path: '../x' }).length, 1);
  assert.equal(validateLocation({ owner: 'a/b', repo: 'c', path: 'p' }).length, 1);
  assert.equal(validateLocation({ owner: 'a', repo: '..', path: 'p' }).length, 1);
  assert.equal(validateLocation({ owner: 'a', repo: 'b', path: 'dir//p' }).length, 1);
  assert.deepEqual(validateLocation({ owner: 'a-b.c', repo: 'd_e', path: 'x/plan.yaml' }), []);
});

for (const [status, re, headers] of [
  [401, /rejected the token/],
  [403, /permission to read/],
  [403, /rate limit/, { 'x-ratelimit-remaining': '0' }],
  [404, /Not found/],
  [502, /trouble/],
]) {
  test(`HTTP ${status} → friendly message without the token`, async () => {
    const f = fakeFetch(status, `{"message":"Bad credentials ${TOKEN}"}`, headers);
    await assert.rejects(fetchPlanText(loc, f.impl), (e) => {
      assert.match(e.message, re);
      assert.ok(!e.message.includes(TOKEN));
      return true;
    });
  });
}

test('network error text is scrubbed of the token', async () => {
  const impl = async () => { throw new Error(`failed for ${TOKEN}`); };
  await assert.rejects(fetchPlanText(loc, impl), (e) => !e.message.includes(TOKEN) && /\[token\]/.test(e.message));
});

test('a folder path (JSON listing) is reported, not parsed', async () => {
  const f = fakeFetch(200, '[]', { 'content-type': 'application/json; charset=utf-8' });
  await assert.rejects(fetchPlanText(loc, f.impl), /folder, not a file/);
});

test('no request is made without a token or with a bad location', async () => {
  const f = fakeFetch(200);
  await assert.rejects(fetchPlanText({ ...loc, token: ' ' }, f.impl), /Paste your GitHub token/);
  await assert.rejects(fetchPlanText({ ...loc, owner: 'x/y' }, f.impl), /Owner should be/);
  assert.equal(f.calls.length, 0);
});

test('scrub removes any token-shaped strings', () => {
  assert.equal(scrub(`a ${TOKEN} b`), 'a [token] b');
  assert.equal(scrub('x ghp_abcdefghijklmnopqrstuvwxyz0123 y'), 'x [token] y');
});
