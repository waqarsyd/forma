/**
 * What Forma remembers, the Memory section of Settings (2026-11-02,
 * milestone 4 of docs/proposals/own-model.md): every memory, to switch off,
 * change or forget, and what the reports the user kept have taught it.
 * Everything shown lives in this browser only (lib/memory.ts), and since
 * 2026-11-11 (the full audit's WS-28) under the account signed in, which App
 * names to the memory as it signs in; signed out, the browser's own.
 *
 * Every change is written as it is made. Since the redesign of 2026-11-07
 * Settings has no Cancel to put it back, as ChatGPT's memory has none, so
 * the two that forget in bulk, Forget kept reports and Forget everything,
 * ask first: they cannot be undone by changing them back.
 */
import { useRef, useState } from 'react';
import { exportMemory, hintsOf, importMemory, keptSummary, memoryAccount, memoryFrom, readMemory, writeMemory, type MemoryState } from '../lib/memory';
import { forgetLearned } from '../lib/corrections';

/**
 * Every report this account kept, out of the library's kept store as well as
 * the memory. Loaded on the click, as App loads the library: none of it is
 * needed to draw Settings. A library that cannot be opened holds none.
 */
const forgetKeptReports =(owner: string | null): Promise<void> =>
  import('../services/library').then((l) => l.forgetKept(owner, l.defaultDeps())).catch(() => undefined);

