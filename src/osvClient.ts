export type OsvSeverity = 'CRITICAL' | 'HIGH' | 'MODERATE' | 'LOW' | 'UNKNOWN';

export type OsvResult = {
  severity: OsvSeverity;
  summary: string;
  detailsUrl?: string;
  vulnIds: string[];
};

type CacheEntry<T> = { value: T; expiresAt: number };

function normalizeSeverity(s: string | undefined): OsvSeverity {
  const v = String(s ?? '').toUpperCase();
  if (v === 'CRITICAL') return 'CRITICAL';
  if (v === 'HIGH') return 'HIGH';
  if (v === 'MODERATE' || v === 'MEDIUM') return 'MODERATE';
  if (v === 'LOW') return 'LOW';
  return 'UNKNOWN';
}

function maxSeverity(a: OsvSeverity, b: OsvSeverity): OsvSeverity {
  const rank: Record<OsvSeverity, number> = { UNKNOWN: 0, LOW: 1, MODERATE: 2, HIGH: 3, CRITICAL: 4 };
  return rank[a] >= rank[b] ? a : b;
}

export class OsvClient {
  private cache = new Map<string, CacheEntry<OsvResult | null>>();

  constructor(private ttlMs: number, private log?: (line: string) => void) {}

  private cacheGet(key: string): OsvResult | null | undefined {
    if (this.ttlMs <= 0) return undefined;
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.value;
  }

  private cacheSet(key: string, value: OsvResult | null) {
    if (this.ttlMs <= 0) return;
    this.cache.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  async queryNpmPackage(name: string, version: string, signal?: AbortSignal): Promise<OsvResult | null> {
    const cacheKey = `osv:npm:${name}@${version}`;
    const cached = this.cacheGet(cacheKey);
    if (cached !== undefined) return cached;

    try {
      const res = await fetch('https://api.osv.dev/v1/query', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ package: { ecosystem: 'npm', name }, version }),
        signal
      });
      if (!res.ok) {
        this.log?.(`OSV query failed for ${name}@${version}: HTTP ${res.status}`);
        this.cacheSet(cacheKey, null);
        return null;
      }
      const body = (await res.json()) as any;
      const vulns: any[] = Array.isArray(body?.vulns) ? body.vulns : [];
      if (vulns.length === 0) {
        this.cacheSet(cacheKey, null);
        return null;
      }

      const ids: string[] = [];
      let sev: OsvSeverity = 'UNKNOWN';

      for (const v of vulns) {
        const id = typeof v?.id === 'string' ? v.id : undefined;
        if (id) ids.push(id);

        // OSV severity can appear as an array like [{type:'CVSS_V3', score:'...'}] or a 'severity' field
        const sArr: any[] = Array.isArray(v?.severity) ? v.severity : [];
        for (const s of sArr) {
          const t = normalizeSeverity(s?.type);
          sev = maxSeverity(sev, t);
        }
        const databaseSpecific = v?.database_specific;
        const ds = normalizeSeverity(databaseSpecific?.severity);
        sev = maxSeverity(sev, ds);
      }

      const summary = `Found ${vulns.length} vulnerabilities (${sev})`;
      // OSV list page expects `q=` for free-text search, plus `ecosystem=npm`.
      // Example: https://osv.dev/list?q=REACT-ROUTER&ecosystem=npm
      const detailsUrl = ids.length
        ? `https://osv.dev/list?q=${encodeURIComponent(name)}&ecosystem=npm`
        : undefined;

      const result: OsvResult = { severity: sev, summary, detailsUrl, vulnIds: Array.from(new Set(ids)) };
      this.cacheSet(cacheKey, result);
      return result;
    } catch (err: any) {
      this.log?.(`OSV query error for ${name}@${version}: ${err?.message ?? String(err)}`);
      this.cacheSet(cacheKey, null);
      return null;
    }
  }
}

