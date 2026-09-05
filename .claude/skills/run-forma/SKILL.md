---
name: run-forma
description: Launch Forma and drive it end to end — dev server, headless Edge over CDP, attach a file, generate a report, send a chat turn, screenshot, and read back what the status bar and the REPX audit actually say. Use for running the app, confirming a change works in the real UI, or capturing screenshots. Covers the Windows-specific launch and teardown that make this work here.
---

# Running Forma

The app is an Express server with Vite in middleware mode, a React workspace, and
a browser-side Gemini call. Running it means opening the workspace, giving it a
file, and watching a report come out — not importing `geminiService` and logging
the result.

Two things make that possible without a Gemini key or any change to the repo:

- **`VITE_FORMA_MOCK=true`** returns a canned response after a 3s sleep instead of
  calling Google. It covers both paths — generation *and* a chat turn — so the
  whole workspace is exercisable offline.
- **`hasApiKey` is a non-empty check.** Nothing validates the key until a request
  is made, and in mock mode none is. Seeding `sessionStorage` unlocks the
  composer with no network call.

## The sequence

Four steps. Run them in order; the teardown is not optional.

### 1. Start the dev server

```powershell
$env:VITE_FORMA_MOCK='true'; npm run dev
```

Background it. It comes up on <http://localhost:3000> in about 5 seconds; confirm
with `Invoke-WebRequest http://localhost:3000/ -UseBasicParsing` before driving
anything, because a driver pointed at a dead port fails in a way that looks like
a broken selector.

**This is the one sanctioned exception to "the dev server belongs in the user's
terminal".** CLAUDE.md allows taking port 3000 for a short, self-contained check
provided you free it afterwards. A server left running in an agent shell outlives
the task and takes the port from the user.

Drop `VITE_FORMA_MOCK` only if the user supplies a real key and asks for real
output. Never put a key on a command line or in `.env`; type it into the Settings
dialog, where it goes to `sessionStorage` and never to disk.

### 2. Launch headless Edge

```powershell
$sp   = "<scratchpad>"                     # never inside the repo
$edge = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
Start-Process -FilePath $edge -ArgumentList `
  "--headless=new","--disable-gpu","--remote-debugging-port=9222", `
  "--remote-allow-origins=*","--user-data-dir=`"$sp\edge-profile`"", `
  "--window-size=1600,1000","about:blank"
Start-Sleep -Seconds 8
Invoke-WebRequest http://127.0.0.1:9222/json/version -UseBasicParsing   # must answer
```

**Edge, not the Claude-in-Chrome extension.** The extension cannot reach this
machine's localhost — every navigation to `localhost:3000` returns *"Frame with ID
0 is showing error page"* while the same URL is fine from PowerShell and from the
user's own browser. Site permissions, a fresh tab and re-selecting the browser all
fail. Do not re-diagnose it.

**`Start-Process`, never the `&` call operator.** `msedge.exe` is a GUI-subsystem
binary, so PowerShell does not block on it and sets no `$LASTEXITCODE`. With `&`
the next statement runs while Edge is still starting and everything downstream
reports "missing" — which reads as headless being broken when it is a race.

Three `ERROR:` lines on stderr are normal on this box (Edge LLM "Not supported on
non Desktop SKU", a task_manager fallback complaint, a geolocation class-not-
registered). Judge success by the CDP endpoint answering.

### 3. Drive it

[`drive.mjs`](drive.mjs) beside this file is the driver. It is dependency-free —
Node 20+ has a global `WebSocket` and `fetch`, so no puppeteer and no playwright,
neither of which this project has any other reason to install.

```powershell
node .claude/skills/run-forma/drive.mjs --out $sp `
  --attach docs/media/screenshot.png `
  --say "Move the invoice title to the top right." `
  --pane REPX
```

