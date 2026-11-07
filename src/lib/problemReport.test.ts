/**
 * Which build runs and a problem report, items 103 and 64 (2026-11-08, the site audit's batch SI).
 */
import { describe, expect, it } from 'vitest';
import { versionLabel, versionUrl } from './buildInfo';
import { problemReportUrl, stackHead } from './problemReport';

describe('versionLabel and problemReportUrl', () => {
  it('names the build by its short commit and day, and links the commit', () => {
    const build = { commit: '1fc5bb3dad9891486bc587f75c15346d4d28f8af', date: '2026-11-08' };
    expect(versionLabel(build)).toBe('1fc5bb3, built 2026-11-08');
    expect(versionUrl(build)).toBe('https://github.com/waqarsyd/forma/commit/1fc5bb3dad9891486bc587f75c15346d4d28f8af');
    expect(versionLabel(null)).toBe('a development build');
    // With the release in front since item 43, the commit still beside it.
    expect(versionLabel({ ...build, version: '1.1.0' })).toBe('1.1.0 (1fc5bb3, built 2026-11-08)');
    expect(versionUrl({ commit: 'unknown', date: '' })).toBeNull();
  });

  it('prefills an issue with the area, the error, the build and the page, and nothing from a query', () => {
    const url = new URL(
      problemReportUrl({
        area: 'the Preview',
        message: 'Cannot read properties of undefined',
        stack: 'TypeError: x\n    at draw (https://openforma.web.app/assets/App-1.js?v=2:10:5)\n    at y',
        version: '1fc5bb3, built 2026-11-08',
        path: '/workspace?token=secret#frag',
        browser: 'Chrome 140',
      }),
    );
    expect(url.searchParams.get('title')).toBe('Problem in the Preview: Cannot read properties of undefined');
    const body = url.searchParams.get('body')!;
    expect(body).toContain('Version: 1fc5bb3, built 2026-11-08');
    expect(body).toContain('Page: /workspace');
    expect(body).not.toContain('secret');
    expect(body).not.toContain('?v=2');
    expect(url.searchParams.get('labels')).toBe('bug');
    expect(stackHead(undefined)).toBe('');
  });
});
