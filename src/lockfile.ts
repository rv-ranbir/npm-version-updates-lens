import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';

export async function getInstalledVersionsFromNearestLockfile(
  packageJsonUri: vscode.Uri,
  log?: (line: string) => void
): Promise<{ installedVersions: Map<string, string>; lockfilePath: string } | null> {
  // MVP implementation: support npm `package-lock.json` only.
  // If parsing fails or file is missing, return null so callers can fall back
  // to the existing "declared range" logic.
  const startDir = path.dirname(packageJsonUri.fsPath);

  for (let cur = startDir; ; ) {
    const candidate = path.join(cur, 'package-lock.json');
    try {
      await fs.access(candidate);
      const raw = await fs.readFile(candidate, 'utf8');
      const data = JSON.parse(raw) as any;
      const versions = new Map<string, string>();

      if (data?.packages && typeof data.packages === 'object') {
        for (const [k, v] of Object.entries<any>(data.packages)) {
          if (!k.startsWith('node_modules/')) continue;
          const name = k.slice('node_modules/'.length);
          if (typeof v?.version === 'string') versions.set(name, v.version);
        }
      } else if (data?.dependencies && typeof data.dependencies === 'object') {
        for (const [name, v] of Object.entries<any>(data.dependencies)) {
          if (typeof v?.version === 'string') versions.set(name, v.version);
        }
      }

      log?.(`Lockfile: resolved ${versions.size} installed package versions from ${path.relative(startDir, candidate)}.`);
      return { installedVersions: versions, lockfilePath: candidate };
    } catch {
      // Not found / unreadable / parse error -> keep walking up.
    }

    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }

  return null;
}

