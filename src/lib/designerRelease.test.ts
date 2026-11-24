/**
 * The Forma Designer download's record (2026-11-09, the owner's download
 * programme, batch WD). The zip is packed by scripts/package-designer.ts,
 * which writes the block these tests read; measured that day, two packs of the
 * same commit gave the same 99,261 bytes and SHA-256.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  DESIGNER_PACKAGE_FILES,
  DESIGNER_RELEASE,
  DESIGNER_VERBS_SINCE,
  designerDownloadUrl,
  designerIsOlder,
  designerReleasePage,
  designerZipName,
  packageProblems,
} from './designerRelease';

describe('the record the packing script writes', () => {
  it('is the version the companion itself carries, under the name the script gives it', () => {
    const info = readFileSync('tools/RepxDesigner/AssemblyInfo.cs', 'utf8');
    const assembly = /AssemblyVersion\("(\d+\.\d+\.\d+)\.\d+"\)/.exec(info)![1];
    expect(DESIGNER_RELEASE.version).toBe(assembly);
    expect(DESIGNER_RELEASE.file).toBe(designerZipName(assembly));
  });

  it('describes a real zip: a SHA-256, a size, a date and the release it rides on', () => {
    expect(DESIGNER_RELEASE.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(DESIGNER_RELEASE.bytes).toBeGreaterThan(20_000);
    expect(DESIGNER_RELEASE.bytes).toBeLessThan(1_000_000);
    expect(DESIGNER_RELEASE.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(DESIGNER_RELEASE.tag).toMatch(/^v\d+\.\d+\.\d+$/);
  });

  it('links the zip on its GitHub release, where it is served free', () => {
    expect(designerDownloadUrl({ ...DESIGNER_RELEASE, tag: 'v1.3.0', file: 'FormaDesigner-1.0.0-windows.zip' })).toBe(
      'https://github.com/waqarsyd/forma/releases/download/v1.3.0/FormaDesigner-1.0.0-windows.zip',
    );
    expect(designerReleasePage({ ...DESIGNER_RELEASE, tag: 'v1.3.0' })).toBe('https://github.com/waqarsyd/forma/releases/tag/v1.3.0');
  });
});

describe('what a package may hold', () => {
  it('is the program and its three texts, and nothing of DevExpress', () => {
    expect(packageProblems([...DESIGNER_PACKAGE_FILES])).toEqual([]);
    expect(packageProblems([...DESIGNER_PACKAGE_FILES, 'DevExpress.XtraReports.v20.1.dll'])).toEqual([
      'DevExpress.XtraReports.v20.1.dll is a DevExpress file, which Forma may not redistribute',
    ]);
    expect(packageProblems([...DESIGNER_PACKAGE_FILES, 'RepxDesigner.pdb'])[0]).toContain('RepxDesigner.pdb is not one of');
    expect(packageProblems(['RepxDesigner.exe', 'README.txt', 'NOTICE.txt'])).toEqual(['LICENSE.txt is missing']);
  });

  it('says in its own texts that DevExpress is not included, in plain ASCII for Notepad', () => {
    for (const name of ['README.txt', 'NOTICE.txt']) {
      const text = readFileSync(`tools/RepxDesigner/download/${name}`, 'utf8');
      expect(/^[\x09\x0a\x20-\x7e]*$/.test(text), name).toBe(true);
      expect(text).toMatch(/DevExpress (is NOT included|software)/);
    }
    expect(readFileSync('tools/RepxDesigner/download/README.txt', 'utf8')).toContain('https://www.devexpress.com/products/try/');
  });
});

describe('the first Forma Designer with the command-line verbs (D2-8)', () => {
  /** The last Forma Designer published without them: 1.1.0, on v1.6.0. */
  const LAST_WITHOUT_VERBS = '1.1.0';
  const assembly = /AssemblyVersion\("(\d+\.\d+\.\d+)\.\d+"\)/.exec(readFileSync('tools/RepxDesigner/AssemblyInfo.cs', 'utf8'))![1];

  it('is newer than the last release without them, so an installed 1.1.0 is never started with a verb', () => {
    expect(DESIGNER_VERBS_SINCE).toMatch(/^\d+\.\d+\.\d+$/);
    expect(designerIsOlder(LAST_WITHOUT_VERBS, DESIGNER_VERBS_SINCE)).toBe(true);
  });

  it('is read from the file version, which says what the version says, so raising one alone fails here rather than in the field (N6-1)', () => {
    // src/mcp/designerVerbs.ts reads the exe's VS_FIXEDFILEINFO, which AssemblyFileVersion sets; the record, /health and this
    // file's other cases read AssemblyVersion. A 1.2.0 packed with AssemblyFileVersion left at 1.1.0.0 would pass everything
    // else and be refused by the command line on every PC; scripts/package-designer.ts refuses to pack it too.
    const info = readFileSync('tools/RepxDesigner/AssemblyInfo.cs', 'utf8');
    const version = /AssemblyVersion\("([^"]*)"\)/.exec(info)![1];
    const fileVersion = /AssemblyFileVersion\("([^"]*)"\)/.exec(info)?.[1];
    expect(fileVersion).toBe(version);
    expect(readFileSync('scripts/package-designer.ts', 'utf8')).toContain('AssemblyFileVersion (');
  });

  it('is not newer than the source once the owner has raised it past 1.1.0, so a packed build with the verbs passes its own check', () => {
    // Until the owner's packing commit the source says 1.1.0 though Verbs.cs is in it, which is why a copy built from source
    // (FORMA_DESIGNER) skips the check, and the sentinel and the envelope (src/mcp/designerVerbs.ts) decide alone.
    if (designerIsOlder(LAST_WITHOUT_VERBS, assembly)) expect(designerIsOlder(assembly, DESIGNER_VERBS_SINCE)).toBe(false);
    else expect(assembly).toBe(LAST_WITHOUT_VERBS);
  });
});

describe('a running copy older than the download', () => {
  it('is told, by number, and anything unreadable is not', () => {
    expect(designerIsOlder('1.0.0', '1.0.1')).toBe(true);
    expect(designerIsOlder('1.2.0', '1.10.0')).toBe(true);
    expect(designerIsOlder('1.0.0', '1.0.0')).toBe(false);
    expect(designerIsOlder('2.0.0', '1.9.9')).toBe(false);
    expect(designerIsOlder(null, '1.0.0')).toBe(false);
    expect(designerIsOlder('20.1.3.0', '1.0.0')).toBe(false);
  });
});
