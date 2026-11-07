/**
 * Settings, redesigned on 2026-11-07 at the owner's request to match the
 * workspace as it is now (Google Stitch's, ChatGPT's and Gemini's manner):
 * a list of sections on the left and one section at a time on the right, as
 * ChatGPT's Settings, each setting a row with what it is on the left and its
 * control on the right or below. The owner chose both of these (2026-11-07):
 *
 * - **Sections on the left**: General, AI, Gemini key and Memory.
 * - **A change takes effect as it is made**, as in ChatGPT and Gemini. There
 *   is no Save and no Cancel, only Close; what cannot be undone by changing
 *   it back asks first: forgetting the kept reports or everything in Memory,
 *   and forgetting the encrypted key stored in the account.
 *
 * Until then it was two columns in the drafting style of the 2026-08-12 port
 * (monospace eyebrows tagged in orange, registration marks), inline in App,
 * with a Cancel that put the config and the memory back from a snapshot taken
 * when it opened (app-shell.md, *The configuration dialog was refined*).
 *
 * It opens at the Gemini key while there is none, because every route here
 * without one is the locked composer asking for it (`workspaceOpen` in
 * lib/aiProvider.ts), and at General otherwise.
 *
 * Lazy, like every other dialog: the key check, the vault and the sections
 * load when Settings opens, and none of it weighs on App's entry chunk. Its
 * frame, the section list and the keyboard, is SectionedDialog, shared with
 * the account dialog since the same day; its styles are dialogs.css.
 */
import { useEffect, useState } from 'react';
import { loadGemini } from '../lib/geminiClient';
import { loadFirebase } from '../lib/firebaseClient';
import { clearSessionKey, decryptApiKey, encryptApiKey, isVaultAvailable, WrongPassphraseError, type EncryptedKeyRecord } from '../services/keyVault';
import type { ReportConfig } from '../services/geminiService';
import { IconAlert, IconArchive, IconChat, IconCheck, IconEye, IconEyeOff, IconKey, IconTune, IconWarn } from './landing/icons';
import SectionedDialog, { type DialogSection } from './SectionedDialog';
import UsageSettings from './UsageSettings';
import ProviderSettings from './ProviderSettings';
import MemorySettings from './MemorySettings';

export type SettingsSection = 'general' | 'ai' | 'key' | 'memory';

const SECTIONS: DialogSection<SettingsSection>[] = [
  { id: 'general', label: 'General', Icon: IconTune },
  { id: 'ai', label: 'AI', Icon: IconChat },
  { id: 'key', label: 'Gemini key', Icon: IconKey },
  { id: 'memory', label: 'Memory', Icon: IconArchive },
];

type Notice = { tone: 'ok' | 'error'; text: string };

export interface SettingsDialogProps {
  config: ReportConfig;
  onChange: (changes: Partial<ReportConfig>) => void;
  /** Who is signed in, for the encrypted copy of the key; null when signed out. */
  user: { uid: string } | null;
  /** What the last request worked out, and why (lib/autoConfig.ts); null before the first. */
  workedOut: string[] | null;
  onClose: () => void;
  /** The section to open at: AI, from the box's model label (agent audit item 74); otherwise General, or the key when there is none. */
  start?: SettingsSection;
}

/** A line under a setting: what happened, or what to know. */
function Note({ notice }: { notice: Notice }) {
  return (
    <p className={`wb-set-note ${notice.tone === 'ok' ? 'is-ok' : 'is-bad'}`} role="status">
      {notice.tone === 'ok' ? <IconCheck size={13} /> : <IconAlert size={13} />}
      <span>{notice.text}</span>
    </p>
  );
}

