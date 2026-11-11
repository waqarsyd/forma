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
const state = vi.hoisted(() => ({ firestoreLoads: 0, accountDataLoads: 0, appCheckLoads: 0, appCheckApps: [] as unknown[] }));

vi.mock('../services/firebase', () => ({ app: { name: 'test-app' }, firestoreDatabaseId: 'test-db' }));
/* App Check, on since the owner's reCAPTCHA key (2026-11-08): started once,
   on the auth client's app, and only on the way to the database. */
vi.mock('firebase/app-check', () => {
  state.appCheckLoads++;
  return {
    initializeAppCheck: vi.fn((app: unknown) => {
      state.appCheckApps.push(app);
    }),
    // The Enterprise provider since the owner registered the app with it (2026-11-08).
    ReCaptchaEnterpriseProvider: class {
      constructor(readonly siteKey: string) {}
    },
  };
});
vi.mock('firebase/firestore', () => {
  state.firestoreLoads++;
  return { getFirestore: vi.fn((app: unknown, id: string) => ({ app, id })) };
});
vi.mock('./accountData', () => {
  state.accountDataLoads++;
  return { vaultDocRef: vi.fn() };
});

describe('firebaseClient', () => {
  /*
   * One case, in order, on purpose (2026-11-11, the full audit, TC-06). The
   * counters above and the module cache are shared by the whole file, so as
   * two cases the first held only while it ran first: under
   * `--sequence.shuffle` seeds 1, 2, 3 and 11 ran the database case first and
   * failed the auth case on a Firestore load that had already happened. The
   * order is the claim being tested: auth alone loads nothing else, and the
   * database comes after it, from the same app.
   */
  it('loads auth without Firestore or the path builders, then opens the database from the same app', async () => {
    const { loadAuth, loadFirebase } = await import('./firebaseClient');
    const auth = await loadAuth();
    expect(auth.service.app).toEqual({ name: 'test-app' });
    expect(state.firestoreLoads).toBe(0);
    expect(state.accountDataLoads).toBe(0);
    // A signed-out reader never loads reCAPTCHA.
    expect(state.appCheckLoads).toBe(0);
    expect(await loadAuth()).toBe(auth);

    const client = await loadFirebase();
    expect(client.service).toBe(auth.service);
    expect(client.db).toEqual({ app: { name: 'test-app' }, id: 'test-db' });
    expect(state.firestoreLoads).toBe(1);
    expect(state.accountDataLoads).toBe(1);
    expect(await loadFirebase()).toBe(client);
    expect(state.appCheckApps).toEqual([{ name: 'test-app' }]);
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
