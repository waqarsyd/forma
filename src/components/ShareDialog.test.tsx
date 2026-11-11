// @vitest-environment jsdom
/**
 * Sharing a report (2026-11-06), as Stitch's dialog: signed out it asks for
 * sign-in; signed in it writes the shared copy the rules pin, changes who may
 * open it, and stops sharing. Firebase is replaced by a stand-in, since what
 * the rules allow is the emulator suite's to prove (tests/firestore.rules).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

const sdk = { getDocs: vi.fn(), setDoc: vi.fn(), deleteDoc: vi.fn() };
// The counted writes since 2026-11-08 (site audit item 57, lib/accountData.ts),
// and the invitees read from the share's access list since 2026-11-11 (SE-04).
const paths = {
  ownedShares: vi.fn(() => 'query'),
  shareDocRef: vi.fn((_db: unknown, id: string) => `shares/${id}`),
  writeShare: vi.fn(),
  deleteShare: vi.fn(),
  readShareEmails: vi.fn(async (_db: unknown, share: { emails?: unknown }) => (Array.isArray(share.emails) ? share.emails : [])),
};
// The verification as the rules see it (2026-11-11, SA-08): false unless a case says otherwise.
const service = { refreshVerification: vi.fn() };
vi.mock('../lib/firebaseClient', () => ({ loadFirebase: () => Promise.resolve({ sdk, paths, db: {}, service }) }));

import ShareDialog from './ShareDialog';

afterEach(cleanup);
beforeEach(() => {
  sdk.getDocs.mockReset().mockResolvedValue({ docs: [] });
  sdk.setDoc.mockReset().mockResolvedValue(undefined);
  sdk.deleteDoc.mockReset().mockResolvedValue(undefined);
  paths.writeShare.mockReset().mockResolvedValue(undefined);
  paths.deleteShare.mockReset().mockResolvedValue(undefined);
  service.refreshVerification.mockReset().mockResolvedValue(false);
});

const props = (over: Partial<React.ComponentProps<typeof ShareDialog>> = {}) => ({
  user: { uid: 'alice', email: 'alice@example.com' },
  name: 'Invoice',
  report: { title: 'Invoice', repxContent: '<x/>' },
  ensureSaved: vi.fn().mockResolvedValue('r1'),
  onSignIn: vi.fn(),
  onNotice: vi.fn(),
  onFailure: vi.fn(),
  onClose: vi.fn(),
  ...over,
});

describe('ShareDialog', () => {
  it('asks a signed-out person to sign in, and writes nothing', () => {
    const p = props({ user: null });
    render(<ShareDialog {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(p.onSignIn).toHaveBeenCalled();
    expect(p.ensureSaved).not.toHaveBeenCalled();
  });

  it('saves the project first, then shares a restricted copy with the people added', async () => {
    const p = props();
    render(<ShareDialog {...p} />);
    await waitFor(() => expect(screen.getByLabelText('Add people by email')).toBeTruthy());
    expect(p.ensureSaved).toHaveBeenCalled();
    expect(paths.ownedShares).toHaveBeenCalledWith({}, 'alice', 'r1');
    fireEvent.change(screen.getByLabelText('Add people by email'), { target: { value: ' Bob@Example.com ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByText('bob@example.com')).toBeTruthy();
    expect(paths.writeShare).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    await waitFor(() => expect(paths.writeShare).toHaveBeenCalledTimes(1));
    const [, uid, written, isNew] = paths.writeShare.mock.calls[0];
    expect(uid).toBe('alice');
    expect(isNew).toBe(true);
    expect(written).toMatchObject({ ownerId: 'alice', reportId: 'r1', name: 'Invoice', access: 'restricted', emails: ['bob@example.com'] });
    expect(written.id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    await waitFor(() => expect((screen.getByLabelText('Link to the shared report') as HTMLInputElement).value).toContain(`/s/${written.id}`));
    expect(p.onNotice).toHaveBeenCalledWith('Shared');
  });

  it('opens on an existing share, changes its access at once, and stops sharing', async () => {
    const existing = { id: 'Sh4r3dR3p0rtIdOfTwentyTwo', ownerId: 'alice', reportId: 'r1', name: 'Invoice', result: '{}', access: 'restricted', emails: [], timestamp: 1_790_000_000_000 };
    sdk.getDocs.mockResolvedValue({ docs: [{ data: () => existing }] });
    const p = props();
    render(<ShareDialog {...p} />);
    await waitFor(() => expect(screen.getByLabelText('Link to the shared report')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('General access'), { target: { value: 'link' } });
    await waitFor(() => expect(paths.writeShare).toHaveBeenCalledTimes(1));
    expect(paths.writeShare.mock.calls[0][2]).toMatchObject({ id: existing.id, access: 'link' });
    expect(paths.writeShare.mock.calls[0][3]).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Stop sharing' }));
    await waitFor(() => expect(paths.deleteShare).toHaveBeenCalledWith({}, 'alice', existing.id));
    await waitFor(() => expect(screen.queryByLabelText('Link to the shared report')).toBeNull());
  });

  // The workspace audit, 2026-11-06: a removal that failed showed the person
  // gone while the share still let them in.
  it('puts a person back when their removal could not be written', async () => {
    const existing = { id: 'Sh4r3dR3p0rtIdOfTwentyTwo', ownerId: 'alice', reportId: 'r1', name: 'Invoice', result: '{}', access: 'restricted', emails: ['bob@example.com'], timestamp: 1_790_000_000_000 };
    sdk.getDocs.mockResolvedValue({ docs: [{ data: () => existing }] });
    paths.writeShare.mockRejectedValue(new Error('offline'));
    const p = props();
    render(<ShareDialog {...p} />);
    await waitFor(() => expect(screen.getByText('bob@example.com')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Remove bob@example.com' }));
    await waitFor(() => expect(p.onFailure).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText('bob@example.com')).toBeTruthy());
  });

  // Site audit item 57 (2026-11-08): a verified address to share, and a cap.
  it('asks an unverified account to verify its address first, and writes nothing', async () => {
    render(<ShareDialog {...props({ user: { uid: 'alice', email: 'alice@example.com', emailVerified: false } })} />);
    await waitFor(() => expect(screen.getByText(/Verify your email address to share a report/)).toBeTruthy());
    expect(screen.queryByLabelText('Add people by email')).toBeNull();
    expect(paths.writeShare).not.toHaveBeenCalled();
  });

  // The full audit, 2026-11-11 (SA-08): the link clicked in another tab used
  // to leave this saying "verify" until a reload, and the rules refusing the
  // share for up to an hour after it.
  it('opens the share form once the address is verified elsewhere, when the window regains focus', async () => {
    render(<ShareDialog {...props({ user: { uid: 'alice', email: 'alice@example.com', emailVerified: false } })} />);
    await waitFor(() => expect(service.refreshVerification).toHaveBeenCalledTimes(1));
    expect(screen.getByText(/Verify your email address to share a report/)).toBeTruthy();
    service.refreshVerification.mockResolvedValue(true);
    fireEvent.focus(window);
    await waitFor(() => expect(screen.getByLabelText('Add people by email')).toBeTruthy());
    expect(screen.queryByText(/Verify your email address/)).toBeNull();
  });

  it("checks again on I've verified it, and says so when it still is not", async () => {
    render(<ShareDialog {...props({ user: { uid: 'alice', email: 'alice@example.com', emailVerified: false } })} />);
    await waitFor(() => expect(service.refreshVerification).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: "I've verified it" }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('not verified yet'));
    service.refreshVerification.mockResolvedValue(true);
    fireEvent.click(screen.getByRole('button', { name: "I've verified it" }));
    await waitFor(() => expect(screen.getByLabelText('Add people by email')).toBeTruthy());
  });

  it('reads the invitees from the access list, not from the share everyone may read', async () => {
    const existing = { id: 'Sh4r3dR3p0rtIdOfTwentyTwo', ownerId: 'alice', reportId: 'r1', name: 'Invoice', result: '{}', access: 'restricted', timestamp: 1_790_000_000_000 };
    sdk.getDocs.mockResolvedValue({ docs: [{ data: () => existing }] });
    paths.readShareEmails.mockResolvedValueOnce(['carol@example.com']);
    render(<ShareDialog {...props()} />);
    await waitFor(() => expect(screen.getByText('carol@example.com')).toBeTruthy());
    expect(paths.readShareEmails).toHaveBeenCalledWith({}, existing);
  });

  it('says when the account has shared as many reports as it may', async () => {
    const limit = Object.assign(new Error('An account can share up to 100 reports at once. Stop sharing one to share another.'), { name: 'ShareLimitError' });
    paths.writeShare.mockRejectedValue(limit);
    const p = props();
    render(<ShareDialog {...p} />);
    await waitFor(() => expect(screen.getByLabelText('Add people by email')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('up to 100 reports'));
    expect(p.onFailure).not.toHaveBeenCalled();
  });

  it('says when what was typed is not an address', async () => {
    render(<ShareDialog {...props()} />);
    await waitFor(() => expect(screen.getByLabelText('Add people by email')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Add people by email'), { target: { value: 'bob at example' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByRole('alert').textContent).toContain('does not look like an email address');
  });
});
