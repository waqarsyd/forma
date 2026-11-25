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
server and its command line, below, are programs you run yourself and keep their key
differently; their sections say how.

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

`src/mcp` is the part of Forma that runs as a program with access to your files, in two
forms: this server, which an AI assistant's host (Claude Code, Visual Studio, VS Code, Claude
Desktop) starts from a clone with `node <clone>/src/mcp/run.mjs`, and the command line, next
below. Neither is a backend: the website never runs them, and nothing of them is deployed.
What the server is built to hold:

- **stdio only.** It talks to the host that started it over stdin and stdout and opens no
  port, so no other user of the computer, and no web page, can reach it. Only protocol
  messages reach stdout; everything else goes to stderr, with keys taken out.
- **Only the folders in effect**: `FORMA_MCP_ROOTS`, else the folders the host hands it, else
  `CLAUDE_PROJECT_DIR`. A whole drive, the home folder or a folder holding it, and a dot-folder
  are refused as a folder for it. Outside them the server writes only its own cache, in a
  per-user folder of Forma's under the home folder (`AppData\Local\Forma`, `Library/Caches/Forma`
  or `~/.cache/forma`): the OCR languages the AI tools read with, the Gemini model chosen for
  a key, and which of its models have reached a limit and until when, both filed by the key's
  32-bit tag, never the key. tsx, which runs it, keeps its compile cache in the system's temp
  folder.
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
- **A database's layout on your terms** (since 2026-11-25). The AI tools, `repx_edit` and
  `repx_convert` bind a report to a layout a call gives, as a file under the folders in effect
  or, through `connection`, read by Forma Designer on your PC. Two things are yours to allow in
  the server's entry, never a tool argument alone, since the host's model can be steered by a
  file it read: `FORMA_DATABASE_CONNECTIONS` lists the Forma Designer connections it may read,
  and `FORMA_DATABASE_SAMPLES=1` lets sample rows go to the AI. Forma Designer is started only
  from the entry's full path to it, never through `PATH` or a share, with no shell, its output
  piped, an environment of Windows' own variables with no key, a deadline and a byte cap, and
  only a build new enough to have the verbs; it never prints the server, the login or the
  password it keeps. Every name read from a layout, SQL Server's own words, and what a report
  binds are returned only under `fromFile`; no sample value is put in a result.

Worth reporting about it, then:

- a path outside the folders in effect that a tool reads or writes, by any spelling, link,
  junction or short name;
- any file-system call, or SMB connection, made for a path before it was checked;
- a file replaced, or written into a dot-folder or `node_modules`, without the call asking;
- anything but a protocol message on stdout, or a key or a stored login on stderr;
- a report whose text reaches the assistant outside `fromFile`, or steers what the server does;
- a stored database login that reaches a result or a written file;
- a report that stops the server, or keeps it from answering other calls;
- a network request made by a tool that needs no AI (Forma Designer's own connection to a
  SQL Server for a connection the entry lists aside), or one an AI tool makes to anything but
  the AI set up, a Local AI server off this computer included;
- a key in a result, on stderr or in a file the server writes, or a key taken from a `.env`,
  a `GEMINI_API_KEY` or a `GOOGLE_API_KEY`;
- a request sent, or a file written, after the call was cancelled;
- a Forma Designer connection read that the entry does not list, sample values sent while
  `FORMA_DATABASE_SAMPLES` is off, a sample value in a result, or a name read from a layout,
  or SQL Server's words, outside `fromFile`;
- Forma Designer started from anywhere but the path the entry worked out, handed another
  connections file, an environment with a key in it, or an argument a name could turn into a
  switch.

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

## Forma's command line

The same clone is a command line (since 2026-11-24), `node <clone>/src/mcp/cli.mjs <command>`,
which a person runs from any folder, on their own computer or on a CI runner they choose. It runs
the server's own calls, through a second entry in `src/mcp` (`cliEntry.ts`) that keeps the
server's order: the stdout guard first, then the environment read, the keys deleted before
anything can load the Gemini SDK or start a thread. What it is built to hold, beyond what the
server holds:

