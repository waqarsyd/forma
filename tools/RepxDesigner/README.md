# RepxDesigner

Opens a `.repx` in the DevExpress end-user report designer.

This is the **edit** half of Forma. Forma generates a report and the model's job ends at export: the `layout` JSON and `repxContent` are terminal outputs of one request, never edited afterwards, so they cannot drift apart. Adjustments — nudging a field, resizing a box, fixing a caption — happen here in the real designer, where they cost no tokens and change nothing you did not touch.

## Three ways in

```powershell
RepxDesigner.exe                  # file picker, opens in your Downloads folder
RepxDesigner.exe report.repx      # open that file
RepxDesigner.exe --serve          # listen on 127.0.0.1:7317 for Forma
```

Saving inside the designer writes back to the file it opened.

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

Run `RepxDesigner.exe --serve` and it sits in the system tray. Forma pings `/health` **once there is a report with XML to open**, and again whenever the tab regains focus — starting the companion is something you do *outside* the browser, so a mount-only ping would leave the button dead until a reload. Two narrowings since this said "when the workspace loads": the probe is gated on having something to open, because an empty workspace asks a question nothing is waiting on, and repeat probes are throttled to one per 30 seconds (`DESIGNER_RECHECK_GAP_MS`), because a refused connection is logged by the browser itself and cannot be caught — someone alt-tabbing produced one `ERR_CONNECTION_REFUSED` per switch, and predictable noise hides the unpredictable kind.

**The ping decides whether the button works, not whether it exists.** It sits in the bench bar beside **Save** and **Export .repx** at all times, and with nothing listening it is disabled with a `title` naming the command that turns it on. That is a change from the original behaviour (2026-08-26): the button used to render only once something answered, which meant the one group of people who would benefit from installing the companion — those who have not installed it — were also the only ones the product never mentioned it to. Detection is still real, and clicking something that would fail is still prevented; a capability nobody can discover is simply its own kind of broken. `isVaultAvailable()` gates the key-sync UI by the same detect-never-assume rule, and the same reasoning would apply there if the vault were ever a thing users had to go and enable.

Click it and Forma POSTs the XML to `/open`. The tool writes it to `%TEMP%\Forma\<title>.repx` and opens the designer on it — no download, no file dialog.

| | |
|---|---|
| `GET /health` | `{"app":"RepxDesigner","designerVersion":"20.1.3.0"}` |
| `POST /open` | body is the `.repx` XML; `x-forma-filename` names it |
| `--port N` | move both sides — `DESIGNER_ORIGIN` in `src/lib/designerBridge.ts` must match |

Two guards, because a port open on your machine is reachable by any page you visit:

- **Loopback only, localhost origins only.** `OPTIONS` from anything else gets a bare 403 with no `Access-Control-Allow-Origin`, so the browser never sends the real request.
- **`POST /open` requires the `x-forma-client` header.** It is not CORS-safelisted, which forces a preflight — that is the whole point, since a safelisted POST would reach the handler before any origin check could run. Renaming it on one side without the other disables this.

Verified 2026-08-13: health 200 with the origin echoed, a POST missing the header 400s, `OPTIONS` from a foreign origin 403s.

It uses a raw `TcpListener` rather than `HttpListener` because `HttpListener` wants a URL reservation or an elevated process, and this has to run by double-clicking it.

## Version compatibility

The tool targets **DevExpress 20.1**, the version installed on this machine.

Forma's configuration dropdown offers 26.1 / 25.2 / 25.1 / 24.1 / 23.2 / 23.1 / 22.2 / **20.1**, and the selected version is written into the generated XML's `SerializerVersion` and `Version`. (It did not used to be: the prompt's ROOT STRUCTURE example hardcoded 23.2.3.0, so the setting was inert. See *`geminiService.ts` is a single mega-prompt* in [`docs/notes/gemini.md`](../../docs/notes/gemini.md).)

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

The tidiest version of all this is not to start it at all. `RepxDesigner.exe --register` writes a `forma-repx://` URL-protocol handler under `HKCU\Software\Classes` — no admin, nothing machine-wide — whose command is `"<exe>" --serve "%1"`. Forma's **Open in designer** button is then enabled whenever the report has XML, and clicking it with nothing listening navigates to `forma-repx://serve`, which is the one route by which a web page may cause a local program to run. Windows starts the companion, the page polls `/health` for up to 12 seconds (`waitForDesigner`), and then POSTs the report as usual.

Four things worth knowing before relying on it:

- **The browser asks the first time.** Edge and Chrome show *"This site is trying to open RepxDesigner"* with an **Always allow** checkbox. That prompt is the security model, not a bug, and it cannot be suppressed from the page.
- **A launch is unobservable from script.** An unregistered scheme, a declined prompt and a successful start are indistinguishable to `location.href` — none of them throws. That is why the timeout is the failure signal, and why the error message names all three causes rather than guessing one.
- **The URL is a doorbell, not a delivery.** It carries no report: a `.repx` is tens of kilobytes and would not survive a command line. The XML still goes over the loopback POST, so the CORS and `x-forma-client` guards below apply exactly as before — registering the protocol widens nothing.
- **The protocol launch never shows the "already running" warning box.** `RunServer(port, quietIfTaken: true)` exits silently when the port is taken, because from the page's point of view something already serving *is* success. Started by hand, the warning still appears.

`--unregister` removes the key. Renaming the scheme means renaming `Scheme` in `Program.cs` **and** `DESIGNER_PROTOCOL` in `src/lib/designerBridge.ts`; they are matched by string and a mismatch fails silently.

### Starting it at login, so the button is simply always live

The button is gated on the ping, so "why is *Open in designer* greyed out" has one answer in practice: nothing is listening. Having to remember to start a tray app before it works is a bad deal for a one-click feature, and the fix is to stop remembering — a shortcut in the per-user Startup folder, which needs no admin and no code:

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

  This said the button "is permanently disabled" there. It is not, and has not been since `launchDesigner()` was added: the button is disabled only while there is no report to open, and with one on the bench it is enabled everywhere. A click on a machine with no companion asks the OS to open a `forma-repx://` URL, waits out `waitForDesigner`, and then reports that it could not start — naming a `.exe` that will never run there. So on those platforms the cost is a wasted twelve seconds and a Windows-flavoured message, not a greyed-out control.

  Accepted for now, on the same reasoning as before: the alternative is a browser app sniffing the platform to decide what to admit exists. Worth revisiting if anyone actually runs Forma off Windows, because twelve seconds of nothing is a worse answer than a disabled button with an honest tooltip.
- **Loopback over plain HTTP.** If Forma is ever served over HTTPS the browser will block the request to `http://127.0.0.1` as mixed content, and the button will fail even with the companion running. Note the ping fails the same way, so the button reports itself as "start the companion" when the companion may well be running — the tooltip will be wrong about the reason, and this is the case to suspect first if it is ever deployed behind TLS.
