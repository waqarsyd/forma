# RepxDesigner

Opens a `.repx` in the DevExpress end-user report designer.

This is the **open it in the real designer** half of Forma. Forma writes the report, and its chat and Preview edit that REPX in place; this program opens the same file in DevExpress's own WinForms designer, for whatever only the designer does, and saving there writes back to the file it opened. (Until 2026-11-11 this paragraph said the REPX was never edited after the request that wrote it, which stopped being true when the chat began editing reports in place; SD-19 of the full audit.)

## Get it (2026-11-09)

**Most people should download it**, not build it: <https://openforma.web.app/download> has *Forma Designer for Windows*, this program packed with its readme, notice and licence (no DevExpress file), with its version, size and SHA-256. Double-clicking the downloaded exe offers to install it for the current user (*Install, update and remove, per user*, below), and Forma's Open in designer then works from the website as well as from a Forma running on the PC. It needs DevExpress Reporting 20.1 or later installed on the same PC (*Which DevExpress it runs on*, below). Building it, under *Build*, is for working on it, and for packing a new download (*The download, and how it is published*).

## Three ways in

```powershell
RepxDesigner.exe                  # file picker, opens in your Downloads folder
RepxDesigner.exe report.repx      # open that file
RepxDesigner.exe --serve          # listen on 127.0.0.1:7317 for Forma
```

Saving inside the designer writes back to the file it opened. (There are more switches than three since 2026-11-09, for installing, checking and SQL Server; the heading names the ways a report gets in.)

**A file opened from Windows runs no report script unasked (2026-11-11, SE-02c).** The first two ways, *Open with Forma Designer*, and the tray's *Open a .repx...* all deny report scripts, as `--serve` does, because the install puts *Open with* on by default and a `.repx` downloaded from a share is one somebody else wrote. When the file carries code (`ScriptsSource` with text in it, or a control's `<Scripts On...=` — the same test as `hasReportScripts` in `src/lib/shares.ts`), it asks once, in a Yes/No box that defaults to No: *This report contains code that runs on this PC when it is previewed or printed ... Allow its code to run only if you trust whoever made the report.* No opens the report with its code refused at preview; Yes starts a process of its own with `--allow-scripts`, because the mode holds for the whole process once set (measured, *Caveats* below; `RepxProbe scripts` on 2026-11-11 again printed `ScriptExecutionException: Report scripts were found in the application while script execution is disabled` under Deny). This is a security question about the person's own PC, not a step to go on with.

**Since 2026-11-09 the install adds *Open with Forma Designer* for `.repx`** (an Open-with entry, never the default; *Install, update and remove, per user*, below). What follows is the older, manual way, which makes this build the default for `.repx` and is kept for a working tree that is not installed.

**Double-clicking a downloaded `.repx` can also work, but only after you set it up — and nothing in this program does it for you.** `--register` writes the `forma-repx://` scheme and *only* that scheme; the file association is a separate, manual, per-user step. This section stated the association as a fact and gave only the commands to remove it, which was true of the machine it was written on and of no other. To create it:

```powershell
$exe = (Resolve-Path 'tools\RepxDesigner\bin\Release\RepxDesigner.exe').Path
New-Item -Path 'HKCU:\Software\Classes\RepxDesigner.repx\shell\open\command' -Force | Out-Null
Set-ItemProperty -Path 'HKCU:\Software\Classes\RepxDesigner.repx\shell\open\command' -Name '(default)' -Value "`"$exe`" `"%1`""
New-Item -Path 'HKCU:\Software\Classes\.repx' -Force | Out-Null
Set-ItemProperty -Path 'HKCU:\Software\Classes\.repx' -Name '(default)' -Value 'RepxDesigner.repx'
```

`HKCU` only — no admin, nothing machine-wide, and it does not disturb a DevExpress installation's own association if one exists. **It hardcodes the exe path**, so it has the same failure mode as the Startup shortcut further down: move or rename the working tree and double-clicking a `.repx` silently stops working. To undo it:

```powershell
Remove-Item -Path 'HKCU:\Software\Classes\.repx' -Recurse -Force
Remove-Item -Path 'HKCU:\Software\Classes\RepxDesigner.repx' -Recurse -Force
```

## `--serve`, and the button it turns on

A web page cannot start a program — every browser blocks that, and should. So Forma's **Open in designer** button works the other way round: this tool listens, and the page asks it.

**Since 2026-11-09 the button opens a dialog, and nothing asks the companion until it is clicked** (batch WF of the download programme, `src/components/OpenInDesigner.tsx`). The dialog runs `designerStep` in `src/lib/designerBridge.ts`, a pure function of what it has found, in this order:

1. a page the companion does not answer (a preview channel): Export;
2. not Windows (`onWindows`): Export, or *this is Windows: try anyway*;
3. the browser's permission for this site to reach apps on the device, read without asking (`loopbackPermission`): denied gives *Your browser blocked it* and how to allow it;
4. `/health` (`askDesigner`, which reads both shapes it has had): nothing answering gives a `forma-repx://` launch and a 12-second wait, and then *Get Forma Designer*, linking the download page;
5. an answer with `devexpress: null` gives *DevExpress is not installed* (or *DevExpress 19.2 is too old*), with one link, to devexpress.com's trial, saying it is a separate commercial product;
6. the report is handed over. A 424 there means the same as step 5, and anything else is shown as it came.

