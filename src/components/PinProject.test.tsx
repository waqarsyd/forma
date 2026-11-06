// @vitest-environment jsdom
/**
 * The pin beside the report's title (2026-11-06): the projects list's own pin,
 * which the title showed as a star until the workspace audit, pinned and
 * unpinned, saying which.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import PinProject from './PinProject';

afterEach(cleanup);

describe('PinProject', () => {
  it('pins and unpins the project, saying which, and offers no rating', () => {
    const onPin = vi.fn();
    const { rerender } = render(<PinProject pinned={false} onPin={onPin} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pin this project' }));
    expect(onPin).toHaveBeenCalledTimes(1);
    rerender(<PinProject pinned onPin={onPin} />);
    expect(screen.getByRole('button', { name: 'Unpin this project' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByRole('button', { name: /report$/ })).toBeNull();
  });
});
