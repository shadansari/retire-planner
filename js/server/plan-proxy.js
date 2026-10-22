// Server side of hosted mode (Cloudflare Pages + Access). Runs in the Workers runtime
// via functions/api/plan.js; plain web APIs only, so node --test can exercise it.
//
// GET /api/plan → the plan text, read from the private repo with a server-held,
// read-only GitHub token (secret GITHUB_TOKEN). Cloudflare Access gates the whole site;
// we verify Access's signed JWT here as well, so a misconfigured or missing Access
// policy fails closed instead of serving the plan to the world.
//
// Environment (Pages project → Settings → Variables and Secrets, Production only):
//   GITHUB_TOKEN        secret; fine-grained, Contents: Read-only on the plan repo
//   PLAN_OWNER, PLAN_REPO, PLAN_PATH (default plan.yaml)
//   ACCESS_TEAM_DOMAIN  e.g. ourteam.cloudflareaccess.com
//   ACCESS_AUD          Access application AUD tag(s), comma-separated
//
// Every response carries X-Plan-Server so the page can tell hosted mode from a static
// host's plain 404. Error bodies are short, token-free, and meant for the owner.

import { fetchPlanText, scrub } from '../data/github.js';

const TEAM_RE = /^[a-z0-9-]+\.cloudflareaccess\.com$/;
const SKEW_S = 60;

const b64urlBytes = (s) => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '='));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};
const b64urlJson = (s) => JSON.parse(new TextDecoder().decode(b64urlBytes(s)));

class AccessError extends Error {}

// → JWT payload, or throws AccessError. RS256 only; key chosen by `kid` from the team's
// certs endpoint (not cached: one extra request per plan load is fine at this scale).
export async function verifyAccessJwt(jwt, { teamDomain, auds, nowS, fetchImpl = globalThis.fetch }) {
  const parts = (jwt ?? '').split('.');
  if (parts.length !== 3) throw new AccessError('missing or malformed Access token');
  let header, payload;
  try { header = b64urlJson(parts[0]); payload = b64urlJson(parts[1]); }
  catch { throw new AccessError('malformed Access token'); }
  if (header.alg !== 'RS256' || !header.kid) throw new AccessError('unexpected token algorithm');

  const res = await fetchImpl(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new AccessError(`couldn't fetch Access certs (HTTP ${res.status})`);
  const jwk = ((await res.json()).keys ?? []).find((k) => k.kid === header.kid);
  if (!jwk) throw new AccessError('unknown signing key');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlBytes(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!ok) throw new AccessError('bad signature');

  if (payload.iss !== `https://${teamDomain}`) throw new AccessError('wrong issuer');
  const tokenAuds = [].concat(payload.aud ?? []);
  if (!tokenAuds.some((a) => auds.includes(a))) throw new AccessError('wrong audience');
  if (typeof payload.exp !== 'number' || payload.exp + SKEW_S < nowS) throw new AccessError('expired');
  if (typeof payload.nbf === 'number' && payload.nbf - SKEW_S > nowS) throw new AccessError('not yet valid');
  return payload;
}

function reply(status, body, extra = {}) {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Plan-Server': '1',
      ...extra,
    },
  });
}

function accessJwtFrom(request) {
  const h = request.headers.get('Cf-Access-Jwt-Assertion');
  if (h) return h;
  const m = /(?:^|;\s*)CF_Authorization=([^;]+)/.exec(request.headers.get('Cookie') ?? '');
  return m ? m[1] : null;
}

export async function handlePlanRequest(request, env, { fetchImpl = globalThis.fetch, nowS = Math.floor(Date.now() / 1000) } = {}) {
  if (request.method !== 'GET') return reply(405, 'Method not allowed.', { Allow: 'GET' });

  const missing = ['GITHUB_TOKEN', 'PLAN_OWNER', 'PLAN_REPO', 'ACCESS_TEAM_DOMAIN', 'ACCESS_AUD'].filter((k) => !env[k]);
  if (missing.length) return reply(500, `Server not configured: missing ${missing.join(', ')} (see docs/cloudflare.md).`);
  if (!TEAM_RE.test(env.ACCESS_TEAM_DOMAIN)) return reply(500, 'Server not configured: ACCESS_TEAM_DOMAIN should look like ourteam.cloudflareaccess.com.');
  const auds = env.ACCESS_AUD.split(',').map((s) => s.trim()).filter(Boolean);

  let identity;
  try {
    identity = await verifyAccessJwt(accessJwtFrom(request), { teamDomain: env.ACCESS_TEAM_DOMAIN, auds, nowS, fetchImpl });
  } catch (e) {
    return reply(403, `Not signed in through Cloudflare Access (${e instanceof AccessError ? e.message : 'verification failed'}). Reload the page to sign in.`);
  }

  const token = env.GITHUB_TOKEN;
  try {
    const text = await fetchPlanText(
      { owner: env.PLAN_OWNER, repo: env.PLAN_REPO, path: env.PLAN_PATH || 'plan.yaml', token },
      fetchImpl, { browser: false });
    return reply(200, text, identity.email ? { 'X-Plan-User': identity.email } : {});
  } catch (e) {
    return reply(502, `Server's GitHub access: ${scrub(e.message, token)}`);
  }
}
