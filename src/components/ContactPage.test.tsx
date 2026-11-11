// @vitest-environment jsdom
/**
 * The contact form's topics (2026-11-11, the full audit's batch PSB, PS-27):
 * a security issue is not one of them, since the form passes through a
 * third-party relay and the page sends it to the private routes instead, and
 * a shared report's "Report this link" arrives with its own topic chosen.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';

vi.mock('../lib/contactSubmit', () => ({ submitContactMessage: vi.fn(async () => undefined) }));

import ContactPage, { SHARED_LINK_TOPIC, TOPICS, topicFromSearch } from './ContactPage';

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

const page = () =>
  render(
    <ContactPage
      onEnterWorkspace={vi.fn()}
      onSignIn={vi.fn()}
      onSignUp={vi.fn()}
      user={null}
      logOut={vi.fn()}
      isDarkMode={false}
      setIsDarkMode={vi.fn()}
    />,
  );

describe('ContactPage topics', () => {
  it('offers no security topic, and says where a security issue goes', () => {
    page();
    const select = screen.getByLabelText(/What is this about\?/) as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.textContent);
    expect(options).not.toContain('A security issue');
    expect(options).toContain('A shared link that should not be public');
    expect(TOPICS).toContain(SHARED_LINK_TOPIC);
    expect(select.value).toBe('');
    const hint = screen.getByText('Security issue? Use one of the private routes on this page instead.');
    expect(select.getAttribute('aria-describedby')).toContain(hint.id);
  });

  it('chooses the shared-link topic when a shared report sends someone here', async () => {
    window.history.replaceState(null, '', '/contact?topic=shared#form');
    page();
    const select = screen.getByLabelText(/What is this about\?/) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe(SHARED_LINK_TOPIC));
    expect(topicFromSearch('?topic=other')).toBe('');
    expect(topicFromSearch('')).toBe('');
  });

  it('keeps the line for a recruiter off the page', () => {
    page();
    expect(screen.queryByText(/The application is the portfolio/)).toBeNull();
  });
});
