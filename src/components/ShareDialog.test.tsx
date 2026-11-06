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
const paths = { ownedShares: vi.fn(() => 'query'), shareDocRef: vi.fn((_db: unknown, id: string) => `shares/${id}`) };
vi.mock('../lib/firebaseClient', () => ({ loadFirebase: () => Promise.resolve({ sdk, paths, db: {} }) }));

import ShareDialog from './ShareDialog';

afterEach(cleanup);
beforeEach(() => {
  sdk.getDocs.mockReset().mockResolvedValue({ docs: [] });
  sdk.setDoc.mockReset().mockResolvedValue(undefined);
  sdk.deleteDoc.mockReset().mockResolvedValue(undefined);
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
    expect(sdk.setDoc).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    await waitFor(() => expect(sdk.setDoc).toHaveBeenCalledTimes(1));
    const [, written] = sdk.setDoc.mock.calls[0];
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
    await waitFor(() => expect(sdk.setDoc).toHaveBeenCalledTimes(1));
    expect(sdk.setDoc.mock.calls[0][1]).toMatchObject({ id: existing.id, access: 'link' });
    fireEvent.click(screen.getByRole('button', { name: 'Stop sharing' }));
    await waitFor(() => expect(sdk.deleteDoc).toHaveBeenCalledWith(`shares/${existing.id}`));
    await waitFor(() => expect(screen.queryByLabelText('Link to the shared report')).toBeNull());
  });

  // The workspace audit, 2026-11-06: a removal that failed showed the person
  // gone while the share still let them in.
  it('puts a person back when their removal could not be written', async () => {
    const existing = { id: 'Sh4r3dR3p0rtIdOfTwentyTwo', ownerId: 'alice', reportId: 'r1', name: 'Invoice', result: '{}', access: 'restricted', emails: ['bob@example.com'], timestamp: 1_790_000_000_000 };
    sdk.getDocs.mockResolvedValue({ docs: [{ data: () => existing }] });
    sdk.setDoc.mockRejectedValue(new Error('offline'));
    const p = props();
    render(<ShareDialog {...p} />);
    await waitFor(() => expect(screen.getByText('bob@example.com')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Remove bob@example.com' }));
    await waitFor(() => expect(p.onFailure).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText('bob@example.com')).toBeTruthy());
  });

  it('says when what was typed is not an address', async () => {
    render(<ShareDialog {...props()} />);
    await waitFor(() => expect(screen.getByLabelText('Add people by email')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Add people by email'), { target: { value: 'bob at example' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByRole('alert').textContent).toContain('does not look like an email address');
  });
});
