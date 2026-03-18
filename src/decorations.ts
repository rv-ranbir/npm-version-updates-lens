import * as vscode from 'vscode';
import { PackageUpdateInfo } from './types';
import { parseDependencyValueLocations } from './packageJsonRanges';

export type DecorationBundle = {
  ok: vscode.TextEditorDecorationType;
  warn: vscode.TextEditorDecorationType;
  err: vscode.TextEditorDecorationType;
};

export function createDecorations(): DecorationBundle {
  const ok = vscode.window.createTextEditorDecorationType({
    after: { margin: '0 0 0 1rem', color: new vscode.ThemeColor('descriptionForeground') }
  });
  const warn = vscode.window.createTextEditorDecorationType({
    after: { margin: '0 0 0 1rem', color: new vscode.ThemeColor('editorWarning.foreground') }
  });
  const err = vscode.window.createTextEditorDecorationType({
    after: { margin: '0 0 0 1rem', color: new vscode.ThemeColor('editorError.foreground') }
  });
  return { ok, warn, err };
}

export function clearEditorDecorations(editor: vscode.TextEditor, deco: DecorationBundle) {
  editor.setDecorations(deco.ok, []);
  editor.setDecorations(deco.warn, []);
  editor.setDecorations(deco.err, []);
}

export function applyUpdatesDecorations(
  editor: vscode.TextEditor,
  deco: DecorationBundle,
  updates: PackageUpdateInfo[]
) {
  const doc = editor.document;
  if (!doc.fileName.endsWith('package.json')) return;

  const locations = parseDependencyValueLocations(doc);
  const map = new Map<string, vscode.Range>();
  for (const loc of locations) {
    map.set(`${loc.section}:${loc.name}`, loc.eolAnchor);
  }

  const okRanges: vscode.DecorationOptions[] = [];
  const warnRanges: vscode.DecorationOptions[] = [];
  const errRanges: vscode.DecorationOptions[] = [];

  const push = (kind: 'ok' | 'warn' | 'err', range: vscode.Range, text: string) => {
    const opt: vscode.DecorationOptions = {
      range,
      renderOptions: { after: { contentText: text } }
    };
    if (kind === 'ok') okRanges.push(opt);
    if (kind === 'warn') warnRanges.push(opt);
    if (kind === 'err') errRanges.push(opt);
  };

  for (const u of updates) {
    const r = map.get(`${u.section}:${u.name}`);
    if (!r) continue;

    if (u.status === 'upToDate') {
      push('ok', r, `✓ up to date`);
    } else if (u.status === 'outdated') {
      const parts: string[] = [];
      if (u.available.patch) parts.push(`patch ${u.available.patch}`);
      if (u.available.minor) parts.push(`minor ${u.available.minor}`);
      if (u.available.major) parts.push(`major ${u.available.major}`);
      if (parts.length === 0 && u.latest) parts.push(`latest ${u.latest}`);
      push('warn', r, `⬆ ${parts.join(' • ')}`);
    } else {
      const msg = u.error ? `? ${u.error}` : '? unknown';
      push('err', r, msg);
    }
  }

  editor.setDecorations(deco.ok, okRanges);
  editor.setDecorations(deco.warn, warnRanges);
  editor.setDecorations(deco.err, errRanges);
}

