// @vitest-environment jsdom
/**
 * Settings as ChatGPT's (2026-11-07): sections on the left, one at a time on
 * the right, and a change that takes effect as it is made, with no Save and
 * no Cancel. What cannot be undone by changing it back asks first. Firebase
 * and the Gemini client are stand-ins; the key check and what the rules allow
 * are proved where they live (geminiService, tests/firestore.rules).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';

const sdk = { getDoc: vi.fn(), setDoc: vi.fn(), deleteDoc: vi.fn() };
const paths = { vaultDocRef: vi.fn((_db: unknown, uid: string) => `users/${uid}/vault`) };
vi.mock('../lib/firebaseClient', () => ({ loadFirebase: () => Promise.resolve({ sdk, paths, db: {} }) }));
vi.mock('../lib/geminiClient', () => ({
  loadGemini: () => Promise.resolve({ validateApiKey: vi.fn().mockResolvedValue({ valid: true, message: 'That key works.' }) }),
}));
// A secure context, so the encrypted copy is offered whatever jsdom provides.
vi.mock('../services/keyVault', async (actual) => ({ ...(await actual<typeof import('../services/keyVault')>()), isVaultAvailable: () => true }));

import SettingsDialog from './SettingsDialog';
import { memoryFrom, readMemory, writeMemory } from '../lib/memory';

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
});
beforeEach(() => {
  sdk.getDoc.mockReset().mockResolvedValue({ exists: () => false, data: () => undefined });
  sdk.setDoc.mockReset().mockResolvedValue(undefined);
  sdk.deleteDoc.mockReset().mockResolvedValue(undefined);
});

const props = (over: Partial<React.ComponentProps<typeof SettingsDialog>> = {}) => ({
  config: { version: '23.2', unit: 'HundredthsOfAnInch', pageSize: 'Letter', customApiKey: 'AIza-test' } as React.ComponentProps<typeof SettingsDialog>['config'],
  onChange: vi.fn(),
  user: null,
  workedOut: null,
  onClose: vi.fn(),
  ...over,
});
const tab = (name: string) => screen.getByRole('tab', { name });
const heading = () => screen.getByRole('tabpanel').querySelector('h3')?.textContent;

describe('SettingsDialog', () => {
  it('opens at the Gemini key while there is none, and at General once there is', () => {
    render(<SettingsDialog {...props({ config: { ...props().config, customApiKey: '' } })} />);
    expect(tab('Gemini key').getAttribute('aria-selected')).toBe('true');
    expect(heading()).toBe('Gemini key');
    cleanup();
    render(<SettingsDialog {...props()} />);
    expect(tab('General').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('Requests today')).toBeTruthy();
  });

  it('moves between sections by click and by the arrow keys, as a tab list', () => {
    render(<SettingsDialog {...props()} />);
    fireEvent.click(tab('AI'));
    expect(heading()).toBe('AI');
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowDown' });
    expect(heading()).toBe('Gemini key');
    expect(document.activeElement).toBe(tab('Gemini key'));
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'End' });
    // Learning is the last section since 2026-11-10 (the full audit).
    expect(heading()).toBe('Learning');
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowDown' });
    expect(heading()).toBe('General');
  });

  it('applies a choice as it is made, with no Save or Cancel to press', () => {
    const p = props();
    render(<SettingsDialog {...p} />);
    fireEvent.click(tab('AI'));
    fireEvent.click(screen.getByRole('radio', { name: 'Local AI' }));
    expect(p.onChange).toHaveBeenCalledWith({ provider: 'local' });
    expect(screen.queryByRole('button', { name: /save/i })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  });

  it('sends someone who chose another AI and has no Gemini key to the key', () => {
    render(<SettingsDialog {...props({ config: { ...props().config, customApiKey: '', provider: 'local' } })} />);
    fireEvent.click(tab('AI'));
    fireEvent.click(screen.getByRole('button', { name: 'Add it' }));
    expect(heading()).toBe('Gemini key');
  });

  it('checks the key, and clears it from the tab with a line that says so', async () => {
    const p = props();
    render(<SettingsDialog {...p} />);
    fireEvent.click(tab('Gemini key'));
    fireEvent.click(screen.getByRole('button', { name: 'Check key' }));
    expect(await screen.findByText('That key works.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(p.onChange).toHaveBeenCalledWith({ customApiKey: '' });
    expect(screen.getByText('Key cleared from this browser session.')).toBeTruthy();
  });

  it('asks before Forget everything, and Cancel keeps every memory', () => {
    writeMemory({ memories: [memoryFrom('Always use A4', 'settings')], kept: [], learnFromKept: true });
    render(<SettingsDialog {...props()} />);
    fireEvent.click(tab('Memory'));
    fireEvent.click(screen.getByRole('button', { name: 'Forget everything' }));
    const ask = screen.getByRole('alertdialog', { name: 'Forget everything?' });
    fireEvent.click(within(ask).getByRole('button', { name: 'Cancel' }));
    expect(readMemory().memories).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Forget everything' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Forget everything' }));
    expect(readMemory().memories).toHaveLength(0);
    expect(screen.getByText('Nothing remembered yet.')).toBeTruthy();
  });

  it('offers the encrypted copy signed in, and asks before forgetting a stored one', async () => {
    sdk.getDoc.mockResolvedValue({ exists: () => true, data: () => ({ v: 1 }) });
    render(<SettingsDialog {...props({ user: { uid: 'alice' } })} />);
    fireEvent.click(tab('Gemini key'));
    fireEvent.click(await screen.findByRole('button', { name: 'Forget stored key' }));
    expect(sdk.deleteDoc).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Forget stored key' }));
    await waitFor(() => expect(sdk.deleteDoc).toHaveBeenCalledWith('users/alice/vault'));
    expect(await screen.findByText('Stored key removed from your account.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Store encrypted' })).toBeTruthy();
  });

  it('closes from its button and from Escape', () => {
    const p = props();
    render(<SettingsDialog {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(p.onClose).toHaveBeenCalledTimes(2);
  });
});
