# Read the structure of Crystal Reports .rpt files for Forma's vision model
# (2026-11-03, milestone 6 of docs/proposals/own-model.md).
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\model\crystal.ps1 `
#     -Reports <folder> -Data <folder> [-Shard 0 -Shards 1] [-Limit 0]
#
# -Reports  searched recursively for .rpt. Reports stay where they are.
# -Data     where the layouts go, OUTSIDE the repository: crystal\<md5>.json,
#           one per distinct file, and crystal-files-<shard>.json, which pairs
#           each md5 with a file it was read from (local only: folder names can
#           name a client). Then `npx tsx scripts/model/crystal.ts --data <folder>`
#           numbers them into skeletons\ for `npm run model:dataset`.
# -Shard/-Shards  split the files between processes by their path, so several
#           can run at once. A layout is named by the md5 of its file, so a copy
#           is written once, and a rerun skips what is already written.
#           A report that crashes the Crystal engine ends the process; rerun the
#           shard until it prints its summary line, and that report is skipped.
#
# Needs the Crystal Reports runtime 13 (CrystalDecisions.*, 13.0.2000.0) in the
# GAC, which this server has, and 64-bit PowerShell.
#
# STRUCTURE ONLY, as everything that leaves for training: each section's kind
# and height, each object's kind, place, size, font, alignment and borders, and
# the role its text plays (a caption, a bound value, a total, page information).
# A text object gives only its LENGTH; a field gives only what kind of field it
# is. No text, formula, field name, query or picture is read into the output,
# and the console prints counts only. Places are in hundredths of an inch, as a
# skeleton's are (a twip is 1/1440 inch, so hundredths = twips / 14.4).
#
# Pure ASCII, for the PowerShell 5.1 reason in CLAUDE.md.
param(
  [Parameter(Mandatory = $true)][string]$Reports,
  [Parameter(Mandatory = $true)][string]$Data,
  [int]$Shard = 0,
  [int]$Shards = 1,
  [int]$Limit = 0
)
$ErrorActionPreference = 'Stop'
if ([IntPtr]::Size -ne 8) { throw 'Run this in 64-bit PowerShell.' }
Add-Type -AssemblyName 'CrystalDecisions.CrystalReports.Engine, Version=13.0.2000.0, Culture=neutral, PublicKeyToken=692fbea5521e1304'
Add-Type -AssemblyName 'CrystalDecisions.Shared, Version=13.0.2000.0, Culture=neutral, PublicKeyToken=692fbea5521e1304'

$outDir = Join-Path $Data 'crystal'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$utf8 = New-Object System.Text.UTF8Encoding($false)
$md5 = [System.Security.Cryptography.MD5]::Create()

function Hundredths([double]$twips) { return [math]::Round($twips / 14.4, 2) }

function FontOf($o) {
  try {
    $f = $o.Font
    if ($null -eq $f) { return $null }
    return @{ family = [string]$f.Name; size = [math]::Round([double]$f.SizeInPoints, 2); bold = [bool]$f.Bold; italic = [bool]$f.Italic }
  } catch { return $null }
}

function BordersOf($o) {
  $mask = 0
  try {
    $b = $o.Border
    if ($b.TopLineStyle.ToString() -ne 'NoLine') { $mask = $mask -bor 1 }
    if ($b.RightLineStyle.ToString() -ne 'NoLine') { $mask = $mask -bor 2 }
    if ($b.BottomLineStyle.ToString() -ne 'NoLine') { $mask = $mask -bor 4 }
    if ($b.LeftLineStyle.ToString() -ne 'NoLine') { $mask = $mask -bor 8 }
  } catch { }
  return $mask
}

function AlignOf($o, [bool]$numeric) {
  $a = 'DefaultAlign'
  try { $a = $o.ObjectFormat.HorizontalAlignment.ToString() } catch { }
  switch ($a) {
    'LeftAlign' { return 'left' }
    'HorizontalCenterAlign' { return 'center' }
    'RightAlign' { return 'right' }
    default { if ($numeric) { return 'right' } else { return 'left' } }
  }
}

function SectionKind([string]$k) {
  switch ($k) {
    'ReportHeader' { return 'ReportHeader' }
    'PageHeader' { return 'PageHeader' }
    'GroupHeader' { return 'GroupHeader' }
    'Detail' { return 'Detail' }
    'GroupFooter' { return 'GroupFooter' }
    'ReportFooter' { return 'ReportFooter' }
    'PageFooter' { return 'PageFooter' }
    default { return 'Unknown' }
  }
}

function ControlOf($o, [double]$sectionHeight) {
  $kind = $o.Kind.ToString()
  $x = [double]$o.Left; $y = [double]$o.Top; $w = 0.0; $h = 0.0
  if ($kind -eq 'LineObject' -or $kind -eq 'BoxObject') {
    $w = [math]::Abs([double]$o.Right - [double]$o.Left)
    $h = [math]::Abs([double]$o.Bottom - [double]$o.Top)
  } else {
    $w = [double]$o.Width; $h = [double]$o.Height
  }
  # A line or box may run on into later sections; inside this one it is cut at the bottom.
  if ($y + $h -gt $sectionHeight) { $h = [math]::Max(14.4, $sectionHeight - $y) }
  $c = @{ x = (Hundredths $x); y = (Hundredths $y); w = (Hundredths ([math]::Max($w, 14.4))); h = (Hundredths ([math]::Max($h, 14.4))); font = $null; align = 'left'; borders = (BordersOf $o); chars = 0 }
  switch ($kind) {
    'TextObject' { $len = 0; try { $len = ([string]$o.Text).Trim().Length } catch { }
      $c.kind = 'label'; if ($len -gt 0) { $c.role = 'caption' } else { $c.role = 'decoration' }; $c.chars = [math]::Min(200, $len)
      $c.font = FontOf $o; $c.align = AlignOf $o $false }
    'FieldHeadingObject' { $len = 0; try { $len = ([string]$o.Text).Trim().Length } catch { }
      $c.kind = 'label'; $c.role = 'caption'; $c.chars = [math]::Min(200, $len); $c.font = FontOf $o; $c.align = AlignOf $o $false }
    'FieldObject' {
      $def = ''; $numeric = $false
      try { $def = $o.DataSource.GetType().Name } catch { }
      try { $vt = $o.DataSource.ValueType.ToString(); $numeric = ($vt -match 'Number|Currency|Int') } catch { }
      $c.kind = 'label'; $c.role = 'value'
      if ($def -match 'SpecialVar') { $c.kind = 'pageInfo'; $c.role = 'pageInfo' }
      elseif ($def -match 'Summary|RunningTotal') { $c.role = 'total' }
      $c.font = FontOf $o; $c.align = AlignOf $o $numeric }
    'LineObject' { $c.kind = 'line'; $c.role = 'decoration' }
    'BoxObject' { $c.kind = 'shape'; $c.role = 'decoration' }
    'PictureObject' { $c.kind = 'picture'; $c.role = 'decoration' }
    'BlobFieldObject' { $c.kind = 'picture'; $c.role = 'decoration' }
    'SubreportObject' { $c.kind = 'subreport'; $c.role = 'decoration' }
    'ChartObject' { $c.kind = 'chart'; $c.role = 'decoration' }
    default { $c.kind = 'other'; $c.role = 'decoration' }
  }
  return $c
}

function LayoutOf([string]$path) {
  $doc = New-Object CrystalDecisions.CrystalReports.Engine.ReportDocument
  try {
    $doc.Load($path)
    $po = $doc.PrintOptions
    $m = $po.PageMargins
    # One band per area. Crystal splits an area into sections (Report Header a,
    # b, c...) that print one under the other; DevExpress has one band for it,
    # so the sections are stacked into it, each control moved down by the
    # sections above. A group's header and footer are areas of their own.
    $bands = @()
    foreach ($a in $doc.ReportDefinition.Areas) {
      $areaHidden = $false
      try { $areaHidden = [bool]$a.AreaFormat.EnableSuppress } catch { }
      if ($areaHidden) { continue }
      $offset = 0.0
      $controls = @()
      foreach ($s in $a.Sections) {
        $suppressed = $false
        try { $suppressed = [bool]$s.SectionFormat.EnableSuppress } catch { }
        if ($suppressed) { continue }
        $height = [double]$s.Height
        foreach ($o in $s.ReportObjects) {
          $hidden = $false
          try { $hidden = [bool]$o.ObjectFormat.EnableSuppress } catch { }
          if ($hidden) { continue }
          try {
            $c = ControlOf $o $height
            $c.y = [math]::Round($c.y + (Hundredths $offset), 2)
            $controls += ,$c
          } catch { }
        }
        $offset += $height
      }
      if ($offset -le 0) { continue }
      $kind = SectionKind $a.Kind.ToString()
      $group = 0; if ($kind -eq 'GroupHeader') { $group = 1 }
      $bands += ,@{ kind = $kind; height = (Hundredths $offset); groupFields = $group; controls = $controls }
    }
    $width = [double]$po.PageContentWidth + [double]$m.leftMargin + [double]$m.rightMargin
    $pageHeight = [double]$po.PageContentHeight + [double]$m.topMargin + [double]$m.bottomMargin
    return @{
      width = (Hundredths $width); height = (Hundredths $pageHeight)
      margins = @{ top = (Hundredths $m.topMargin); bottom = (Hundredths $m.bottomMargin); left = (Hundredths $m.leftMargin); right = (Hundredths $m.rightMargin) }
      bands = $bands
    }
  } finally {
    $doc.Close(); $doc.Dispose()
  }
}

$files = Get-ChildItem -LiteralPath $Reports -Recurse -File -Filter *.rpt
$pairs = @{}
$read = 0; $written = 0; $skipped = 0; $failed = 0; $other = 0
foreach ($f in $files) {
  # Which process takes a file is decided by its path, which costs nothing to
  # hash; reading every file in every process to hash its content would read the
  # whole folder once per shard. A layout is still named by its content, so a
  # copy in another shard is written once and skipped after.
  $pathHash = ([BitConverter]::ToString($md5.ComputeHash([Text.Encoding]::UTF8.GetBytes($f.FullName.ToLower())))).Replace('-', '')
  if (([Convert]::ToInt32($pathHash.Substring(0, 6), 16) % $Shards) -ne $Shard) { $other++; continue }
  # A path past Windows' 260 characters needs the \\?\ form. Nothing here may
  # print a path: a folder name can name a client, so a failure is only counted.
  $full = $f.FullName
  if ($full.Length -ge 248 -and -not $full.StartsWith('\\')) { $full = '\\?\' + $full }
  try {
    $bytes = [IO.File]::ReadAllBytes($full)
  } catch {
    $failed++
    continue
  }
  $hash = ([BitConverter]::ToString($md5.ComputeHash($bytes))).Replace('-', '').ToLower()
  if ($pairs.ContainsKey($hash)) { continue }
  $pairs[$hash] = $f.FullName.Substring($Reports.Length).TrimStart('\')
  $out = Join-Path $outDir ($hash + '.json')
  if (Test-Path -LiteralPath $out) { $skipped++; continue }
  # Some reports crash the Crystal engine itself, which ends the process with no
  # exception to catch (2026-11-03: every shard of the first run died within
  # ~80 files). A marker is written before each one is opened; a rerun that
  # finds a marker with no layout skips that file as failed and goes on.
  $marker = Join-Path $outDir ($hash + '.try')
  if (Test-Path -LiteralPath $marker) { $failed++; continue }
  if ($Limit -gt 0 -and $read -ge $Limit) { break }
  $read++
  [IO.File]::WriteAllText($marker, '', $utf8)
  try {
    $layout = LayoutOf $full
    [IO.File]::WriteAllText($out, (ConvertTo-Json $layout -Depth 8 -Compress), $utf8)
    Remove-Item -LiteralPath $marker -Force
    $written++
  } catch {
    $failed++
  }
  if ($read % 200 -eq 0) { "shard ${Shard}: read $read, written $written, failed $failed" }
}
$index = $pairs.GetEnumerator() | ForEach-Object { @{ md5 = $_.Key; file = $_.Value } }
[IO.File]::WriteAllText((Join-Path $Data ("crystal-files-" + $Shard + ".json")), (ConvertTo-Json @($index) -Depth 3 -Compress), $utf8)
"shard ${Shard} of ${Shards}: distinct files $($pairs.Count), written $written, already there $skipped, failed $failed (files in other shards: $other)"
