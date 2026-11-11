/**
 * Help Forma learn, a section of Settings (2026-11-10, the full audit, the
 * owner's ask that Forma learn from every use; lib/learning.ts). Two
 * switches, what has been kept, and one button that deletes it: on this
 * device, and in the account when signed in. Every change is written as it
 * is made, as the rest of Settings; deleting asks first, as Memory's
 * forgetting does, since it cannot be undone.
 *
 * Since 2026-11-11 (the full audit's LM-01, SA-13 and LM-30), signed in, the
 * switches are the account's (`users/{uid}/meta/learning`), so they apply on
 * every device and never to the next person to sign in on this one; and the
 * section says how many events the account holds, which a new device could
 * not, since it counted only what this browser kept.
 */
import { useEffect, useRef, useState } from 'react';
import {
  clearLearningEvents,
  learningSummary,
  listLearningEvents,
  readDeviceLearning,
  settleLearningSettings,
  writeLearningSettings,
  type LearningSettings as Settings,
} from '../lib/learning';
import { loadFirebase } from '../lib/firebaseClient';

export interface LearningSettingsProps {
  /** Who is signed in, whose account holds the shared events; null when signed out. */
  user: { uid: string } | null;
}

export default function LearningSettings({ user }: LearningSettingsProps) {
  const uid = user?.uid ?? null;
  const [settings, setSettings] = useState<Settings>(() => readDeviceLearning(uid).settings);
  const [kept, setKept] = useState<ReturnType<typeof learningSummary> | null>(null);
  /** How many events the account holds, once counted; null signed out or until then. */
  const [shared, setShared] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  /**
   * Counts the changes made here, so an answer from the account that arrives
   * after a newer change never writes over it: neither the account's copy
   * read on opening nor an older change's confirmation (the PRIV review,
   * 2026-11-11). Without it a switch could silently undo itself.
   */
  const changes = useRef(0);

  useEffect(() => {
    let live = true;
    listLearningEvents()
      .then((events) => {
        if (live) setKept(learningSummary(events));
      })
      .catch(() => {
        if (live) setKept(learningSummary([]));
      });
    return () => {
      live = false;
    };
  }, []);

  // The account's switches and its count. The switches settle as App settles
  // them on sign-in (lib/learning.ts): the account's copy, unless this browser
  // holds a change the account has not had yet.
  useEffect(() => {
    if (!uid) {
      setSettings(readDeviceLearning(null).settings);
      setShared(null);
      return;
    }
    let live = true;
    const opened = changes.current;
    setSettings(readDeviceLearning(uid).settings);
    void loadFirebase()
      .then(async ({ paths, db }) => {
        const [count, account] = await Promise.all([
          paths.countLearning(db, uid).catch(() => null),
          paths.readLearningPrefs(db, uid).catch(() => undefined),
        ]);
        if (!live) return;
        setShared(count);
        if (account === undefined || changes.current !== opened) return;
        const settled = settleLearningSettings(readDeviceLearning(uid), account);
        if (settled.push) return;
        setSettings(settled.settings);
        writeLearningSettings(settled.settings, uid);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [uid]);

  const save = (next: Settings) => {
    const change = ++changes.current;
    setSettings(next);
    setNote('');
    // Signed in, marked as not yet in the account until the account has it.
    writeLearningSettings(next, uid, Boolean(uid));
    if (!uid) return;
    void loadFirebase()
      .then(({ paths, db }) => paths.writeLearningPrefs(db, uid, next))
      .then(() => {
        // A newer change is still on its way; its own answer clears the mark.
        if (changes.current === change) writeLearningSettings(next, uid);
      })
      .catch(() => setNote('Changed on this computer. Your account could not be updated just now; it will be the next time you open Forma here.'));
  };

  const deleteAll = async () => {
    setBusy(true);
    setNote('');
    try {
      await clearLearningEvents();
      if (user) {
        const { paths, db } = await loadFirebase();
        await paths.deleteLearning(db, user.uid);
        setShared(0);
      }
      setKept(learningSummary([]));
      setNote(user ? 'Deleted from this device and from your account.' : 'Deleted from this device.');
    } catch {
      setNote('Some of it could not be deleted. Try again in a moment.');
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  const keptLine = !kept
    ? 'Reading what is kept…'
    : kept.total === 0
      ? 'Nothing kept on this device.'
      : `${kept.total} ${kept.total === 1 ? 'event' : 'events'} kept on this device: ${kept.byKind.generation} ${kept.byKind.generation === 1 ? 'report' : 'reports'}, ${kept.byKind.edit} ${kept.byKind.edit === 1 ? 'edit' : 'edits'}, ${kept.byKind.translate} ${kept.byKind.translate === 1 ? 'translation' : 'translations'} and ${kept.byKind.rating} ${kept.byKind.rating === 1 ? 'rating' : 'ratings'}${kept.full ? `, ${kept.full} with the whole report` : ''}.`;
  const sharedLine = shared === null ? '' : ` ${shared} ${shared === 1 ? 'event' : 'events'} shared from your account.`;

  return (
    <>
      {user && <p className="wb-set-note">Applies to your account on every device.</p>}
      <div className="wb-set-row">
        <div className="wb-set-text">
          <label className="wb-set-label" htmlFor="wb-set-learn-structure">Help Forma learn from the shape of my reports</label>
          <p>
            The structure of each report you make or change: its bands, where each control sits, its size, font and alignment, and what
            kind of text it holds. Never the text itself, a field name, a query or a picture. With this on, Forma&apos;s own model gets
            better at laying out reports like yours.
          </p>
        </div>
        <input
          id="wb-set-learn-structure"
          type="checkbox"
          role="switch"
          className="wb-set-switch"
          checked={settings.structure}
          onChange={(e) => save({ ...settings, structure: e.target.checked })}
        />
      </div>

      <div className="wb-set-row">
        <div className="wb-set-text">
          <label className="wb-set-label" htmlFor="wb-set-learn-full">Share whole reports and what I asked for</label>
          <p>
            Off unless you turn it on. The complete report file and the words you typed go with each event, captions, field names and
            all, so Forma can learn how a request becomes a report. Share this only for reports with nothing confidential in them.
          </p>
        </div>
        <input
          id="wb-set-learn-full"
          type="checkbox"
          role="switch"
          className="wb-set-switch"
          checked={settings.full}
          onChange={(e) => save({ ...settings, full: e.target.checked })}
        />
      </div>

      <div className="wb-set-row is-stack">
        <div className="wb-set-text">
          <span className="wb-set-label">What has been kept</span>
          <p>
            {keptLine}
            {sharedLine}
            {user ? ' What was shared is in your account, where only you and Forma’s maintainer can read it; deleting your account removes it.' : ' Sign in to share it; signed out, it stays on this device.'}
          </p>
        </div>
        {confirming ? (
          <div className="wb-set-confirm" role="alertdialog" aria-label="Delete what Forma learned from?">
            <span>Delete every event kept on this device{user ? ' and in your account' : ''}? This cannot be undone.</span>
            <button type="button" className="wb-set-quiet" onClick={() => setConfirming(false)} disabled={busy}>Cancel</button>
            <button type="button" className="wb-set-quiet is-danger" onClick={() => void deleteAll()} disabled={busy}>
              {busy ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        ) : (
          <div className="wb-set-actions">
            <button type="button" className="wb-pill wb-pill--outline" disabled={busy || !kept || (kept.total === 0 && !user)} onClick={() => setConfirming(true)}>
              Delete what was kept
            </button>
          </div>
        )}
        {note && <p className="wb-set-note">{note}</p>}
      </div>
    </>
  );
}
