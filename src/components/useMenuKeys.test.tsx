// @vitest-environment jsdom
/**
 * A menu's keyboard (2026-11-06, the workspace audit): focus on the first
 * item as it opens, the arrows and Home and End moving between the items,
 * and focus back to the button that opened it when it closes.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { useRef, useState } from 'react';
import { useMenuKeys } from './useMenuKeys';

afterEach(cleanup);

function Menu({ onDone }: { onDone: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useMenuKeys(ref);
  return (
    <div role="menu" ref={ref}>
      <button role="menuitem">One</button>
      <button role="menuitem" disabled>Off</button>
      <button role="menuitem">Two</button>
      <button role="menuitem" onClick={onDone}>Three</button>
    </div>
  );
}

function Opener() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open</button>
      {open && <Menu onDone={() => setOpen(false)} />}
    </>
  );
}

describe('useMenuKeys', () => {
  it('focuses the first item, moves with the arrows past a disabled one and round the ends, and Home and End', () => {
    render(<Opener />);
    const opener = screen.getByRole('button', { name: 'Open' });
    opener.focus();
    fireEvent.click(opener);
    expect(document.activeElement?.textContent).toBe('One');
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement?.textContent).toBe('Two');
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(document.activeElement?.textContent).toBe('Three');
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement?.textContent).toBe('One');
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    expect(document.activeElement?.textContent).toBe('Three');
  });

  it('gives the focus back to the button that opened it', () => {
    render(<Opener />);
    const opener = screen.getByRole('button', { name: 'Open' });
    opener.focus();
    fireEvent.click(opener);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Three' }));
    expect(document.activeElement).toBe(opener);
  });
});
