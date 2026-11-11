/**
 * A project deleted from the list, with a moment to take it back (2026-11-11,
 * the full audit's WS-03 and WS-27).
 *
 * The trash on a project's row deleted it for good on one click: the project,
 * its version history and its shared links, with nothing asked, right beside
 * Archive and Duplicate, and on a touch screen always showing. ChatGPT, Claude
 * and Gemini all give a delete a way back. So the row goes from the list at
 * once and the deletion itself waits `UNDO_DELETE_MS`, while a toast offers
 * Undo; Undo puts the row back and nothing was deleted.
 *
 * A tab closed in that moment leaves the project undeleted. That is the safe
 * side on purpose: deleting from `pagehide` would race the page going away,
 * and a project that survives a closed tab is a click to delete again, where
 * one deleted by accident is gone with its history.
 *
 * **The deletions run one after another, never side by side** (WS-27). Each
 * deletes the project's shares through `deleteShare`, which reads the account's
 * share count and writes it one lower in the same batch, and `firestore.rules`
 * lets the count move by exactly one per write. Two run at once both read the
 * same count, and the second write is refused: "Clear all" over two shared
 * projects failed one of them. `deleteAccountData` deletes one at a time for
 * the same reason.
 */

export const UNDO_DELETE_MS = 6000;

export interface DeferredDeletes {
  /** Holds `ids` back from the list now, and deletes them once the wait is over. */
  schedule(ids: readonly string[]): void;
  /** Takes a waiting deletion back; true when any of `ids` was still waiting. */
  undo(ids: readonly string[]): boolean;
  /** Runs every waiting deletion now, resolving when all have run (the person's own sign-out). */
  flush(): Promise<void>;
  /** The ids waiting to be deleted. */
  pending(): string[];
}

/**
 * @param run      deletes one project; it reports its own failure, and one that
 *                 throws anyway does not stop the next.
 * @param onChange told the ids to hide whenever they change: those waiting and
 *                 those whose deletion is still under way.
 */
export function deferDeletes(
  run: (id: string) => Promise<void>,
  onChange: (pending: string[]) => void,
  wait = UNDO_DELETE_MS,
): DeferredDeletes {
  /** Each waiting id, with the timer that will delete it. */
  const waiting = new Map<string, ReturnType<typeof setTimeout>>();
  /**
   * Ids past the wait whose deletion has not settled yet. They stay hidden
   * until it has: a signed-in delete reads the shares and the versions before
   * it removes the index entry the list is drawn from, so a row let go when
   * the wait ended came back for those round trips, and a Clear all brought
   * every row back at once and took them away one by one. Undo and `pending()`
   * do not see them, since a deletion under way cannot be taken back. A failed
   * one comes back to the list, which its error says.
   */
  const running = new Set<string>();
  let chain: Promise<void> = Promise.resolve();
  const changed = () => onChange([...waiting.keys(), ...running]);
  /** Out of the waiting list, and onto the end of the one line of deletions. */
  const start = (ids: readonly string[]): Promise<void> => {
    for (const id of ids) {
      waiting.delete(id);
      running.add(id);
    }
    changed();
    chain = chain.then(async () => {
      for (const id of ids) {
        await run(id).catch(() => undefined);
        running.delete(id);
        changed();
      }
    });
    return chain;
  };
  return {
    schedule(ids) {
      const fresh = ids.filter((id) => !waiting.has(id) && !running.has(id));
      if (!fresh.length) return;
      // One timer for the group; when it fires it deletes those of the group
      // still waiting on it, so an Undo of some leaves the rest to go.
      const timer = setTimeout(() => void start(fresh.filter((id) => waiting.get(id) === timer)), wait);
      for (const id of fresh) waiting.set(id, timer);
      changed();
    },
    undo(ids) {
      let any = false;
      for (const id of ids) any = waiting.delete(id) || any;
      if (any) changed();
      return any;
    },
    flush() {
      const ids = [...waiting.keys()];
      return ids.length ? start(ids) : chain;
    },
    pending: () => [...waiting.keys()],
  };
}

/**
 * The person's own sign-out, in order (2026-11-11, the full audit's WS-18):
 * what they changed last is kept, the deletions they asked for are made while
 * the account can still make them, and only then are they signed out and the
 * browser cleared. A sign-out dropped the last change, which the drop rule is
 * right to do for a sign-out made somewhere else, and not for one's own. A
 * save that fails does not hold the sign-out: on a shared browser leaving is
 * what matters, and the save has said why it failed.
 */
export async function signOutKeeping(steps: {
  keep: () => Promise<unknown>;
  logOut: () => Promise<void>;
  forget: () => void;
}): Promise<void> {
  await steps.keep().catch(() => undefined);
  try {
    await steps.logOut();
  } catch (err) {
    console.error(err);
  }
  steps.forget();
}
