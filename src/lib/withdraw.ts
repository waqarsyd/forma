/**
 * What withdrawing a message takes back with it (2026-11-11, the full audit's
 * WS-41, moved out of App.tsx in batch BW2 so it has a test).
 *
 * Withdrawing a message drops it and Forma's answers from the thread, and
 * since WS-41 it also takes back the change those answers made to the report,
 * as the reply's own Undo would: the answer used to leave the thread while its
 * change stayed in the report, so the conversation no longer said why the
 * report looked as it did. Until this file the decision sat inline in App's
 * `handleWithdrawMessage`, and reverting it left every test green.
 *
 * The rules, each a function below:
 *
 * - **Which change** (`undoReplyOf`): the newest reply of the request that
 *   still carries an Undo. An older one was already taken back or overtaken;
 *   a request whose replies changed nothing undoes nothing.
 * - **How** (`howToUndo`): by the report's own Undo while that change is
 *   still the last thing the report's history holds, so Redo keeps working;
 *   otherwise by putting the report back as it was before the change, since
 *   a later change sits on top of it and the Undo would take that one instead.
 * - **What the question says** (`requestsThatUndo`): the requests whose
 *   withdrawal would undo something, so the panel asks "Withdraw this message
 *   and undo what Forma changed?" for those and its plain question otherwise.
 */

/** A request as the conversation groups it: the person's message and Forma's replies to it. */
export interface WithdrawRequest {
  id: string;
  replies: readonly { id: string }[];
}

/** The reply of request `id` whose change a withdrawal takes back, if any. */
export function undoReplyOf(requests: readonly WithdrawRequest[], id: string, undoable: ReadonlySet<string>): string | undefined {
  const replies = requests.find((r) => r.id === id)?.replies ?? [];
  for (let i = replies.length - 1; i >= 0; i--) if (undoable.has(replies[i].id)) return replies[i].id;
  return undefined;
}

/**
 * How the change is taken back: 'undo' when the report's newest past state is
 * the one the change started from (the change is still the last), else
 * 'restore', putting `before` back over whatever came after.
 */
export function howToUndo(changeBefore: string | undefined, lastPast: string | undefined): 'undo' | 'restore' {
  return lastPast !== undefined && lastPast === changeBefore ? 'undo' : 'restore';
}

/** The requests whose withdrawal would undo a change, for the panel's question. */
export function requestsThatUndo(requests: readonly WithdrawRequest[], undoable: ReadonlySet<string>): Set<string> {
  return new Set(requests.filter((r) => r.replies.some((m) => undoable.has(m.id))).map((r) => r.id));
}
