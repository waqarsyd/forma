/**
 * Which build runs and a problem report, items 103 and 64 (2026-11-08, the site audit's batch SI).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { versionLabel, versionUrl } from './buildInfo';
import { BUG_TEMPLATE, problemReportUrl, publicPath, stackHead, withoutKeys } from './problemReport';

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

  it('prefills the bug form with the area, the error, the build and the page, and nothing from a query', () => {
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
    expect(url.searchParams.get('template')).toBe('bug-report.yml');
    expect(url.searchParams.get('title')).toBe('Problem in the Preview: Cannot read properties of undefined');
    expect(url.searchParams.get('what')).toContain('Where: the Preview\nPage: /workspace');
    expect(url.searchParams.get('error')).toBe('Cannot read properties of undefined');
    expect(url.searchParams.get('version')).toBe('1fc5bb3, built 2026-11-08');
    expect(url.searchParams.get('env')).toBe('Chrome 140');
    expect(url.searchParams.get('console')).toContain('at draw (https://openforma.web.app/assets/App-1.js:10:5)');
    expect(url.toString()).not.toContain('secret');
    expect(url.toString()).not.toContain('v%3D2');
    // A form sets its own label, and only a triager may set one from a link.
    expect(url.searchParams.has('labels')).toBe(false);
    expect(url.searchParams.has('body')).toBe(false);
    expect(stackHead(undefined)).toBe('');
  });

  /*
   * The full audit (2026-11-11, PS-15 and SE-15): every parameter is a field
   * the bug form has, and nothing that opens someone's report or spends their
   * quota reaches a public issue.
   */
  it("fills only the bug form's own fields", () => {
    const form = readFileSync(`.github/ISSUE_TEMPLATE/${BUG_TEMPLATE}`, 'utf8');
    const ids = [...form.matchAll(/^\s+id: ([\w-]+)$/gm)].map((m) => m[1]);
    const url = new URL(problemReportUrl({ area: 'a', message: 'b', stack: 'c', version: 'd', path: '/', browser: 'e' }));
    for (const key of url.searchParams.keys()) {
      if (key === 'template' || key === 'title') continue;
      expect(ids, key).toContain(key);
    }
  });

  it('never names a shared report or an API key', () => {
    // Built in two halves so no key-shaped literal sits in the source.
    const gemini = `AIza${'Sy0123456789abcdefghijklmnopqrstuvw'}`;
    const openrouter = 'sk-or-v1-0123456789abcdef0123456789abcdef';
    expect(gemini).toHaveLength(39);
    const url = problemReportUrl({
      area: 'the shared report',
      message: `Request failed: https://example.com/?key=${gemini} and ${openrouter}`,
      stack: `Error: ${gemini}\n    at x (https://openforma.web.app/assets/a.js:1:1)`,
      version: 'v',
      path: '/s/Sh4r3dR3p0rtIdOfTwentyTwo?x=1',
    });
    const all = [...new URL(url).searchParams.values()].join('\n');
    expect(all).not.toContain(gemini);
    expect(all).not.toContain(openrouter);
    expect(all).not.toContain('Sh4r3dR3p0rtIdOfTwentyTwo');
    expect(all).toContain('/s/(a shared report)');
    expect(all).toContain('(a key)');
    expect(publicPath('/workspace#x')).toBe('/workspace');
    expect(publicPath('/s/abc/def')).toBe('/s/(a shared report)/def');
    expect(withoutKeys('a $& b')).toBe('a $& b');
  });

  // AI Studio's newer key format (2026-11-12), which a problem report let through until then.
  it('never names a Gemini key in the newer AQ. format either', () => {
    const newKey = `AQ.${'Ab8RN6x-'.repeat(6)}q_7z`;
    const url = problemReportUrl({ area: 'the workspace', message: `API key not valid: ${newKey}`, stack: `Error: key=${newKey}`, version: 'v' });
    const all = [...new URL(url).searchParams.values()].join('\n');
    expect(all).not.toContain(newKey);
    expect(all).toContain('(a key)');
    expect(withoutKeys('See FAQ.html')).toBe('See FAQ.html');
  });
});
