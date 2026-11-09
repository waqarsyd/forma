/**
 * Packs the Forma Designer download (2026-11-09, the owner's download
 * programme, batch WD).
 *
 *   npx tsx scripts/package-designer.ts --tag v1.3.0 [--msbuild <path>]
 *
 * For the owner, on a Windows PC with DevExpress 20.1 installed, because the
 * companion is compiled against it (and nothing else can build it: CI has no
 * DevExpress). It:
 *
 *   1. rebuilds tools/RepxDesigner in Release with MSBuild;
 *   2. stages RepxDesigner.exe with tools/RepxDesigner/download/README.txt and
 *      NOTICE.txt and the repository's LICENSE as LICENSE.txt, and REFUSES if
 *      anything else is there, a DevExpress file above all
 *      (packageProblems in src/lib/designerRelease.ts);
 *   3. runs the staged exe with --check, headless, to prove it starts with no
 *      DevExpress file beside it;
 *   4. zips it to tools/RepxDesigner/bin/package/FormaDesigner-<version>-windows.zip
 *      with every entry dated 2026-01-01, so the same commit packs to the same
 *      bytes (the project is <Deterministic>);
 *   5. writes the version, name, size, SHA-256, date and --tag into the marked
 *      block of src/lib/designerRelease.ts.
 *
 * It uploads nothing: publishing is the owner's. scripts/deploy.mjs attaches
 * the zip to the release it makes when --tag names that release, and stops
 * before building if the zip is missing or its SHA-256 differs from the
 * committed one. The command to attach it by hand is printed at the end.
 *
 * Pure ASCII, as every script here.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildZip } from '../src/lib/zip';
import { DESIGNER_PACKAGE_FILES, designerZipName, packageProblems } from '../src/lib/designerRelease';

const args = process.argv.slice(2);
const option = (name: string): string | undefined => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};

function fail(message: string): never {
  console.error(`package-designer: ${message}`);
  process.exit(1);
}

const tag = option('--tag');
if (!tag || !/^v\d+\.\d+\.\d+$/.test(tag)) fail('say which Forma release the zip is for: --tag v<x.y.z>.');

const project = join('tools', 'RepxDesigner');
const assemblyInfo = readFileSync(join(project, 'AssemblyInfo.cs'), 'utf8');
const versionMatch = /AssemblyVersion\("(\d+\.\d+\.\d+)\.\d+"\)/.exec(assemblyInfo);
if (!versionMatch) fail('no AssemblyVersion("x.y.z.0") in tools/RepxDesigner/AssemblyInfo.cs.');
const version = versionMatch[1];

// 1. Build.
function findMsBuild(): string {
  const given = option('--msbuild');
  if (given) return given;
  const vswhere = 'C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe';
  if (existsSync(vswhere)) {
    const found = spawnSync(vswhere, ['-latest', '-products', '*', '-requires', 'Microsoft.Component.MSBuild', '-find', 'MSBuild\\**\\Bin\\MSBuild.exe'], { encoding: 'utf8' });
    const first = (found.stdout || '').split(/\r?\n/).find((line) => line.trim());
    if (first) return first.trim();
  }
  const known = 'C:\\Program Files (x86)\\Microsoft Visual Studio\\18\\BuildTools\\MSBuild\\Current\\Bin\\MSBuild.exe';
  if (existsSync(known)) return known;
  fail('MSBuild not found; pass --msbuild <path to MSBuild.exe>.');
}
const msbuild = findMsBuild();
console.log(`Building Forma Designer ${version} with ${msbuild}`);
const build = spawnSync(msbuild, [join(project, 'RepxDesigner.csproj'), '/t:Rebuild', '/p:Configuration=Release', '/nologo', '/v:minimal'], { stdio: 'inherit' });
if (build.status !== 0) fail('the build failed (is DevExpress 20.1 installed, and is a copy of RepxDesigner running?).');

// 2. Stage, and refuse anything that is not ours.
const stage = join(project, 'bin', 'package', 'stage');
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
copyFileSync(join(project, 'bin', 'Release', 'RepxDesigner.exe'), join(stage, 'RepxDesigner.exe'));
copyFileSync(join(project, 'download', 'README.txt'), join(stage, 'README.txt'));
copyFileSync(join(project, 'download', 'NOTICE.txt'), join(stage, 'NOTICE.txt'));
copyFileSync('LICENSE', join(stage, 'LICENSE.txt'));
const staged = readdirSync(stage);
const problems = packageProblems(staged);
if (problems.length) fail(`refusing to pack:\n  ${problems.join('\n  ')}`);

// 3. It starts with nothing beside it.
const check = spawnSync(join(stage, 'RepxDesigner.exe'), ['--check', '--no-load'], { encoding: 'utf8' });
let checked: { app?: string; using?: string | null } = {};
try {
  checked = JSON.parse((check.stdout || '').trim());
} catch {
  fail(`the staged exe did not answer --check (exit ${check.status}): ${(check.stdout || check.stderr || '').slice(0, 300)}`);
}
if (checked.app !== 'RepxDesigner') fail('the staged exe answered --check with something else.');
console.log(`The staged exe starts alone and finds DevExpress ${checked.using ?? 'none on this PC'}.`);

// 4. Zip, dated so the same commit packs to the same bytes in any time zone.
const zipped = buildZip(
  DESIGNER_PACKAGE_FILES.map((name) => ({ name, content: new Uint8Array(readFileSync(join(stage, name))) })),
  new Date(2026, 0, 1, 0, 0, 0),
  { keepPaths: true },
);
if (!zipped.bytes) fail(`the zip could not be made: ${zipped.reason}`);
const file = designerZipName(version);
const out = join(project, 'bin', 'package', file);
writeFileSync(out, zipped.bytes);
const sha256 = createHash('sha256').update(zipped.bytes).digest('hex');
const bytes = zipped.bytes.length;

// 5. The manifest.
const manifestPath = join('src', 'lib', 'designerRelease.ts');
const manifest = readFileSync(manifestPath, 'utf8');
const begin = manifest.indexOf('// BEGIN designer release');
const end = manifest.indexOf('// END designer release');
if (begin < 0 || end < begin) fail('src/lib/designerRelease.ts has lost its BEGIN/END markers.');
const previous = /sha256: '([0-9a-f]*)'[\s\S]*?date: '([^']*)'/.exec(manifest.slice(begin, end));
// Repacking the same bytes keeps the date it was first packed on.
const date = previous && previous[1] === sha256 ? previous[2] : new Date().toISOString().slice(0, 10);
const block =
  '// BEGIN designer release (scripts/package-designer.ts writes this block)\n' +
  'export const DESIGNER_RELEASE: DesignerRelease = {\n' +
  `  version: '${version}',\n` +
  `  file: '${file}',\n` +
  `  bytes: ${bytes},\n` +
  `  sha256: '${sha256}',\n` +
  `  date: '${date}',\n` +
  `  tag: '${tag}',\n` +
  '};\n';
writeFileSync(manifestPath, manifest.slice(0, begin) + block + manifest.slice(end));

console.log(`\nPacked ${out}`);
console.log(`  ${bytes.toLocaleString('en-US')} bytes, SHA-256 ${sha256}`);
console.log(`  written to ${manifestPath} (version ${version}, release ${tag})`);
console.log(`\nCommit the manifest. scripts/deploy.mjs attaches the zip to release ${tag} when it makes it; by hand:`);
console.log(`  gh release upload ${tag} "${out}" --repo waqarsyd/forma`);
