# Vendored libraries

Files here are copied byte-for-byte from upstream releases. Do not edit them; to
upgrade, replace the files and update this table (version, integrity, sha256).

| File | Library | Version | Source | License |
|---|---|---|---|---|
| js-yaml.mjs (+ .map) | js-yaml | 4.3.2 | npm `js-yaml@4.3.2` → `dist/js-yaml.mjs` | MIT (js-yaml.LICENSE) |

- npm integrity: `sha512-SFNOvSJ+Dgf/9An904Yx+CgSlIPCkIpao4qo51lpee25TIRejdH3rhR4EZMGoNx3/TP3O+wzWuiTFl4sqbltzA==`
- sha256(js-yaml.mjs): `cea276c7e15f409a1adbe5d177aba7824398a474f7cf702bd57962c7d570636f`

Why 4.3.2 and not 5.x: 4.x is the long-stable API, still receiving fixes (4.3.2,
2026-08-26). 5.x had many releases in the last few months (5.5.0 five days old at
vendoring time); not worth the churn for a parser we use in one call.

Usage: always `load(text, { schema: CORE_SCHEMA })` so `1968-04-12` stays a string
(the default schema converts YAML timestamps to Date objects).

Verify: `shasum -a 256 vendor/js-yaml.mjs`