Opened, it closes and App says so. When `/health` reports a version older than `src/lib/designerRelease.ts` (or none, from a companion built before that date), it stays open to name the newer download. Every step offers *Export .repx instead*. The Export panel's row, Ctrl+K and the chat's `designer` action all open this one dialog. Checked in the owner's Chrome on the mock server by mounting the dialog with `/health` stubbed, never by clicking the button, which would start the real companion: *DevExpress is not installed* and *Your browser blocked it* drew in the workspace's own panel, focus moved into it, and Escape closed it.

*Until 2026-11-09:* Run `RepxDesigner.exe --serve` and it sits in the system tray. Forma pinged `/health` **once there is a report with XML to open**, and again whenever the tab regains focus — starting the companion is something you do *outside* the browser, so a mount-only ping would leave the button dead until a reload. Two narrowings since this said "when the workspace loads": the probe is gated on having something to open, because an empty workspace asks a question nothing is waiting on, and repeat probes are throttled to one per 30 seconds (`DESIGNER_RECHECK_GAP_MS`), because a refused connection is logged by the browser itself and cannot be caught — someone alt-tabbing produced one `ERR_CONNECTION_REFUSED` per switch, and predictable noise hides the unpredictable kind.

*Also until 2026-11-09:* the ping decided whether the button worked, not whether it existed: the button sat in the bench bar at all times and, with nothing listening, was disabled with a `title` naming the command that turned it on (before 2026-08-26 it rendered only once something answered, so the people who had not installed the companion were the only ones never told of it). There is no ping and no disabled button now: the dialog is always offered, asks nothing until it is clicked, and says at each step what is missing. The rule it kept is the same one: detect, never assume, and never hide a capability from the people who lack it.

Once the dialog has its answer, Forma POSTs the XML to `/open`. The tool writes it to `%TEMP%\Forma\<title>.repx` and opens the designer on it — no download, no file dialog.

| | |
|---|---|
| `GET /health` | `{"app":"RepxDesigner","version":"1.0.0","designerVersion":"20.1.3.0","devexpress":{"version":"20.1","build":"20.1.3"},"found":["20.1"],"oldest":"20.1","compiled":"20.1"}`; with no usable DevExpress, `designerVersion` and `devexpress` are `null` and `found` lists what is there (2026-11-09) |
| `POST /open` | body is the `.repx` XML; `x-forma-filename` names it; **424** `{"devexpress":null,"found":[...],"oldest":"20.1","trial":"https://www.devexpress.com/products/try/"}` when there is no DevExpress to open it in |
| `--port N` | move both sides — `DESIGNER_ORIGIN` in `src/lib/designerBridge.ts` must match |

The guards, because a port open on your machine is reachable by any page you visit and, on a shared PC, by every other person signed in to it:

- **Loopback only, and the origins it knows.** `OPTIONS` from an origin it does not grant gets a bare 403 with no `Access-Control-Allow-Origin`, so the browser never sends the real request. A page served from this PC is granted every route; Forma's website `/health` and `/open` alone (*Caveats*, below).
- **`POST /open` requires the `x-forma-client` header.** It is not CORS-safelisted, which forces a preflight — that is the whole point, since a safelisted POST would reach the handler before any origin check could run. Renaming it on one side without the other disables this.
- **`POST /open` checks the origin on the request itself (2026-11-11, SE-06).** Until then the origin was read only on the preflight, so a client that skipped it, or sent no `Origin`, reached the designer with the header alone; it is 403 now.
- **The `Host` must be the listener's own** (`127.0.0.1:<port>` or `localhost:<port>`), else 400 (SE-06). A page that rebinds its own domain to 127.0.0.1 is same-origin to the browser and sends no preflight, but its requests still carry its own name as the Host. Chrome's local-network prompt also stops that; Firefox does not.
- **Only this Windows user's programs (2026-11-11, SE-05).** 127.0.0.1 is one address for everyone signed in to a PC, and on a Remote Desktop server that is many people; the two headers above stop a web page, not another user's `curl`, which could otherwise read the databases through `/sql/` with this user's sign-in. Each connection is traced to the process that opened it through the TCP table Windows keeps (`GetExtendedTcpTable`, the one `netstat -o` reads) and refused with a 403 unless that process runs as the same user (`SameUser` in `Program.cs`). Free, no prompt, no administrator. Measured on this server: the processes holding this user's connections (Chrome's, Edge's, Node's) all read as this user's SID, while another user's Chrome, Edge and Node could not even be opened (error 5), and whatever cannot be read is refused. A call from a second Windows account is the owner's to try (owner decision 7 of the 2026-11-11 audit).
- **A body over 8 MB is refused with 413 before anything is allocated, a `Content-Length` that is not a number with 400, and a socket has ten seconds to send its request** (SE-06, SD-24). Each caller is served on the thread pool (SD-14b), so a long Live rows fill or a socket that never finishes its headers no longer leaves `/health` and `/open` waiting.

Verified 2026-08-13: health 200 with the origin echoed, a POST missing the header 400s, `OPTIONS` from a foreign origin 403s. **Verified 2026-11-11** with curl against the new build alone in an empty folder, on port 7399 with a scratch connection store:

| request | status |
|---|---|
| `GET /health`, Host `127.0.0.1:7399` / `localhost:7399` | 200 / 200 |
| `GET /health`, Host `evil.example:7399` / no Host | 400 / 400 |
| `POST /open` with the header and no `Origin` / with `Origin: https://evil.example` | 403 / 403 (the 2026-11-09 build answered the first with 202 and opened it) |
| `POST /open`, a 9 MB body, `Origin: http://localhost:3000` | 413 |
| `POST /open`, `Content-Length: abc` | 400 |
| `OPTIONS /open` from `http://localhost:3000` / `https://openforma.web.app` / `https://evil.example` | 204 / 204 / 403 |
| `GET /sql/connections` from `http://localhost:3000` / `http://127.0.0.1:3001` | 200 / 200 |
| `GET /sql/connections` from `http://localhost:5173` / `http://localhost` / `https://openforma.web.app` | 403 / 403 / 403 |
| `GET /health` while one socket sends nothing and another half its headers | 200 in 32 ms; the silent socket was closed after 9.9 s |

It uses a raw `TcpListener` rather than `HttpListener` because `HttpListener` wants a URL reservation or an elevated process, and this has to run by double-clicking it.

## SQL Server, from this PC (2026-11-09)

The SQL Server programme's Phase 2 (`Sql.cs`, `ConnectionsForm.cs`, `SqlScripts.cs`). The owner's rule of 2026-11-08: a database credential is held on the user's own PC and nowhere else. So the companion keeps the connections and the page only ever names one.

| | |
|---|---|
| `GET /sql/connections` | each connection's name, how it signs in, and its database; never a secret |
| `GET /sql/schema?connection=NAME` | Forma's read-only layout script's one value, run here: what `readDatabaseText` reads |
| `GET /sql/sample?connection=NAME&objects=dbo.A,dbo.B&rows=N` | the sample script's own format, built here: each name checked against the catalog and quoted by `QUOTENAME`, N from 1 to 50, a name the catalog lacks left out |
| `POST /sql/fill?procedures=0\|1&p.NAME=value` | body is the `.repx`; its own data source filled as DevExpress fills it, each query's first 500 rows |

- **Both guards, on every route, before any work.** An origin outside `IsLocalOrigin` gets 403 and a request without `x-forma-client` 400, so a page from anywhere else never reaches a database, not even to be refused by CORS afterwards. Checked 2026-11-09: foreign origin 403, no header 400, unknown connection 404. **Since 2026-11-11 (SE-05) only Forma's own ports**: 3000 (`npm run dev`, `npm start`) and 3001 (the mock server), plus any given to `--serve` as `--page-port N`; any other web app a person runs on this PC is a local origin too, and none of them is meant to read a database. The same-user check above applies here as everywhere.
- **No SQL from the page.** The layout script is `SqlScripts.Schema`, written by `npx tsx scripts/companion-scripts.ts` from `SCHEMA_SCRIPT` and held equal to it by `src/lib/sqlCompanion.test.ts`. Samples are built here. A fill runs the report's own data source: custom SQL must be one SELECT, and **a stored procedure runs only with `procedures=1`**, which the Preview sends only from the button that names the procedure (it could write; 409 lists them otherwise).
- **"One SELECT" is read, not pattern-matched (2026-11-11, SE-12; `IsOneSelect` in `Sql.cs`).** The text is walked left to right first, string literals emptied, comments dropped and bracketed or quoted names replaced, so a quote inside a comment can no longer hide a statement (the old literal-stripping regex could be walked past that way); a semicolon is allowed only at the very end; and `OPENQUERY`, `KILL`, `WAITFOR`, `WRITETEXT`, `UPDATETEXT` and `RECONFIGURE` joined the blocklist. A parser (ScriptDom) would be exact, but it would be a second DLL in a download that is one exe, and running the query inside a transaction does not help, because DevExpress opens its own connection to run it.
- **At most 500 rows from SQL Server itself (SD-14a).** Each built query (`SelectQuery`) with no `Top`, or one above 500, is given `Top = 500` before the fill; until 2026-11-11 the whole table was read and the first 500 kept, so Live rows on a large table ran for minutes and held every row in memory. Custom SQL and procedures are the report's own text; the 500 kept from their results still bounds what is sent.

**What DevExpress itself refuses, measured 2026-11-11** (SE-07; `RepxProbe sql-fill` on LocalDB's made-up FormaSample, a report holding one custom query and nothing else, DevExpress 20.1.3 with its custom-query validation left on, as the companion leaves it):

| custom SQL | DevExpress 20.1 | the companion's `/sql/fill` (2026-11-09 build / 2026-11-11 build) |
|---|---|---|
| `SELECT CompanyName, City FROM dbo.Customers` | filled | - / 200, three rows |
| `SELECT ...; DELETE FROM dbo.OrderLines` | refused: *One or more queries have failed to validate* | - / 400 |
| `DELETE FROM dbo.OrderLines` | refused (validate) | - / 400 |
| `SELECT ... /* ' */; DELETE ... /* ' */` | refused (validate) | **passed the companion's check**, refused only by DevExpress / 400 |
| `WITH c AS (SELECT ...) SELECT * FROM c` | refused (validate): 20.1's validator does not take a CTE | - / passes the companion, refused by DevExpress |
| `SELECT ... INTO #copy FROM dbo.Customers` | refused (validate) | - / 400 |
| `SELECT * FROM OPENQUERY(LOOPBACK, 'SELECT 1')` | **passed validation**, failed only to execute (no such linked server) | **passed the companion's check** / 400 |
| `EXEC dbo.usp_TwoSets` | refused (validate) | - / 400 |

So DevExpress's own validator, which the designer's Preview applies too, already refuses most writes in custom SQL; `OPENQUERY` is the one it lets through, and a stored procedure (`StoredProcQuery`) is not custom SQL and is not validated at all. The rows above are what `/sql/fill?procedures=1` answered on port 7399 with a scratch store naming FormaSample; the database was made with `RepxProbe sql-keep` and dropped with `sql-drop` afterwards. A built query filled as before with its new `Top`: `OrderLines`, five rows.
- **The connections** are in `%LOCALAPPDATA%\Forma\connections.tsv`: name, sign-in, server, database, and for a SQL Server login its login and password encrypted with DPAPI for the current Windows user. Windows authentication stores no secret. Add one from the tray menu, *SQL Server connections...* (or `--sql-connections`), where a password is typed into a masked box; `--sql-add NAME --server S --database D` adds a Windows-authentication one from a command line, `--sql-remove NAME` removes one, and `--store <path>` moves the file, which is how a test keeps out of the profile. Name a connection as your application's `connectionStrings` does, so a report reads the same database here.
- **The designer reads the connection too (item 38).** `OpenDesigner` sets each data source's connection from the store and marks it `StoreConnectionNameOnly`, so the designer's own preview works at once and saving writes only the name. Measured with `RepxProbe sql-fill --name-only`: filled, and the saved layout read `<Connection Name="FormaSample" FromAppConfig="true" />`. Supplying it through `ConfigureDataConnection` instead does not work for a connection stored by name: DevExpress looks the name up in the config file first and throws ("Cannot find the following connection in the config file"), measured with `--event`.
- **A report a page sent is not connected where it could change data (2026-11-11, SD-15 and SE-07).** `/sql/fill` runs a procedure only when the person asked and custom SQL only when it is one SELECT, but the designer's own Preview runs whatever the data source holds. So for `POST /open`, a data source holding a stored procedure, or custom SQL that `IsOneSelect` refuses, is left unconnected (`PrepareForDesigner(report, fromPage: true, ...)`), and the designer's title says which and why: *not connected to your saved databases (NAME): it came from a web page and runs a stored procedure or SQL that could change data. Open the file with Forma Designer to connect it.* A file opened from Windows is connected as before. The title is set when the window is shown, because the designer titles it as it loads; how it reads on screen is the owner's to look at, since a designer started from an agent shell paints where nobody can see it.
- **Only from a page served on this PC**, as for `/open`: the deployed site never calls 127.0.0.1 and the Data tab says how instead. Tested against LocalDB's made-up FormaSample only (`RepxProbe sql-keep` and `sql-drop`).

## Which DevExpress it runs on (2026-11-09)

The owner's download programme (`DevFiles/forma-audit/designer-download-2026-11-09.md`): the companion is to be downloaded by people who never built it, and the DevExpress they install is whatever the free trial offers, which is **only the current version** (25.2 / 26.1 as of 2026-11-09; older versions need a licence). So the program no longer assumes 20.1 beside it.

- **`Entry.Main` runs first and names no DevExpress type** (`Entry.cs`): .NET compiles a method, and loads every assembly its body names, before its first line, so the old `Main` would have failed on a PC without DevExpress before it could say why. It finds DevExpress, then calls `Program.Run`, which was `Main`.
- **`DevExpressLocator` reads three traces, both registry views, merged by version** (`DevExpressLocator.cs`). Measured here on 20.1.3: `HKLM\SOFTWARE\WOW6432Node\DevExpress\Components\v20.1` (`RootDirectory`, `Build`), `C:\Program Files (x86)\DevExpress 20.1\Components\Bin\Framework`, and the GAC's `DevExpress.XtraReports.v20.1\v4.0_20.1.3.0__b88d1754d700e49a`; the uninstall entry ("DevExpress Components 20.1", 20.1.3) carries no install location, so it is not read. Newer installers use `Program Files` and may skip the GAC, which is why all three are read.
- **Any version through `AssemblyResolve`.** Every DevExpress assembly has its version in its name, so on a PC with only 25.2 the runtime fails to find `DevExpress.XtraReports.v20.1` and asks `AssemblyResolve`, which answers with `DevExpress.XtraReports.v25.2.dll` from that install's `Bin\Framework` (or its GAC entry); types are then found by their full name in the assembly that came back.
- **Any 20.1 build, too (2026-11-11, SD-01).** The program's reference is to `20.1.3.0` exactly, and DevExpress ships no publisher policy in the GAC, so on a PC with another 20.1 build (or 20.1.3 in its `Bin\Framework` and not the GAC) the runtime misses and asks `AssemblyResolve` for a name that is *the same* as the one installed. `Resolve` used to answer only a different name, and returned nothing here, so the program died at its first DevExpress call (`DenyReportScripts` at `--serve`'s start). It now answers a same-named request from the install as well, its `Bin` file or else the GAC at the build installed, with a `[ThreadStatic]` guard because that second load asks the runtime again. Note what makes this hard to see: once DevExpress's own code has run in a process it answers later requests for its other builds itself, so only the *first* request shows the gap, which is why the measurement below asks first.
- **"Found" means the WinForms designer is there (2026-11-11, SD-13).** An install counts as usable only when `DevExpress.XtraReports.v{version}.Extensions` (which holds `ReportDesignTool`) is in its `Bin\Framework` or the GAC; a web- or WPF-only DevExpress has the report engine and no designer, and before this it counted, the page said *Opened*, and the tray process died with a .NET error. `OpenDesigner` also catches a designer that will not load and says *This PC's DevExpress has no WinForms report designer. Install DevExpress Reporting for WinForms.* `--check` names the assembly and where it was found for each install (`"designer":{"assembly":...,"at":...}`, or `null`).
- **`--check`** prints what it found as JSON with no window (exit 0 when it can run, 3 when no usable DevExpress is installed): `Start-Process RepxDesigner.exe --check -Wait -NoNewWindow -RedirectStandardOutput out.txt`. `--devexpress-root <dir>`, `--no-registry`, `--no-folders` and `--no-gac` leave sources out, to simulate another PC; `--alias <version>` asks for a version the program was not built against; `--simulate-build <a.b.c>` asks for a build of the same version that is not installed, as the program's own `20.1.3` reference is on a PC with another 20.1 build. `load` asks for the version the program's reference names (read off the exe, not written in the code; it was a hard-coded `.3.0` until 2026-11-11), and `designerLoad` loads the designer assembly the same way.

Measured 2026-11-09 with the exe copied **alone** into an empty folder, no DevExpress DLL beside it:

| | result |
|---|---|
| `--check` | found 20.1 (build 20.1.3) in the registry, the folder and the GAC; loaded `XtraReports.v20.1` from the GAC, made a report, loaded a two-band layout, counted 2 bands; exit 0 |
| `--check --no-registry --no-folders --no-gac` | found nothing, `using: null`, exit 3, no crash |
| `--check --alias 99.9` | asked for `DevExpress.XtraReports.v99.9`, got `v20.1` through the resolver, and the report loaded its layout with 2 bands: a binding failure for one version's name is answered by another version's file |
| `--store <tmp> --sql-add` / `--sql-remove` | still work through `Entry.Main` |

Measured again 2026-11-11 (SD-01, SD-13), the new build alone in an empty folder:

| | result |
|---|---|
| `--check` | as above, and `"designer":{"assembly":"DevExpress.XtraReports.v20.1.Extensions","at":"...\Bin\Framework\DevExpress.XtraReports.v20.1.Extensions.dll"}`; `designerLoad` got `Extensions` 20.1.3.0 from the GAC; exit 0 |
| `--check --simulate-build 20.1.99` | asked for `DevExpress.XtraReports.v20.1, Version=20.1.99.0` first, before any DevExpress code ran; got 20.1.3.0 through the resolver, loaded the layout, 2 bands; the designer assembly the same; exit 0. A plain `Assembly.Load` of that name in a fresh process fails (*The system cannot find the file specified*), so the answer came from `Resolve` |
| `--check --simulate-build 20.1.99 --no-registry --no-folders` | the GAC alone (`bin: null`, `"designer":{"at":"gac"}`): answered by `Assembly.Load` at the build installed; 2 bands; exit 0 |
| `--check --no-registry --no-folders --no-gac` | found nothing, exit 3 |
| `--check --alias 99.9` | as before |

**When there is none (batch WB).** Nothing that loads a DevExpress assembly runs without one: `OpenDesigner` checks `Program.Installed` and hands over to `OpenDesignerCore`, `/health` builds its answer without naming a DevExpress type, and `/open` and `/sql/fill` answer **424 Failed Dependency** with what was found and the trial's address (`MissingDevExpress.Json`); the layout, samples and connections still work, because they are SQL Server alone. A person who starts the program to open a report gets a window instead of a file picker (`MissingDevExpress.ShowWindow`): DevExpress Reporting is not installed (or "this PC has DevExpress 19.2, and Forma Designer needs 20.1 or later"), what it is, that it is a separate commercial product with a free 30-day trial, a button to devexpress.com, and that Forma's Export needs nothing installed. `--serve` keeps listening so the page can ask, and says the same once in a tray balloon and the tray's menu, never a window, because a launch from the browser is already being told by the page. Checked 2026-11-09 with the exe alone, headless (`--serve` with sources left out, and a fake `DevExpress 19.2` folder through `--devexpress-root`): `/health` `devexpress: null` with `found: []` and then `["19.2"]`, `/open` and `/sql/fill` 424, `/sql/connections` 200, `--check` exit 3. With 20.1 found, `/health` named it and `/sql/fill` filled FormaSample's orders report as in batch DP: 3 orders, 5 lines, 2 regions.

**What cannot be measured here, and is the owner's to check on another PC** (the trial must never be installed on this server): a real 25.2 or 26.1 install, whether every assembly the designer touches kept its name and the members used (a type DevExpress moved without a type forward would fail), and DevExpress's licence check from 25.1, which may show a trial watermark for a program built without a licence stamp (`docs.devexpress.com/GeneralInformation/405494`).

## Install, update and remove, per user (2026-11-09)

Batch WC of the download programme (`Installer.cs`). The download is this exe; **double-clicked from wherever it was saved, it offers to install itself** for the current user, with no administrator, as VS Code's user setup does: Install (or Update, naming both versions), *Open a report once*, or Cancel, with two boxes ticked by default, *start it when I sign in* and *Open with Forma Designer for .repx*. The installed copy, double-clicked, opens the file picker as before. (*Open a report once* was labelled *Run once* until 2026-11-11, SD-27: it opens the file picker and the designer and starts nothing that listens, so Forma's Open in designer cannot reach it, which the old label did not say.) *Open with* is safe to leave on: a file opened that way runs no report script unasked (*Three ways in*, above).

