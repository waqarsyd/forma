// @vitest-environment jsdom
/**
 * The Preview's rail (2026-11-11, the full audit's CP-03): Select, Mark an
 * area, and Compare with the original only for a report made from a picture.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import PreviewRail from './PreviewRail';

afterEach(cleanup);

describe('PreviewRail', () => {
  it('offers Compare only when there is an original, and toggles it back to Select', () => {
    const onTool = vi.fn();
    const { rerender } = render(<PreviewRail tool="select" onTool={onTool} canCompare={false} />);
    expect(screen.queryByLabelText('Compare with the original')).toBeNull();
    rerender(<PreviewRail tool="select" onTool={onTool} canCompare />);
    fireEvent.click(screen.getByLabelText('Compare with the original'));
    expect(onTool).toHaveBeenLastCalledWith('compare');
    rerender(<PreviewRail tool="compare" onTool={onTool} canCompare />);
    expect(screen.getByLabelText('Compare with the original').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByLabelText('Compare with the original'));
    expect(onTool).toHaveBeenLastCalledWith('select');
  });

  it('keeps Select and Mark an area as they were', () => {
    const onTool = vi.fn();
    render(<PreviewRail tool="mark" onTool={onTool} canCompare={false} />);
    expect(screen.getByLabelText('Mark an area').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByLabelText('Mark an area'));
    expect(onTool).toHaveBeenLastCalledWith('select');
    fireEvent.click(screen.getByLabelText('Select'));
    expect(onTool).toHaveBeenLastCalledWith('select');
  });
});
