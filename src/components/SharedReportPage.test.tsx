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
    expect(screen.getByRole('banner').contains(screen.getByRole('button', { name: /Download \.repx/ }))).toBe(true);
    expect((await screen.findByTestId('preview')).textContent).toBe('Invoice');
    expect(screen.queryByText(/contains code/)).toBeNull();
    // It reads the share's document and nothing beneath it (SE-04): the
    // invitees' access list is its owner's alone.
    expect(getDoc).toHaveBeenCalledTimes(1);
    expect(getDoc).toHaveBeenCalledWith('shares/Sh4r3dR3p0rtIdOfTwentyTwo');
  });

  // The full audit, 2026-11-11 (SE-02): DevExpress runs a report's scripts
  // when it is previewed in a designer, and anyone verified can share one.
  it('says a shared report carries code before it is downloaded', async () => {
    const repx = '<XtraReportsLayoutSerializer ControlType="DevExpress.XtraReports.UI.XtraReport" ScriptsSource="private void x() {}" />';
    getDoc.mockResolvedValue({ data: () => ({ name: 'Invoice', result: JSON.stringify({ title: 'Invoice', repxContent: repx }) }) });
    page();
    await waitFor(() => expect(screen.getByText(/This report contains code that runs when it is previewed/)).toBeTruthy());
    const notice = screen.getByText(/Open it only if you trust whoever shared it/);
    // One download, and it comes after the notice in the page's order, so it
    // is never read or reached before the warning (it leaves the bar).
    const buttons = screen.getAllByRole('button', { name: /Download \.repx/ });
    expect(buttons).toHaveLength(1);
    expect(notice.compareDocumentPosition(buttons[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('banner').contains(buttons[0])).toBe(false);
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
