---
name: run-forma
description: Launch Forma and drive it end to end — a mock dev server on 3001, the owner's Chrome through the extension (a CDP driver only when the owner asks for one), attach a file, generate a report, send a chat turn, screenshot, and read back what the REPX audit actually says. Use for running the app, confirming a change works in the real UI, or capturing screenshots. Covers the Windows-specific launch and teardown that make this work here.
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

### 1. Start the dev server, in mock mode on 3001

```powershell
$env:VITE_FORMA_MOCK='true'; $env:PORT='3001'; npm run dev
```

Background it. It comes up on <http://localhost:3001> in about 5 seconds; confirm
with `Invoke-WebRequest http://localhost:3001/ -UseBasicParsing` before driving
anything, because a driver pointed at a dead port fails in a way that looks like
a broken selector. Port 3000 is the owner's own server, which may be running;
3001 leaves it alone (the two share Vite's dependency cache, so start them one at
a time, as CLAUDE.md's Commands section says).

**This is the one sanctioned exception to "the dev server belongs in the user's
terminal".** CLAUDE.md allows taking a port for a short, self-contained check
provided you free it afterwards. A server left running in an agent shell outlives
the task.

**Signing in from it writes to a real account** unless the emulators are used:
start them (`npx firebase emulators:start --only auth,firestore`) and add
`$env:VITE_FIREBASE_EMULATORS='true'` before `npm run dev` (.env.example has the
details; it works only in development). A check that never signs in needs neither.

**One exception keeps 3000: the App Check test.** 3001 is not in the browser
key's referrers, so App Check's exchange can only be watched on the owner's
server at `localhost:3000`.

Drop `VITE_FORMA_MOCK` only if the user supplies a real key and asks for real
output. Never put a key on a command line or in `.env`; type it into the Settings
dialog, where it goes to `sessionStorage` and never to disk.

### 2. Open it in the owner's Chrome

Browser work happens in the owner's own Chrome, through the Claude-in-Chrome
extension, or in the owner's own Edge. That is the owner's standing rule since
2026-11-01, so the headless Edge below is not a fallback: it runs only when the
owner asks for it. Open `localhost:3001/workspace` in a tab of it and drive
it there: `find` for a control, `file_upload` to attach (paths in the session's
scratchpad, 10 MB a call), `javascript_tool` to read state. Its screenshots can
stall on a heavy pane, such as the REPX source, or in the unpainted RDP window;
reading the DOM answers anyway. Until 2026-10-31 the extension could not reach
this machine's localhost (*"Frame with ID 0 is showing error page"*); since the
owner logged it in on this server it does.

If the extension is not connected, say so and ask the owner rather than starting
a browser of your own.

### 3. The CDP driver, only when the owner asks for it

Everything from here to the end of step 3 is for a run the owner has asked to be
made with the driver (an unattended check, say). It launches a headless Edge
from the shell, which is exactly what the rule in step 2 otherwise rules out.

#### Launch headless Edge

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

**`Start-Process`, never the `&` call operator.** `msedge.exe` is a GUI-subsystem
binary, so PowerShell does not block on it and sets no `$LASTEXITCODE`. With `&`
the next statement runs while Edge is still starting and everything downstream
reports "missing" — which reads as headless being broken when it is a race.

Three `ERROR:` lines on stderr are normal on this box (Edge LLM "Not supported on
non Desktop SKU", a task_manager fallback complaint, a geolocation class-not-
registered). Judge success by the CDP endpoint answering.

#### Drive it

[`drive.mjs`](drive.mjs) beside this file is the driver. It is dependency-free —
Node 22+ has a global `WebSocket` and `fetch`, so no puppeteer and no playwright,
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
| `--url <url>` | any route — default `http://localhost:3001/workspace`, the mock server |
| `--attach <file>` | attach before generating; repeatable — workspace only |
| `--prompt <text>` | text sent with the generation — workspace only |
| `--say <text>` | a chat turn after the report; repeatable — workspace only |
| `--pane <name>` | open a pane at the end: `Mockup`, `Preview`, `Data`, `Spec` or `REPX` — workspace only |
| `--no-key` | remove the key, to see the composer locked |
| `--wait <s>` | generation timeout, default 60 |
| `--port <n>` | the CDP port to attach to, default 9222 — only needed if Edge was started on another one |

**`--url` works on any route**, and the driver adapts to it: it waits for the
composer on `/workspace` and for an `<h1>` anywhere else, since the workspace has
no heading until a report exists and a marketing page has no composer at all. The
four workspace-only flags are refused up front with exit 2 rather than timing out
inside a step that could never work. Verifying the marketing routes is therefore
one call per route:

```powershell
foreach ($r in '/','/features','/docs','/contact','/terms','/privacy','/nope') {
  node .claude/skills/run-forma/drive.mjs --out "$sp$($r -replace '/','-')" --url "http://localhost:3001$r"
}
```

It prints the document title, the rendered character count and `h1`, whether an
the composer is open or locked, how long the generation took, and — on the
workspace, once a report exists — **the report's title and the REPX audit**, read
from the REPX pane's audit box with every finding, or `clean` when there is no
box. It exits non-zero when a step cannot complete, so it works as a check and
not only as a demo. Every screenshot is numbered in order.

The character count is there because **a rendered element is not a rendered
page**: every wait in this script would pass on a blank frame, so it measures the
text and throws below 50 characters. That is a floor for "nothing at all", not a
judgement about how much a page should say — the empty workspace is about 310.
It does not replace looking at the screenshot; it catches the case where nobody
does.

**The browser outlives any one run, and that matters for `--no-key`.** Re-running
the driver against the same Edge instance reuses the same tab: `sessionStorage`
persists, and a `Page.addScriptToEvaluateOnNewDocument` registered by an earlier
run keeps firing on every navigation with no identifier a later process could use
to unregister it. So `--no-key` *removes* the key rather than merely not seeding
one, and the driver **asserts** the resulting state instead of printing it — a key
surviving under `--no-key` throws, because every step after that would be
testing the wrong thing. Skipping the seed was the first implementation, and it
cheerfully reported `composer enabled` on a run that had asked for the opposite.
Since 2026-11-05 a missing key locks the composer again (from 2026-11-02 Forma's
own model answered without one), so the state is read from whether the message
field is disabled.

`docs/media/screenshot.png` is a convenient thing to attach: it is committed, it
is a real image, and it is large enough to exercise the upload optimiser.

### 4. Tear down

Stop the dev server (TaskStop on the background shell). The rest of this step
applies only when step 3 started an Edge.

```powershell
Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" |
  Where-Object { $_.CommandLine -like '*<your session id>*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
```

**Filter by the profile path in the command line. Never kill `msedge` by name** —
this is a shared RDP server with other live users on it.

`-ErrorAction SilentlyContinue` is load-bearing, not decoration. Edge is a process
tree; killing the browser takes its renderers and GPU process with it, so most of
the PIDs the `Get-CimInstance` snapshot collected are already gone by the time the
loop reaches them. Without it you get one red `Cannot find a process with the
process identifier NNN` block per child — seven of them on a normal run — and a
teardown that fully succeeded reads as a wall of failure. Confirm by re-querying
for the count, which is the only signal worth trusting here.

Then delete the profile, because `sessionStorage` lives inside it. **Two calls, and
they must stay two** — see the warning under them:

```powershell
# 1. empty it, with robocopy and no Remove-Item anywhere in this call
$empty = Join-Path $sp "_empty"; New-Item -ItemType Directory -Force $empty | Out-Null
$rcArgs = @("$empty", "$sp\edge-profile", "/MIR", "/NFL", "/NDL", "/NJH", "/NJS", "/R:0", "/W:0")
& robocopy @rcArgs | Out-Null
"files left: " + @(Get-ChildItem "$sp\edge-profile" -Recurse -File -ErrorAction SilentlyContinue).Count
```

```powershell
# 2. remove the empty shells, in a call containing nothing else
Remove-Item -LiteralPath "$sp\edge-profile" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath "$sp\_empty" -Recurse -Force -ErrorAction SilentlyContinue
if (-not (Test-Path "$sp\edge-profile")) { "profile removed" }   # keep this line
```

`Remove-Item -Recurse` alone fails with *"Could not find a part of the path
'noto-sans-regular.woff'"* — Edge's font cache exceeds the classic path limit.
The robocopy mirror-from-empty gets under it. Robocopy exits 1-3 on success, so
its non-zero exit is not a failure — but it does become the block's exit code,
which is why the check on the end is not optional: it leaves the block exiting 0
on success, instead of reporting a 2 that means "files were copied".

**Do not merge those two blocks back together, however much they look like one
step.** A permission guard reads the whole command before running any of it, and
a switch-shaped token elsewhere in the same call gets attributed to `Remove-Item`
as a path. Both of these were refused outright on 2026-09-08:

```
Remove-Item on system path '/MIR' is blocked. This path is protected from removal.
Remove-Item on system path ''\bit\' is blocked. This path is protected from removal.
```

The first was robocopy's `/MIR` sharing a call with `Remove-Item`; the second was
an unrelated `\bit\(` regex counting tests in the same call. **Nothing in the
block runs when this fires** — so Edge is left alive, the port is still held, and
the failure reads as the teardown having half-worked. Passing robocopy's switches
through `@rcArgs` keeps them out of the command text, which is why step 1 is
written that way rather than inline.

The rule that survives both: **give `Remove-Item` a call of its own, and keep
every regex, switch and flag out of it.**

Finish by confirming port 3001 has no listener and `git status` shows nothing new
of yours. (Port 3000 is the owner's; leave whatever is on it.)

## Reading the result

**Look at the screenshots.** A blank frame is a failed launch, and the driver
cannot tell you that — every wait it does would still have passed.

The REPX pane is the app's own summary of the file it would export: `units N/in`
and the token usage beside the source, and — only when something is structurally
wrong — an `N REPX warning` box listing every finding. Silence there is the good
case. See `src/lib/repxAudit.ts` for what it checks and why each check exists.
Until 2026-11-04 these sat in a status bar at the foot of the workspace, which
went with the owner's request for a workspace as clean as the chat apps people
know.

## Selectors worth knowing

They live in one block at the top of `drive.mjs`; these are the ones that surprise.

- **One composer does both jobs.** `[aria-label="Send note"]` calls
  `handleGenerate()`, which decides between a generation and a chat turn from
  whether anything is attached. There is no separate chat box.
- **The result pane is five plain buttons** — `Mockup`, `Preview`, `Data`, `Spec`
  and `REPX` — and `--pane` takes any of them. It said three until 2026-09-08,
  which was the flag's documentation being narrower than its behaviour rather
  than a limit: there is no list in `drive.mjs`, it finds the button whose
  trimmed `textContent` **equals** the name and clicks it, so it would open any
  button in the app spelled exactly that way, and throws `no pane button named X`
  when nothing matches.
  That exact-equality is also why a `Specs & REPX` tab in an older shell cannot
  be hit by asking for `REPX`. This bullet used to warn that it could; a
  substring match would, and the driver has never used one.
- The composer is `[aria-label="Message"]`. Work in flight is `.wb-dots` (or the
  generation's `[role=progressbar]`); a report exists once the result pane's
  `[role=tablist][aria-label=View]` does; the notes are the thread's `.wb-note`s
  (an empty thread has none since 2026-11-05); the audit is `[data-audit]` in the REPX pane.

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
