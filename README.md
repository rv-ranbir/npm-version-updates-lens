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

## Settings

- `packageUpdates.scanMode` (default: `manual`)
- `packageUpdates.versionSource` (default: `npmCli`)
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

