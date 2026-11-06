// @vitest-environment jsdom
/**
 * The zoom at the corner as a field (2026-11-06, the owner's request): a
 * size typed and confirmed with Enter, kept inside 10% to 400%, Escape
 * putting the number back, and Stitch's 100% / Fit / Selection menu.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import ZoomField, { readPercent } from './ZoomField';

afterEach(cleanup);

const field = () => screen.getByLabelText('Zoom, in percent') as HTMLInputElement;

describe('readPercent', () => {
  it('reads 150 and 150% alike, rounds, and keeps the size inside 10% to 400%', () => {
    expect(readPercent('150')).toBe(150);
    expect(readPercent(' 150% ')).toBe(150);
    expect(readPercent('87.6')).toBe(88);
    expect(readPercent('2')).toBe(10);
    expect(readPercent('900')).toBe(400);
    expect(readPercent('abc')).toBeNull();
    expect(readPercent('')).toBeNull();
    expect(readPercent('0')).toBeNull();
  });
});

describe('ZoomField', () => {
  it('shows the size, takes a typed one on Enter, and sets nothing when it did not change', () => {
    const onSet = vi.fn();
    render(<ZoomField percent={93} onSet={onSet} onFit={vi.fn()} mac={false} />);
    expect(field().value).toBe('93%');
    fireEvent.focus(field());
    expect(field().value).toBe('93');
    fireEvent.change(field(), { target: { value: '150' } });
    fireEvent.blur(field());
    expect(onSet).toHaveBeenCalledWith(150);
    expect(field().value).toBe('93%');
    onSet.mockClear();
    fireEvent.focus(field());
    fireEvent.blur(field());
    expect(onSet).not.toHaveBeenCalled();
  });

  it('puts the number back on Escape, and ignores what is not a number', () => {
    const onSet = vi.fn();
    render(<ZoomField percent={93} onSet={onSet} onFit={vi.fn()} mac={false} />);
    fireEvent.focus(field());
    fireEvent.change(field(), { target: { value: 'big' } });
    fireEvent.blur(field());
    expect(onSet).not.toHaveBeenCalled();
    fireEvent.focus(field());
    fireEvent.change(field(), { target: { value: '200' } });
    fireEvent.keyDown(field(), { key: 'Escape' });
    expect(field().value).toBe('93%');
  });

  it('steps by ten with the arrows', () => {
    const onSet = vi.fn();
    render(<ZoomField percent={93} onSet={onSet} onFit={vi.fn()} mac={false} />);
    fireEvent.focus(field());
    fireEvent.keyDown(field(), { key: 'ArrowUp' });
    expect(onSet).toHaveBeenLastCalledWith(103);
  });

  // Found in the owner's Chrome: the blur a choice causes applied the typed size over it.
  it('keeps a size chosen from the menu, not the one typed before it', () => {
    const onSet = vi.fn();
    render(<ZoomField percent={93} onSet={onSet} onFit={vi.fn()} mac={false} />);
    field().focus();
    fireEvent.change(field(), { target: { value: '150' } });
    fireEvent.mouseDown(screen.getByRole('button', { name: /100%/ }));
    expect(onSet.mock.calls).toEqual([[100]]);
  });

  it('offers 100%, Fit and, with a selection, Selection while it has focus', () => {
    const onSet = vi.fn();
    const onFit = vi.fn();
    const onSelection = vi.fn();
    render(<ZoomField percent={93} onSet={onSet} onFit={onFit} onSelection={onSelection} mac={false} />);
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.focus(field());
    fireEvent.mouseDown(screen.getByRole('button', { name: /100%/ }));
    expect(onSet).toHaveBeenCalledWith(100);
    fireEvent.focus(field());
    fireEvent.mouseDown(screen.getByRole('button', { name: /Fit/ }));
    expect(onFit).toHaveBeenCalled();
    fireEvent.focus(field());
    expect(screen.getByRole('button', { name: /Selection/ }).textContent).toContain('Shift+2');
  });
});
