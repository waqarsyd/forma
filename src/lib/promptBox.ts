/**
 * The words in the message box, held outside React state (2026-11-11, the
 * full audit's PR-05, built in batch BW2).
 *
 * The box's text was App's state, so every key pressed drew the whole
 * workspace again: App and every pane it holds, several thousand lines of
 * render, once per character. Now the text lives here and the composer reads
 * it (`usePromptText`), so typing draws the composer alone. App holds the box
 * and reads or sets it through this handle where it needs the words: what is
 * sent, a project's unsent draft, a starting point or "Edit text" put in the
 * box, the box cleared after a send.
 */
import { useSyncExternalStore } from 'react';

export interface PromptBox {
  /** The words in the box now. */
  get(): string;
  /** New words, or a change of the words there, as a state setter takes them. */
  set(next: string | ((typed: string) => string)): void;
  /** Words put in for the person to finish: after what is typed, on a line of their own. */
  insert(text: string): void;
  clear(): void;
  /** Called after each change; returns the way to stop. */
  subscribe(listener: () => void): () => void;
}

export function createPromptBox(initial = ''): PromptBox {
  let text = initial;
  const listeners = new Set<() => void>();
  const box: PromptBox = {
    get: () => text,
    set: (next) => {
      const value = typeof next === 'function' ? next(text) : next;
      if (value === text) return;
      text = value;
      for (const listener of [...listeners]) listener();
    },
    insert: (words) => box.set((typed) => (typed.trim() ? `${typed.replace(/\s+$/, '')}\n${words}` : words)),
    clear: () => box.set(''),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return box;
}

/** The box's words, drawn again when they change: the composer's, and only the composer's. */
export function usePromptText(box: PromptBox): string {
  return useSyncExternalStore(box.subscribe, box.get, box.get);
}
