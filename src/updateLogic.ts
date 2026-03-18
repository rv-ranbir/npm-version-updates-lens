import * as semver from 'semver';
import { PackageJsonDependency, PackageUpdateInfo } from './types';
import { Packument } from './npmRegistry';

function isProbablyFileOrGit(range: string): boolean {
  const r = range.trim();
  return (
    r.startsWith('file:') ||
    r.startsWith('link:') ||
    r.startsWith('git+') ||
    r.startsWith('github:') ||
    r.startsWith('http://') ||
    r.startsWith('https://') ||
    r.includes('://')
  );
}

function normalizeVersion(v: string): string | null {
  const cleaned = semver.valid(semver.coerce(v)?.version ?? '');
  return cleaned ?? null;
}

function getCurrentBase(range: string): string | null {
  const trimmed = range.trim();
  const exact = semver.valid(trimmed);
  if (exact) return exact;
  const valid = semver.validRange(trimmed);
  if (!valid) return null;
  const min = semver.minVersion(valid);
  return min ? normalizeVersion(min.version) : null;
}

function bestVersion(versions: string[], predicate: (v: semver.SemVer) => boolean): string | undefined {
  const valid = versions
    .map((v) => semver.parse(v))
    .filter((v): v is semver.SemVer => Boolean(v))
    // Only keep stable versions (no prerelease / canary, etc.)
    .filter((v) => v.prerelease.length === 0)
    .filter(predicate)
    .map((v) => v.version);
  if (valid.length === 0) return undefined;
  return semver.rsort(valid)[0];
}

export function computeUpdate(dep: PackageJsonDependency, packument: Packument): PackageUpdateInfo {
  const latestRaw = packument.latest ? normalizeVersion(packument.latest) : null;
  const latest =
    latestRaw && semver.valid(latestRaw) && (semver.parse(latestRaw) as semver.SemVer).prerelease.length === 0
      ? latestRaw
      : null;

  if (isProbablyFileOrGit(dep.range)) {
    return {
      ...dep,
      latest,
      currentBase: null,
      status: 'unknown',
      available: {},
      error: 'Non-registry specifier'
    };
  }

  const currentBase = getCurrentBase(dep.range);
  if (!currentBase) {
    return {
      ...dep,
      latest,
      currentBase: null,
      status: 'unknown',
      available: { latest: latest ?? undefined },
      error: 'Unrecognized version range'
    };
  }

  const versions = packument.versions;
  const base = semver.parse(currentBase);

  const available: PackageUpdateInfo['available'] = {};
  if (latest) available.latest = latest;

  if (base) {
    available.patch = bestVersion(versions, (v) => v.major === base.major && v.minor === base.minor && semver.gt(v, base));
    available.minor = bestVersion(versions, (v) => v.major === base.major && semver.gt(v, base));
    available.major = bestVersion(versions, (v) => semver.gt(v, base));
  }

  const best =
    (available.major && available.major) ||
    (available.minor && available.minor) ||
    (available.patch && available.patch) ||
    (available.latest && available.latest);

  let status: PackageUpdateInfo['status'] = 'unknown';
  let hasMajorBreakingChange = false;
  if (base && best) {
    if (semver.lte(best, base)) {
      // Already at or ahead of best known stable; treat as fully up to date and clear actions.
      available.patch = undefined;
      available.minor = undefined;
      available.major = undefined;
      status = 'upToDate';
    } else {
      status = 'outdated';
      if (available.major && semver.gt(available.major, base)) {
        hasMajorBreakingChange = true;
      }
    }
  }

  return {
    ...dep,
    latest,
    currentBase,
    status,
    available,
    hasMajorBreakingChange
  };
}

