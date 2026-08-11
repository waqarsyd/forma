import { useEffect, useRef, useState } from 'react';
import { useInView, useReducedMotion } from 'motion/react';
import { IconArrowDown } from './icons';

/**
 * The key vault, shown rather than described: a plaintext key scrambles
 * character by character into the ciphertext that is all Forma ever stores.
 *
 * The strings are illustrative — the real key never leaves the browser, which is
 * the point the figure exists to make. Runs once on scroll into view; reduced
 * motion lands straight on the ciphertext.
 */

const PLAIN = 'AIzaSyD7k2Qx9LmV4pR8tN3bW6eH1oU5cZ0jY';
const CIPHER = 'k9Twm2XqA0vLb7Rd41ZpNc6Hy8Ue3JsF5OgM+i2Qx==';
const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';

const FRAMES = 44;
const FRAME_MS = 34;

const ROW = 'grid gap-1.5 border-b border-outline-variant px-[18px] py-4';
const LABEL =
  'font-code-sm text-[9.5px] leading-[1.62] font-medium tracking-[0.13em] uppercase text-[color:var(--ink-faint)]';
const VALUE = 'min-h-5 font-code-sm text-[12px] leading-[1.5]';
const META = 'font-body-lg text-[12px] leading-[1.5] text-[color:var(--ink-faint)]';

export default function VaultFigure() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.4 });
  const prefersReduced = useReducedMotion();
  const [cipher, setCipher] = useState('');

  useEffect(() => {
    if (!inView) return;

    if (prefersReduced) {
      setCipher(CIPHER);
      return;
    }

    let frame = 0;
    let timer = 0;

    const scramble = () => {
      const settled = Math.floor(CIPHER.length * (frame / FRAMES));
      let text = CIPHER.slice(0, settled);
      for (let i = settled; i < CIPHER.length; i++) {
        text += ALPHA[Math.floor(Math.random() * ALPHA.length)];
      }
      setCipher(text);
      frame += 1;
      if (frame <= FRAMES) timer = window.setTimeout(scramble, FRAME_MS);
      else setCipher(CIPHER);
    };

    scramble();
    return () => clearTimeout(timer);
  }, [inView, prefersReduced]);

  return (
    <div
      ref={ref}
      className="overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest dark:bg-card shadow-[var(--shadow-lg),var(--inset-hi)]"
    >
      <div className="flex items-center gap-2.5 border-b border-outline-variant bg-surface-container-low px-[18px] py-[13px] font-code-sm text-[10px] leading-[1.62] font-medium tracking-[0.11em] uppercase text-[color:var(--ink-faint)]">
        <span className="h-1.5 w-1.5 rounded-full bg-secondary-container" />
        users/&#123;uid&#125;/vault/geminiKey
      </div>

      <div className={ROW}>
        <div className={LABEL}>your key, in the browser</div>
        <div className={`${VALUE} break-all text-on-surface`}>{PLAIN}</div>
      </div>

      <div className="flex items-center justify-center gap-[9px] border-b border-outline-variant bg-surface-container-low px-3 py-[9px] text-center font-code-sm text-[9.5px] leading-[1.62] font-medium tracking-[0.1em] text-[color:var(--ink-faint)]">
        <IconArrowDown size={11} />
        PBKDF2-SHA256 · 310,000 iterations
      </div>

      <div className={ROW}>
        <div className={LABEL}>what Forma stores</div>
        <div className={`${VALUE} break-all text-secondary`}>{cipher || '—'}</div>
        <div className={META}>
          AES-GCM ciphertext with its salt, IV and iteration count. Nothing that can decrypt it.
        </div>
      </div>

      <div className={`${ROW} border-b-0`}>
        <div className={LABEL}>what the operator can read</div>
        <div className={`${VALUE} text-success`}>nothing</div>
        <div className={META}>The passphrase never leaves your browser.</div>
      </div>
    </div>
  );
}
