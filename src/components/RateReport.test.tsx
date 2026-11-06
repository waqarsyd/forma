// @vitest-environment jsdom
/**
 * A star and two thumbs beside the report's title (2026-11-06), as Stitch's
 * on a screen: the star the project's pin, the thumbs the rating of the reply
 * that made the report, a second press taking a rating back.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import RateReport from './RateReport';

afterEach(cleanup);

describe('RateReport', () => {
  it('stars and unstars the project, saying which it is', () => {
    const onStar = vi.fn();
    const { rerender } = render(<RateReport starred={false} onStar={onStar} />);
    fireEvent.click(screen.getByRole('button', { name: 'Star this project' }));
    expect(onStar).toHaveBeenCalledTimes(1);
    rerender(<RateReport starred onStar={onStar} />);
    expect(screen.getByRole('button', { name: 'Unstar this project' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByRole('button', { name: 'Good report' })).toBeNull();
  });

  it('rates the report, and a second press takes the rating back', () => {
    const onRate = vi.fn();
    const { rerender } = render(<RateReport starred={false} onRate={onRate} />);
    expect(screen.queryByRole('button', { name: /Star/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Good report' }));
    expect(onRate).toHaveBeenLastCalledWith('good');
    rerender(<RateReport starred={false} rating="good" onRate={onRate} />);
    fireEvent.click(screen.getByRole('button', { name: 'Good report' }));
    expect(onRate).toHaveBeenLastCalledWith(undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Bad report' }));
    expect(onRate).toHaveBeenLastCalledWith('bad');
  });
});