| What install writes | Where (all per user) |
|---|---|
| the program, with the readme, licence and notice beside it | `%LOCALAPPDATA%\Programs\Forma Designer\RepxDesigner.exe` |
| the `forma-repx://` handler Forma's button starts it through | `HKCU\Software\Classes\forma-repx` (the same as `--register`, now `Installer.WriteProtocol`) |
| a Start menu entry, *Forma Designer*, which starts it in the tray | `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Forma Designer.lnk` |
| starting with Windows, which Settings, Apps, Startup can switch off | `HKCU\...\CurrentVersion\Run`, value *Forma Designer* = `"...\RepxDesigner.exe" --serve` |
| *Open with Forma Designer* for `.repx`, **never the default** | `HKCU\Software\Classes\.repx\OpenWithProgids\FormaDesigner.repx`, the ProgId, and `Applications\RepxDesigner.exe` |
| an entry in Settings, Apps, Installed apps (version, publisher, size, Uninstall) | `HKCU\...\CurrentVersion\Uninstall\FormaDesigner` |

**Uninstall** (Settings, Apps, or `--uninstall`) asks first, with *Also remove my SQL Server connections* unticked, then removes all of the above. It removes the handler only when it starts this install, since one registered by a copy built from source is that copy's, and says so. It keeps the connections unless asked, and says where they are. Run from the installed copy itself, it leaves a hidden `cmd` to delete the folder once it has exited, because a running program cannot delete its own file. Either way it first stops this user's own copy running from that folder; another user's process cannot be read and is left alone.

