/**
 * Help Forma learn, a section of Settings (2026-11-10, the full audit, the
 * owner's ask that Forma learn from every use; lib/learning.ts). Two
 * switches, what has been kept, and one button that deletes it: on this
 * device, and in the account when signed in. Every change is written as it
 * is made, as the rest of Settings; deleting asks first, as Memory's
 * forgetting does, since it cannot be undone.
 */
import { useEffect, useState } from 'react';
import { clearLearningEvents, learningSummary, listLearningEvents, readLearningSettings, writeLearningSettings, type LearningSettings as Settings } from '../lib/learning';
import { loadFirebase } from '../lib/firebaseClient';

export interface LearningSettingsProps {
  /** Who is signed in, whose account holds the shared events; null when signed out. */
  user: { uid: string } | null;
}

export default function LearningSettings({ user }: LearningSettingsProps) {
  const [settings, setSettings] = useState<Settings>(() => readLearningSettings());
  const [kept, setKept] = useState<ReturnType<typeof learningSummary> | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

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

  const save = (next: Settings) => {
    setSettings(next);
    writeLearningSettings(next);
  };

  const deleteAll = async () => {
    setBusy(true);
    setNote('');
    try {
      await clearLearningEvents();
      if (user) {
        const { paths, db } = await loadFirebase();
        await paths.deleteLearning(db, user.uid);
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
      ? 'Nothing kept yet.'
      : `${kept.total} ${kept.total === 1 ? 'event' : 'events'} kept on this device: ${kept.byKind.generation} ${kept.byKind.generation === 1 ? 'report' : 'reports'}, ${kept.byKind.edit} ${kept.byKind.edit === 1 ? 'edit' : 'edits'}, ${kept.byKind.translate} ${kept.byKind.translate === 1 ? 'translation' : 'translations'} and ${kept.byKind.rating} ${kept.byKind.rating === 1 ? 'rating' : 'ratings'}${kept.full ? `, ${kept.full} with the whole report` : ''}.`;

  return (
    <>
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
