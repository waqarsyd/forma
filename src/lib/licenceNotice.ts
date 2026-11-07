/**
 * The notices for the open-source code and data Forma ships (2026-11-08, site
 * audit item 97), written at build into `/licenses.txt` by the
 * `thirdPartyLicences` plugin in vite.config.ts, which reads each package's
 * own licence file. The bundle carries React, Firebase, pdf.js, Tesseract,
 * ONNX Runtime and Transformers.js among others, and the site serves
 * Tesseract's language data, three typefaces and the PDF fonts; most of
 * their licences ask that the notice travel with the code, and the site
 * carried none.
 *
 * Pure, so a test holds it: packages that share a licence text word for word
 * share one copy of it, which is what keeps twenty Apache-2.0 Firebase
 * packages from printing the same eleven kilobytes twenty times.
 */

export interface LicensedWork {
  name: string;
  version?: string;
  /** The SPDX identifier or the licence's name. */
  license: string;
  /** The licence file as the package ships it; empty when it ships none. */
  text: string;
  homepage?: string;
}

const RULE = '-'.repeat(72);

/**
 * Where a licence's own text lives, for a package that declares it and ships
 * no file (Firebase's packages declare Apache-2.0 and carry no LICENSE).
 */
const LICENCE_TEXT_AT: Record<string, string> = {
  'Apache-2.0': 'https://www.apache.org/licenses/LICENSE-2.0',
  MIT: 'https://opensource.org/license/mit',
  ISC: 'https://opensource.org/license/isc-license-txt',
  'BSD-2-Clause': 'https://opensource.org/license/bsd-2-clause',
  'BSD-3-Clause': 'https://opensource.org/license/bsd-3-clause',
  '0BSD': 'https://opensource.org/license/0bsd',
  'OFL-1.1': 'https://openfontlicense.org/open-font-license-official-text/',
};

/** One file of notices: each distinct licence text once, under every work it covers. */
export function licenceNotice(works: readonly LicensedWork[], heading: string): string {
  const seen = new Set<string>();
  const unique = works.filter((w) => {
    const key = `${w.name}@${w.version ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const groups = new Map<string, LicensedWork[]>();
  for (const work of [...unique].sort((a, b) => a.name.localeCompare(b.name))) {
    const key = work.text.trim() ? work.text.replace(/\s+/g, ' ').trim() : `(no text) ${work.license}`;
    groups.set(key, [...(groups.get(key) ?? []), work]);
  }
  const blocks = [...groups.values()].map((group) => {
    const names = group.map((w) => {
      const label = [w.name, w.version].filter(Boolean).join(' ');
      return `${label} (${w.license || 'licence not stated'})${w.homepage ? ` ${w.homepage}` : ''}`;
    });
    const text = group[0].text.trim();
    const declared = group[0].license;
    const at = LICENCE_TEXT_AT[declared];
    const missing = `This package ships no licence file; its package declares ${declared || 'no licence'}.${at ? ` The licence's text: ${at}` : ''}`;
    return [...names, '', text || missing].join('\n');
  });
  return `${heading.trim()}\n\n${RULE}\n\n${blocks.join(`\n\n${RULE}\n\n`)}\n`;
}

/** A package.json `license` field, in whichever of its historical shapes. */
export function licenseOf(field: unknown): string {
  if (typeof field === 'string') return field;
  if (Array.isArray(field)) return field.map(licenseOf).filter(Boolean).join(' OR ');
  if (field && typeof field === 'object' && typeof (field as { type?: unknown }).type === 'string') {
    return (field as { type: string }).type;
  }
  return '';
}

/** The package a bundled module came from, as the directory under node_modules, or null. */
export function packageDirOf(moduleId: string): string | null {
  const id = moduleId.replace(/\\/g, '/').replace(/^\0/, '').split('?')[0];
  const at = id.lastIndexOf('/node_modules/');
  if (at < 0) return null;
  const rest = id.slice(at + '/node_modules/'.length).split('/');
  const name = rest[0]?.startsWith('@') ? rest.slice(0, 2).join('/') : rest[0];
  return name ? `${id.slice(0, at)}/node_modules/${name}` : null;
}