export default function MemorySettings() {
  const [state, setState] = useState<MemoryState>(() => readMemory());
  const [draft, setDraft] = useState('');
  /** What Import last said, in a line under its button (CP-13). */
  const [importNote, setImportNote] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  /** Which forgetting is being confirmed: every kept report, or everything. */
  const [confirming, setConfirming] = useState<'kept' | 'all' | null>(null);
  const save = (next: MemoryState) => {
    setState(next);
    writeMemory(next);
  };
  const add = () => {
    if (!draft.trim()) return;
    save({ ...state, memories: [...state.memories, memoryFrom(draft, 'settings')] });
    setDraft('');
  };
  const kept = keptSummary(state);
  // What the person said, and what their changes taught (2026-11-11, D4): listed apart.
  const own = state.memories.filter((m) => m.source !== 'learned');
  const learned = state.memories.filter((m) => m.source === 'learned');
  const setEnabled = (id: string, enabled: boolean) => save({ ...state, memories: state.memories.map((x) => (x.id === id ? { ...x, enabled } : x)) });

  return (
    <>
      <div className="wb-set-row is-stack">
        <div className="wb-set-text">
          <span className="wb-set-label">Saved memories</span>
          <p>What Forma remembers about how you work. Tell it in the chat ("remember: always use A4"), or add one here. It stays in this browser, kept apart for each account that signs in here.</p>
        </div>
        {own.length === 0 ? (
          <p className="wb-set-note">Nothing remembered yet.</p>
        ) : (
          <ul className="wb-set-mems" aria-label="Memories">
            {own.map((m) => (
              <li key={m.id}>
                <input
                  type="checkbox"
                  role="switch"
                  className="wb-set-switch"
                  aria-label={m.enabled ? 'Use this memory' : 'This memory is off'}
                  checked={m.enabled}
                  onChange={(e) => setEnabled(m.id, e.target.checked)}
                />
                <input
                  className="wb-set-input"
                  type="text"
                  aria-label={m.projectId ? 'Memory for one project' : 'Memory'}
                  title={m.projectId ? 'Used only in the project it was said in' : undefined}
                  value={m.text}
                  onChange={(e) => save({ ...state, memories: state.memories.map((x) => (x.id === m.id ? { ...x, text: e.target.value, hints: hintsOf(e.target.value) } : x)) })}
                />
                {m.projectId && <span className="wb-set-note">This project only</span>}
                <button type="button" className="wb-set-quiet" onClick={() => save({ ...state, memories: state.memories.filter((x) => x.id !== m.id) })}>
                  Forget
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="wb-set-field">
          <input
            className="wb-set-input"
            type="text"
            placeholder="e.g. Always use A4 and Tahoma"
            aria-label="A new memory"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) add();
            }}
          />
          <button type="button" className="wb-pill wb-pill--outline" disabled={!draft.trim()} onClick={add}>
            Remember
          </button>
        </div>
      </div>

      {/* A change made the same way to two reports Forma made (2026-11-11, D4, lib/corrections.ts). */}
      {learned.length > 0 && (
        <div className="wb-set-row is-stack">
          <div className="wb-set-text">
            <span className="wb-set-label">Learned from your changes</span>
            <p>Changes you made the same way to two reports Forma made, so it makes them that way from now on. Each has its own switch; turning off the learning below keeps these and stops new ones.</p>
          </div>
          <ul className="wb-set-mems" aria-label="Learned from your changes">
            {learned.map((m) => (
              <li key={m.id}>
                <input
                  type="checkbox"
                  role="switch"
                  className="wb-set-switch"
                  aria-label={m.enabled ? `Use: ${m.text}` : `Off: ${m.text}`}
                  checked={m.enabled}
                  onChange={(e) => setEnabled(m.id, e.target.checked)}
                />
                <span className="wb-set-note">{m.text}</span>
                {/* Forgotten with what it was counted from, so the same reports do not teach it again. */}
                <button
                  type="button"
                  className="wb-set-quiet"
                  aria-label={`Forget: ${m.text}`}
                  onClick={() => save({ ...state, memories: state.memories.filter((x) => x.id !== m.id), ledger: forgetLearned(state.ledger ?? [], m.id) })}
                >
                  Forget
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="wb-set-row">
        <div className="wb-set-text">
          <label className="wb-set-label" htmlFor="wb-set-learn">Learn the style of reports I keep</label>
          <p>
            {kept
              ? `Learned from ${kept.reports} kept reports: ${kept.paper}${kept.landscape ? ' landscape' : ''}, ${kept.fontFamily}${Object.keys(kept.sizes ?? {}).length ? `; ${Object.entries(kept.sizes ?? {}).map(([role, pt]) => `${role}s ${pt}pt`).join(', ')}` : ''}.`
              : state.kept.length
                ? `${state.kept.length} kept report${state.kept.length === 1 ? '' : 's'} so far; Forma learns a style from two.`
                : 'A report is kept when you export it, save it or open it in the designer. None yet.'}
          </p>
        </div>
        <input id="wb-set-learn" type="checkbox" role="switch" className="wb-set-switch" checked={state.learnFromKept} onChange={(e) => save({ ...state, learnFromKept: e.target.checked })} />
      </div>

      {/* One small file of the memories, to take to another browser or back them up (2026-11-11, CP-13). */}
      <div className="wb-set-row is-stack">
        <div className="wb-set-text">
          <span className="wb-set-label">Move your memories</span>
          <p>Save them as a file, or add the ones in a saved file to these. The style of your kept reports stays with this browser.</p>
        </div>
        <div className="wb-set-actions">
          <button
            type="button"
            className="wb-pill wb-pill--outline"
            disabled={own.length === 0}
            onClick={() => {
              const url = URL.createObjectURL(new Blob([exportMemory(state)], { type: 'application/json' }));
              const a = document.createElement('a');
              a.href = url;
              a.download = 'forma-memory.json';
              document.body.appendChild(a);
              a.click();
              a.remove();
              setTimeout(() => URL.revokeObjectURL(url), 60_000);
            }}
          >
            Export
          </button>
          <button type="button" className="wb-pill wb-pill--outline" onClick={() => fileRef.current?.click()}>
            Import
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            aria-label="A memory file to import"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              const next = file.size <= 1_000_000 ? importMemory(state, await file.text()) : null;
              if (!next) {
                setImportNote('That file is not a Forma memory file.');
                return;
              }
              const added = next.memories.length - state.memories.length;
              save(next);
              setImportNote(added ? `Added ${added} ${added === 1 ? 'memory' : 'memories'}.` : 'Those memories are already here.');
            }}
          />
        </div>
        {importNote && <p className="wb-set-note" role="status">{importNote}</p>}
      </div>

      {(state.memories.length > 0 || state.kept.length > 0) && (
        <div className="wb-set-row is-stack">
          <div className="wb-set-text">
            <span className="wb-set-label">Forget</span>
            <p>Forgetting cannot be undone.</p>
          </div>
          {confirming ? (
            <div className="wb-set-confirm" role="alertdialog" aria-label={confirming === 'all' ? 'Forget everything?' : 'Forget kept reports?'}>
              <span>
                {confirming === 'all'
                  ? 'Forget every memory and every kept report? This cannot be undone.'
                  : 'Forget the reports Forma learned your style from? Your memories stay. This cannot be undone.'}
              </span>
              <button type="button" className="wb-set-quiet" onClick={() => setConfirming(null)}>Cancel</button>
              <button
                type="button"
                className="wb-set-quiet is-danger"
                onClick={() => {
                  save(confirming === 'all' ? { memories: [], kept: [], learnFromKept: state.learnFromKept, ledger: [] } : { ...state, kept: [] });
                  // And the kept reports themselves, which the Library panel lists and a first
                  // report is shown (the LRN2 review, 2026-11-11): forgetting left them in use.
                  void forgetKeptReports(memoryAccount());
                  setConfirming(null);
                }}
              >
                {confirming === 'all' ? 'Forget everything' : 'Forget kept reports'}
              </button>
            </div>
          ) : (
            <div className="wb-set-actions">
              {state.kept.length > 0 && (
                <button type="button" className="wb-pill wb-pill--outline" onClick={() => setConfirming('kept')}>
                  Forget kept reports
                </button>
              )}
              <button type="button" className="wb-pill wb-pill--outline" onClick={() => setConfirming('all')}>
                Forget everything
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
