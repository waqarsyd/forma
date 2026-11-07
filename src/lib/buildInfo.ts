/**
 * Which build is running (2026-11-08, site audit item 103): the commit and
 * the day it was built, which `vite.config.ts` passes in as
 * `__FORMA_BUILD__`. Nothing on screen said it; the page's
 * `<meta name="forma-version">` did, for machines. Settings, under General,
 * shows it, a problem report carries it, and the bug form asks for it.
 *
 * With package.json's version in front since item 43 (the same day): the
 * release a deploy tags as `v<version>`, which is what a person names when
 * they say which Forma they use. The commit stays beside it, because a build
 * made after a release carries that release's number until the next one.
 */
declare const __FORMA_BUILD__: { version?: string; commit: string; date: string } | undefined;

export interface BuildInfo {
  /** package.json's version, e.g. '1.1.0'; absent in a build made before it was stamped. */
  version?: string;
  /** The full commit hash, or 'unknown' outside a git checkout. */
  commit: string;
  /** YYYY-MM-DD. */
  date: string;
}

export const BUILD: BuildInfo | null = typeof __FORMA_BUILD__ === 'object' && __FORMA_BUILD__ ? __FORMA_BUILD__ : null;

/** "1.1.0 (1fc5bb3, built 2026-11-08)", or what to say when there is no build to name. */
export function versionLabel(build: BuildInfo | null = BUILD): string {
  if (!build) return 'a development build';
  const commit = /^[0-9a-f]{7,40}$/.test(build.commit) ? build.commit.slice(0, 7) : build.commit;
  const where = build.date ? `${commit}, built ${build.date}` : commit;
  return build.version ? `${build.version} (${where})` : where;
}

/** The commit's page on GitHub, when there is one. */
export function versionUrl(build: BuildInfo | null = BUILD): string | null {
  return build && /^[0-9a-f]{40}$/.test(build.commit) ? `https://github.com/waqarsyd/forma/commit/${build.commit}` : null;
}
