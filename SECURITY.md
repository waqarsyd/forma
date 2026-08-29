# Security

## Reporting a vulnerability

Email **waqarsayyed.official@gmail.com** with "Forma security" in the subject, or use
GitHub's [private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
on this repository.

Please do not open a public issue for anything that could expose someone's API key or
their saved reports. Everything else is fine in the open.

This is one person's project, not a company with an on-call rota. Expect an
acknowledgement within a few days.

## What the threat model actually is

Forma has **no backend of its own**. There is no Forma server holding user data, so
there is no server to breach. That shapes what is and is not worth reporting.

**Your Gemini API key never reaches a server belonging to this project.** The browser
calls Google directly with it. The key lives in `sessionStorage` and the browser erases
it when the tab closes. If you opt into cross-device sync, it is encrypted **in your
browser** under a passphrase you choose (PBKDF2-SHA256, 310,000 iterations, per-record
salt and IV, then AES-GCM) and only the ciphertext is uploaded. The passphrase never
leaves your machine, so a forgotten passphrase cannot be recovered — by anyone,
including whoever runs a deployment. That is the design, not an oversight.

The interesting reports are therefore things like:

- a path by which the key reaches `localStorage`, a cookie, a log, the DOM, or any
  network request other than Google's API;
- a Firestore rule that lets one account read or write another's reports or key vault
  (`firestore.rules`, with tests in `tests/`);
- anything that weakens the vault: a wrong KDF parameter, a reused IV or salt, a
  downgrade path, ciphertext accepted without validation;
- XSS or injection through an uploaded file, a generated report, or the markdown
  specification, since all three are rendered in the browser;
- a way to make the app send an attachment somewhere it should not go.

## Known and deliberate

- **The `AIzaSy…` string in `firebase-applet-config.json` is not a secret.** It is a
  public Firebase project identifier, shipped in every Firebase web app by design.
  Access is controlled by `firestore.rules`, not by hiding that value. Please do not
  report it; do report a rule that fails to constrain it.
- **Generation runs in the browser and is staying there.** Moving it server-side is
  explicitly out of scope (`docs/PRD.md` §6) — a server would mean Forma holding keys,
  which is the thing this design exists to avoid.
- If you self-host, the Firebase project is yours. Restrict your own API key and deploy
  your own rules; see the setup walkthrough in `README.md`.

## Supported versions

The `main` branch is the only supported version. There are no release branches and no
backports.
