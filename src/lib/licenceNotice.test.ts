/**
 * The third-party notices written to /licenses.txt (2026-11-08, site audit
 * item 97).
 */
import { describe, expect, it } from 'vitest';
import { licenceNotice, licenseOf, packageDirOf } from './licenceNotice';

const MIT = 'MIT License\n\nCopyright (c) Someone\n\nPermission is hereby granted...';

describe('licenceNotice', () => {
  it('prints a shared licence text once, under every package it covers', () => {
    const text = licenceNotice(
      [
        { name: 'b-pkg', version: '2.0.0', license: 'MIT', text: MIT },
        { name: 'a-pkg', version: '1.0.0', license: 'MIT', text: `  ${MIT.replace(/\n/g, '\r\n')}  ` },
        { name: 'c-pkg', version: '3.0.0', license: 'Apache-2.0', text: 'Apache License 2.0 ...' },
      ],
      'Forma ships these.',
    );
    expect(text.match(/Permission is hereby granted/g)).toHaveLength(1);
    expect(text).toMatch(/^Forma ships these\./);
    expect(text.indexOf('a-pkg 1.0.0 (MIT)')).toBeLessThan(text.indexOf('b-pkg 2.0.0 (MIT)'));
    expect(text).toContain('c-pkg 3.0.0 (Apache-2.0)');
  });

  it('lists a package once, and says when it ships no licence file', () => {
    const text = licenceNotice(
      [
        { name: 'x', version: '1.0.0', license: 'ISC', text: '' },
        { name: 'x', version: '1.0.0', license: 'ISC', text: '' },
      ],
      'Notices',
    );
    expect(text.match(/x 1\.0\.0/g)).toHaveLength(1);
    expect(text).toContain('ships no licence file; its package declares ISC.');
    expect(text).toContain("The licence's text: https://opensource.org/license/isc-license-txt");
  });
});

describe('licenseOf and packageDirOf', () => {
  it('reads every shape a licence field has had', () => {
    expect(licenseOf('MIT')).toBe('MIT');
    expect(licenseOf({ type: 'BSD-3-Clause' })).toBe('BSD-3-Clause');
    expect(licenseOf([{ type: 'MIT' }, 'Apache-2.0'])).toBe('MIT OR Apache-2.0');
    expect(licenseOf(undefined)).toBe('');
  });

  it('finds the package a bundled module came from, scoped or not', () => {
    expect(packageDirOf('E:\\forma\\node_modules\\react-dom\\cjs\\react-dom.production.js')).toBe('E:/forma/node_modules/react-dom');
    expect(packageDirOf('/app/node_modules/@firebase/auth/dist/esm/index.js?commonjs-proxy')).toBe('/app/node_modules/@firebase/auth');
    expect(packageDirOf('/app/node_modules/a/node_modules/b/index.js')).toBe('/app/node_modules/a/node_modules/b');
    expect(packageDirOf('/app/src/App.tsx')).toBeNull();
  });
});
