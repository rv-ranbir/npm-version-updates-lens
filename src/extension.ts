import * as vscode from 'vscode';
import { createDecorations, applyUpdatesDecorations, clearEditorDecorations, DecorationBundle } from './decorations';
import { findAllPackageJsonFiles, extractDependenciesFromPackageJsonText } from './packageJsonScanner';
import { NpmRegistryClient } from './npmRegistry';
import { computeUpdate } from './updateLogic';
import { DepSection, PackageUpdateInfo } from './types';
import { PackageUpdatesCodeLensProvider } from './codeLens';
import { parseDependencyValueLocations } from './packageJsonRanges';
import { WorkspaceUpdatesTreeProvider } from './workspaceTree';

type WorkspaceUpdates = Map<string, PackageUpdateInfo[]>;

function getIncludedSections(): DepSection[] {
  const cfg = vscode.workspace.getConfiguration('packageUpdates');
  const includeDeps = Boolean(cfg.get('includeDependencies') ?? true);
  const includeDevDeps = Boolean(cfg.get('includeDevDependencies') ?? true);
  const sections: DepSection[] = [];
  if (includeDeps) sections.push('dependencies');
  if (includeDevDeps) sections.push('devDependencies');
  return sections;
}

function shouldShowInlineHints(): boolean {
  const cfg = vscode.workspace.getConfiguration('packageUpdates');
  return Boolean(cfg.get('showInlineHints') ?? false);
}

function scanMode(): 'manual' | 'automatic' {
  const cfg = vscode.workspace.getConfiguration('packageUpdates');
  const mode = String(cfg.get('scanMode') ?? 'manual');
  return mode === 'automatic' ? 'automatic' : 'manual';
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;

  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (true) {
      const cur = idx++;
      if (cur >= items.length) return;
      results[cur] = await fn(items[cur]);
    }
  });

  await Promise.all(workers);
  return results;
}

async function computeUpdatesForPackageJson(
  uri: vscode.Uri,
  registry: NpmRegistryClient,
  includeSections: DepSection[]
): Promise<PackageUpdateInfo[] | null> {
  const doc = await vscode.workspace.openTextDocument(uri);
  const parsed = extractDependenciesFromPackageJsonText(uri, doc.getText(), includeSections);
  if (!parsed) return null;

  const deps = parsed.dependencies;
  const controller = new AbortController();

  const infos = await mapLimit(deps, 12, async (dep) => {
    const packument = await registry.getPackument(dep.name, controller.signal);
    return computeUpdate(dep, packument);
  });

  return infos;
}

function applyDecorationsForVisibleEditors(deco: DecorationBundle, updatesByFile: WorkspaceUpdates) {
  if (!shouldShowInlineHints()) return;
  for (const editor of vscode.window.visibleTextEditors) {
    const doc = editor.document;
    if (doc.languageId !== 'json' || !doc.fileName.endsWith('package.json')) continue;
    const key = doc.uri.toString();
    const updates = updatesByFile.get(key);
    if (!updates) {
      clearEditorDecorations(editor, deco);
      continue;
    }
    applyUpdatesDecorations(editor, deco, updates);
  }
}

