/** A shared report's copy, link and invitees (2026-11-06), as firestore.rules pins them. */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { MAX_INVITED, REPORT_SCRIPTS_PATTERN, hasReportScripts, inviteesOf, isEmail, makeShareId, normaliseEmail, readSharedReport, shareDocument, shareLink, splitShare, withInvitee } from './shares';
import { sharedReportId } from './routes';

describe('makeShareId', () => {
  it('makes 22 base64url characters from random bytes, a valid document id', () => {
    const id = makeShareId();
    expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(makeShareId()).not.toBe(id);
    // 0xFF bytes are "/" in base64, written "_" in base64url.
    expect(makeShareId((b) => b.fill(255))).toBe('_'.repeat(22));
  });
});

describe('invitees', () => {
  it('compares addresses trimmed and in lower case, as the rules do', () => {
    expect(normaliseEmail('  Bob@Example.COM ')).toBe('bob@example.com');
    expect(isEmail('bob@example.com')).toBe(true);
    expect(isEmail('bob@example')).toBe(false);
    expect(isEmail('bob example.com')).toBe(false);
  });

  it('adds an address once, in the order added, and not past the cap', () => {
    expect(withInvitee(['a@x.io'], ' B@X.io ')).toEqual(['a@x.io', 'b@x.io']);
    expect(withInvitee(['a@x.io'], 'A@x.io')).toEqual(['a@x.io']);
    expect(withInvitee(['a@x.io'], 'not an address')).toEqual(['a@x.io']);
    const full = Array.from({ length: MAX_INVITED }, (_, i) => `p${i}@x.io`);
    expect(withInvitee(full, 'one@more.io')).toHaveLength(MAX_INVITED);
  });
});

describe('shareDocument', () => {
  const base = { id: 'Sh4r3dR3p0rtIdOfTwentyTwo', ownerId: 'alice', reportId: 'r1', name: 'Invoice', access: 'link' as const, emails: ['Bob@Example.com'], now: 1_790_000_000_000 };

  it('holds exactly the fields the rules pin, the report without its conversation', () => {
    const d = shareDocument({ ...base, report: { title: 'Invoice', repxContent: '<x/>', layout: { sections: [] } } })!;
    expect(Object.keys(d).sort()).toEqual(['access', 'emails', 'id', 'name', 'ownerId', 'reportId', 'result', 'timestamp']);
    expect(d.emails).toEqual(['bob@example.com']);
    expect(JSON.parse(d.result)).toEqual({ title: 'Invoice', repxContent: '<x/>', layout: { sections: [] } });
    expect(readSharedReport(d.result)?.repxContent).toBe('<x/>');
  });

  it('declines a report too large for one document', () => {
    expect(shareDocument({ ...base, report: { repxContent: 'x'.repeat(1_000_001) } })).toBeNull();
  });

  it('reads back nothing from what is not a shared report', () => {
    expect(readSharedReport('{"title":"no repx"}')).toBeNull();
    expect(readSharedReport('not json')).toBeNull();
    expect(readSharedReport(42)).toBeNull();
  });
});

// The full audit, 2026-11-11 (SE-04): the document a link share hands anyone
// carries no invitee; they go to the access list only the owner reads.
describe('splitShare and inviteesOf', () => {
  const base = { id: 'Sh4r3dR3p0rtIdOfTwentyTwo', ownerId: 'alice', reportId: 'r1', name: 'Invoice', access: 'link' as const, emails: ['Bob@Example.com'], now: 1_790_000_000_000 };

  it('writes the document in the shape the rules pin, with no address in it', () => {
    const { stored, acl } = splitShare(shareDocument({ ...base, report: { repxContent: '<x/>' } })!);
    expect(Object.keys(stored).sort()).toEqual(['access', 'id', 'name', 'ownerId', 'reportId', 'result', 'timestamp']);
    expect(JSON.stringify(stored)).not.toContain('example.com');
    expect(acl).toEqual({ ownerId: 'alice', list: ['bob@example.com'] });
  });

  it('keeps a legacy share\'s own emails out of the document it rewrites', () => {
    const legacy = { ...shareDocument({ ...base, report: { repxContent: '<x/>' } })!, emails: ['carol@example.com'], extra: 'x' };
    const { stored, acl } = splitShare(legacy);
    expect(stored).not.toHaveProperty('emails');
    expect(stored).not.toHaveProperty('extra');
    expect(acl.list).toEqual(['carol@example.com']);
  });

  it('reads the invitees from the list, or from a share made before it, or none', () => {
    expect(inviteesOf({ ownerId: 'alice', list: ['a@x.io'] }, { emails: ['old@x.io'] })).toEqual(['a@x.io']);
    expect(inviteesOf(null, { emails: ['old@x.io', 7] })).toEqual(['old@x.io']);
    expect(inviteesOf(null, {})).toEqual([]);
    expect(inviteesOf(undefined)).toEqual([]);
  });
});

