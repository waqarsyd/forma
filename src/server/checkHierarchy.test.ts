/**
 * The project hierarchy (2026-11-23): every place a change has to reach, and
 * the rules the pre-commit hook holds each commit to. The cases feed the pure
 * `findings` a change as git would describe it; the last ones read the real
 * tree, so CI holds the hierarchy to the repository even where no hook runs.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { DOC_PATH, RULES, SURFACES, findings, hierarchyMarkdown, missingSurfaces, parseNameStatus } from '../../scripts/check-hierarchy.mjs';

type Change = { status: 'A' | 'M' | 'D' | 'R'; path: string; oldPath?: string };
type Pkg = { before: Record<string, unknown>; after: Record<string, unknown> } | null;

const TOP = new Set(['src', 'docs', 'scripts', 'tests', 'tools', 'README.md', 'package.json', 'CLAUDE.md']);
const check = (changes: Change[], pkg: Pkg = null, mentionsOf: (name: string) => string[] = () => []) =>
  findings({ changes, pkg, topLevel: TOP, mentionsOf });
const rule = (out: ReturnType<typeof check>, id: string) => out.find((f) => f.rule.id === id);
const open = (out: ReturnType<typeof check>, id: string) => rule(out, id)?.open.map((l) => l.path);
const add = (path: string): Change => ({ status: 'A', path });
const edit = (path: string): Change => ({ status: 'M', path });

describe('project hierarchy', () => {
  it('an MCP connection added in src/lib and wired into App waits for the layout, and lists every page that describes the product', () => {
    const out = check([add('src/lib/mcpClient.ts'), edit('src/App.tsx'), edit('src/lib/releases.ts')]);
    expect(open(out, 'layout')).toEqual(['docs/project-structure.md']);
    const feature = rule(out, 'feature');
    expect(feature?.triggers).toEqual(['src/lib/mcpClient.ts (added)', 'src/App.tsx']);
    expect(feature?.lines.find((l) => l.path === 'src/lib/releases.ts')?.reached).toBe(true);
    expect(feature?.open.map((l) => l.path)).toEqual(expect.arrayContaining([
      'src/components/FeaturesPage.tsx', 'src/components/DocsPage.tsx', 'docs/PRD.md', 'src/components/LegalPage.tsx', 'src/server/securityHeaders.ts',
    ]));
  });

  it('a file added under src/lib is satisfied by the layout in the same commit, and a feature removed asks the same pages', () => {
    expect(open(check([add('src/lib/mcpClient.ts'), edit('docs/project-structure.md')]), 'layout')).toEqual([]);
    const removed = check([{ status: 'D', path: 'src/components/PlanCard.tsx' }]);
    expect(open(removed, 'layout')).toEqual(['docs/project-structure.md']);
    expect(rule(removed, 'feature')?.triggers).toEqual(['src/components/PlanCard.tsx (removed)']);
  });

  it('a test file added waits for testing.md; a test file changed only asks', () => {
    expect(open(check([add('src/lib/mcpClient.test.ts')]), 'test-files')).toEqual(['docs/notes/testing.md']);
    expect(rule(check([add('src/lib/mcpClient.test.ts')]), 'layout')).toBeUndefined();
    const changed = check([edit('src/lib/repx.test.ts')]);
    expect(rule(changed, 'test-files')).toBeUndefined();
    expect(open(changed, 'test-cases')).toEqual(['docs/notes/testing.md']);
    expect(rule(changed, 'feature')).toBeUndefined();
  });

  it('the Node floor waits for every copy of it', () => {
    const pkg = { before: { engines: { node: '^24.15.0 || >=26' } }, after: { engines: { node: '>=26' } } };
    const out = check([edit('package.json'), edit('README.md')], pkg);
    expect(open(out, 'node-floor')).toEqual(['CONTRIBUTING.md', '.github/workflows/checks.yml', 'src/components/infoPages.tsx', 'CLAUDE.md']);
  });

  it('a version waits for its release entry, the lockfile and the Docs page that clones it, and a dependency for the lockfile', () => {
    expect(open(check([edit('package.json')], { before: { version: '1.6.5' }, after: { version: '1.6.6' } }), 'version'))
      .toEqual(['src/lib/releases.ts', 'package-lock.json', 'src/components/DocsPage.tsx']);
    const dep = { before: { devDependencies: { vitest: '^5.1.1' } }, after: { devDependencies: { vitest: '^5.2.0' } } };
    expect(open(check([edit('package.json')], dep), 'dependencies')).toEqual(['package-lock.json']);
    expect(open(check([edit('package.json'), edit('package-lock.json')], dep), 'dependencies')).toEqual([]);
  });

  it('an npm script added waits for CLAUDE.md and README.md; a command changed only asks', () => {
    const added = { before: { scripts: { test: 'vitest run' } }, after: { scripts: { test: 'vitest run', 'check:x': 'node x.mjs' } } };
    expect(open(check([edit('package.json')], added), 'scripts-list')).toEqual(['CLAUDE.md', 'README.md']);
    const changedCommand = { before: { scripts: { test: 'vitest run' } }, after: { scripts: { test: 'vitest run --silent' } } };
    const out = check([edit('package.json')], changedCommand);
    expect(rule(out, 'scripts-list')).toBeUndefined();
    expect(open(out, 'script-commands')).toEqual(['CLAUDE.md', 'README.md']);
  });

  it('a new root file waits for the encoding sweep to name it, and a new top-level directory for the layout and README', () => {
    expect(open(check([add('NOTICE.md')]), 'root-file')).toEqual(['scripts/check-encoding.mjs']);
    expect(rule(check([edit('README.md')]), 'root-file')).toBeUndefined();
    const dir = check([add('mcp/server.ts'), add('mcp/tools.ts')]);
    expect(rule(dir, 'top-dir')?.triggers).toEqual(['mcp/ (new)']);
    expect(open(dir, 'top-dir')).toEqual(['docs/project-structure.md', 'README.md']);
  });

  it('the MCP server or the command line changing lists what tells other programs how to use Forma, and a file added there waits for the layout', () => {
    const out = check([add('src/mcp/tools.ts'), edit('scripts/repx.ts')]);
    expect(open(out, 'layout')).toEqual(['docs/project-structure.md']);
    expect(rule(out, 'mcp')?.triggers).toEqual(['src/mcp/tools.ts (added)', 'scripts/repx.ts']);
    expect(open(out, 'mcp')).toEqual(expect.arrayContaining(['SECURITY.md', 'docs/skills/devexpress-repx/SKILL.md', 'src/components/DocsPage.tsx', 'src/components/LegalPage.tsx']));
    // Since 2026-11-24 (the MCP work's wave 5): the note that owns the server, and the test that holds its tool list to the pages.
    expect(open(out, 'mcp')).toEqual(expect.arrayContaining(['docs/notes/mcp.md', 'src/components/publicClaims.test.ts']));
    expect(open(out, 'mcp')).not.toContain('docs/notes/');
    // Since the wave-4 review (R4): the FAQ and CONTRIBUTING.md also say what the tools do and need, and the
    // feature rule stays quiet for src/mcp, so a tool added to the server must prompt them here.
    expect(open(out, 'mcp')).toEqual(expect.arrayContaining(['src/components/faqs.tsx', 'CONTRIBUTING.md']));
    expect(rule(out, 'feature')).toBeUndefined();
    expect(rule(check([edit('src/mcp/tools.test.ts')]), 'mcp')).toBeUndefined();
  });

  it('the command line, a second entry in src/mcp with its own launcher, is seen by the same rule before any of it lands, and its tests are not', () => {
    // 2026-11-24, finding SURF-1 of the command line's design audit: every file the command line is to have, as the audit's
    // defaults placed it (CLI-1, TEST-2), with scripts/repx.ts kept as a forwarder; mcp.md must be asked for by name, never
    // hidden behind the notes folder that testing.md, staged with every new test, would tick.
    const cli = check([add('src/mcp/cli.mjs'), add('src/mcp/cliEntry.ts'), add('src/mcp/cli.ts'), add('src/mcp/cliBatch.ts'), edit('scripts/repx.ts'), add('src/mcp/cli.test.ts'), edit('docs/notes/testing.md')]);
    expect(rule(cli, 'mcp')?.triggers).toEqual(['src/mcp/cli.mjs (added)', 'src/mcp/cliEntry.ts (added)', 'src/mcp/cli.ts (added)', 'src/mcp/cliBatch.ts (added)', 'scripts/repx.ts']);
    expect(rule(cli, 'mcp')?.rule.title).toMatch(/^Forma's MCP server and command line/);
    expect(open(cli, 'mcp')).toEqual(expect.arrayContaining(['docs/notes/mcp.md', 'docs/skills/devexpress-repx/SKILL.md', 'SECURITY.md', 'README.md', 'src/components/DocsPage.tsx', 'src/components/publicClaims.test.ts', '.env.example']));
    expect(rule(cli, 'feature')).toBeUndefined();
    expect(open(cli, 'layout')).toEqual(['docs/project-structure.md']);
    expect(SURFACES.mcpNote.what).toMatch(/^Forma's MCP server and command line/);
    // The launchers that pin Forma's tsconfig (CLI-8) are files of it too.
    expect(rule(check([edit('src/mcp/run.mjs'), edit('src/mcp/genWorker.mjs')]), 'mcp')?.triggers).toEqual(['src/mcp/run.mjs', 'src/mcp/genWorker.mjs']);
    expect(rule(check([add('src/mcp/cli.test.ts'), edit('docs/notes/testing.md')]), 'mcp')).toBeUndefined();
  });

  it("Forma Designer's C# lists every page that describes it; RepxProbe's lists what cites it, and neither lists the other's pages", () => {
    // 2026-11-24, SURF-1: the database verbs of wave 6 change tools/RepxDesigner, and what they read reaches the Docs page's
    // designer and data articles, the terms and the privacy policy, the PRD, SECURITY.md and mcp.md, which the tools rule never asked for;
    // and, from the wave-1 review (HIER2-1), CLAUDE.md, whose session rule for starting it the verbs change, the home page and the
    // download page's description in seo.ts.
    const designer = check([edit('tools/RepxDesigner/Sql.cs'), add('tools/RepxDesigner/Verbs.cs')]);
    expect(rule(designer, 'designer')?.triggers).toEqual(['tools/RepxDesigner/Sql.cs', 'tools/RepxDesigner/Verbs.cs (added)']);
    expect(open(designer, 'designer')).toEqual(expect.arrayContaining([
      'tools/RepxDesigner/README.md', 'src/lib/designerRelease.ts', 'src/components/infoPages.tsx', 'src/components/DocsPage.tsx',
      'src/components/LegalPage.tsx', 'docs/notes/mcp.md', 'docs/PRD.md', 'SECURITY.md', 'docs/notes/gemini.md', 'docs/notes/app-shell.md',
      'CLAUDE.md', 'src/components/LandingPage.tsx', 'src/lib/seo.ts',
    ]));
    expect(rule(designer, 'designer')?.rule.why).toContain('src/lib/inspectionGuard.ts');
    expect(open(designer, 'designer')).not.toContain('tools/RepxProbe/README.md');
    expect(rule(designer, 'tools')).toBeUndefined();
    expect(rule(designer, 'feature')).toBeUndefined();
    // Its README is the surface itself, so editing it alone asks nothing.
    expect(rule(check([edit('tools/RepxDesigner/README.md')]), 'designer')).toBeUndefined();
    const probe = check([edit('tools/RepxProbe/Sql.cs')]);
    expect(rule(probe, 'designer')).toBeUndefined();
    // Every page that cites a RepxProbe command (HIER2-2): the PRD and app-shell.md name render, inspect, emit-gauge and emit-localize.
    expect(open(probe, 'tools')).toEqual(['tools/RepxProbe/README.md', 'docs/notes/gemini.md', 'docs/proposals/devexpress-parity.md', 'docs/PRD.md', 'docs/notes/app-shell.md', 'docs/skills/devexpress-repx/SKILL.md', 'tools/RepxDesigner/README.md', 'CLAUDE.md']);
    expect(open(probe, 'tools')).not.toContain('src/lib/designerRelease.ts');
  });

  it('an edit to a page on its own is not a feature change', () => {
    const out = check([edit('src/components/FeaturesPage.tsx'), edit('src/lib/releases.ts')]);
    expect(rule(out, 'feature')).toBeUndefined();
  });

  it('a removed or renamed file lists the docs that still name it; a short name, or a move that keeps the name, lists nothing', () => {
    const mentions = (name: string) => (name === 'panelSize' ? ['docs/notes/app-shell.md', 'CLAUDE.md', DOC_PATH] : []);
    const out = check([{ status: 'D', path: 'src/lib/panelSize.ts' }, edit('CLAUDE.md')], null, mentions);
    expect(rule(out, 'removed')?.lines).toEqual([
      { path: 'docs/notes/app-shell.md', what: 'still names panelSize', reached: false },
      { path: 'CLAUDE.md', what: 'still names panelSize', reached: true },
    ]);
    const all = () => ['docs/notes/app-shell.md'];
    expect(rule(check([{ status: 'D', path: 'src/lib/ids.ts' }], null, all), 'removed')).toBeUndefined();
    expect(rule(check([{ status: 'R', oldPath: 'src/lib/panelSize.ts', path: 'src/server/panelSize.ts' }], null, all), 'removed')).toBeUndefined();
  });

  it('reads git\'s name-status output, a rename and a copy included', () => {
    expect(parseNameStatus('M\0src/App.tsx\0R087\0src/lib/a.ts\0src/lib/b.ts\0C100\0x.ts\0y.ts\0D\0old.md\0T\0link\0'))
      .toEqual([
        { status: 'M', path: 'src/App.tsx' },
        { status: 'R', oldPath: 'src/lib/a.ts', path: 'src/lib/b.ts' },
        { status: 'A', path: 'y.ts' },
        { status: 'D', path: 'old.md' },
        { status: 'M', path: 'link' },
      ]);
  });

  it('every rule names surfaces the hierarchy has, and every surface exists', () => {
    for (const r of RULES) for (const key of r.surfaces ?? []) expect(SURFACES, `${r.id} names ${key}`).toHaveProperty(key);
    expect(missingSurfaces(existsSync)).toEqual([]);
  });

  it('docs/project-hierarchy.md is the hierarchy as the script writes it', () => {
    expect(readFileSync(DOC_PATH, 'utf8').replace(/\r\n/g, '\n')).toBe(hierarchyMarkdown());
  });
});
