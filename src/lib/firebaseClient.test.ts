import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

/*
 * The split between `loadAuth` and `loadFirebase` (2026-11-01) is what keeps
 * the 449 kB Firestore chunk away from every visitor who is not signed in.
 * It fails quietly: a static import of `firebase/firestore` back into
 * `services/firebase.ts` puts the database in front of every page again,
 * and no size budget notices, because the bytes stay in their own chunk and
 * only the order they load in changes. So the loaders are checked against
 * mocks, and the imports that would undo them against the source.
 */
const state = vi.hoisted(() => ({ firestoreLoads: 0, accountDataLoads: 0 }));

vi.mock('../services/firebase', () => ({ app: { name: 'test-app' }, firestoreDatabaseId: 'test-db' }));
vi.mock('firebase/firestore', () => {
  state.firestoreLoads++;
  return { getFirestore: vi.fn((app: unknown, id: string) => ({ app, id })) };
});
vi.mock('./accountData', () => {
  state.accountDataLoads++;
  return { vaultDocRef: vi.fn() };
});

describe('firebaseClient', () => {
  it('loads auth without loading Firestore or the path builders', async () => {
    const { loadAuth } = await import('./firebaseClient');
    const client = await loadAuth();
    expect(client.service.app).toEqual({ name: 'test-app' });
    expect(state.firestoreLoads).toBe(0);
    expect(state.accountDataLoads).toBe(0);
    expect(await loadAuth()).toBe(client);
  });

  it('opens the database from the auth client’s app and the configured id', async () => {
    const { loadAuth, loadFirebase } = await import('./firebaseClient');
    const client = await loadFirebase();
    expect(client.service).toBe((await loadAuth()).service);
    expect(client.db).toEqual({ app: { name: 'test-app' }, id: 'test-db' });
    expect(state.firestoreLoads).toBe(1);
    expect(state.accountDataLoads).toBe(1);
    expect(await loadFirebase()).toBe(client);
  });

  const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
  /** A value import of `from`; `import type` is erased and therefore allowed. */
  const imports = (source: string, from: string) =>
    new RegExp(`^import\\s+(?!type\\b)[^;]*?from\\s+['"]${from.replace(/[./]/g, '\\$&')}['"]`, 'm').test(source);

  it('keeps Firestore out of the modules every page loads', () => {
    const service = read('src/services/firebase.ts');
    expect(imports(service, 'firebase/firestore')).toBe(false);
    expect(imports(service, '../lib/accountData')).toBe(false);
    const app = read('src/App.tsx');
    expect(imports(app, 'firebase/firestore')).toBe(false);
    expect(imports(app, './services/firebase')).toBe(false);
    expect(imports(app, './lib/accountData')).toBe(false);
  });

  it('would notice the import it guards against', () => {
    expect(imports("import { getFirestore } from 'firebase/firestore';", 'firebase/firestore')).toBe(true);
    expect(imports("import type { Firestore } from 'firebase/firestore';", 'firebase/firestore')).toBe(false);
  });
});