Commands for a script: `--install [--no-startup] [--no-open-with] [--no-start] [--quiet]`, `--uninstall [--remove-connections] [--quiet]`, `--installed` (what is installed, as JSON). With `--quiet` they print JSON and open no window. **`--sandbox <dir>` moves all of it** (files under that folder, keys under `HKCU\Software\FormaDesigner-Sandbox`), which is how it was tested from an agent shell on 2026-11-09 without touching the account's settings:

- an install from a copy of the exe alone wrote the program with its `README.txt` and `LICENSE.txt`, the handler, the Start menu link, the Run value, *Open with*, and the Apps entry (*Forma Designer 1.0.0 by Forma, 83 KB*); the installed copy's `--check` found DevExpress from its own folder;
- an update with `--no-startup --no-open-with` removed exactly those two;
- an uninstall from the download removed everything and the folder at once and kept the connections, naming them; one from the installed copy removed the connections too (asked) and its folder was gone once it exited; no value was left under the sandbox key;
- afterwards the account's real Run key, Apps entry, `.repx` Open-with and `%LOCALAPPDATA%\Programs\Forma Designer` were all absent, and its `forma-repx` handler still named the repository's build.

The windows themselves (the offer, the confirmation, the done message) cannot be seen from an agent shell, so they are the owner's to look at on first install.

