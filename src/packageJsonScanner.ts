import * as vscode from 'vscode';
import { DepSection, PackageJsonDependency, PackageJsonFile } from './types';

function asStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

export async function findAllPackageJsonFiles(): Promise<vscode.Uri[]> {
  return vscode.workspace.findFiles('**/package.json', '**/{node_modules,dist,build,out,.git}/**');
}

export function extractDependenciesFromPackageJsonText(
  uri: vscode.Uri,
  text: string,
  includeSections: DepSection[]
): PackageJsonFile | null {
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }

  const deps: PackageJsonDependency[] = [];
  const readSection = (section: DepSection) => {
    if (!includeSections.includes(section)) return;
    const rec = asStringRecord(json?.[section]);
    for (const [name, range] of Object.entries(rec)) {
      deps.push({ section, name, range });
    }
  };

  readSection('dependencies');
  readSection('devDependencies');

  return { uri, dependencies: deps };
}

