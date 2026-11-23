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

## Forma's MCP server

`src/mcp` is the one part of Forma that runs as a program on your computer with access to
your files: an AI assistant's host (Claude Code, Visual Studio, VS Code, Claude Desktop) starts
it from a clone with `node <clone>/src/mcp/run.mjs`. It is not a backend: the website never
runs it, and nothing of it is deployed. What it is built to hold:

- **stdio only.** It talks to the host that started it over stdin and stdout and opens no
  port, so no other user of the computer, and no web page, can reach it. Only protocol
  messages reach stdout; everything else goes to stderr, with keys taken out.
- **Only the folders in effect**: `FORMA_MCP_ROOTS`, else the folders the host hands it, else
  `CLAUDE_PROJECT_DIR`. A whole drive, the home folder or a folder holding it, and a dot-folder
  are refused as a folder for it.
- **Full paths only, judged before the disk is touched.** A relative name, `~` and a Git Bash
  `/g/...` path are refused; a UNC path is refused on the raw string, before any file-system
  call could open an SMB connection; every link and junction is followed and the real path
  checked against the folders, and a link to another computer is refused without being
  followed. A tool never reads or writes a dot-folder or a file named as credentials, never
  writes into `node_modules`, and never replaces a file unless the call asks.
- **A report's stored database login is removed before any tool reads it**, wherever the report
  stores its data sources (a subreport's and one kept in `ObjectStorage` included), and never
  reaches a result or a file the server writes; a report whose login cannot be taken out with
  certainty is refused.
- **One report costs one call.** A tool's work on a report runs in a worker thread bounded to
  30 seconds and 512 MB, and a file that is not well-formed XML is refused before anything reads
  it, so a report built to be slow or large is refused and the server goes on.
- **What a file says is data.** Text read from a report is returned only under `fromFile`,
  never in a summary, a description or an error, because a report made by someone else
  controls its own words and the assistant may have a shell.
- **No network, in this version.** No tool calls an AI, holds a key or makes a request to
  anyone. It reads no `.env`, and only its entry reads the environment.

Worth reporting about it, then:

- a path outside the folders in effect that a tool reads or writes, by any spelling, link,
  junction or short name;
- any file-system call, or SMB connection, made for a path before it was checked;
- a file replaced, or written into a dot-folder or `node_modules`, without the call asking;
- anything but a protocol message on stdout, or a key or a stored login on stderr;
- a report whose text reaches the assistant outside `fromFile`, or steers what the server does;
- a stored database login that reaches a result or a written file;
- a report that stops the server, or keeps it from answering other calls;
- a network request made by a tool.

Known and deliberate there: what a tool returns goes to the assistant and the AI behind it,
under that assistant's own terms; a hard link inside a folder is read as the file it is, since
making one takes access to that file already; the host's own permission prompts, not the
server, decide which calls run without asking you; and a JSON data source's stored credentials
are not taken out yet, since whether DevExpress 20.1 writes them into a `.repx` is still to be
measured.

## Known and deliberate

- **The `AIzaSy…` string in `firebase-applet-config.json` is not a secret.** It is a
  public Firebase project identifier, shipped in every Firebase web app by design.
  Access is controlled by `firestore.rules`, not by hiding that value. Please do not
  report it; do report a rule that fails to constrain it.
- **Generation runs in the browser and is staying there.** Moving it server-side is
  explicitly out of scope (`docs/PRD.md` §6) — a server would mean Forma holding keys,
  which is the thing this design exists to avoid. Forma's MCP server is not that: it is your
  own program on your own computer, with no port, holding only your files.
- If you self-host, the Firebase project is yours. Restrict your own API key and deploy
  your own rules; see the setup walkthrough in `README.md`.

## Supported versions

The `main` branch is the only supported version. There are no release branches and no
backports.
