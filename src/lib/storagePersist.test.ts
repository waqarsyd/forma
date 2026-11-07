/**
 * Asking the browser to keep local projects, item 60 (2026-11-08, the site audit's batch SI).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { askToKeepStorage, forgetAsked, isStorageKept } from './storagePersist';

describe('askToKeepStorage', () => {
  beforeEach(() => forgetAsked());

  it('asks once, and not when the browser already keeps it', async () => {
    const persist = vi.fn().mockResolvedValue(true);
    const storage = { persist, persisted: vi.fn().mockResolvedValue(false) };
    expect(await askToKeepStorage(storage)).toBe(true);
    expect(await askToKeepStorage(storage)).toBe(true);
    expect(persist).toHaveBeenCalledTimes(1);
    forgetAsked();
    const kept = { persist: vi.fn(), persisted: vi.fn().mockResolvedValue(true) };
    expect(await askToKeepStorage(kept)).toBe(true);
    expect(kept.persist).not.toHaveBeenCalled();
  });

  it('says no where the browser has no such thing', async () => {
    expect(await askToKeepStorage(null)).toBe(false);
    expect(await isStorageKept(null)).toBe(false);
  });
});
