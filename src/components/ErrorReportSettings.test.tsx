// @vitest-environment jsdom
/**
 * "Send error reports" in Settings → General (2026-11-12, Owner decision 10):
 * off until turned on, one account's choice only, and a change that starts
 * or stops the reports as it is made. jsdom for localStorage.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import ErrorReportSettings from './ErrorReportSettings';
import { readErrorReporting, startErrorReports } from '../lib/errorReport';
import { hasErrorSink, setErrorSink } from '../lib/errorSink';

afterEach(() => {
  cleanup();
  localStorage.clear();
  startErrorReports(null);
  setErrorSink(null);
});

const toggle = () => screen.getByRole('switch', { name: 'Send error reports' }) as HTMLInputElement;

describe('ErrorReportSettings', () => {
  it('is off unless turned on, and says what a report holds and what it never does', () => {
    render(<ErrorReportSettings user={{ uid: 'alice', emailVerified: true }} />);
    expect(toggle().checked).toBe(false);
    expect(document.body.textContent).toMatch(/Off unless you turn it on/);
    expect(document.body.textContent).toMatch(/Never your reports, your words or who you are/);
    expect(document.body.textContent).not.toMatch(/Verify your email address/);
  });

  it('turns reporting on for this account, and off again, as it is changed', () => {
    startErrorReports({ uid: 'alice', send: async () => undefined });
    render(<ErrorReportSettings user={{ uid: 'alice', emailVerified: true }} />);
    fireEvent.click(toggle());
    expect(readErrorReporting('alice')).toBe(true);
    expect(hasErrorSink()).toBe(true);
    fireEvent.click(toggle());
    expect(readErrorReporting('alice')).toBe(false);
    expect(hasErrorSink()).toBe(false);
  });

  it('does not carry one account\'s choice to the next person signed in here', () => {
    render(<ErrorReportSettings user={{ uid: 'alice', emailVerified: true }} />);
    fireEvent.click(toggle());
    cleanup();
    render(<ErrorReportSettings user={{ uid: 'bob', emailVerified: true }} />);
    expect(toggle().checked).toBe(false);
  });

  it('says nothing is sent until the address is verified', () => {
    render(<ErrorReportSettings user={{ uid: 'alice', emailVerified: false }} />);
    expect(document.body.textContent).toMatch(/Verify your email address first; until then nothing is sent/);
  });
});