export default function SettingsDialog({ config, onChange, user, workedOut, onClose, start }: SettingsDialogProps) {
  const [section, setSection] = useState<SettingsSection>(() => start ?? (config.customApiKey?.trim() ? 'general' : 'key'));

  /* ---- The Gemini key ---- */
  const key = config.customApiKey || '';
  const [showKey, setShowKey] = useState(false);
  const [checking, setChecking] = useState(false);
  const [keyNote, setKeyNote] = useState<Notice | null>(null);

  const checkKey = async () => {
    setKeyNote(null);
    setChecking(true);
    try {
      const { validateApiKey } = await loadGemini();
      const { valid, message } = await validateApiKey(key);
      setKeyNote({ tone: valid ? 'ok' : 'error', text: message });
    } catch (err) {
      setKeyNote({ tone: 'error', text: err instanceof Error ? err.message : 'Could not check the key.' });
    } finally {
      setChecking(false);
    }
  };

  /**
   * Wipe the key from this tab without touching the encrypted copy. Its
   * confirmation goes under the key, which is shown signed in or out: until
   * 2026-09-08 it went to the vault's line, which a signed-out person never
   * sees, and nothing on the page said the key was gone.
   */
  const clearKey = () => {
    onChange({ customApiKey: '' });
    clearSessionKey();
    setVaultNote(null);
    setKeyNote({ tone: 'ok', text: 'Key cleared from this browser session.' });
  };

  /* ---- The encrypted copy in the account (services/keyVault.ts) ---- */
  const canUseVault = !!user && isVaultAvailable();
  /** The stored copy: undefined while the account is asked, null when there is none. */
  const [record, setRecord] = useState<EncryptedKeyRecord | null | undefined>(undefined);
  const [passphrase, setPassphrase] = useState('');
  const [passphraseConfirm, setPassphraseConfirm] = useState('');
  const [vaultBusy, setVaultBusy] = useState(false);
  const [vaultNote, setVaultNote] = useState<Notice | null>(null);
  const [confirmForget, setConfirmForget] = useState(false);
  const uid = user?.uid;

  // Only whether a copy exists is read here; decrypting needs the passphrase,
  // which the person supplies on demand. The path is lib/accountData's, the one
  // deleting an account removes, so the two cannot drift apart.
  useEffect(() => {
    if (!canUseVault || !uid) return;
    let gone = false;
    loadFirebase()
      .then(({ sdk, paths, db }) => sdk.getDoc(paths.vaultDocRef(db, uid)))
      .then((snap) => {
        if (!gone) setRecord(snap.exists() ? (snap.data() as EncryptedKeyRecord) : null);
      })
      .catch((err) => {
        console.warn('Could not check for a stored API key:', err);
        if (!gone) setRecord(null);
      });
    return () => {
      gone = true;
    };
  }, [canUseVault, uid]);

  // Encrypt in the browser, upload ciphertext. The passphrase is never stored or
  // sent anywhere, which is exactly why a forgotten one cannot be recovered.
  const storeKey = async () => {
    setVaultNote(null);
    if (!key.trim()) return setVaultNote({ tone: 'error', text: 'Enter your API key first.' });
    if (passphrase.length < 8) return setVaultNote({ tone: 'error', text: 'Use a passphrase of at least 8 characters.' });
    if (passphrase !== passphraseConfirm) return setVaultNote({ tone: 'error', text: 'The two passphrases do not match.' });
    if (!uid) return;
    setVaultBusy(true);
    try {
      const next = await encryptApiKey(key.trim(), passphrase);
      const { sdk, paths, db } = await loadFirebase();
      await sdk.setDoc(paths.vaultDocRef(db, uid), next);
      setRecord(next);
      setPassphrase('');
      setPassphraseConfirm('');
      setVaultNote({ tone: 'ok', text: 'Key encrypted and synced. Unlock it with your passphrase on any device.' });
    } catch (err) {
      console.error('Failed to sync key:', err);
      setVaultNote({ tone: 'error', text: err instanceof Error && err.message ? err.message : 'Could not sync the key.' });
    } finally {
      setVaultBusy(false);
    }
  };

  const unlockKey = async () => {
    setVaultNote(null);
    if (!record) return;
    if (!passphrase) return setVaultNote({ tone: 'error', text: 'Enter your passphrase.' });
    setVaultBusy(true);
    try {
      onChange({ customApiKey: await decryptApiKey(record, passphrase) });
      setPassphrase('');
      setKeyNote(null);
      setVaultNote({ tone: 'ok', text: 'Key unlocked for this session.' });
    } catch (err) {
      setVaultNote({ tone: 'error', text: err instanceof WrongPassphraseError ? err.message : 'Could not unlock the key.' });
    } finally {
      setVaultBusy(false);
    }
  };

  const forgetStoredKey = async () => {
    setConfirmForget(false);
    if (!uid) return;
    setVaultBusy(true);
    try {
      const { sdk, paths, db } = await loadFirebase();
      await sdk.deleteDoc(paths.vaultDocRef(db, uid));
      setRecord(null);
      setVaultNote({ tone: 'ok', text: 'Stored key removed from your account.' });
    } catch (err) {
      console.error('Failed to remove stored key:', err);
      setVaultNote({ tone: 'error', text: 'Could not remove the stored key.' });
    } finally {
      setVaultBusy(false);
    }
  };

  return (
    <SectionedDialog title="Settings" sections={SECTIONS} section={section} onSection={setSection} onClose={onClose}>
          {section === 'general' && (
            <>
              {/* Requests today first, as Stitch's settings open with its daily credits (2026-11-05). */}
              <UsageSettings />
              {/* What used to be chosen here is worked out for each request
                  since 2026-11-04 (lib/autoConfig.ts, lib/ocrScript.ts): the
                  DevExpress version, unit, paper, direction and data source,
                  and the language and handwriting of a picture, from what the
                  request brings. The owner's rule is that nobody is asked what
                  the input already says. */}
              <div className="wb-set-row is-stack">
                <div className="wb-set-text">
                  <h4 className="wb-set-label">Worked out for you</h4>
                  <p>
                    Forma reads the DevExpress version and unit from a report you bring, the paper from your page or your words, right to
                    left from the text, the stored procedure from your words or data, and the language of a picture as it reads it. Ask in
                    the chat for anything else.
                  </p>
                </div>
                {workedOut && workedOut.length > 0 && (
                  <ul className="wb-set-list" aria-label="Worked out for the last request">
                    {workedOut.map((reason) => <li key={reason}>{reason}</li>)}
                  </ul>
                )}
              </div>
            </>
          )}

          {section === 'ai' && <ProviderSettings config={config} onChange={onChange} onKey={() => setSection('key')} />}

          {section === 'key' && (
            <>
              <div className="wb-set-row is-stack">
                <div className="wb-set-text">
                  <label className="wb-set-label" htmlFor="cfg-key">API key</label>
                  <p id="cfg-key-note">
                    Required, whichever AI designs. It goes from this browser straight to Google, is held for this tab only, and is never
                    written to disk.
                  </p>
                </div>
                <div className="wb-set-field">
                  <span className="wb-set-secret">
                    <input
                      className="wb-set-input"
                      id="cfg-key"
                      type={showKey ? 'text' : 'password'}
                      placeholder="AIza… or AQ.…"
                      value={key}
                      onChange={(e) => {
                        onChange({ customApiKey: e.target.value });
                        setKeyNote(null);
                      }}
                      /* The whole point of this app is that the key is not
                         written to disk. A password manager offering to save
                         it, or the browser offering to fill it, undoes that
                         from outside, and the field is revealed as plain text
                         by the eye button, where autocorrect would happily
                         rewrite an API key.

                         For the same reason this input is deliberately NOT
                         inside a <form>. Chromium logs a warning about that on
                         every load ("[DOM] Password field is not contained in
                         a form"), and it is the browser objecting to the
                         correct behaviour: that hint exists to help password
                         managers recognise sign-in forms, which is the one
                         thing this field must never look like. Do not silence
                         it by adding a form wrapper. */
                      aria-describedby="cfg-key-note"
                      autoComplete="off"
                      autoCapitalize="off"
                      autoCorrect="off"
                      spellCheck={false}
                    />
                    <button type="button" className="wb-set-peek" onClick={() => setShowKey(!showKey)} aria-label={showKey ? 'Hide key' : 'Show key'}>
                      {showKey ? <IconEyeOff size={15} /> : <IconEye size={15} />}
                    </button>
                  </span>
                  {/* Disabled while it runs: the check is a round trip to Google,
                      and a second click fired a second request. */}
                  <button type="button" className="wb-pill wb-pill--outline" onClick={checkKey} disabled={checking || !key.trim()}>
                    {checking ? 'Checking…' : 'Check key'}
                  </button>
                  {key.trim() && (
                    <button type="button" className="wb-set-quiet" onClick={clearKey} title="Clear the key from this tab">
                      Clear
                    </button>
                  )}
                </div>
                {keyNote && <Note notice={keyNote} />}
              </div>

              {canUseVault && (
                <>
                  <h4 className="wb-set-sub">Encrypted sync</h4>
                  <div className="wb-set-row is-stack">
                    <div className="wb-set-text">
                      <span className="wb-set-label">Keep it in your account</span>
                      <p>Store the key encrypted with a passphrase of your own, and unlock it with that passphrase on any device.</p>
                    </div>
                    <div className="wb-set-pair">
                      <input
                        className="wb-set-input"
                        id="cfg-pass"
                        type="password"
                        aria-label="Passphrase"
                        placeholder="Passphrase, at least 8 characters"
                        value={passphrase}
                        onChange={(e) => setPassphrase(e.target.value)}
                        /* `new-password` rather than `off`: this is the one
                           field a manager may legitimately generate for, and it
                           stops it being autofilled with the account password,
                           which would silently become the vault passphrase. */
                        autoComplete="new-password"
                      />
                      <input
                        className="wb-set-input"
                        id="cfg-pass2"
                        type="password"
                        aria-label="Confirm passphrase"
                        placeholder="Confirm passphrase"
                        value={passphraseConfirm}
                        onChange={(e) => setPassphraseConfirm(e.target.value)}
                        autoComplete="new-password"
                      />
                    </div>
                    {record === undefined ? (
                      <p className="wb-set-note">Checking your account for a stored key…</p>
                    ) : (
                      <div className="wb-set-actions">
                        <button type="button" className="wb-pill wb-pill--outline" onClick={storeKey} disabled={vaultBusy}>
                          {record ? 'Replace stored key' : 'Store encrypted'}
                        </button>
                        {record && (
                          <>
                            <button type="button" className="wb-pill wb-pill--outline" onClick={unlockKey} disabled={vaultBusy}>
                              Unlock
                            </button>
                            <button type="button" className="wb-set-quiet is-danger" onClick={() => setConfirmForget(true)} disabled={vaultBusy}>
                              Forget stored key
                            </button>
                          </>
                        )}
                      </div>
                    )}
                    {confirmForget && (
                      <div className="wb-set-confirm" role="alertdialog" aria-label="Forget the stored key?">
                        <span>Remove the encrypted key from your account? This cannot be undone; the key in this tab stays.</span>
                        <button type="button" className="wb-set-quiet" onClick={() => setConfirmForget(false)}>Cancel</button>
                        <button type="button" className="wb-set-quiet is-danger" onClick={() => void forgetStoredKey()}>Forget stored key</button>
                      </div>
                    )}
                    {vaultNote && <Note notice={vaultNote} />}
                    {/* Stated plainly because it is true and unrecoverable. */}
                    <p className="wb-set-note">
                      <IconWarn size={13} />
                      <span>
                        <b>There is no reset.</b> Your passphrase never leaves this browser, so if you forget it the stored key cannot be
                        recovered, by you or by anyone running Forma.
                      </span>
                    </p>
                  </div>
                </>
              )}
            </>
          )}

          {section === 'memory' && <MemorySettings />}
    </SectionedDialog>
  );
}
