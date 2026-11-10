// @vitest-environment jsdom
/**
 * Usage today at the top of Settings (2026-11-05), as Stitch's settings open
 * with its daily credits: requests sent from this browser to each model, with
 * a bar only where Google has stated the model's limit.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import UsageSettings from './UsageSettings';
import { pacificDay } from '../lib/requestCount';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const now = new Date('2026-11-05T20:00:00Z');

describe('UsageSettings', () => {
  it("lists today's requests by model, most first, with a bar against a limit Google stated", () => {
    localStorage.setItem('forma:requestsToday', JSON.stringify({ day: pacificDay(now), counts: { 'gemini-flash-lite-latest': 2, 'gemini-2.5-flash': 7 } }));
    localStorage.setItem('forma:dailyLimits', JSON.stringify({ 'gemini-2.5-flash': 20 }));
    render(<UsageSettings now={now} />);
    const rows = within(screen.getByRole('list', { name: 'Requests sent today, by model' })).getAllByRole('listitem');
    expect(rows.map((r) => r.textContent)).toEqual(['Gemini 2.5 Flash7 of 20', 'Gemini Flash-Lite (latest)2 today']);
    expect(within(rows[0]).getByRole('img').getAttribute('aria-label')).toBe("35% of the day's limit");
    expect(within(rows[1]).queryByRole('img')).toBeNull();
    // 20:00 UTC is noon Pacific (standard time since 1 November): twelve hours to go.
    expect(document.body.textContent).toMatch(/starts again in 12 h 0 min/);
  });

  it('says when nothing has been sent today', () => {
    render(<UsageSettings now={now} />);
    expect(screen.getByText('No requests from this browser today.')).toBeTruthy();
  });
});
