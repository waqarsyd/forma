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

**Your Gemini API key never reaches a server belonging to this project.** On the website
the browser calls Google directly with it. The key lives in `sessionStorage` and the browser
erases it when the tab closes. If you opt into cross-device sync, it is encrypted **in your
browser** under a passphrase you choose (PBKDF2-SHA256, 310,000 iterations, per-record
salt and IV, then AES-GCM) and only the ciphertext is uploaded. The passphrase never
leaves your machine, so a forgotten passphrase cannot be recovered — by anyone,
including whoever runs a deployment. That is the design, not an oversight. Forma's MCP
server, below, is a program you run yourself and keeps its key differently; its section says
how.

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
- **A request only from the two AI tools, and only to the AI you set up.** `generate_report`
  and `revise_report` send the files' pages, the text OCR read from them on your computer,
  your words and the report to Google's Gemini API, OpenRouter, or a Local AI server, with
  your own key, never through Forma; the other tools make no request at all. No Content
  Security Policy stands behind a Node process, so the code is the bound: every Gemini client
  is built pinned to Gemini's address, so no `GOOGLE_*` variable can move it to another
  endpoint; a Local AI address is accepted only on this computer (`localhost`, `127.0.0.1` or
  `[::1]`, with no user name or password), and anything else refuses the AI tools; and
  `legalDisclosure.test.ts` fails on any host the server's imports reach that the privacy
  policy does not name. OCR reads only the language files and models in the clone, never a
  CDN.
- **The key is yours, read once, and scrubbed.** It reads no `.env`, and only its entry reads
  the environment: your key under Forma's own names (`FORMA_GEMINI_KEY`,
  `FORMA_OPENROUTER_KEY`), never a `GEMINI_API_KEY` or `GOOGLE_API_KEY` set for something
  else, which it deletes from its environment, with Google's Vertex AI switches, before the
  Gemini SDK loads; its own two key variables are deleted once read, so no worker thread
  inherits them. Every result, error and line on stderr has keys taken out, by their shapes
  and by the exact values it was given. Where the key is stored is your host's: readable, in
  its configuration file or, through a `${FORMA_GEMINI_KEY}` reference, your environment.
  Keep it in a file of your own, never one a project commits.
- **One AI call at a time, and a stop that stops.** A second call waits for the first; a
  cancellation ends the work's thread at once, so nothing is sent after it and nothing is
  written.

Worth reporting about it, then:

- a path outside the folders in effect that a tool reads or writes, by any spelling, link,
  junction or short name;
- any file-system call, or SMB connection, made for a path before it was checked;
- a file replaced, or written into a dot-folder or `node_modules`, without the call asking;
- anything but a protocol message on stdout, or a key or a stored login on stderr;
- a report whose text reaches the assistant outside `fromFile`, or steers what the server does;
- a stored database login that reaches a result or a written file;
- a report that stops the server, or keeps it from answering other calls;
- a network request made by a tool that needs no AI, or one an AI tool makes to anything but
  the AI set up, a Local AI server off this computer included;
- a key in a result, on stderr or in a file the server writes, or a key taken from a `.env`,
  a `GEMINI_API_KEY` or a `GOOGLE_API_KEY`;
- a request sent, or a file written, after the call was cancelled.

Known and deliberate there: what a tool returns goes to the assistant and the AI behind it,
under that assistant's own terms; what the AI tools send goes to the AI you set up, under that
provider's terms (on Gemini's free tier Google may use it to improve its products); when the AI
you chose reaches a limit, another AI you also set up answers, never after a Local AI, and the
result says so; the key is stored wherever your host keeps the server's entry, readable, and the
server only reads it; a hard link inside a folder is read as the file it is, since
making one takes access to that file already; the host's own permission prompts, not the
server, decide which calls run without asking you; and a JSON data source's stored credentials
are not taken out yet, since whether DevExpress 20.1 writes them into a `.repx` is still to be
measured.

## Known and deliberate

- **The `AIzaSy…` string in `firebase-applet-config.json` is not a secret.** It is a
  public Firebase project identifier, shipped in every Firebase web app by design.
  Access is controlled by `firestore.rules`, not by hiding that value. Please do not
  report it; do report a rule that fails to constrain it.
- **Generation runs in the browser, or in Forma's MCP server on your own computer, never on
  a server of this project's.** Moving it server-side is explicitly out of scope
  (`docs/PRD.md` §6) — a server would mean Forma holding keys, which is the thing this design
  exists to avoid. Forma's MCP server is not that: it is your own program on your own
  computer, with no port, holding only your files and your own key.
- If you self-host, the Firebase project is yours. Restrict your own API key and deploy
  your own rules; see the setup walkthrough in `README.md`.

## Supported versions

The `main` branch is the only supported version. There are no release branches and no
backports.
