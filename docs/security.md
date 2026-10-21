# Security notes

## What we protect

The household plan (`plan.yaml`) and the GitHub token that can read it. The page is
public; the plan never is.

## Design

| Concern | Measure |
|---|---|
| Plan in public repo | Plan lives in a separate private repo. `plan.yaml` / `*.private.yaml` are gitignored here; tests assert it. |
| Token scope | Fine-grained PAT, one repository, Contents: Read-only (docs/github-token.md). A leak can read the plan, not change it. |
| Token exposure | Only in the `Authorization` header to `api.github.com`. Never in URLs, never logged (tests ban `console.*`), never in localStorage (test). sessionStorage only if the user opts in **and** GitHub accepted the token. Input field cleared after use. Errors are scrubbed of the token and token-shaped strings. |
| Third-party code | None at runtime. js-yaml vendored byte-identical, sha256 verified by a test. No CDNs, fonts, analytics. |
| Injection / XSS | CSP `default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self' https://api.github.com; base-uri 'none'; form-action 'none'`. No inline script/style. All plan-derived text via `textContent` (tests ban `innerHTML` & co.). Only hardcoded/tax-table URLs become links. |
| Exfiltration | `connect-src` limits fetches to this origin and api.github.com, so even injected script couldn't send data elsewhere via fetch/XHR. |
| Request hygiene | `credentials: 'omit'`, `referrerPolicy: 'no-referrer'`, `cache: 'no-store'`; owner/repo validated, path segments URL-encoded, `..` rejected. |
| Clickjacking | GitHub Pages can't send `frame-ancestors`/`X-Frame-Options`, so the app refuses to run when framed. |
| YAML parsing | js-yaml 4 `CORE_SCHEMA` (no JS types, no timestamps); `__proto__` keys can't pollute prototypes (test). |

## Known limitations (accepted)

- **Shared origin.** GitHub Pages serves all of an account's project sites from
  `<user>.github.io`. Another project site of the *same account*, opened in the same
  tab, could read this tab's sessionStorage. Only opt in to "remember" if you trust all
  sites published from that account (or use a custom domain for this one).
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
