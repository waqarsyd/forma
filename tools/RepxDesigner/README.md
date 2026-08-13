# RepxDesigner

Opens a `.repx` file in the DevExpress end-user report designer. No database, no ERP.

This is the **edit** half of the Forma workflow. Forma generates a report and the user clicks **Export .repx** in the workspace; at that point the model's job is finished and the downloaded file is the single source of truth. Small adjustments — nudging a field, resizing a box, fixing a caption — belong here rather than in another generation round, because a drag costs nothing and cannot change anything you did not touch.

```powershell
# pick a file (opens in your Downloads folder, where Forma exports land)
tools\RepxDesigner\bin\Release\RepxDesigner.exe

# or open one directly
tools\RepxDesigner\bin\Release\RepxDesigner.exe C:\path\to\Invoice.repx
```

Saving inside the designer writes back to the same file.

## Build

```powershell
& 'C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools\MSBuild\Current\Bin\MSBuild.exe' tools\RepxDesigner\RepxDesigner.csproj /p:Configuration=Release
```

**Stop the Vite dev server first, or expect it to die.** MSBuild briefly locks files under `obj/`, and Vite's watcher takes the whole dev server down with an unhandled `EBUSY` when it meets one. `vite.config.ts` now excludes `**/tools/**` from the watcher, which is the real fix; this note stays because the failure is confusing when it happens.

## Version compatibility

This is the thing most likely to bite. It targets **DevExpress 20.1**, matching the target ERP (`DevExpress.XtraReports.v20.1`, `TargetFrameworkVersion v4.7.2`) and the templates that ship with it — `tagprintscript.repx` declares `SerializerVersion="20.1.3.0"`.

**Forma currently emits `SerializerVersion="23.2.3.0"`**, and its report-configuration dropdown offers 24.1 / 23.2 / 23.1 / 22.2 with no 20.1 option. A file written by a newer DevExpress may not load in an older designer. The tool reads `SerializerVersion` off the file before attempting to load and, on failure, shows it next to the designer's own version — so the mismatch reads as a mismatch rather than as an unexplained crash.

If that is what you hit, the fix is on Forma's side: add 20.1 to the version list in the config modal and to the prompt's DevExpress cheat sheet. Editing the XML by hand is not a fix.

## Not committed

`bin/` and `obj/` are gitignored (`tools/**/bin/`, `tools/**/obj/`). `Release` is ~137 MB because the DevExpress assemblies are copied local, so the folder runs on a machine without DevExpress installed. Building it does need DevExpress 20.1 installed at the path in the `.csproj` `HintPath`s.
