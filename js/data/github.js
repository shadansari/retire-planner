// Fetch plan.yaml from a (private) GitHub repo with a fine-grained PAT.
//   GET https://api.github.com/repos/{owner}/{repo}/contents/{path}
//   Accept: application/vnd.github.raw
//
// Token rules (CLAUDE.md): only ever in the Authorization header. Never in a URL,
// never logged, never stored here, and scrubbed from any error text we produce.
// `fetchImpl` is injectable for tests.

const NAME_RE = /^[A-Za-z0-9._-]{1,100}$/;

export function validateLocation({ owner, repo, path }) {
  const errors = [];
  if (!NAME_RE.test(owner ?? '')) errors.push('Owner should be a GitHub user or organization name, like "alexsample".');
  if (!NAME_RE.test(repo ?? '') || repo === '.' || repo === '..') errors.push('Repository should be a repository name, like "our-plan".');
  const segs = (path ?? '').split('/');
  if (!path || segs.some((s) => !s || s === '.' || s === '..')) errors.push('File path should be like "plan.yaml" or "folder/plan.yaml".');
  return errors;
}

export function contentsUrl({ owner, repo, path }) {
  const p = path.split('/').map(encodeURIComponent).join('/');
  return `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${p}`;
}

// Remove any occurrence of the token (and anything token-shaped) from text.
export function scrub(text, token) {
  let s = String(text);
  if (token) s = s.split(token).join('[token]');
  return s.replace(/\b(github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,})\b/g, '[token]');
}

class GitHubError extends Error {}

function friendlyStatus(status, rateRemaining) {
  if (status === 401) return 'GitHub rejected the token. It may be mistyped, expired, or revoked — create a new one (see the setup guide).';
  if (status === 403 && rateRemaining === '0') return 'GitHub rate limit reached. Wait a few minutes and try again.';
  if (status === 403) return "The token doesn't have permission to read this repository. It needs read-only access to Contents on this repository.";
  if (status === 404) return 'Not found. Check the owner, repository and file path — and that the token was given access to this repository (GitHub reports "not found" for repos a token can\'t see).';
  if (status >= 500) return 'GitHub is having trouble right now. Try again in a minute.';
  return `GitHub returned an unexpected response (HTTP ${status}).`;
}

// → plan text. Throws Error with a friendly, token-free message.
export async function fetchPlanText({ owner, repo, path, token }, fetchImpl = globalThis.fetch) {
  const bad = validateLocation({ owner, repo, path });
  if (bad.length) throw new GitHubError(bad.join(' '));
  if (!token || !token.trim()) throw new GitHubError('Paste your GitHub token first.');
  let res;
  try {
    res = await fetchImpl(contentsUrl({ owner, repo, path }), {
      method: 'GET',
      headers: {
        Accept: 'application/vnd.github.raw',
        Authorization: `Bearer ${token.trim()}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
  } catch (e) {
    throw new GitHubError(scrub(`Couldn't reach GitHub (${e.message}). Check your internet connection.`, token));
  }
  if (!res.ok) throw new GitHubError(friendlyStatus(res.status, res.headers.get('x-ratelimit-remaining')));
  const type = res.headers.get('content-type') ?? '';
  if (type.includes('application/json')) {
    // A directory listing (or other JSON) instead of the raw file.
    throw new GitHubError('That path is a folder, not a file. Give the path to plan.yaml.');
  }
  return res.text();
}

// --- saving (needs a token with Contents: Read and write) -------------------------------

// Git's blob id for this text: sha1("blob <bytes>\0<bytes>"). GitHub requires the id of
// the version being replaced, which doubles as a "changed since you loaded it" check.
export async function gitBlobSha(text) {
  const body = new TextEncoder().encode(text);
  const head = new TextEncoder().encode(`blob ${body.length}\0`);
  const all = new Uint8Array(head.length + body.length);
  all.set(head);
  all.set(body, head.length);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', all));
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function base64Utf8(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

const jsonHeaders = (token) => ({
  Accept: 'application/vnd.github+json',
  Authorization: `Bearer ${token.trim()}`,
  'X-GitHub-Api-Version': '2022-11-28',
});
const browserInit = { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' };

// Current blob id of the file, or null if it doesn't exist yet.
export async function fetchFileSha({ owner, repo, path, token }, fetchImpl = globalThis.fetch) {
  const bad = validateLocation({ owner, repo, path });
  if (bad.length) throw new GitHubError(bad.join(' '));
  let res;
  try {
    res = await fetchImpl(contentsUrl({ owner, repo, path }), { method: 'GET', headers: jsonHeaders(token), ...browserInit });
  } catch (e) {
    throw new GitHubError(scrub(`Couldn't reach GitHub (${e.message}). Check your internet connection.`, token));
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new GitHubError(friendlyStatus(res.status, res.headers.get('x-ratelimit-remaining')));
  const body = await res.json();
  if (Array.isArray(body)) throw new GitHubError('That path is a folder, not a file. Give the path to plan.yaml.');
  return body.sha;
}

// Commit `text` as the new file contents. `sha`: blob id of the version being replaced
// (null to create). → the new blob id. Throws a friendly, token-free Error.
export async function savePlanText({ owner, repo, path, token, text, sha, message }, fetchImpl = globalThis.fetch) {
  const bad = validateLocation({ owner, repo, path });
  if (bad.length) throw new GitHubError(bad.join(' '));
  if (!token || !token.trim()) throw new GitHubError('Paste your GitHub token first (under "Load our plan from GitHub").');
  let res;
  try {
    res = await fetchImpl(contentsUrl({ owner, repo, path }), {
      method: 'PUT',
      headers: { ...jsonHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, content: base64Utf8(text), ...(sha ? { sha } : {}) }),
      ...browserInit,
    });
  } catch (e) {
    throw new GitHubError(scrub(`Couldn't reach GitHub (${e.message}). Nothing was saved; check your connection and try again.`, token));
  }
  if (res.status === 409 || (res.status === 422 && sha)) {
    throw new GitHubError('The plan on GitHub was changed after you loaded it (perhaps edited from another device or by someone else), so it was not overwritten.');
  }
  if (res.status === 403 && res.headers.get('x-ratelimit-remaining') !== '0') {
    throw new GitHubError('This token can only read the plan. To save from the page, the token needs "Contents: Read and write" on this repository (see the setup guide).');
  }
  if (!res.ok) throw new GitHubError(friendlyStatus(res.status, res.headers.get('x-ratelimit-remaining')));
  const body = await res.json();
  return body?.content?.sha ?? null;
}
