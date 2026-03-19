# Changelog

## 1.0.0

- Release tooling: add Jira-ready Markdown reports for both the `package.json` scan and the lockfile OSV scan.
- UX: lockfile OSV findings now include a clickable `package-lock.json` link from the VS Code Problems panel.
- OSV output: per-vulnerability links now use the OSV list-page structure (`q=`) and include `https://osv.dev/vulnerability/<ID>` references.

## 0.0.1

- Initial release: scan workspace, inline annotations, quick-pick list of outdated dependencies.

## 0.0.3

- Improve npm version fetching for public/private registries (fallback when `npm view` returns no data).
- Add an Output channel (`npm Version Updates Lens`) for easier debugging.

## 0.0.4

- Fix runtime error: include `semver` dependency in the packaged extension (was missing due to `.vscodeignore` excluding `node_modules`).

## 0.0.5

- Diagnostics: combine Deprecated + OSV findings into a single Problems entry per dependency.
- Harder parsing for `npm view ... deprecated` output (handles mixed output/warnings).

## 0.0.6

- Diagnostics: avoid stale cached results by only checking dependencies that still exist in the current `package.json`.
- Deprecated lookup: fallback to registry packument when `npm view deprecated` fails (e.g. `spawn EINVAL`), with caching to reduce repeat requests.
