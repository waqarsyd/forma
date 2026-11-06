// @vitest-environment jsdom
/**
 * A shared report opened from its link (2026-11-06): shown with its name and
 * its .repx when the rules let this person read it, and otherwise a page
 * saying what to try, which differs signed in and signed out. Firebase and
 * the Preview are stand-ins; the emulator suite proves the rules.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';

const getDoc = vi.fn();
vi.mock('../lib/firebaseClient', () => ({
  loadFirebase: () => Promise.resolve({ sdk: { getDoc }, paths: { shareDocRef: (_db: unknown, id: string) => `shares/${id}` }, db: {} }),
}));
vi.mock('./ReportPreview', () => ({ default: ({ title }: { title?: string }) => <div data-testid="preview">{title}</div> }));

import SharedReportPage from './SharedReportPage';

afterEach(cleanup);
// A body, not an expression: a function returned from beforeEach is run as a
// teardown, and mockReset returns the mock, which then rejected after the test.
beforeEach(() => {
  getDoc.mockReset();
});

const page = (user: { uid: string; email: string | null } | null = null) =>
  render(<SharedReportPage id="Sh4r3dR3p0rtIdOfTwentyTwo" user={user} onSignIn={vi.fn()} onHome={vi.fn()} />);

describe('SharedReportPage', () => {
  it('shows the report, its name and its download when it may be read', async () => {
    getDoc.mockResolvedValue({ data: () => ({ name: 'Invoice', result: '{"title":"Invoice","repxContent":"<x/>"}' }) });
    page();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Invoice' })).toBeTruthy());
    expect(screen.getByRole('button', { name: /Download \.repx/ })).toBeTruthy();
    expect((await screen.findByTestId('preview')).textContent).toBe('Invoice');
  });

  it('asks a signed-out visitor to sign in when the rules refuse, and names the account when signed in', async () => {
    getDoc.mockRejectedValue(Object.assign(new Error('denied'), { code: 'permission-denied' }));
    page();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'This link does not open a report for you' })).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy();
    cleanup();
    page({ uid: 'bob', email: 'bob@example.com' });
    await waitFor(() => expect(screen.getByText(/signed in as bob@example.com/)).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull();
  });
});
