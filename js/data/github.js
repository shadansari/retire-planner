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
