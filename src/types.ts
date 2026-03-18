export type DepSection = 'dependencies' | 'devDependencies';

export type PackageJsonDependency = {
  section: DepSection;
  name: string;
  range: string;
};

export type PackageJsonFile = {
  uri: import('vscode').Uri;
  dependencies: PackageJsonDependency[];
};

export type PackageUpdateInfo = PackageJsonDependency & {
  latest: string | null;
  /**
   * A best-effort "current" semver baseline derived from the declared range.
   * - exact versions -> that version
   * - ranges -> minVersion(range)
   */
  currentBase: string | null;
  status: 'unknown' | 'upToDate' | 'outdated';
  /**
   * Available updates derived from published versions.
   * Each entry is a target version (not range).
   */
  available: {
    patch?: string;
    minor?: string;
    major?: string;
    latest?: string;
  };
  /**
   * True if the best available stable version would bump the major version.
   */
  hasMajorBreakingChange?: boolean;
  error?: string;
};

