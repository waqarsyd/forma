/**
 * Asking the browser to keep this site's storage (2026-11-08, site audit item
 * 60). Signed out, projects live in local storage, which a browser may clear
 * under storage pressure, and Safari clears a site's script-written storage
 * after seven days without a visit. `navigator.storage.persist()` asks for it
 * to be kept until the person clears it: Chrome and Edge decide on their own
 * (a site you use and bookmark is granted), Firefox asks the person, and
 * Safari keeps it for an installed web app.
 *
 * Asked once a session, when a project is first saved on this device, which
 * is when there is something worth keeping, as the big web apps ask.
 */
type StorageManagerLike = { persist?: () => Promise<boolean>; persisted?: () => Promise<boolean> };

let asked: Promise<boolean> | null = null;

function manager(): StorageManagerLike | null {
  return typeof navigator !== 'undefined' && navigator.storage ? (navigator.storage as StorageManagerLike) : null;
}

/** Ask once; true when the browser will keep it. */
export function askToKeepStorage(storage: StorageManagerLike | null = manager()): Promise<boolean> {
  if (!storage?.persist) return Promise.resolve(false);
  if (!asked) {
    asked = storage.persisted?.().then((already) => already || storage.persist!()).catch(() => false) ?? storage.persist().catch(() => false);
  }
  return asked;
}

/** Whether the browser has already agreed to keep it. */
export function isStorageKept(storage: StorageManagerLike | null = manager()): Promise<boolean> {
  return storage?.persisted ? storage.persisted().catch(() => false) : Promise.resolve(false);
}

/** For tests: forget that it was asked. */
export function forgetAsked(): void {
  asked = null;
}
