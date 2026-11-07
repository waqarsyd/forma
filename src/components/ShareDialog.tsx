/**
 * Share a report (2026-11-06), as Google Stitch's Share dialog: people added
 * by email, general access as Restricted or Anyone with the link, the link
 * to copy, and Stop sharing. What is shared is a COPY of the report in
 * `shares/{id}` (lib/shares.ts), never the saved project, and the copy
 * changes when "Update the shared copy" is pressed, not on every edit. Forma
 * has no server, so it sends no email: adding someone lets their verified
 * address open the link, and the dialog says to send it. firestore.rules
 * decides who may read a share; this dialog only writes what the rules pin.
 *
 * It does its own reads and writes, through lib/firebaseClient, so none of
 * this weighs on App's entry chunk: App passes who is signed in, the report,
 * and how to make sure the project is saved, since a share names its project.
 */
import { useEffect, useRef, useState } from 'react';
import { copyText } from '../lib/clipboard';
import { loadFirebase } from '../lib/firebaseClient';
import { isEmail, makeShareId, shareDocument, shareLink, withInvitee, type ShareAccess, type ShareDocument, type SharedReport } from '../lib/shares';
import { IconClose } from './landing/icons';
import './overlays.css';
import { useFocusTrap } from './useFocusTrap';

interface Props {
  user: { uid: string; email: string | null } | null;
  name: string;
  report: SharedReport;
  /** Saves the project when it is not saved yet, and gives its id. */
  ensureSaved: () => Promise<string | null>;
  onSignIn: () => void;
  onNotice: (text: string) => void;
  onFailure: (error: unknown, path: string, message: string) => void;
  onClose: () => void;
}

