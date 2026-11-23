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

  it('a version waits for its release entry and the lockfile, and a dependency for the lockfile', () => {
    expect(open(check([edit('package.json')], { before: { version: '1.6.5' }, after: { version: '1.6.6' } }), 'version'))
      .toEqual(['src/lib/releases.ts', 'package-lock.json']);
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
