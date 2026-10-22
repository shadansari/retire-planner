import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handlePlanRequest, verifyAccessJwt } from '../js/server/plan-proxy.js';

// A throwaway RSA key plays Cloudflare Access's signing key.
const TEAM = 'sampleteam.cloudflareaccess.com';
const AUD = 'aud-tag-123';
const NOW = 2_000_000_000;
const TOKEN = 'github_pat_SERVERSIDE0123456789abcdefghijklmnop';
const { publicKey, privateKey } = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true, ['sign', 'verify']);
const jwk = { ...(await crypto.subtle.exportKey('jwk', publicKey)), kid: 'k1' };

const b64url = (bytes) => Buffer.from(bytes).toString('base64url');
async function sign(payload, header = { alg: 'RS256', kid: 'k1' }, key = privateKey) {
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(input));
  return `${input}.${b64url(new Uint8Array(sig))}`;
}
const goodClaims = { iss: `https://${TEAM}`, aud: [AUD], exp: NOW + 3600, nbf: NOW - 10, email: 'alex@example.com' };

const env = { GITHUB_TOKEN: TOKEN, PLAN_OWNER: 'alexsample', PLAN_REPO: 'our-plan', ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: `other, ${AUD}` };

function fakeFetch({ github = () => new Response('schema_version: 1\n', { status: 200, headers: { 'content-type': 'text/plain' } }) } = {}) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    if (url === `https://${TEAM}/cdn-cgi/access/certs`) return Response.json({ keys: [jwk] });
    if (url.startsWith('https://api.github.com/')) return github(url, init);
    throw new Error(`unexpected fetch ${url}`);
  };
  return { impl, calls };
}
const req = (jwt, init = {}) => new Request('https://retire-planner.pages.dev/api/plan',
  { ...init, headers: jwt ? { 'Cf-Access-Jwt-Assertion': jwt } : {} });

test('valid Access token → plan text from GitHub, with server token and User-Agent', async () => {
  const f = fakeFetch();
  const res = await handlePlanRequest(req(await sign(goodClaims)), env, { fetchImpl: f.impl, nowS: NOW });
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'schema_version: 1\n');
  assert.equal(res.headers.get('x-plan-server'), '1');
  assert.equal(res.headers.get('x-plan-user'), 'alex@example.com');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const gh = f.calls.find((c) => c.url.startsWith('https://api.github.com/'));
  assert.equal(gh.url, 'https://api.github.com/repos/alexsample/our-plan/contents/plan.yaml');
  assert.equal(gh.init.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(gh.init.headers['User-Agent'], 'retire-planner');
  assert.equal(gh.init.credentials, undefined, 'no browser-only init fields in Workers');
});

test('Access token also accepted from the CF_Authorization cookie', async () => {
  const jwt = await sign(goodClaims);
  const r = new Request('https://x.pages.dev/api/plan', { headers: { Cookie: `a=b; CF_Authorization=${jwt}` } });
  assert.equal((await handlePlanRequest(r, env, { fetchImpl: fakeFetch().impl, nowS: NOW })).status, 200);
});

for (const [name, mk] of [
  ['no token', async () => null],
  ['garbage', async () => 'not.a.jwt'],
  ['wrong audience', () => sign({ ...goodClaims, aud: ['someone-else'] })],
  ['wrong issuer', () => sign({ ...goodClaims, iss: 'https://evil.cloudflareaccess.com' })],
  ['expired', () => sign({ ...goodClaims, exp: NOW - 120 })],
  ['not yet valid', () => sign({ ...goodClaims, nbf: NOW + 120 })],
  ['alg none', async () => (await sign(goodClaims, { alg: 'none', kid: 'k1' })).replace(/\.[^.]+$/, '.')],
  ['unknown kid', () => sign(goodClaims, { alg: 'RS256', kid: 'k2' })],
  ['tampered payload', async () => {
    const [h, , s] = (await sign(goodClaims)).split('.');
    return `${h}.${b64url(JSON.stringify({ ...goodClaims, email: 'mallory@example.com' }))}.${s}`;
  }],
]) {
  test(`rejected without touching GitHub: ${name}`, async () => {
    const f = fakeFetch();
    const res = await handlePlanRequest(req(await mk()), env, { fetchImpl: f.impl, nowS: NOW });
    assert.equal(res.status, 403);
    assert.equal(res.headers.get('x-plan-server'), '1');
    assert.ok(!f.calls.some((c) => c.url.startsWith('https://api.github.com/')));
  });
}

test('signature by a different key is rejected', async () => {
  const other = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign']);
  await assert.rejects(verifyAccessJwt(await sign(goodClaims, undefined, other.privateKey),
    { teamDomain: TEAM, auds: [AUD], nowS: NOW, fetchImpl: fakeFetch().impl }), /bad signature/);
});

test('missing configuration fails closed and names only the variables', async () => {
  const res = await handlePlanRequest(req(await sign(goodClaims)), { PLAN_OWNER: 'alexsample' }, { fetchImpl: fakeFetch().impl, nowS: NOW });
  assert.equal(res.status, 500);
  assert.match(await res.text(), /missing GITHUB_TOKEN, PLAN_REPO, ACCESS_TEAM_DOMAIN, ACCESS_AUD/);
});

test('odd ACCESS_TEAM_DOMAIN is refused (no fetching certs from arbitrary hosts)', async () => {
  const res = await handlePlanRequest(req(await sign(goodClaims)), { ...env, ACCESS_TEAM_DOMAIN: 'evil.example.com' }, { fetchImpl: fakeFetch().impl, nowS: NOW });
  assert.equal(res.status, 500);
});

test('GitHub errors come back as 502 with a friendly, token-free message', async () => {
  const f = fakeFetch({ github: () => new Response(`bad credentials ${TOKEN}`, { status: 401 }) });
  const res = await handlePlanRequest(req(await sign(goodClaims)), env, { fetchImpl: f.impl, nowS: NOW });
  assert.equal(res.status, 502);
  const body = await res.text();
  assert.match(body, /GitHub rejected the token/);
  assert.ok(!body.includes(TOKEN));
});

test('non-GET is refused', async () => {
  const res = await handlePlanRequest(req(await sign(goodClaims), { method: 'POST' }), env, { fetchImpl: fakeFetch().impl, nowS: NOW });
  assert.equal(res.status, 405);
});