export default function ShareDialog({ user, name, report, ensureSaved, onSignIn, onNotice, onFailure, onClose }: Props) {
  const [reportId, setReportId] = useState<string | null>(null);
  const [share, setShare] = useState<ShareDocument | null>(null);
  const [loading, setLoading] = useState(!!user);
  const [busy, setBusy] = useState(false);
  const [access, setAccess] = useState<ShareAccess>('restricted');
  const [emails, setEmails] = useState<string[]>([]);
  const [typed, setTyped] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  // A modal's keyboard (2026-11-06, the workspace audit): focus into it, Tab
  // kept inside, Escape (its layer), and focus back to Share. It said
  // aria-modal and did none of it.
  const dialog = useRef<HTMLElement>(null);
  useFocusTrap(dialog, onClose);

  // The project's share, if it has one; saving the project first when it is not saved.
  useEffect(() => {
    if (!user) return;
    let gone = false;
    void (async () => {
      const id = await ensureSaved();
      if (gone) return;
      if (!id) {
        setProblem('Save the project first, then share it.');
        setLoading(false);
        return;
      }
      setReportId(id);
      try {
        const { sdk, paths, db } = await loadFirebase();
        const found = await sdk.getDocs(paths.ownedShares(db, user.uid, id));
        if (gone) return;
        const existing = found.docs[0]?.data() as ShareDocument | undefined;
        if (existing) {
          setShare(existing);
          setAccess(existing.access);
          setEmails(existing.emails);
        }
      } catch (err) {
        onFailure(err, 'shares', 'Forma could not check whether this report is shared. Try again in a moment.');
      } finally {
        if (!gone) setLoading(false);
      }
    })();
    return () => {
      gone = true;
    };
    // Once per person: the callbacks are new every render, and re-running
    // would save and query again for nothing.
  }, [user?.uid]);

  /**
   * Write the shared copy with these settings: creating it, changing who may
   * open it, or updating it. False when it was not written, so a change the
   * dialog already showed can be put back (2026-11-06, the workspace audit):
   * a removal that failed showed the person gone while the share still let
   * them in.
   */
  const save = async (nextAccess: ShareAccess, nextEmails: string[], notice: string): Promise<boolean> => {
    if (!user || !reportId) return false;
    const doc = shareDocument({ id: share?.id ?? makeShareId(), ownerId: user.uid, reportId, name, report, access: nextAccess, emails: nextEmails });
    if (!doc) {
      setProblem('This report is too large to share.');
      return false;
    }
    setBusy(true);
    try {
      const { sdk, paths, db } = await loadFirebase();
      await sdk.setDoc(paths.shareDocRef(db, doc.id), doc);
      setShare(doc);
      setProblem(null);
      onNotice(notice);
      return true;
    } catch (err) {
      onFailure(err, `shares/${doc.id}`, 'That report could not be shared. Try again in a moment.');
      return false;
    } finally {
      setBusy(false);
    }
  };
  /** Show a change at once, and put the old settings back if it is not written. */
  const change = (nextAccess: ShareAccess, nextEmails: string[], notice: string) => {
    const before = { access, emails };
    setAccess(nextAccess);
    setEmails(nextEmails);
    if (!share) return;
    void save(nextAccess, nextEmails, notice).then((ok) => {
      if (ok) return;
      setAccess(before.access);
      setEmails(before.emails);
    });
  };

  const stop = async () => {
    if (!share) return;
    setBusy(true);
    try {
      const { sdk, paths, db } = await loadFirebase();
      await sdk.deleteDoc(paths.shareDocRef(db, share.id));
      setShare(null);
      onNotice('Stopped sharing');
    } catch (err) {
      onFailure(err, `shares/${share.id}`, 'Forma could not stop sharing it. Try again in a moment.');
    } finally {
      setBusy(false);
    }
  };

  const add = () => {
    const next = withInvitee(emails, typed);
    if (next.length === emails.length) {
      if (typed.trim()) setProblem(isEmail(typed) ? 'That address is already here.' : 'That does not look like an email address.');
      return;
    }
    setTyped('');
    setProblem(null);
    change(access, next, 'Added them');
  };
  const remove = (email: string) => change(access, emails.filter((e) => e !== email), 'Removed them');
  const changeAccess = (next: ShareAccess) =>
    change(next, emails, next === 'link' ? 'Anyone with the link can open it' : 'Only the people added can open it');

  const link = share ? shareLink(window.location.origin, share.id) : null;
  return (
    <div className="wb-cmd-backdrop wb-cmd-backdrop--centre" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="wb-share" role="dialog" aria-modal="true" aria-labelledby="wb-share-title" ref={dialog} tabIndex={-1}>
        <div className="wb-share-head">
          <h2 id="wb-share-title">Share "{name}"</h2>
          <button type="button" className="wb-share-close" aria-label="Close" onClick={onClose}>
            <IconClose size={15} />
          </button>
        </div>

        {!user ? (
          <div className="wb-share-body">
            <p>Sign in to share a report. A shared report lives in your account, so only you can change or stop sharing it.</p>
            <button type="button" className="wb-pill wb-pill--accent" onClick={onSignIn}>Sign in</button>
          </div>
        ) : loading ? (
          <div className="wb-share-body"><p>Checking whether it is shared…</p></div>
        ) : (
          <div className="wb-share-body">
            {/* noValidate: the browser's own "include an @" bubble would stand in for Forma's message. */}
            <form className="wb-share-add" noValidate onSubmit={(e) => { e.preventDefault(); add(); }}>
              <input type="email" value={typed} placeholder="Add people by email" aria-label="Add people by email" onChange={(e) => setTyped(e.target.value)} />
              <button type="submit" className="wb-pill wb-pill--outline" disabled={busy || !typed.trim()}>Add</button>
            </form>

            <h3>People with access</h3>
            <ul className="wb-share-people">
              <li><span>{user.email ?? 'You'}</span><small>Owner</small></li>
              {emails.map((email) => (
                <li key={email}>
                  <span>{email}</span>
                  <button type="button" disabled={busy} aria-label={`Remove ${email}`} onClick={() => remove(email)}>Remove</button>
                </li>
              ))}
            </ul>

            <h3>General access</h3>
            <label className="wb-share-access">
              <select value={access} disabled={busy} aria-label="General access" onChange={(e) => changeAccess(e.target.value as ShareAccess)}>
                <option value="restricted">Restricted</option>
                <option value="link">Anyone with the link</option>
              </select>
              <small>
                {access === 'link'
                  ? 'Anyone who has the link can open it, without signing in.'
                  : 'Only the people added can open it, signed in with a verified address.'}
              </small>
            </label>

            {link ? (
              <>
                <h3>Link</h3>
                <div className="wb-share-link">
                  <input readOnly value={link} aria-label="Link to the shared report" onFocus={(e) => e.target.select()} />
                  <button type="button" className="wb-pill wb-pill--outline" onClick={() => void copyText(link).then((ok) => onNotice(ok ? 'Copied the link' : 'Could not copy the link: select it and copy it by hand'))}>Copy link</button>
                </div>
                <p className="wb-share-note">
                  The shared copy is from {new Date(share!.timestamp).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}.{' '}
                  <button type="button" className="wb-share-linkbtn" disabled={busy} onClick={() => void save(access, emails, 'Updated the shared copy')}>Update the shared copy</button>
                </p>
                <div className="wb-share-foot">
                  <button type="button" className="wb-share-stop" disabled={busy} onClick={() => void stop()}>Stop sharing</button>
                </div>
              </>
            ) : (
              <div className="wb-share-foot">
                <button type="button" className="wb-pill wb-pill--accent" disabled={busy} onClick={() => void save(access, emails, 'Shared')}>
                  {busy ? 'Sharing…' : 'Share'}
                </button>
              </div>
            )}

            {problem && <p className="wb-share-problem" role="alert">{problem}</p>}
            <p className="wb-share-note">Forma sends no email: send the link to the people you add. The conversation is never shared, only the report.</p>
          </div>
        )}
      </section>
    </div>
  );
}
