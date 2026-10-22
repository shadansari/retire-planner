# Retirement planner

A static page that reads a household's retirement plan (`plan.yaml`) from a **private**
GitHub repository and projects, year by year, whether savings last through retirement,
including federal, California, and payroll taxes and required minimum distributions.

- **Try it with made-up data:** open the page and click **Load demo** (or add `?demo`).
- **Use it with your own plan:** see [docs/github-token.md](docs/github-token.md).
- **Edit the plan:** see [docs/editing-plan.md](docs/editing-plan.md).

## Privacy model

- This repository contains only code, tax tables, and fake example data. Real plans
  live in a separate private repository and are never committed here.
- The page fetches the plan directly from `api.github.com` in your browser using a
  fine-grained, read-only token scoped to that one repository. There is no server.
- The token is kept in memory (or this tab's sessionStorage if you opt in), never in
  localStorage, URLs, or logs.
- A strict Content-Security-Policy allows scripts and styles only from this site and
  network requests only to this site and `api.github.com`. No third-party code runs:
  the one library (js-yaml) is vendored in `vendor/` with its checksum.

## Development

No build step and no dependencies.

```sh
python3 -m http.server      # then open http://localhost:8000/?demo
npm test                    # node --test (Node ≥ 20)
node tools/check-page.mjs http://localhost:8000/?demo 375 /tmp/phone.png   # overflow + CSP check
```

Project decisions and conventions are in [CLAUDE.md](CLAUDE.md). Tax figures are data in
[`tax/`](tax/), each file citing its IRS/FTB/SSA sources.

Not financial or tax advice. Estimates aim to be within a few percent, not filing-grade.
