/** A shared report's copy, link and invitees (2026-11-06), as firestore.rules pins them. */
import { describe, it, expect } from 'vitest';
import { MAX_INVITED, isEmail, makeShareId, normaliseEmail, readSharedReport, shareDocument, shareLink, withInvitee } from './shares';
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

describe('links', () => {
  it('builds /s/{id} and reads the id back off a path, and nothing else', () => {
    expect(shareLink('https://forma.example/', 'Sh4r3dR3p0rtIdOfTwentyTwo')).toBe('https://forma.example/s/Sh4r3dR3p0rtIdOfTwentyTwo');
    expect(sharedReportId('/s/Sh4r3dR3p0rtIdOfTwentyTwo')).toBe('Sh4r3dR3p0rtIdOfTwentyTwo');
    expect(sharedReportId('/s/short')).toBeNull();
    expect(sharedReportId('/s/has.dots.in.it.at.all.yes')).toBeNull();
    expect(sharedReportId('/workspace')).toBeNull();
  });
});
