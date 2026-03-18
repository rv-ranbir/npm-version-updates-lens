# Changelog

## 0.0.1

- Initial release: scan workspace, inline annotations, quick-pick list of outdated dependencies.

## 0.0.3

- Improve npm version fetching for public/private registries (fallback when `npm view` returns no data).
- Add an Output channel (`npm Version Updates Lens`) for easier debugging.

## 0.0.4

- Fix runtime error: include `semver` dependency in the packaged extension (was missing due to `.vscodeignore` excluding `node_modules`).
