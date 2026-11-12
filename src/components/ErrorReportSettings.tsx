/**
 * "Send error reports", a row of Settings → General (2026-11-12, Owner
 * decision 10, the full audit's SA-15; lib/errorReport.ts). Off unless the
 * person turns it on, offered only signed in, and kept in this browser for
 * that account alone, so the next person to sign in here sends nothing until
 * they choose to. A change applies as it is made, as the rest of Settings.
 */
import { useState } from 'react';
import { readErrorReporting, writeErrorReporting } from '../lib/errorReport';

export interface ErrorReportSettingsProps {
  user: { uid: string; emailVerified?: boolean };
}

export default function ErrorReportSettings({ user }: ErrorReportSettingsProps) {
  const [on, setOn] = useState(() => readErrorReporting(user.uid));
  return (
    <div className="wb-set-row">
      <div className="wb-set-text">
        <label className="wb-set-label" htmlFor="wb-set-error-reports">Send error reports</label>
        <p>
          Off unless you turn it on. When part of Forma stops working, a short note goes to Forma&apos;s maintainer so it can be
          fixed: the day, the version, which part failed and the error&apos;s message, with addresses, keys, file names, links and
          long numbers taken out. Never your reports, your words or who you are. For your account, in this browser.
          {user.emailVerified === false ? ' Verify your email address first; until then nothing is sent.' : ''}
        </p>
      </div>
      <input
        id="wb-set-error-reports"
        type="checkbox"
        role="switch"
        className="wb-set-switch"
        checked={on}
        onChange={(e) => {
          setOn(e.target.checked);
          writeErrorReporting(user.uid, e.target.checked);
        }}
      />
    </div>
  );
}
