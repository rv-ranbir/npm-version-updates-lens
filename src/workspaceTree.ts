import * as vscode from 'vscode';
import { PackageUpdateInfo } from './types';

type UpdatesByFile = Map<string, PackageUpdateInfo[]>;

class UpdateTreeItem extends vscode.TreeItem {
  constructor(
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    readonly uri?: vscode.Uri,
    readonly depName?: string
  ) {
    super(label, collapsibleState);
    this.resourceUri = uri;
  }
}

export class WorkspaceUpdatesTreeProvider implements vscode.TreeDataProvider<UpdateTreeItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<UpdateTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<UpdateTreeItem | undefined | null | void> =
    this._onDidChangeTreeData.event;

  constructor(private getUpdates: () => UpdatesByFile) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: UpdateTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: UpdateTreeItem): Thenable<UpdateTreeItem[]> {
    const updatesByFile = this.getUpdates();
    if (!element) {
      const items: UpdateTreeItem[] = [];
      for (const [uriStr, updates] of updatesByFile.entries()) {
        const uri = vscode.Uri.parse(uriStr);
        const rel = vscode.workspace.asRelativePath(uri);
        const outdated = updates.filter((u) => u.status === 'outdated');
        if (!outdated.length) continue;
        const label = `${rel} (${outdated.length})`;
        items.push(new UpdateTreeItem(label, vscode.TreeItemCollapsibleState.Collapsed, uri));
      }
      return Promise.resolve(items.sort((a, b) => String(a.label).localeCompare(String(b.label))));
    }

    if (element.uri && !element.depName) {
      const updates = updatesByFile.get(element.uri.toString()) ?? [];
      const outdated = updates.filter((u) => u.status === 'outdated');
      const items: UpdateTreeItem[] = [];
      for (const u of outdated) {
        const parts: string[] = [];
        if (u.available.patch) parts.push(`patch → ~${u.available.patch}`);
        if (u.available.minor) parts.push(`minor → ^${u.available.minor}`);
        if (u.available.major) parts.push(`major → ^${u.available.major}`);
        const detail = parts.join(' • ') || 'outdated';
        const item = new UpdateTreeItem(
          `${u.name} (${u.range})`,
          vscode.TreeItemCollapsibleState.None,
          element.uri,
          u.name
        );
        item.description = detail;
        item.command = {
          title: 'Open dependency',
          command: 'packageUpdates.revealDependency',
          arguments: [element.uri, u.name]
        };
        items.push(item);
      }
      return Promise.resolve(items.sort((a, b) => String(a.label).localeCompare(String(b.label))));
    }

    return Promise.resolve([]);
  }
}