## The download, and how it is published (2026-11-09)

Batch WD of the download programme. The download is **one zip of four files**: `RepxDesigner.exe`, and `README.txt` and `NOTICE.txt` from `download/` beside this README, and the repository's `LICENSE` as `LICENSE.txt`. **It holds no DevExpress file**: the `bin/Release` folder beside a build carries ~146 MB of them, copied local so a build runs standalone, and only a licensed developer may redistribute those. Forma Designer uses whatever DevExpress the user installed (*Which DevExpress it runs on*, above), and `NOTICE.txt` says so.

```powershell
npx tsx scripts/package-designer.ts --tag v1.4.0
```

That is the owner's to run, on a PC with DevExpress 20.1, because only such a PC can compile this project. It rebuilds in Release, stages the four files and **refuses anything else** (`packageProblems` in `src/lib/designerRelease.ts`, which names a DevExpress file as such), runs the staged exe with `--check` to prove it starts with nothing beside it, and zips it to `bin/package/FormaDesigner-<version>-windows.zip`. Then it writes the version, name, size, SHA-256, date and `--tag` into the marked block of `src/lib/designerRelease.ts`, which the download page reads. `<version>` is this program's own (`AssemblyInfo.cs`), and `designerRelease.test.ts` holds the record to it. **The same commit packs to the same bytes**: the project is `<Deterministic>` and every zip entry is dated 2026-01-01 local time. Measured 2026-11-09: two packs gave 99,261 bytes with the same SHA-256. That is the check a person can make on a download that is not code-signed.

**Publishing is the deploy.** When the record's `tag` is the release `scripts/deploy.mjs` is making, the deploy stops before building unless the zip is in `bin/package` with exactly the committed SHA-256, and after `gh release create` it runs `gh release upload <tag> <zip>`. GitHub serves a release's files free, with no bandwidth limit. Without the GitHub CLI signed in it prints both commands. A release whose tag the record does not name carries no zip. The download page links the one that does (`designerDownloadUrl`), so a release of the web app alone does not break the download. **The record must name a release that exists and carries the zip**, and since 2026-11-10 the deploy stops when it does not, and `scripts/smoke.mjs` asks GitHub for the zip the live build links. That day 1.4.0 was deployed with the record still naming `v1.3.0`, a release never made because 1.3.0 had shipped inside 1.4.0; the deploy, seeing a tag that was not its own, attached nothing, and `/download` went live linking a 404 while every check passed. The zip itself carries no tag (the same commit packs to the same bytes, above), so the fix was to attach it to `v1.4.0` by hand and point the record there, not to pack again.

