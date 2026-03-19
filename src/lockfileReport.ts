import * as vscode from 'vscode';

export type LockfileVulnReportRow = {
  packageJsonRel: string;
  lockfileRel: string;
  lockfileFsPath: string;
  section: string;
  name: string;
  declaredRange: string;
  installedVersion: string;
  severity: string;
  summary: string;
  vulnIds: string[];
  detailsUrl?: string;
};

export function renderLockfileReportMarkdown(rows: LockfileVulnReportRow[]): string {
  const formatVulnIdLinks = (vulnIds: string[]): string => {
    if (!vulnIds.length) return '—';
    return vulnIds
      .map((id) => {
        const url = `https://osv.dev/vulnerability/${encodeURIComponent(id)}`;
        return `[${id}](${url})`;
      })
      .join(', ');
  };

  const when = new Date().toISOString();
  const lines: string[] = [
    '# npm lockfile OSV vulnerability report',
    '',
    `Generated: ${when}`,
    '',
    '> Use this document for Jira / security tickets. Versions are from **package-lock.json** (installed), not only declared ranges in package.json.',
    '',
    '## Summary',
    '',
    `- **Total findings:** ${rows.length}`,
    ''
  ];

  if (rows.length === 0) {
    lines.push('No vulnerabilities reported by OSV for scanned dependencies.', '');
    return lines.join('\n');
  }

  // Group by package.json + lockfile
  const groups = new Map<string, LockfileVulnReportRow[]>();
  for (const r of rows) {
    const key = `${r.packageJsonRel}|||${r.lockfileRel}`;
    const arr = groups.get(key) ?? [];
    arr.push(r);
    groups.set(key, arr);
  }

  lines.push('## Findings by project', '');

  for (const [, groupRows] of groups) {
    const first = groupRows[0];
    lines.push(`### \`${first.packageJsonRel}\``, '');
    lines.push(`- **Lockfile:** \`${first.lockfileRel}\``);
    lines.push(`- **Lockfile (absolute):** \`${first.lockfileFsPath}\``);
    lines.push('');
    lines.push('| Package | Section | Declared in package.json | Installed (lockfile) | Severity | Vuln IDs |');
    lines.push('| --- | --- | --- | --- | --- | --- |');
    for (const r of groupRows) {
      const ids = formatVulnIdLinks(r.vulnIds);
      lines.push(
        `| \`${r.name}\` | ${r.section} | \`${r.declaredRange}\` | \`${r.installedVersion}\` | **${r.severity}** | ${ids} |`
      );
    }
    lines.push('');
    for (const r of groupRows) {
      lines.push(`- **${r.name}@${r.installedVersion}** (${r.severity}): ${r.summary}`);
      lines.push(`  - Vulnerabilities: ${formatVulnIdLinks(r.vulnIds)}`);
      if (r.detailsUrl) lines.push(`  - Reference: ${r.detailsUrl}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export async function writeReportToWorkspaceRoot(
  content: string,
  fileName = 'npm-version-updates-lockfile-report.md'
): Promise<vscode.Uri | null> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) return null;
  const uri = vscode.Uri.joinPath(folder.uri, fileName);
  await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
  return uri;
}
