import * as vscode from 'vscode';
import { DepSection } from './types';

export type DepValueLocation = {
  section: DepSection;
  name: string;
  /**
   * Range that covers the quoted value (including the quotes) on the line:
   * `"^1.2.3"`
   */
  valueRange: vscode.Range;
  /**
   * Zero-length anchor at end-of-line (used for decorations).
   */
  eolAnchor: vscode.Range;
};

export function parseDependencyValueLocations(document: vscode.TextDocument): DepValueLocation[] {
  // Heuristic line-based parser (works well for typical package.json formatting).
  const out: DepValueLocation[] = [];

  let section: 'none' | DepSection = 'none';
  let braceDepth = 0;

  for (let i = 0; i < document.lineCount; i++) {
    const line = document.lineAt(i).text;

    if (/"dependencies"\s*:\s*\{/.test(line)) {
      section = 'dependencies';
      braceDepth = 1;
      continue;
    }
    if (/"devDependencies"\s*:\s*\{/.test(line)) {
      section = 'devDependencies';
      braceDepth = 1;
      continue;
    }

    if (section !== 'none') {
      const opens = (line.match(/\{/g) ?? []).length;
      const closes = (line.match(/\}/g) ?? []).length;
      braceDepth += opens - closes;
      if (braceDepth <= 0) {
        section = 'none';
        braceDepth = 0;
        continue;
      }

      const m = line.match(/^\s*"([^"]+)"\s*:\s*"([^"]*)"\s*,?\s*$/);
      if (!m) continue;

      const pkg = m[1];
      const valueRaw = m[2];
      const rangeStart = line.indexOf(`"${valueRaw}"`);
      if (rangeStart < 0) continue;

      const valueStartChar = rangeStart;
      const valueEndChar = rangeStart + `"${valueRaw}"`.length;
      const valueRange = new vscode.Range(new vscode.Position(i, valueStartChar), new vscode.Position(i, valueEndChar));

      const eol = line.length;
      const eolAnchor = new vscode.Range(new vscode.Position(i, eol), new vscode.Position(i, eol));

      out.push({ section, name: pkg, valueRange, eolAnchor });
    }
  }

  return out;
}