## Version compatibility

The tool is built against **DevExpress 20.1**, the version installed on this machine, and runs on whichever version is installed (*Which DevExpress it runs on*, above).

Forma writes the version into the generated XML's `SerializerVersion` and `Version`. There is no dropdown for it any more: Forma works the version out, from an uploaded `.repx` or the report being refined, else the version learned from the last report the user brought (*Forma works out the settings and the language itself* in [`docs/notes/app-shell.md`](../../docs/notes/app-shell.md)). Until 2026-11-04 the Report configuration dialog offered 26.1 down to **20.1**; before that the prompt's ROOT STRUCTURE example hardcoded 23.2.3.0, so the setting was inert (*`geminiService.ts` is a single mega-prompt* in [`docs/notes/gemini.md`](../../docs/notes/gemini.md)).

**Verified on 2026-08-13:** generated with v20.1 selected, exported, opened here with every control present.

The tool reads `SerializerVersion` before loading and, when a load fails, shows it beside the designer's own version so a reader has both numbers to hand.

**It does not refuse anything, and the version is not why a load fails.** This paragraph used to say a file declaring a newer release will not open in an older designer. Measured 2026-09-06 with `RepxProbe inspect`: a generated 24.1 report loaded through the installed 20.1 assemblies with every cell intact, and the loader rewrote the tag to `20.1.3.0` on save. What could genuinely break a load is a control or property the older assembly never had — the version is only a hint that one might be present. See *SerializerVersion is a label, not a gate* in [`docs/notes/gemini.md`](../../docs/notes/gemini.md).

## Build

```powershell
& 'C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools\MSBuild\Current\Bin\MSBuild.exe' tools\RepxDesigner\RepxDesigner.csproj /p:Configuration=Release
```

Needs DevExpress 20.1 installed at the path in the `.csproj` `HintPath`s. `bin/` and `obj/` are gitignored (`tools/**/bin/`, `tools/**/obj/`); `Release` is ~146 MB (measured 2026-09-01) because the DevExpress assemblies are copied local so the folder runs standalone. `.gitignore` repeats that figure in the comment above those two patterns, so re-measuring is a change to both.

**Stop `--serve` before rebuilding** — MSBuild cannot overwrite a running exe. `vite.config.ts` already excludes `**/tools/**` from its watcher, so a build no longer kills the dev server.

## Start it yourself, from your own desktop

**`--serve` must be launched from the session you are actually looking at.** A Windows process paints on the desktop of whatever session and window station created it, so an instance started by an agent shell, a service, a scheduled task or a second RDP session opens the designer somewhere you cannot see — and nothing reports an error, because from the browser's side it all succeeded: the guards passed, the file was written, the designer was told to open.

Observed 2026-08-13 on this machine, which has interactive desktops in sessions 2, 3 and 4: an instance started from a background shell wrote `%TEMP%\Forma\Job_Card_Report.repx` correctly and opened the designer on a desktop nobody was watching. The symptom is "the button does nothing" with a perfectly good file on disk.

**Double-clicking the bare exe does NOT start the server, and the wording here used to imply it did.** With no arguments the program opens a *file picker* and then the designer — a completely different mode. It looks like it worked (a window appears, the designer runs) while nothing is listening on 7317 and Forma's button stays greyed. Observed 2026-08-26: `Get-Process RepxDesigner` showed a live process with `MainWindowTitle: Report Designer` and `Get-NetTCPConnection -LocalPort 7317` showed nothing, which is the signature of exactly this mistake. **`--serve` is not optional; it is the whole difference between the two modes.**

So: run the Startup shortcut, or a shortcut whose Target ends in `--serve`, or `RepxDesigner.exe --serve` from a terminal on your own desktop. Then check the tray icon is in **your** tray. If the port is taken, an instance is already running somewhere — `Get-Process RepxDesigner | Select-Object Id, SessionId` shows which session owns it.

### Letting the button start it: `--register`

The tidiest version of all this is not to start it at all. `RepxDesigner.exe --register` (which the install now does for you) writes a `forma-repx://` URL-protocol handler under `HKCU\Software\Classes` — no admin, nothing machine-wide — whose command is `"<exe>" --serve "%1"`. When the Open in designer dialog finds nothing listening, it navigates to `forma-repx://serve`, which is the one route by which a web page may cause a local program to run. Windows starts the companion, the page polls `/health` for up to 12 seconds (`waitForDesigner`), and then POSTs the report as usual.

Four things worth knowing before relying on it:

- **The browser asks the first time.** Edge and Chrome show *"This site is trying to open RepxDesigner"* with an **Always allow** checkbox. That prompt is the security model, not a bug, and it cannot be suppressed from the page.
- **A launch is unobservable from script.** An unregistered scheme, a declined prompt and a successful start are indistinguishable to `location.href` — none of them throws. That is why the timeout is the failure signal, and why the error message names all three causes rather than guessing one.
- **The URL is a doorbell, not a delivery.** It carries no report: a `.repx` is tens of kilobytes and would not survive a command line. The XML still goes over the loopback POST, so the CORS and `x-forma-client` guards below apply exactly as before — registering the protocol widens nothing.
- **The protocol launch never shows the "already running" warning box.** `RunServer(port, quietIfTaken: true)` exits silently when the port is taken, because from the page's point of view something already serving *is* success. Started by hand, the warning still appears.