export function activate(context: vscode.ExtensionContext) {
  const deco = createDecorations();
  const updatesByFile: WorkspaceUpdates = new Map();

  let registry = new NpmRegistryClient();
  const codeLensProvider = new PackageUpdatesCodeLensProvider((uri) => updatesByFile.get(uri.toString()));
  const treeProvider = new WorkspaceUpdatesTreeProvider(() => updatesByFile);

  const scanUris = async (uris: vscode.Uri[], sections: DepSection[]) => {
    if (sections.length === 0) {
      vscode.window.showInformationMessage('Package Updates: nothing to scan (all sections disabled).');
      return;
    }
    if (uris.length === 0) {
      vscode.window.showInformationMessage('Package Updates: no package.json files found.');
      return;
    }

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Package Updates: scanning…', cancellable: true },
      async (progress, token) => {
        let done = 0;

        const results = await mapLimit(uris, 4, async (uri) => {
          if (token.isCancellationRequested) return { uri, updates: null as PackageUpdateInfo[] | null };
          const updates = await computeUpdatesForPackageJson(uri, registry, sections);
          done++;
          progress.report({ message: `${done}/${uris.length} package.json`, increment: (1 / uris.length) * 100 });
          return { uri, updates };
        });

        for (const r of results) {
          const key = r.uri.toString();
          const existing = updatesByFile.get(key) ?? [];
          const incoming = r.updates ?? [];

          if (incoming.length === 0 && existing.length === 0) {
            updatesByFile.delete(key);
            continue;
          }

          // Merge by (section + name) so scanning one section does not
          // remove updates for the other section for the same file.
          const mergedMap = new Map<string, PackageUpdateInfo>();
          for (const u of existing) {
            mergedMap.set(`${u.section}:${u.name}`, u);
          }
          for (const u of incoming) {
            mergedMap.set(`${u.section}:${u.name}`, u);
          }

          const merged = Array.from(mergedMap.values());
          if (merged.length > 0) updatesByFile.set(key, merged);
          else updatesByFile.delete(key);
        }
      }
    );

    applyDecorationsForVisibleEditors(deco, updatesByFile);
    codeLensProvider.refresh();
    treeProvider.refresh();
    vscode.window.showInformationMessage('Package Updates: scan complete.');
  };

  const scanWorkspace = async () => {
    const sections = getIncludedSections();
    const uris = await findAllPackageJsonFiles();
    await scanUris(uris, sections);
  };

  const scanFile = async (uri?: vscode.Uri) => {
    const target = uri ?? vscode.window.activeTextEditor?.document.uri;
    if (!target) return;
    await scanUris([target], getIncludedSections());
  };

  const scanSection = async (uri: vscode.Uri, section: DepSection) => {
    await scanUris([uri], [section]);
  };

  const updateAllInFile = async (uri: vscode.Uri, kind: 'patch' | 'minor' | 'major') => {
    const updates = updatesByFile.get(uri.toString());
    if (!updates) return;
    const targetUpdates = updates.filter((u) => u.status === 'outdated' && u.available[kind]);
    if (!targetUpdates.length) return;

    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(doc, { preview: false });
    const locs = parseDependencyValueLocations(doc);

    await editor.edit((eb) => {
      for (const u of targetUpdates) {
        const loc = locs.find((l) => l.section === u.section && l.name === u.name);
        if (!loc) continue;
        const oldQuoted = doc.getText(loc.valueRange);
        const oldVal = oldQuoted.replace(/^"/, '').replace(/"$/, '');
        const targetVersion = u.available[kind]!;
        const prefix = oldVal.startsWith('~') ? '~' : oldVal.startsWith('^') ? '^' : kind === 'patch' ? '~' : '^';
        const newVal = `${prefix}${targetVersion}`;
        const newQuoted = `"${newVal}"`;
        eb.replace(loc.valueRange, newQuoted);
      }
    });

    await doc.save();
  };

  const updateAllInSection = async (uri: vscode.Uri, section: DepSection, kind: 'patch' | 'minor') => {
    const updates = updatesByFile.get(uri.toString());
    if (!updates) return;
    const targetUpdates = updates.filter((u) => u.section === section && u.status === 'outdated' && u.available[kind]);
    if (!targetUpdates.length) return;

    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(doc, { preview: false });
    const locs = parseDependencyValueLocations(doc);

    await editor.edit((eb) => {
      for (const u of targetUpdates) {
        const loc = locs.find((l) => l.section === u.section && l.name === u.name);
        if (!loc) continue;
        const oldQuoted = doc.getText(loc.valueRange);
        const oldVal = oldQuoted.replace(/^"/, '').replace(/"$/, '');
        const targetVersion = u.available[kind]!;

        const prefix = oldVal.startsWith('~') ? '~' : oldVal.startsWith('^') ? '^' : kind === 'patch' ? '~' : '^';
        const newVal = `${prefix}${targetVersion}`;
        const newQuoted = `"${newVal}"`;
        eb.replace(loc.valueRange, newQuoted);
      }
    });

    await doc.save();
  };

  const showUpdates = async () => {
    if (updatesByFile.size === 0) {
      await scanWorkspace();
    }

    const items: Array<
      vscode.QuickPickItem & { uri: vscode.Uri; depName: string; section: string; status: string; latest: string | null }
    > = [];

    for (const [uriStr, updates] of updatesByFile.entries()) {
      const uri = vscode.Uri.parse(uriStr);
      const fileLabel = vscode.workspace.asRelativePath(uri);

      for (const u of updates) {
        if (u.status === 'upToDate') continue;
        const latest = u.latest ?? null;
        const bump =
          (u.available.patch && `~${u.available.patch}`) ||
          (u.available.minor && `^${u.available.minor}`) ||
          (u.available.major && `^${u.available.major}`) ||
          (latest ? `^${latest}` : '?');
        items.push({
          uri,
          depName: u.name,
          section: u.section,
          status: u.status,
          latest,
          label: `${u.name}`,
          description: `${u.range} → ${bump}`,
          detail: `${fileLabel} • ${u.section} • latest ${latest ?? 'unknown'}`
        });
      }
    }

    if (items.length === 0) {
      vscode.window.showInformationMessage('Package Updates: no outdated dependencies found.');
      return;
    }

    items.sort((a, b) => a.label.localeCompare(b.label));
    const picked = await vscode.window.showQuickPick(items, {
      title: 'Package Updates: outdated dependencies',
      matchOnDescription: true,
      matchOnDetail: true
    });
    if (!picked) return;

    const doc = await vscode.workspace.openTextDocument(picked.uri);
    const editor = await vscode.window.showTextDocument(doc, { preview: true });

    const text = doc.getText();
    const idx = text.indexOf(`"${picked.depName}"`);
    if (idx >= 0) {
      const pos = doc.positionAt(idx);
      editor.selection = new vscode.Selection(pos, pos);
      editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
    }
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('packageUpdates.scanWorkspace', scanWorkspace),
    vscode.commands.registerCommand('packageUpdates.scanFile', scanFile),
    vscode.commands.registerCommand('packageUpdates.scanSection', scanSection),
    vscode.commands.registerCommand('packageUpdates.showUpdates', showUpdates),
    vscode.commands.registerCommand(
      'packageUpdates.applyUpdate',
      async (uri: vscode.Uri, section: DepSection, depName: string, kind: string, targetVersion: string) => {
        const doc = await vscode.workspace.openTextDocument(uri);
        const editor = await vscode.window.showTextDocument(doc, { preview: false });

        const locs = parseDependencyValueLocations(doc);
        const loc = locs.find((l) => l.section === section && l.name === depName);
        if (!loc) return;

        const oldQuoted = doc.getText(loc.valueRange); // includes quotes
        const oldVal = oldQuoted.replace(/^"/, '').replace(/"$/, '');

        const prefix =
          oldVal.startsWith('~') ? '~' : oldVal.startsWith('^') ? '^' : kind === 'patch' ? '~' : '^';
        const newVal = `${prefix}${targetVersion}`;
        const newQuoted = `"${newVal}"`;

        await editor.edit((eb) => eb.replace(loc.valueRange, newQuoted));
        await doc.save();

        // Refresh UI: re-scan just the impacted section so CodeLens/tree update immediately.
        await scanUris([uri], [section]);
      }
    ),
    vscode.commands.registerCommand('packageUpdates.updateAllInFile', async (uri: vscode.Uri, kind: 'patch' | 'minor' | 'major') => {
      await updateAllInFile(uri, kind);
      await scanUris([uri], getIncludedSections());
    }),
    vscode.commands.registerCommand('packageUpdates.updateAllInSection', async (uri: vscode.Uri, section: DepSection, kind: 'patch' | 'minor') => {
      await updateAllInSection(uri, section, kind);
      await scanUris([uri], [section]);
    }),
    vscode.commands.registerCommand('packageUpdates.revealDependency', async (uri: vscode.Uri, depName: string) => {
      const doc = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(doc, { preview: true });
      const text = doc.getText();
      const idx = text.indexOf(`"${depName}"`);
      if (idx >= 0) {
        const pos = doc.positionAt(idx);
        editor.selection = new vscode.Selection(pos, pos);
        editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
      }
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('packageUpdates')) {
        registry = new NpmRegistryClient();
        codeLensProvider.refresh();
        treeProvider.refresh();
      }
    }),
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (doc.fileName.endsWith('package.json')) {
        if (scanMode() === 'automatic') {
          void scanFile(doc.uri);
        }
      }
    })
  );

  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      [{ language: 'json', pattern: '**/package.json' }],
      codeLensProvider
    ),
    vscode.window.registerTreeDataProvider('packageUpdates.workspaceView', treeProvider)
  );

  if (scanMode() === 'automatic') {
    void scanWorkspace();
  } else {
    codeLensProvider.refresh();
    treeProvider.refresh();
  }
}

export function deactivate() {}

