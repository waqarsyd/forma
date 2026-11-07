/**
 * What Forma remembers, the Memory section of Settings (2026-11-02,
 * milestone 4 of docs/proposals/own-model.md): every memory, to switch off,
 * change or forget, and what the reports the user kept have taught it.
 * Everything shown lives in this browser only (lib/memory.ts).
 *
 * Every change is written as it is made. Since the redesign of 2026-11-07
 * Settings has no Cancel to put it back, as ChatGPT's memory has none, so
 * the two that forget in bulk, Forget kept reports and Forget everything,
 * ask first: they cannot be undone by changing them back.
 */
import { useState } from 'react';
import { hintsOf, keptSummary, memoryFrom, readMemory, writeMemory, type MemoryState } from '../lib/memory';

export default function MemorySettings() {
  const [state, setState] = useState<MemoryState>(() => readMemory());
  const [draft, setDraft] = useState('');
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

  return (
    <>
      <div className="wb-set-row is-stack">
        <div className="wb-set-text">
          <span className="wb-set-label">Saved memories</span>
          <p>What Forma remembers about how you work. Tell it in the chat ("remember: always use A4"), or add one here. It stays in this browser.</p>
        </div>
        {state.memories.length === 0 ? (
          <p className="wb-set-note">Nothing remembered yet.</p>
        ) : (
          <ul className="wb-set-mems" aria-label="Memories">
            {state.memories.map((m) => (
              <li key={m.id}>
                <input
                  type="checkbox"
                  role="switch"
                  className="wb-set-switch"
                  aria-label={m.enabled ? 'Use this memory' : 'This memory is off'}
                  checked={m.enabled}
                  onChange={(e) => save({ ...state, memories: state.memories.map((x) => (x.id === m.id ? { ...x, enabled: e.target.checked } : x)) })}
                />
                <input
                  className="wb-set-input"
                  type="text"
                  aria-label="Memory"
                  value={m.text}
                  onChange={(e) => save({ ...state, memories: state.memories.map((x) => (x.id === m.id ? { ...x, text: e.target.value, hints: hintsOf(e.target.value) } : x)) })}
                />
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

      <div className="wb-set-row">
        <div className="wb-set-text">
          <label className="wb-set-label" htmlFor="wb-set-learn">Learn the style of reports I keep</label>
          <p>
            {kept
              ? `Learned from ${kept.reports} kept reports: ${kept.paper}${kept.landscape ? ' landscape' : ''}, ${kept.fontFamily}${Object.keys(kept.sizes ?? {}).length ? `; ${Object.entries(kept.sizes ?? {}).map(([role, pt]) => `${role}s ${pt}pt`).join(', ')}` : ''}.`
              : state.kept.length
                ? `${state.kept.length} kept report${state.kept.length === 1 ? '' : 's'} so far; Forma learns a style from two.`
                : 'A report is kept when you export or save it. None yet.'}
          </p>
        </div>
        <input id="wb-set-learn" type="checkbox" role="switch" className="wb-set-switch" checked={state.learnFromKept} onChange={(e) => save({ ...state, learnFromKept: e.target.checked })} />
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
                  save(confirming === 'all' ? { memories: [], kept: [], learnFromKept: state.learnFromKept } : { ...state, kept: [] });
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
