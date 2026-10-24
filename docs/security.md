# Security notes

## What we protect

The household plan (`plan.yaml`) and the GitHub token that can read it. The page is
public; the plan never is.

## Design

| Concern | Measure |
|---|---|
| Plan in public repo | Plan lives in a separate private repo. `plan.yaml` / `*.private.yaml` are gitignored here; tests assert it. |
| Token scope | Fine-grained PAT, one repository, Contents: Read and write (to save from the editor) or Read-only (docs/github-token.md). A leak can read the plan and, with write, commit to that one repo; every save is a commit, so changes are visible and revertible. GitHub Free can't protect a private repo's history from a force-push via the API, so keep an occasional local `git clone` backup. |
| Token exposure | Only in the `Authorization` header to `api.github.com`. Never in URLs, never logged (tests ban `console.*`), never in localStorage (test). sessionStorage only if the user opts in **and** GitHub accepted the token. Input field cleared after use. Errors are scrubbed of the token and token-shaped strings. |
| Third-party code | None at runtime. js-yaml vendored byte-identical, sha256 verified by a test. No CDNs, fonts, analytics. |
| Injection / XSS | CSP `default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self' https://api.github.com; base-uri 'none'; form-action 'none'`. No inline script/style. All plan-derived text via `textContent` (tests ban `innerHTML` & co.). Only hardcoded/tax-table URLs become links. |
| Exfiltration | `connect-src` limits fetches to this origin and api.github.com, so even injected script couldn't send data elsewhere via fetch/XHR. |
| Request hygiene | `credentials: 'omit'`, `referrerPolicy: 'no-referrer'`, `cache: 'no-store'`; owner/repo validated, path segments URL-encoded, `..` rejected. |
| Clickjacking | GitHub Pages can't send `frame-ancestors`/`X-Frame-Options`, so the app refuses to run when framed. |
| Saving | `PUT /contents` with the blob sha of the version loaded (computed locally as git does), so a save never overwrites a newer version (409/422 → refused, offer download). The editor's unsaved draft is in sessionStorage (this tab), never localStorage (test). |
| YAML parsing | js-yaml 4 `CORE_SCHEMA` (no JS types, no timestamps); `__proto__` keys can't pollute prototypes (test). |

## Known limitations (accepted)

- **Origin.** The site is served from its own custom domain, `plan.takarola.com`
  (`CNAME` file; domain verified for the GitHub account so the name can't be claimed
  by another Pages site; HTTPS enforced). The `shadansari.github.io/retire-planner/`
  URL redirects there. This keeps it off the shared `<user>.github.io` origin, where
  any other site of the account could read its storage, frame it same-origin, or
  register a service worker over it. Keep the DNS record `plan` → `shadansari.github.io`
  **DNS only** (not proxied) in Cloudflare.
- **The page itself is the trust anchor.** Anyone who can push to this public repo can
  change the code that receives the token. Protect the account with 2FA. `main` is
  protected (applies to admins too): no force-pushes, no deletion, linear history; direct
  pushes are still allowed (no required reviews: single maintainer).
- Meta-tag CSP can't set `frame-ancestors` or `report-uri`; HTTP headers aren't
  configurable on GitHub Pages.
- A displayed plan stays on screen after **Forget token** until the tab is closed or
  reloaded.

## Checklist before each deploy

- `npm test` green (includes the security tests above).
- `node tools/check-page.mjs <url> 375 out.png` shows no console/CSP messages.
- `git ls-files` contains no real plan data.
