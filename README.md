# Package Updates Suggester (OpenVSX / VS Code extension)

Scans `package.json` files in the current workspace and annotates dependencies with update suggestions (based on the npm registry “latest” tag).

## Features

- Inline annotations in `package.json` for `dependencies` and/or `devDependencies`
- Command to scan the workspace
- Command to list outdated dependencies and jump to the entry

## What you’ll see in `package.json`

- **Inline hints** at the end of each dependency line (patch/minor/major availability)
- **Clickable CodeLens actions** above each dependency, for example:
  - **Update patch → `~x.y.z`**
  - **Update minor → `^x.y.z`**
  - **Update major → `^x.y.z`**

The extension no longer uses a “satisfies” label; it always computes **what patch/minor/major updates exist** from published versions.

## Commands

- `Package Updates: Scan workspace` (`packageUpdates.scanWorkspace`)
- `Package Updates: Show update suggestions` (`packageUpdates.showUpdates`)
- `Package Updates: Run checks…` (`packageUpdates.runChecks`)
- `Package Updates: Lockfile OSV vulnerability report…` (`packageUpdates.runLockfileVulnerabilityReport`)

## Diagnostics (Deprecated + OSV Vulnerabilities)

The extension can also run extra checks and report results in the **Problems** panel (so you don’t need to clutter `package.json` with warnings).

Run diagnostics:

1. Open the Command Palette (`Ctrl+Shift+P`).
2. Choose `Package Updates: Run Deprecated + OSV checks…`.
3. Pick one option:
   - `Deprecated packages` (npm deprecated messages)
   - `Vulnerabilities (OSV)` (OSV.dev vulnerability database)
   - `Deprecated + Vulnerabilities` (both)
4. Wait for the scan to finish.

View results:

- Open the **Problems** panel.
- You’ll see entries grouped by the affected `package.json`.
- Clicking a problem will jump to the dependency line in that `package.json`.
- **Jira-ready Markdown:** the command also writes `npm-version-updates-package-json-scan-report.md` at the **first workspace folder root** (deprecated + OSV findings based on what the scan checked).

To refresh:

- Run `Package Updates: Run Deprecated + OSV checks…` again (this clears/overwrites diagnostics from the previous run).

## Lockfile OSV vulnerability report (package-lock.json)

This report is OSV-only and is based on what’s **installed** (from the nearest `package-lock.json` next to each `package.json`).

Run:

1. Open Command Palette (`Ctrl+Shift+P`)
2. Choose `Package Updates: Lockfile OSV vulnerability report…`
3. Review results in the **Problems** panel.
4. **Open the lockfile from Problems:** each issue shows a **code** value (the relative path to `package-lock.json`). Click it to open that lockfile.
5. **Jira-ready Markdown:** the command also writes `npm-version-updates-lockfile-report.md` at the **first workspace folder root** (summary table + bullet details). Use **Open Markdown report** in the notification, or open the file manually and paste into Jira.


## Settings

- `packageUpdates.scanMode` (default: `manual`)
- `packageUpdates.versionSource` (default: `npmCli`)
- `packageUpdates.confirmUpdate` (default: `false`) - when applying updates, ask for confirmation before writing to `package.json`
- `packageUpdates.registryUrl` (default: `https://registry.npmjs.org`)
- `packageUpdates.includeDependencies` (default: `true`)
- `packageUpdates.includeDevDependencies` (default: `true`)
- `packageUpdates.cacheTtlSeconds` (default: `900`)
- `packageUpdates.showInlineHints` (default: `false`)

### Private packages

For private npm packages/registries, keep `packageUpdates.versionSource = npmCli` so the extension uses `npm view` and picks up your existing npm authentication and per-scope registry settings from `.npmrc`.

## Run locally (Extension Development Host)

```bash
npm install
npm run compile
```

Then in Cursor/VS Code:

- Press `F5` (Run → Start Debugging)
- Open a JS/TS project that contains a `package.json`
- Open `package.json` and use the CodeLens buttons:
  - `Check updates (this package.json)`
  - `Check updates (dependencies)`
  - `Check updates (devDependencies)`

## Package / publish

### Create a VSIX

```bash
npm run compile
npx vsce package
```

### Publish to OpenVSX

1. Create an OpenVSX token.
2. Set `publisher` in `package.json` to your OpenVSX namespace.

```bash
npm run compile
npx ovsx publish -p <OPENVSX_TOKEN>
```