`--unregister` removes the key. Renaming the scheme means renaming `Scheme` in `Program.cs` **and** `DESIGNER_PROTOCOL` in `src/lib/designerBridge.ts`; they are matched by string and a mismatch fails silently.

### Starting it at login, so the button is simply always live

*Since 2026-11-09 the install does this* (its *start it when I sign in* box, a `Run` value rather than a shortcut); what follows is the manual way, for a working tree that is not installed. When the button was gated on the ping, "why is *Open in designer* greyed out" had one answer in practice: nothing was listening. Having to remember to start a tray app before it works is a bad deal for a one-click feature, and the fix is to stop remembering — a shortcut in the per-user Startup folder, which needs no admin and no code:

```powershell
$exe = (Resolve-Path 'tools\RepxDesigner\bin\Release\RepxDesigner.exe').Path
$lnk = Join-Path ([Environment]::GetFolderPath('Startup')) 'RepxDesigner (Forma).lnk'
$s = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)
$s.TargetPath = $exe; $s.Arguments = '--serve'; $s.WorkingDirectory = Split-Path $exe
$s.WindowStyle = 7   # minimised; it goes to the tray anyway
$s.Save()
```

Done on this machine on 2026-08-26. Two things about it that are not obvious:

- **It only takes effect at the next login, and it does not help the session you are in now.** Creating the shortcut starts nothing. For the current session the rule above still applies in full: double-click it yourself, from your own desktop. A script that creates the shortcut *and* launches the exe would hand you a designer on the wrong desktop, which is the exact failure this whole section exists to prevent.
- **The shortcut hardcodes the repo path.** Move or rename the working tree and it silently points at nothing — the tray icon never appears, the button stays greyed, and there is no error anywhere. If the button stops working after a move, check this before anything else.

Removing it is deleting the `.lnk` from `shell:startup`; nothing else is registered anywhere.

## Caveats

- **Windows and DevExpress only.** Forma is a browser app that must keep working without any of this, which is why the capability is detected rather than assumed. On a Mac or a Linux box the loopback probe simply never answers.

  Since 2026-11-09 the Open in designer dialog asks the platform first (`onWindows`, step 2 of `designerStep`): off Windows it offers Export, with *this is Windows: try anyway* for a browser that hides its platform, so a Mac or Linux user no longer waits out the twelve-second launch. Until then the button tried the `forma-repx://` launch everywhere and reported, twelve seconds later, that a `.exe` which would never run there could not start; the platform was not sniffed on the reasoning that a browser app should not decide what to admit exists, and the dialog keeps that by still offering the try.
- **Since 2026-11-09, Forma's website too, for opening a report** (the owner's decision in the download programme). `AllowedFor` grants `https://openforma.web.app` and `https://forma-201ba.web.app` the routes `/health` and `/open` alone. The `/sql/` routes still answer only a page served from this PC (`IsLocalOrigin`, passed to `HandleSql` directly), and any other origin, a preview channel included, gets 403 on its preflight. The page sends nothing on load (since batch WF, from any page: the Open in designer dialog asks when it is clicked): its first request is the click on Open in designer, which is when Chrome 142+, Edge 143+ and Firefox 151+ ask the person, once per site, whether it may reach programs on this PC. A preflight carrying `Access-Control-Request-Private-Network` is answered with `Access-Control-Allow-Private-Network: true`. Checked with curl on 2026-11-09: the website's `/health` 200 and `/open` preflight 204 with its origin granted, its `/sql/connections` 403 both ways, another site's and a preview channel's preflight 403, localhost's `/sql/connections` 200.
- **Report scripts are off in the server process.** A `.repx` can carry C# that runs when it is previewed (`ScriptsSource` and a control's `Scripts`), and a report handed over by a page may be one somebody shared. So `--serve` sets `ScriptPermissionManager.GlobalInstance` to `ExecutionMode.Deny` when it starts (`DenyReportScripts`). Measured with `RepxProbe scripts`: under Deny, DevExpress 20.1 refuses to print such a report ("Report scripts were found in the application while script execution is disabled"). **The mode holds for the whole process**: set Unrestricted first and Deny later, and the script still ran; set Deny first and Unrestricted later, and it was still refused. So it is set once, at start. A file the person opens themselves (Open with, the file picker, and the tray's *Open a .repx...*, which starts a process of its own) ran with scripts allowed until 2026-11-11; it is denied now too, and asks once when the file carries code (*Three ways in*, above). Forma never writes a script into a report, and since the full audit's SE-02b its repairs remove one the model wrote.
- **Before 2026-11-09, only a page served from this machine.** `IsAllowedOrigin` (now `IsLocalOrigin`) accepted `http://localhost` and `http://127.0.0.1` alone, so a page from anywhere else, the deployed site included, got no CORS grant and the browser refused the answer. This said until 2026-11-08 that HTTPS would be blocked as mixed content, which is not the reason: browsers treat `127.0.0.1` as a secure origin. From that date until 2026-11-09 the web app never contacted the companion from such a page (`designerReachableFrom` in `src/lib/designerBridge.ts`, site audit item 95), because a public page reaching the local network is what makes Chromium ask the visitor for permission. The owner decided on 2026-11-09 to widen the allowlist to the two Forma sites, for `/health` and `/open` alone, at the cost of that prompt for whoever uses it (the *Since 2026-11-09* bullet, two above).
