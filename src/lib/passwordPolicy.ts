/**
 * The shortest password a new account or a changed password may have
 * (2026-11-08, site audit item 61): 8, NIST SP 800-63B's floor and what the
 * big sites ask, where it was Firebase's own minimum of 6. Checked in the
 * sign-up form and the account dialog; an existing account's shorter password
 * still signs in, since only the person can choose a new one.
 *
 * The browser's check is advice, not enforcement: Firebase Authentication
 * accepts 6 unless its password policy says otherwise, which is a setting in
 * the Firebase console (Authentication, Settings, Password policy) that the
 * owner turns on. README's Firebase walkthrough lists it.
 */
export const MIN_PASSWORD = 8;
