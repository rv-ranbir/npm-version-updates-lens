import * as vscode from 'vscode';
import { OsvSeverity } from './osvClient';

export type PackageJsonScanReportRow = {
  packageJsonRel: string;
  section: string;
  name: string;
  declaredRange: string;
  checkedVersion: string;
  deprecatedMessage?: string | null;

  // OSV (if present for this entry)
  osvSeverity?: OsvSeverity;
  osvSummary?: string;
  osvDetailsUrl?: string;
  vulnIds: string[];
};

function escapeTableCell(s: string): string {
  // Prevent markdown tables from breaking when messages contain `|` or newlines.
  return s.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}

function formatVulnIdLinks(vulnIds: string[]): string {
  if (!vulnIds.length) return '—';
  return vulnIds
    .map((id) => {
      const url = `https://osv.dev/vulnerability/${encodeURIComponent(id)}`;
      return `[${id}](${url})`;
    })
    .join(', ');
}

export function renderPackageJsonScanMarkdown(
  rows: PackageJsonScanReportRow[],
  scanModeLabel: string
): string {
  const when = new Date().toISOString();
  const lines: string[] = [
    '# npm package.json scan OSV / Deprecated report',
    '',
    `Generated: ${when}`,
    '',
    `> Scan mode: **${scanModeLabel}**. (Versions are the extension’s best-effort baseline derived from the declared range.)`,
    '',
    '## Summary',
    '',
    `- **Total findings:** ${rows.length}`,
    ''
  ];

  if (!rows.length) {
    lines.push('No findings were reported by the selected checks.', '');
    return lines.join('\n');
  }

  // Group by package.json.
  const groups = new Map<string, PackageJsonScanReportRow[]>();
  for (const r of rows) {
    const arr = groups.get(r.packageJsonRel) ?? [];
    arr.push(r);
    groups.set(r.packageJsonRel, arr);
  }

  lines.push('## Findings by project', '');

  for (const [, groupRows] of groups) {
    const first = groupRows[0];
    lines.push(`### \`${first.packageJsonRel}\``, '');
    lines.push('| Package | Section | Declared range | Checked version | Deprecated | OSV severity | OSV vuln IDs |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- |');
    for (const r of groupRows) {
      const depText = r.deprecatedMessage ? escapeTableCell(r.deprecatedMessage) : '—';
      const osvSev = r.osvSeverity ? String(r.osvSeverity) : '—';
      const ids = formatVulnIdLinks(r.vulnIds);
      lines.push(
        `| \`${r.name}\` | ${r.section} | \`${escapeTableCell(r.declaredRange)}\` | \`${escapeTableCell(r.checkedVersion)}\` | ${depText} | **${osvSev}** | ${ids} |`
      );
    }
    lines.push('');

    for (const r of groupRows) {
      lines.push(`- **${r.name}@${r.checkedVersion}**`);
      if (r.deprecatedMessage) lines.push(`  - Deprecated: ${escapeTableCell(r.deprecatedMessage)}`);
      if (r.osvSummary) lines.push(`  - OSV: ${escapeTableCell(r.osvSummary)}`);
      if (r.osvDetailsUrl) lines.push(`  - OSV reference: ${r.osvDetailsUrl}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// Kept here (even though writeReportToWorkspaceRoot already exists for the lockfile report)
// so this module can be imported without pulling extra helpers in the future.
export async function writePackageJsonScanReportToWorkspaceRoot(
  content: string,
  fileName = 'npm-version-updates-package-json-scan-report.md'
): Promise<vscode.Uri | null> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) return null;
  const uri = vscode.Uri.joinPath(folder.uri, fileName);
  await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
  return uri;
}