// The full audit, 2026-11-11 (SE-02): code DevExpress runs when a report is previewed.
describe('hasReportScripts', () => {
  it('finds a script source and an event handler, and nothing in a plain report', () => {
    expect(hasReportScripts('<XtraReportsLayoutSerializer ScriptsSource="void x() {}" Ref="1">')).toBe(true);
    expect(hasReportScripts('<Item1 ControlType="XRLabel" Ref="2"><Scripts OnBeforePrint="label1_BeforePrint" /></Item1>')).toBe(true);
    expect(hasReportScripts('<XtraReportsLayoutSerializer Ref="1"><Item1 ControlType="XRLabel" Text="Scripts" /></XtraReportsLayoutSerializer>')).toBe(false);
    expect(hasReportScripts('<XtraReportsLayoutSerializer ScriptsSource="" Ref="1">')).toBe(false);
  });

  // The re-audit's R5-02: legal XML the first pattern missed, so a shared report carried code with no warning.
  it('finds them however XML spells them', () => {
    for (const scripted of [
      `<XtraReportsLayoutSerializer ScriptsSource ="void x() {}" Ref="1">`,
      `<XtraReportsLayoutSerializer ScriptsSource= 'void x() {}' Ref="1">`,
      `<XtraReportsLayoutSerializer\nScriptsSource\n=\n"void x() {}">`,
      `<XtraReportsLayoutSerializer Ref="1"><ScriptsSource>void x() {}</ScriptsSource></XtraReportsLayoutSerializer>`,
      `<Item1 Ref="2"><Scripts OnBeforePrint = "h" /></Item1>`,
      `<Item1 Ref="2"><Scripts OnBeforePrint='h' /></Item1>`,
      `<Item1 Ref="2"><Scripts Ref="5" Note="a>b" OnBeforePrint="h" /></Item1>`,
      // The review of R5-02 (2026-11-12): CDATA, or a comment first.
      `<XtraReportsLayoutSerializer Ref="1"><ScriptsSource><![CDATA[void x(){}]]></ScriptsSource></XtraReportsLayoutSerializer>`,
      `<XtraReportsLayoutSerializer Ref="1"><ScriptsSource> <!-- c -->void x(){}</ScriptsSource></XtraReportsLayoutSerializer>`,
      `<XtraReportsLayoutSerializer Text="a>b" Note='c"d' ScriptsSource="void x() {}">`,
    ]) {
      expect(hasReportScripts(scripted), scripted).toBe(true);
    }
    for (const plain of [
      `<XtraReportsLayoutSerializer ScriptsSource = '' Ref="1">`,
      `<ScriptsSource />`,
      `<ScriptsSource/>text`,
      `<ScriptsSource>  </ScriptsSource>`,
      `<Scripts Ref="5" />`,
      `<Item1 Text="ScriptsSource='x'" />`,
      // Words in another attribute's value, and in a text (the review of R5-02).
      `<Item1 Text="see ScriptsSource='x'" />`,
      `<Item1 Name="a" Text='see ScriptsSource="x"' />`,
      `<Text>see ScriptsSource="x"</Text>`,
    ]) {
      expect(hasReportScripts(plain), plain).toBe(false);
    }
  });

  /**
   * Forma Designer asks the same question before it opens a file, and must
   * ask it the same way, or it opens one with code without offering the
   * choice. Its pattern is a C# string literal; read back, it is this one.
   */
  it('is asked in Forma Designer with the same pattern', () => {
    const program = readFileSync('tools/RepxDesigner/Program.cs', 'utf8');
    const literal = /Regex\.IsMatch\(File\.ReadAllText\(path\), "((?:[^"\\]|\\.)*)"\)/.exec(program)?.[1];
    expect(literal).toBeDefined();
    expect(literal!.replace(/\\(.)/g, '$1')).toBe(REPORT_SCRIPTS_PATTERN);
  });
});

describe('links', () => {
  it('builds /s/{id} and reads the id back off a path, and nothing else', () => {
    expect(shareLink('https://forma.example/', 'Sh4r3dR3p0rtIdOfTwentyTwo')).toBe('https://forma.example/s/Sh4r3dR3p0rtIdOfTwentyTwo');
    expect(sharedReportId('/s/Sh4r3dR3p0rtIdOfTwentyTwo')).toBe('Sh4r3dR3p0rtIdOfTwentyTwo');
    expect(sharedReportId('/s/short')).toBeNull();
    expect(sharedReportId('/s/has.dots.in.it.at.all.yes')).toBeNull();
    expect(sharedReportId('/workspace')).toBeNull();
  });
});
