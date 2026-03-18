import * as vscode from 'vscode';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

type CacheEntry<T> = { value: T; expiresAt: number };

export type Packument = {
  latest: string | null;
  versions: string[];
};

const execFileAsync = promisify(execFile);

export class NpmRegistryClient {
  private cache = new Map<string, CacheEntry<any>>();
  private readonly registryUrl: string;
  private readonly ttlMs: number;
  private readonly versionSource: 'npmCli' | 'registryFetch';
  private readonly log?: (line: string) => void;

  constructor(log?: (line: string) => void) {
    const cfg = vscode.workspace.getConfiguration('packageUpdates');
    this.registryUrl = String(cfg.get('registryUrl') ?? 'https://registry.npmjs.org').replace(/\/+$/, '');
    const ttlSeconds = Number(cfg.get('cacheTtlSeconds') ?? 900);
    this.ttlMs = Math.max(0, ttlSeconds) * 1000;
    const src = String(cfg.get('versionSource') ?? 'npmCli');
    this.versionSource = src === 'registryFetch' ? 'registryFetch' : 'npmCli';
    this.log = log;
  }

  private cacheGet<T>(key: string): T | undefined {
    if (this.ttlMs <= 0) return undefined;
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  private cacheSet<T>(key: string, value: T) {
    if (this.ttlMs <= 0) return;
    this.cache.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  private encodePackageName(packageName: string): string {
    const encoded = packageName.startsWith('@')
      ? `@${encodeURIComponent(packageName.slice(1)).replace('%2F', '%2f')}`
      : encodeURIComponent(packageName);
    return encoded;
  }

  private async getPackumentViaNpmCli(packageName: string): Promise<Packument> {
    // Uses the user's npm auth/config (~/.npmrc), which supports private registries/packages.
    // We deliberately do NOT force --registry here to allow per-scope registries.
    try {
      const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
      const { stdout, stderr } = await execFileAsync(
        npmCmd,
        ['view', packageName, 'versions', 'dist-tags', '--json'],
        { timeout: 20_000, maxBuffer: 1024 * 1024 }
      );

      // npm sometimes prints warnings; they typically go to stderr but can appear elsewhere.
      const text = String(stdout || '').trim();
      if (!text) return { latest: null, versions: [] };

      let data: any;
      try {
        data = JSON.parse(text);
      } catch {
        // Best-effort: extract the last JSON object/array from mixed output.
        const combined = `${String(stderr || '')}\n${text}`;
        const m = combined.match(/(\{[\s\S]*\}|\[[\s\S]*\])\s*$/);
        if (!m) {
          this.log?.(`npm view JSON parse failed for ${packageName}: no trailing JSON found`);
          return { latest: null, versions: [] };
        }
        data = JSON.parse(m[1]);
      }
      const versionsRaw = data?.versions;
      const distTags = data?.['dist-tags'] ?? data?.distTags;

      const versions =
        Array.isArray(versionsRaw) ? versionsRaw.filter((v) => typeof v === 'string') : [];
      const latest = typeof distTags?.latest === 'string' ? distTags.latest : null;

      return { latest, versions };
    } catch (err: any) {
      this.log?.(`npm view failed for ${packageName}: ${err?.message ?? String(err)}`);
      return { latest: null, versions: [] };
    }
  }

  private async getPackumentViaRegistryFetch(packageName: string, signal?: AbortSignal): Promise<Packument> {
    const encoded = this.encodePackageName(packageName);
    const url = `${this.registryUrl}/${encoded}`;

    try {
      const res = await fetch(url, {
        headers: {
          accept: 'application/vnd.npm.install-v1+json'
        },
        signal
      });

      if (!res.ok) return { latest: null, versions: [] };

      const body = (await res.json()) as any;
      const latest = body?.['dist-tags']?.latest;
      const latestStr = typeof latest === 'string' ? latest : null;
      const versions = body?.versions && typeof body.versions === 'object' ? Object.keys(body.versions) : [];
      return { latest: latestStr, versions };
    } catch (err: any) {
      this.log?.(`registry fetch failed for ${packageName}: ${err?.message ?? String(err)}`);
      return { latest: null, versions: [] };
    }
  }

  async getPackument(packageName: string, signal?: AbortSignal): Promise<Packument> {
    const cacheKey = `packument:${packageName}`;
    const cached = this.cacheGet<Packument>(cacheKey);
    if (cached !== undefined) return cached;

    if (this.versionSource === 'npmCli') {
      const fromCli = await this.getPackumentViaNpmCli(packageName);
      // If npm isn't available/configured in the Extension Host, fall back to public registry fetch
      // so public packages still work out of the box.
      const shouldFallback = (fromCli.versions.length ?? 0) === 0 && !fromCli.latest;
      if (shouldFallback) this.log?.(`No usable data from npm view for ${packageName}; falling back to registry fetch`);
      const packument = shouldFallback ? await this.getPackumentViaRegistryFetch(packageName, signal) : fromCli;
      this.cacheSet(cacheKey, packument);
      return packument;
    }

    const packument = await this.getPackumentViaRegistryFetch(packageName, signal);
    this.cacheSet(cacheKey, packument);
    return packument;
  }

  async getLatestVersion(packageName: string, signal?: AbortSignal): Promise<string | null> {
    const p = await this.getPackument(packageName, signal);
    return p.latest;
  }
}

