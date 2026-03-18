import * as vscode from 'vscode';
import { parseDependencyValueLocations } from './packageJsonRanges';
import { PackageUpdateInfo } from './types';

export class PackageUpdatesCodeLensProvider implements vscode.CodeLensProvider {
  private readonly onDidChangeCodeLensesEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses: vscode.Event<void> = this.onDidChangeCodeLensesEmitter.event;

  constructor(private getUpdatesForUri: (uri: vscode.Uri) => PackageUpdateInfo[] | undefined) {}

  refresh() {
    this.onDidChangeCodeLensesEmitter.fire();
  }

  private findSectionHeaderLine(document: vscode.TextDocument, section: 'dependencies' | 'devDependencies'): number | null {
    const re = new RegExp(`"\\s*${section}\\s*"\\s*:\\s*\\{`);
    for (let i = 0; i < document.lineCount; i++) {
      if (re.test(document.lineAt(i).text)) return i;
    }
    return null;
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (!document.fileName.endsWith('package.json')) return [];

    const lenses: vscode.CodeLens[] = [];

    // Always show "scan" lenses (manual buttons).
    const topRange = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0));
    lenses.push(
      new vscode.CodeLens(topRange, {
        title: 'Check updates (this package.json)',
        command: 'packageUpdates.scanFile',
        arguments: [document.uri]
      })
    );

    const updates = this.getUpdatesForUri(document.uri);

    // If we haven't scanned this package.json yet, only show scan buttons.
    if (!updates || updates.length === 0) {
      for (const section of ['dependencies', 'devDependencies'] as const) {
        const line = this.findSectionHeaderLine(document, section);
        if (line === null) continue;
        const r = new vscode.Range(new vscode.Position(line, 0), new vscode.Position(line, 0));
        lenses.push(
          new vscode.CodeLens(r, {
            title: `Check updates (${section})`,
            command: 'packageUpdates.scanSection',
            arguments: [document.uri, section]
          })
        );
      }
      return lenses;
    }

    for (const section of ['dependencies', 'devDependencies'] as const) {
      const line = this.findSectionHeaderLine(document, section);
      if (line === null) continue;
      const r = new vscode.Range(new vscode.Position(line, 0), new vscode.Position(line, 0));

      const sectionHasScannedData = updates.some((u) => u.section === section);
      if (!sectionHasScannedData) {
        // User hasn't scanned this section yet (e.g. scanned dependencies first).
        lenses.push(
          new vscode.CodeLens(r, {
            title: `Check updates (${section})`,
            command: 'packageUpdates.scanSection',
            arguments: [document.uri, section]
          })
        );
        continue;
      }

      const anyPatch = updates.some((u) => u.section === section && u.status === 'outdated' && u.available.patch);
      const anyMinor = updates.some((u) => u.section === section && u.status === 'outdated' && u.available.minor);

      // Always offer a refresh action at the section header.
      lenses.push(
        new vscode.CodeLens(r, {
          title: `↻ Refresh`,
          command: 'packageUpdates.scanSection',
          arguments: [document.uri, section]
        })
      );

      // Prefer showing update actions when something is actually outdated.
      if (anyPatch) {
        lenses.push(
          new vscode.CodeLens(r, {
            title: `Update all patch versions`,
            command: 'packageUpdates.updateAllInSection',
            arguments: [document.uri, section, 'patch']
          })
        );
      }

      if (anyMinor) {
        lenses.push(
          new vscode.CodeLens(r, {
            title: `Update all minor versions`,
            command: 'packageUpdates.updateAllInSection',
            arguments: [document.uri, section, 'minor']
          })
        );
      }
    }

    // Per-file bulk actions.
    const anyPatch = updates.some((u) => u.available.patch);
    const anyMinor = updates.some((u) => u.available.minor);
    const anyMajor = updates.some((u) => u.available.major);

    const bulkPos = new vscode.Position(0, 0);
    const bulkRange = new vscode.Range(bulkPos, bulkPos);
    if (anyPatch) {
      lenses.push(
        new vscode.CodeLens(bulkRange, {
          title: 'Update all patch versions',
          command: 'packageUpdates.updateAllInFile',
          arguments: [document.uri, 'patch']
        })
      );
    }
    if (anyMinor) {
      lenses.push(
        new vscode.CodeLens(bulkRange, {
          title: 'Update all minor versions',
          command: 'packageUpdates.updateAllInFile',
          arguments: [document.uri, 'minor']
        })
      );
    }
    if (anyMajor) {
      lenses.push(
        new vscode.CodeLens(bulkRange, {
          title: '⚠ Update all major versions',
          command: 'packageUpdates.updateAllInFile',
          arguments: [document.uri, 'major']
        })
      );
    }

    const locations = parseDependencyValueLocations(document);
    const locMap = new Map<string, vscode.Range>();
    for (const loc of locations) {
      locMap.set(`${loc.section}:${loc.name}`, loc.valueRange);
    }

    for (const u of updates) {
      // Only show update actions for deps that are actually outdated.
      // If you're already at latest (stable), keep the UI clean.
      if (u.status !== 'outdated') continue;

      const valueRange = locMap.get(`${u.section}:${u.name}`);
      if (!valueRange) continue;

      // Place the CodeLens on the dependency line.
      const lensRange = new vscode.Range(valueRange.start, valueRange.start);

      const actions: Array<{ title: string; target: string; kind: 'patch' | 'minor' | 'major' | 'latest' }> = [];

      if (u.available.patch) actions.push({ title: `Update patch → ~${u.available.patch}`, target: u.available.patch, kind: 'patch' });
      if (u.available.minor) actions.push({ title: `Update minor → ^${u.available.minor}`, target: u.available.minor, kind: 'minor' });
      if (u.available.major) {
        const majorLabel = u.hasMajorBreakingChange ? '⚠ Update major' : 'Update major';
        actions.push({ title: `${majorLabel} → ^${u.available.major}`, target: u.available.major, kind: 'major' });
      }
      if (!u.available.major && !u.available.minor && !u.available.patch && u.latest) {
        actions.push({ title: `Update → ^${u.latest}`, target: u.latest, kind: 'latest' });
      }

      // Remove duplicates if multiple actions point to the same version.
      const seenTargets = new Set<string>();
      const uniqueActions = actions.filter((a) => {
        if (seenTargets.has(a.target)) return false;
        seenTargets.add(a.target);
        return true;
      });

      if (uniqueActions.length === 0) continue;

      // Show up to 3 lenses to avoid clutter.
      for (const a of uniqueActions.slice(0, 3)) {
        lenses.push(
          new vscode.CodeLens(lensRange, {
            title: a.title,
            command: 'packageUpdates.applyUpdate',
            arguments: [document.uri, u.section, u.name, a.kind, a.target]
          })
        );
      }
    }

    return lenses;
  }
}