| Flag | |
|---|---|
| `--out <dir>` | screenshots and `console.txt` land here |
| `--url <url>` | default `http://localhost:3000/workspace` |
| `--attach <file>` | attach before generating; repeatable |
| `--prompt <text>` | text sent with the generation |
| `--say <text>` | a chat turn after the report; repeatable |
| `--pane <name>` | open `Mockup`, `Spec` or `REPX` at the end |
| `--no-key` | skip the seeded key, to see the locked state |
| `--wait <s>` | generation timeout, default 60 |

It prints the document title, whether the composer unlocked, how long the
generation took, **the status bar text, and the REPX audit** — chip plus the full
findings out of its `title` attribute, or `clean` when there is no chip. It exits
non-zero when a step cannot complete, so it works as a check and not only as a
demo. Every screenshot is numbered in order.

`docs/media/screenshot.png` is a convenient thing to attach: it is committed, it
is a real image, and it is large enough to exercise the upload optimiser.

### 4. Tear down

```powershell
# stop the dev server (TaskStop on the background shell), then:
Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" |
  Where-Object { $_.CommandLine -like '*<your session id>*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```

**Filter by the profile path in the command line. Never kill `msedge` by name** —
this is a shared RDP server with other live users on it.

Then delete the profile, because `sessionStorage` lives inside it:

```powershell
$empty = Join-Path $sp "_empty"; New-Item -ItemType Directory -Force $empty | Out-Null
& robocopy $empty "$sp\edge-profile" /MIR /NFL /NDL /NJH /NJS /R:0 /W:0 | Out-Null
Remove-Item -LiteralPath "$sp\edge-profile","$empty" -Recurse -Force
```

`Remove-Item -Recurse` alone fails with *"Could not find a part of the path
'noto-sans-regular.woff'"* — Edge's font cache exceeds the classic path limit.
The robocopy mirror-from-empty gets under it. Robocopy exits 1-3 on success, so
its non-zero exit is not a failure.

Finish by confirming port 3000 has no listener and `git status` is clean.

## Reading the result

**Look at the screenshots.** A blank frame is a failed launch, and the driver
cannot tell you that — every wait it does would still have passed.

The status bar is the app's own summary of the file it would export: `Idle`, the
DevExpress version, `units N/in`, the band count, and — only when something is
structurally wrong — a `N REPX warning` chip whose tooltip carries every finding.
Silence there is the good case. See `src/lib/repxAudit.ts` for what it checks and
why each check exists.

## Selectors worth knowing

They live in one block at the top of `drive.mjs`; these are the ones that surprise.

- **One composer does both jobs.** `[aria-label="Send note"]` calls
  `handleGenerate()`, which decides between a generation and a chat turn from
  whether anything is attached. There is no separate chat box.
- The panes are plain buttons reading exactly `Mockup`, `Spec` and `REPX`.
  Matching on `REPX` alone can also hit a `Specs & REPX` tab in older shells.
- The status bar is `.wb-status`; the audit chip is `.wb-warn` / `.wb-bad`
  inside it; the note count is `.wb-kicker`.

## Two CDP traps this cost a session to learn

- **File input:** `DOM.getDocument` → `DOM.querySelector` → `DOM.setFileInputFiles`
  with the **nodeId**. Passing an `objectId` obtained from `Runtime.evaluate` does
  not fire the change event, and the attachment silently never arrives.
- **Typing:** `Input.insertText` after a real click to focus. Assigning `.value`
  or dispatching a synthetic `input` event reports success while React's state
  stays empty, so the send button acts on nothing.

Both are why `drive.mjs` clicks with `Input.dispatchMouseEvent` rather than
calling `el.click()`.

## If you edit this driver

Keep `drive.mjs` **pure ASCII**. PowerShell 5.1 decodes a BOM-less script as ANSI,
so any non-ASCII character in it is one round-trip from mojibake — the same trap
CLAUDE.md documents for source files.

`npm run lint:encoding` covers `.claude/` as of 2026-09-05, so a corrupted em dash
in this file or in the driver now fails the check rather than sitting here. That
catches mojibake, not plain non-ASCII: a correctly-encoded `—` typed into
`drive.mjs` passes the sweep and still breaks the moment PowerShell reads the
script. The ASCII rule is on you.
