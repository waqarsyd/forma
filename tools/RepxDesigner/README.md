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

**Double-clicking a downloaded `.repx` also works** — `.repx` is associated with this exe for the current user. To undo that:

```powershell
Remove-Item -Path 'HKCU:\Software\Classes\.repx' -Recurse -Force
Remove-Item -Path 'HKCU:\Software\Classes\RepxDesigner.repx' -Recurse -Force
```

## `--serve`, and the button it turns on

A web page cannot start a program — every browser blocks that, and should. So Forma's **Open in designer** button works the other way round: this tool listens, and the page asks it.

Run `RepxDesigner.exe --serve` and it sits in the system tray. Forma pings `/health` when the workspace loads and shows the button only if something answers; with the companion stopped there is no button and **Export .repx** is the whole story. That is the same contract `isVaultAvailable()` uses to gate the key-sync UI: detect the capability, never assume it.

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

Forma's configuration dropdown offers 24.1 / 23.2 / 23.1 / 22.2 / **20.1**, and the selected version is written into the generated XML's `SerializerVersion` and `Version`. (It did not used to be: the prompt's ROOT STRUCTURE example hardcoded 23.2.3.0, so the setting was inert. See *`geminiService.ts` is a single mega-prompt* in [`docs/notes/gemini.md`](../../docs/notes/gemini.md).)

**Verified on 2026-08-13:** generated with v20.1 selected, exported, opened here with every control present.

A file declaring a newer release will not open in an older designer, so the tool reads `SerializerVersion` before loading and, on failure, shows it beside the designer's own version — a mismatch reads as a mismatch rather than an unexplained crash. The fix for one is on Forma's side, in the config modal and the prompt's cheat sheet together. Editing the XML by hand is not a fix.

## Build

```powershell
& 'C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools\MSBuild\Current\Bin\MSBuild.exe' tools\RepxDesigner\RepxDesigner.csproj /p:Configuration=Release
```

Needs DevExpress 20.1 installed at the path in the `.csproj` `HintPath`s. `bin/` and `obj/` are gitignored (`tools/**/bin/`, `tools/**/obj/`); `Release` is ~137 MB because the DevExpress assemblies are copied local so the folder runs standalone.

**Stop `--serve` before rebuilding** — MSBuild cannot overwrite a running exe. `vite.config.ts` already excludes `**/tools/**` from its watcher, so a build no longer kills the dev server.

## Start it yourself, from your own desktop

**`--serve` must be launched from the session you are actually looking at.** A Windows process paints on the desktop of whatever session and window station created it, so an instance started by an agent shell, a service, a scheduled task or a second RDP session opens the designer somewhere you cannot see — and nothing reports an error, because from the browser's side it all succeeded: the guards passed, the file was written, the designer was told to open.

Observed 2026-08-13 on this machine, which has interactive desktops in sessions 2, 3 and 4: an instance started from a background shell wrote `%TEMP%\Forma\Job_Card_Report.repx` correctly and opened the designer on a desktop nobody was watching. The symptom is "the button does nothing" with a perfectly good file on disk.

Double-click the exe (or a shortcut with `--serve` in its Target), and check the tray icon is in **your** tray. If the port is taken, an instance is already running somewhere — `Get-Process RepxDesigner | Select-Object Id, SessionId` shows which session owns it.

## Caveats

- **Windows and DevExpress only.** Forma is a browser app that must keep working without any of this, which is why the button is feature-detected rather than assumed.
- **Loopback over plain HTTP.** If Forma is ever served over HTTPS the browser will block the request to `http://127.0.0.1` as mixed content, and the button will fail even with the companion running.
