import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

let npmCliDisabled = false;
const deprecatedCache = new Map<string, string | null>();

function encodePackageName(packageName: string): string {
  // Keep consistent with NpmRegistryClient encoding.
  const encoded = packageName.startsWith('@')
    ? `@${encodeURIComponent(packageName.slice(1)).replace('%2F', '%2f')}`
    : encodeURIComponent(packageName);
  return encoded;
}

async function getNpmDeprecatedMessageViaRegistryFetch(
  packageName: string,
  version: string,
  log?: (line: string) => void
): Promise<string | null> {
  const vscode = await import('vscode');
  const cfg = vscode.workspace.getConfiguration('packageUpdates');
  const registryUrl = String(cfg.get('registryUrl') ?? 'https://registry.npmjs.org').replace(/\/+$/, '');

  const cacheKey = `deprecated:${packageName}@${version}:${registryUrl}`;
  const cached = deprecatedCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const url = `${registryUrl}/${encodePackageName(packageName)}`;
  try {
    const res = await fetch(url, {
      headers: { accept: 'application/vnd.npm.install-v1+json' }
    });
    if (!res.ok) {
      deprecatedCache.set(cacheKey, null);
      return null;
    }
    const body = (await res.json()) as any;
    const dep = body?.versions?.[version]?.deprecated;
    const msg = typeof dep === 'string' && dep.trim() ? dep.trim() : null;
    deprecatedCache.set(cacheKey, msg);
    return msg;
  } catch (err: any) {
    log?.(`registry fetch deprecated failed for ${packageName}@${version}: ${err?.message ?? String(err)}`);
    deprecatedCache.set(cacheKey, null);
    return null;
  }
}

export async function getNpmDeprecatedMessage(
  packageName: string,
  version: string,
  log?: (line: string) => void
): Promise<string | null> {
  // Uses npm config/auth like npmRegistryClient does (best for private registries).
  if (npmCliDisabled) {
    return getNpmDeprecatedMessageViaRegistryFetch(packageName, version, log);
  }

  try {
    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const { stdout, stderr } = await execFileAsync(
      npmCmd,
      ['view', `${packageName}@${version}`, 'deprecated', '--json'],
      {
        timeout: 20_000,
        maxBuffer: 1024 * 1024,
        env: { ...process.env, npm_config_loglevel: 'error' }
      }
    );

    const text = String(stdout || '').trim();
    if (!text) return null;

    // npm usually returns a JSON string (e.g. "use String.prototype.padStart()")
    try {
      const parsed = JSON.parse(text);
      if (typeof parsed === 'string' && parsed.trim()) return parsed.trim();
      return null;
    } catch {
      // Best-effort: extract the last JSON string literal from mixed output.
      const combined = `${String(stderr || '')}\n${text}`;
      const m = combined.match(/("([^"\\]|\\.)*")\s*$/);
      if (!m) return null;
      const parsed = JSON.parse(m[1]);
      return typeof parsed === 'string' && parsed.trim() ? parsed.trim() : null;
    }
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    log?.(`npm view deprecated failed for ${packageName}@${version}: ${msg}`);

    // In some environments the extension host can't spawn npm at all.
    // Treat spawn EINVAL as a hard failure and fall back to registry fetch.
    if (msg.includes('spawn EINVAL') || msg.toLowerCase().includes('e-inval') || msg.toLowerCase().includes('spawn')) {
      npmCliDisabled = true;
    }

    return await getNpmDeprecatedMessageViaRegistryFetch(packageName, version, log);
  }
}