- **The folder it runs in stands for the server's roots.** A relative path is read from it once;
  every other form the server refuses is refused here too, a UNC path on the raw string, before
  any file-system call. No link the folder holds may lead out of it, a directory link a checkout
  carries included, and a path whose folder is elsewhere must land in that folder. A file named
  as credentials (Forma Designer's own store of connections among them) or one in a dot-folder
  below the folder it runs in is refused, and nothing is written into `node_modules`.
- **A batch never follows a link.** `batch` lists its folder level by level with the entries'
  own types, never Node's recursive readdir, which follows a junction out of the folder; a link
  or a junction is counted as left out, and every file is judged again at its turn, so one
  swapped for a link after the walk is refused then. Dot-folders, `node_modules`, the output
  folder and Forma's own outputs are left out; a data file is read only when `--data` names it.
- **Nothing replaced unless `--force`**, and never then a report whose stored login was taken
  out, nor a file `generate` is made from. A write goes to a temporary name, then is linked to
  its own, so a file that appears meanwhile is kept.
- **stdout carries results only**, through the same guard; `--json` lines are built from named
  fields, never a spread of the settings that hold the key. Every control character in a report's
  text or a file's name is printed as `?`, so a name with a line break in it cannot forge a line
  in a log a CI author reads. Keys are taken out of every line by their shapes and by the values
  it was given.
- **The key from the environment, under Forma's names, and nowhere else.** The same `FORMA_*`
  names as the server, never a `.env`, a `GEMINI_API_KEY` or a `GOOGLE_API_KEY`, which it
  deletes; never `FORMA_MCP_ROOTS` or `CLAUDE_PROJECT_DIR`, which a command run from an
  assistant's session would inherit; and its mock is a flag, never a variable left set in CI. In
  CI the key comes from the provider's store of secrets into the one step's environment, never
  onto the command line, and never on `pull_request_target`, which runs a fork's changes with
  the repository's secrets: the README's recipe gives the key only to a step that runs on a push.
- **Requests only from the commands that make and change a report**, `generate`, `revise` and a
  batch's files that ask the AI, and only to the AI set up, as the server's: the Gemini client
  pinned to Gemini's address, a Local AI only on the computer it runs on. Every other command
  makes none.
- **Forma Designer's verbs are a new way in, and are started narrowly** (since 2026-11-25, for
  `connections` and `--connection`, and the server's `database_connections` and `connection`).
  Only from the full path the entry worked out, the per-user install or `FORMA_DESIGNER`, never
  `PATH`, a bare name (which runs an exe planted in the folder a command runs in), a share or a
  link; only once the file's own version, read without starting it, says it has the verbs, so an
  older Forma Designer, which would open a window, is never started with one; every call ending
  `--check --no-load`, which an older build answers with its check and exits; with no shell,
  standard input closed, its output piped and capped at 64 MB, a deadline, a stop that kills it,
  and an environment of Windows' own variables with no key in it. A connection's name is held to
  Forma Designer's own rule and found among the names it lists before it is passed, so no name can
  read as a switch, and another connections file is never passed. Its words carry SQL Server's
  first line with the login, the account, the server and quoted values taken out.

Worth reporting about it, then:

- a file read or written that the person did not name, through a link the folder holds or a
  checkout carries, by any spelling;
- a batch that follows a link or a junction, or takes a file from outside its folder;
- a file replaced without `--force`, or a report whose login was taken out written over at all;
- anything but a result on stdout, a key or a stored login in any line, or a line forged by a
  file name or a report's text;
- a request from a command that needs no AI, or one an AI command makes to anything but the AI
  set up;
- a key taken from a `.env`, a `GEMINI_API_KEY` or a `GOOGLE_API_KEY`, or the AI's settings read
  from anywhere but the environment the command runs in;
- sample values sent without `--samples` or `--sample-objects`, or a sample value printed;
- Forma Designer started from anywhere but the path the entry worked out, an older Forma Designer
  started with a verb, an environment with a key in it, or a name turned into a switch.

Known and deliberate there: on a CI runner, the computer is the CI provider's, so the files and the
key are on it for the job, under that provider's terms; the key is stored wherever the person keeps
it, their environment or their CI provider's secrets, and the command line only reads it; a mapped
network drive is used as the person's own, over the share they mapped; a directory link on the way
to a folder the person named outside the folder it runs in is followed as theirs; and on Windows a
stop while a file that asks the AI is being made can end the process with 3221226505 in place of
130, nothing written either way.

## Known and deliberate

- **The `AIzaSy…` string in `firebase-applet-config.json` is not a secret.** It is a
  public Firebase project identifier, shipped in every Firebase web app by design.
  Access is controlled by `firestore.rules`, not by hiding that value. Please do not
  report it; do report a rule that fails to constrain it.
- **Generation runs in the browser, or in Forma's MCP server or its command line, programs you
  run on your own computer or a CI runner you choose, never on a server of this project's.**
  Moving it server-side is explicitly out of scope (`docs/PRD.md` §6) — a server would mean
  Forma holding keys, which is the thing this design exists to avoid. Forma's MCP server and its
  command line are not that: each is your own program, holding only your files and your own key,
  and the server opens no port.
- If you self-host, the Firebase project is yours. Restrict your own API key and deploy
  your own rules; see the setup walkthrough in `README.md`.

## Supported versions

The `main` branch is the only supported version. There are no release branches and no
backports.
