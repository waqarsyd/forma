Forma Designer for Windows
==========================

Forma Designer opens the reports you make in Forma (https://openforma.web.app)
in the DevExpress report designer on your PC, with one click on "Open in
designer". It is free and open source (Apache-2.0):
https://github.com/waqarsyd/forma/tree/main/tools/RepxDesigner


What you need
-------------

- Windows 10 or 11.
- .NET Framework 4.7.2 or later, which Windows 10 (version 1803 or later) and
  Windows 11 already have.
- DevExpress Reporting for WinForms, version 20.1 or later, installed on this
  PC. DevExpress is NOT included: it is a separate commercial product of
  Developer Express Inc. If you do not have it, DevExpress offers a free
  30-day trial with no registration at https://www.devexpress.com/products/try/


Install
-------

1. Unzip, and double-click RepxDesigner.exe.
2. Windows may say "Windows protected your PC", because the program is not
   code-signed. Choose "More info", then "Run anyway". To check the file
   first, compare its SHA-256 with the one on https://openforma.web.app/download
   (PowerShell: Get-FileHash .\FormaDesigner-<version>-windows.zip).
3. Choose Install. It installs for you only, needs no administrator, and goes
   in %LOCALAPPDATA%\Programs\Forma Designer.
4. In Forma, choose Open in designer. The first time, your browser asks to
   allow it: allow it, and it will not ask again.


What it does on your PC
-----------------------

It listens on 127.0.0.1:7317, which only programs on this PC can reach, and
answers Forma pages only. It sends nothing anywhere. It reads a SQL Server
database only when you ask it to, through a connection you add yourself, and
keeps a SQL Server login's password encrypted for your Windows user.


Remove it
---------

Settings > Apps > Installed apps > Forma Designer > Uninstall. Your SQL Server
connections are kept unless you choose to remove them.


Help: https://openforma.web.app/docs#designer
