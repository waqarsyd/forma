// @vitest-environment jsdom
/**
 * The Learning section of Settings (2026-11-11, the full audit, LM-01, SA-13
 * and LM-30): signed in, the switches are the account's and the section says
 * how many events the account holds. jsdom for localStorage, and it has no
 * IndexedDB, so what this browser kept reads as nothing; Firebase is a
 * stand-in, and what the rules allow is proved in tests/firestore.rules.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

const paths = {
  countLearning: vi.fn(),
  readLearningPrefs: vi.fn(),
  writeLearningPrefs: vi.fn(),
  deleteLearning: vi.fn(),
};
vi.mock('../lib/firebaseClient', () => ({ loadFirebase: () => Promise.resolve({ paths, db: {} }) }));

import LearningSettings, { COUNT_LEFT } from './LearningSettings';
import { readDeviceLearning, writeLearningSettings } from '../lib/learning';

beforeEach(() => {
  paths.countLearning.mockReset().mockResolvedValue(7);
  paths.readLearningPrefs.mockReset().mockResolvedValue(null);
  paths.writeLearningPrefs.mockReset().mockResolvedValue(undefined);
  paths.deleteLearning.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

const fullSwitch = () => screen.getByRole('switch', { name: 'Share whole reports and what I asked for' }) as HTMLInputElement;
const structureSwitch = () => screen.getByRole('switch', { name: 'Help Forma learn from the shape of my reports' }) as HTMLInputElement;

describe('LearningSettings', () => {
  it('says how many events the account holds, and that the switches follow it', async () => {
    render(<LearningSettings user={{ uid: 'alice' }} />);
    await waitFor(() => expect(screen.getByText(/7 events shared from your account\./)).toBeTruthy());
    expect(screen.getByText('Applies to your account on every device.')).toBeTruthy();
    expect(paths.countLearning).toHaveBeenCalledWith({}, 'alice');
  });

  // BW2 (2026-11-11): what deleting the account leaves of learning, said signed in only.
  it('says what account deletion leaves, signed in and not signed out', async () => {
    render(<LearningSettings user={{ uid: 'alice' }} />);
    await waitFor(() => expect(screen.getByText(/7 events shared/)).toBeTruthy());
    expect(document.body.textContent).toContain(COUNT_LEFT);
    expect(COUNT_LEFT).toMatch(/no projects, how many of each were sent that day and when the last one was, and no ids/);
    cleanup();
    render(<LearningSettings user={null} />);
    await waitFor(() => expect(screen.getByText(/Nothing kept on this device\./)).toBeTruthy());
    expect(document.body.textContent).not.toContain(COUNT_LEFT);
  });

  it('counts nothing signed out, and says nothing of an account', async () => {
    render(<LearningSettings user={null} />);
    await waitFor(() => expect(screen.getByText(/Nothing kept on this device\./)).toBeTruthy());
    expect(screen.queryByText(/shared from your account/)).toBeNull();
    expect(screen.queryByText('Applies to your account on every device.')).toBeNull();
    expect(paths.countLearning).not.toHaveBeenCalled();
  });

  it('shows the account\'s switches, not the ones the last person left in this browser', async () => {
    writeLearningSettings({ structure: true, full: true }, 'bob');
    paths.readLearningPrefs.mockResolvedValue({ structure: false, full: false });
    render(<LearningSettings user={{ uid: 'alice' }} />);
    expect(fullSwitch().checked).toBe(false);
    await waitFor(() => expect(structureSwitch().checked).toBe(false));
    expect(readDeviceLearning('alice')).toEqual({ settings: { structure: false, full: false }, pending: false });
  });

  it('writes a change to the account, and keeps it here as not yet sent when the account cannot take it', async () => {
    render(<LearningSettings user={{ uid: 'alice' }} />);
    await waitFor(() => expect(screen.getByText(/7 events shared/)).toBeTruthy());
    fireEvent.click(fullSwitch());
    await waitFor(() => expect(paths.writeLearningPrefs).toHaveBeenCalledWith({}, 'alice', { structure: true, full: true }));
    await waitFor(() => expect(readDeviceLearning('alice').pending).toBe(false));

    paths.writeLearningPrefs.mockRejectedValue(new Error('offline'));
    fireEvent.click(structureSwitch());
    await waitFor(() => expect(screen.getByText(/Your account could not be updated just now/)).toBeTruthy());
    expect(readDeviceLearning('alice')).toEqual({ settings: { structure: false, full: true }, pending: true });
  });

  // The PRIV review (2026-11-11): the account's copy, read on opening, arriving after a change was
  // made and confirmed, must not write the old values back over it.
  it('keeps a change made before the account\'s copy arrives', async () => {
    let answer: (v: { structure: boolean; full: boolean }) => void = () => undefined;
    paths.readLearningPrefs.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    render(<LearningSettings user={{ uid: 'alice' }} />);
    fireEvent.click(fullSwitch());
    await waitFor(() => expect(readDeviceLearning('alice')).toEqual({ settings: { structure: true, full: true }, pending: false }));
    answer({ structure: true, full: false });
    await waitFor(() => expect(screen.getByText(/7 events shared/)).toBeTruthy());
    expect(fullSwitch().checked).toBe(true);
    expect(readDeviceLearning('alice')).toEqual({ settings: { structure: true, full: true }, pending: false });
  });
});
