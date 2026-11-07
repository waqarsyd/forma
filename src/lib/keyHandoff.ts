/**
 * A new tab gets the keys from a Forma tab already open (2026-11-08, site
 * audit item 105). The keys live in session storage, which is one tab's: open
 * Forma in a second tab and it asked for the key again, as no big site makes
 * anyone do. A `BroadcastChannel` reaches only this site's other tabs in this
 * browser: a tab with no key asks, and a tab that has one answers. The
 * guarantee the key's storage was chosen for still holds: it is never written
 * to disk, and when the last Forma tab closes it is gone.
 *
 * On by default, as the big sites keep you signed in across tabs; Settings,
 * under Gemini key, turns it off, and then a tab neither asks nor answers.
 */
export interface Keys {
  gemini?: string;
  openRouter?: string;
}

type Message = { type: 'forma-keys-ask' } | ({ type: 'forma-keys-give' } & Keys);

/** The part of a BroadcastChannel this uses, so a test can stand in for it. */
export interface ChannelLike {
  postMessage(message: unknown): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  close(): void;
}

export const KEY_CHANNEL = 'forma-keys';
export const KEY_ACROSS_TABS_SETTING = 'forma:keyAcrossTabs';

/** Whether tabs share the keys: on unless turned off. */
export function keysAcrossTabs(storage: Pick<Storage, 'getItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): boolean {
  try {
    return storage?.getItem(KEY_ACROSS_TABS_SETTING) !== 'off';
  } catch {
    return true;
  }
}

export function setKeysAcrossTabs(on: boolean, storage: Pick<Storage, 'setItem' | 'removeItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): void {
  try {
    if (on) storage?.removeItem(KEY_ACROSS_TABS_SETTING);
    else storage?.setItem(KEY_ACROSS_TABS_SETTING, 'off');
  } catch {
    /* storage blocked: the default holds */
  }
}

/**
 * Join the tabs: answer a tab that asks while this one has a key, and ask
 * once now if this one has none. `onKeys` is given what another tab answered;
 * the caller keeps a key it already has. Returns the leave function.
 */
export function startKeyHandoff(opts: {
  getKeys: () => Keys;
  onKeys: (keys: Keys) => void;
  enabled?: () => boolean;
  open?: () => ChannelLike | null;
}): () => void {
  const enabled = opts.enabled ?? (() => keysAcrossTabs());
  const open = opts.open ?? (() => (typeof BroadcastChannel === 'undefined' ? null : (new BroadcastChannel(KEY_CHANNEL) as unknown as ChannelLike)));
  const channel = open();
  if (!channel) return () => {};
  channel.onmessage = (event) => {
    if (!enabled()) return;
    const message = event.data as Message | null;
    if (message?.type === 'forma-keys-ask') {
      const keys = opts.getKeys();
      if (keys.gemini || keys.openRouter) channel.postMessage({ type: 'forma-keys-give', gemini: keys.gemini || undefined, openRouter: keys.openRouter || undefined });
    } else if (message?.type === 'forma-keys-give') {
      const gemini = typeof message.gemini === 'string' ? message.gemini : undefined;
      const openRouter = typeof message.openRouter === 'string' ? message.openRouter : undefined;
      if (gemini || openRouter) opts.onKeys({ gemini, openRouter });
    }
  };
  if (enabled() && !opts.getKeys().gemini) channel.postMessage({ type: 'forma-keys-ask' });
  return () => channel.close();
}
