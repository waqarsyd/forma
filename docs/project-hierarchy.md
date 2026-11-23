# Project hierarchy

<!-- Written by `npm run check:hierarchy -- --write` from scripts/check-hierarchy.mjs. Edit the script, then write this file again; a test fails while the two differ. -->

Every place in Forma that has to agree with a change, and the rules each commit is checked against. A feature is never one file: an MCP connection added in `src/lib` is also a line on the Features page, an article on the Docs page, a release note, the product spec, the note that owns the area, and, once it reaches a new party or a new origin, the privacy policy and the CSP. Taking a feature away reaches the same places.

The pre-commit hook runs the check on every commit (`.githooks/pre-commit.mjs`), so a change cannot land with the code done and the pages still describing the product as it was. The reasoning is the doc comment of [`scripts/check-hierarchy.mjs`](../scripts/check-hierarchy.mjs).

Two strengths of rule. One that blocks is always true here, so the commit waits until the named file is in it. One that asks for a review is a checklist that needs judgement: the commit waits until every line not already in the commit has been looked at, and the review is recorded. A line already in the commit is ticked.

## Every place a change may have to reach

### The code and its tests

| Surface | What it holds |
|---|---|
| [`docs/notes/testing.md`](notes/testing.md) | every test file, its case count, and the total |
| [`src/components/publicClaims.test.ts`](../src/components/publicClaims.test.ts) | what the public pages claim, held to the code; add a claim when a page states a fact the code can answer |
| [`tests/`](../tests/) | the Firestore rules suite, run against the emulator |
| [`src/lib/designerRelease.ts`](../src/lib/designerRelease.ts) | the Forma Designer release the site offers, and what it needs |

### The spec, the notes and the map of the code

| Surface | What it holds |
|---|---|
| [`docs/PRD.md`](PRD.md) | the product spec: what Forma does, and what is out of scope |
| [`docs/notes/`](notes/) | the note that owns the area; the routing table in CLAUDE.md says which |
| [`docs/notes/app-shell.md`](notes/app-shell.md) | the workspace, routing and the public pages |
| [`docs/notes/persistence.md`](notes/persistence.md) | Firestore, the device, the rules, sign-in and deletion |
| [`docs/project-structure.md`](project-structure.md) | the file layout; names every file under src/lib, src/services, src/components and src/server |
| [`CLAUDE.md`](../CLAUDE.md) | the code map, the routing table, the commands, and the facts stated in more than one file |
| [`tools/RepxDesigner/README.md`](../tools/RepxDesigner/README.md) | Forma Designer: its routes, its guards, its download and install |
| [`tools/RepxProbe/README.md`](../tools/RepxProbe/README.md) | RepxProbe: what it asks DevExpress, and how |

### The public site and the release notes

| Surface | What it holds |
|---|---|
| [`src/components/LandingPage.tsx`](../src/components/LandingPage.tsx) | the home page (/) |
| [`src/components/FeaturesPage.tsx`](../src/components/FeaturesPage.tsx) | the Features page (/features) |
| [`src/components/DocsPage.tsx`](../src/components/DocsPage.tsx) | the Docs page (/docs); the chat answers questions about Forma from it |
| [`src/components/faqs.tsx`](../src/components/faqs.tsx) | the questions on /faq and the Docs page |
| [`src/components/infoPages.tsx`](../src/components/infoPages.tsx) | security, pricing, examples, compare, about, self-host and download |
| [`src/components/LegalPage.tsx`](../src/components/LegalPage.tsx) | terms, privacy and accessibility; the privacy policy names every third party the code reaches |
| [`src/lib/releases.ts`](../src/lib/releases.ts) | the release notes: /changelog, its feed, What is new in the app, and each GitHub release |
| [`src/lib/routes.ts`](../src/lib/routes.ts) | each route's document title |
| [`src/lib/seo.ts`](../src/lib/seo.ts) | the routes search engines index, and their descriptions |
| [`src/prerender.tsx`](../src/prerender.tsx) | the pages the build draws into HTML |
| [`src/components/publicPages.tsx`](../src/components/publicPages.tsx) | which component draws each public route |
| [`src/components/SiteHeader.tsx`](../src/components/SiteHeader.tsx) | the site header's links |
| [`src/components/SiteFooter.tsx`](../src/components/SiteFooter.tsx) | the site footer's links |
| [`src/components/MobileNav.tsx`](../src/components/MobileNav.tsx) | the phone menu's links |

### The repository front door

| Surface | What it holds |
|---|---|
| [`README.md`](../README.md) | the front door: setup, the script table, the honest limitations |
| [`CONTRIBUTING.md`](../CONTRIBUTING.md) | what a contributor runs, what the hook blocks, what a pull request needs |

### Configuration that must agree with the code

| Surface | What it holds |
|---|---|
| [`src/server/securityHeaders.ts`](../src/server/securityHeaders.ts) | the CSP; connect-src is every origin the browser may reach |
| [`firebase.json`](../firebase.json) | the live site's headers and rewrites; hostingConfig.test.ts prints what it must say |
| [`firestore.rules`](../firestore.rules) | what an account may read and write in Firestore |
| [`.github/workflows/checks.yml`](../.github/workflows/checks.yml) | CI: the Node versions and every check |
| [`package-lock.json`](../package-lock.json) | the installed versions; npm ci fails when it disagrees with package.json |
| [`scripts/check-encoding.mjs`](../scripts/check-encoding.mjs) | ROOT_FILES, the root files the mojibake sweep reads |

## What each change is checked against

| When | It must reach | Strength | Why |
|---|---|---|---|
| A file is added, removed or renamed under src/lib, src/services, src/components or src/server | `docs/project-structure.md` | Blocks | docs/project-structure.md names every file there, so it changes in the same commit. |
| A test file is added, removed or renamed | `docs/notes/testing.md` | Blocks | testing.md lists every test file with its count, and the total moves with it. Recount by running the suite, never by grepping. |
| The Node floor changes (engines in package.json) | `README.md`, `CONTRIBUTING.md`, `.github/workflows/checks.yml`, `src/components/infoPages.tsx`, `CLAUDE.md` | Blocks | The floor is restated in five other files, and nothing else keeps them in step. |
| The release version changes (version in package.json) | `src/lib/releases.ts`, `package-lock.json` | Blocks | Every deploy of main is a numbered release: its notes are the newest entry of releases.ts, and the lockfile carries the version too. |
| A dependency or an override changes | `package-lock.json` | Blocks | npm ci, the first thing CI runs, fails when package.json and the lockfile disagree. |
| An npm script is added or removed | `CLAUDE.md`, `README.md` | Blocks | The Commands in CLAUDE.md and the script table in README.md list every script. |
| A file is added at the root of the repository | `scripts/check-encoding.mjs` | Blocks | The mojibake sweep reads a root file only once ROOT_FILES names it. |
| A new top-level directory appears | `docs/project-structure.md`, `README.md` | Blocks | A new top-level directory needs a stated reason, in the file layout and in the overview of the top level in README.md. |
| Code a person uses is added, changed or removed | `src/lib/releases.ts`, `src/components/FeaturesPage.tsx`, `src/components/DocsPage.tsx`, `src/components/faqs.tsx`, `src/components/LandingPage.tsx`, `src/components/infoPages.tsx`, `src/components/LegalPage.tsx`, `docs/PRD.md`, `docs/notes/`, `README.md`, `CLAUDE.md`, `src/components/publicClaims.test.ts`, `src/server/securityHeaders.ts`, `firestore.rules` | Review | A feature is never one file. Each line below describes the product, and must describe it as it is after this commit, including what was taken away. |
| A file is removed or renamed, and the docs still name it | every doc that still names it | Review | A pointer to something gone is worse than none. Update each mention, or keep it where the history is the point and date the removal. |
| A test file changes | `docs/notes/testing.md` | Review | A case added or removed changes its row in testing.md and the total. Recount by running the suite, never by grepping. |
| A file is added, removed or renamed under scripts | `docs/project-structure.md`, `CLAUDE.md` | Review | The file layout names the scripts a person runs, and CLAUDE.md the ones a session needs. |
| What an npm script runs changes | `CLAUDE.md`, `README.md` | Review | CLAUDE.md and README.md say what each script does. |
| Forma Designer or RepxProbe changes | `tools/RepxDesigner/README.md`, `tools/RepxProbe/README.md`, `src/lib/designerRelease.ts`, `src/components/infoPages.tsx`, `src/lib/releases.ts` | Review | Their READMEs are their notes, and the site offers the designer's release and states what it needs. |
| The security headers change | `firebase.json`, `src/components/LegalPage.tsx`, `src/components/infoPages.tsx` | Review | firebase.json carries the same policy to the live site, and a new origin in connect-src is a new party the privacy policy must name. |
| The Firestore rules change | `tests/`, `docs/notes/persistence.md`, `src/components/LegalPage.tsx` | Review | The rules suite holds every rule, persistence.md owns why, and the privacy policy says what is kept. |
| The list of routes changes (src/lib/router.ts) | `src/lib/routes.ts`, `src/lib/seo.ts`, `src/prerender.tsx`, `src/components/publicPages.tsx`, `src/components/SiteHeader.tsx`, `src/components/SiteFooter.tsx`, `src/components/MobileNav.tsx`, `docs/notes/app-shell.md` | Review | A page has a title, a description, prerendered HTML, a component that draws it, and links in the header, the footer and the phone menu. |
| A CI workflow changes | `CLAUDE.md`, `README.md`, `CONTRIBUTING.md` | Review | The check list is stated in CLAUDE.md, README.md, CONTRIBUTING.md and checks.yml, and nothing keeps them in step. |
| The pre-commit hook changes | `CONTRIBUTING.md`, `CLAUDE.md` | Review | CONTRIBUTING.md tells a contributor what it blocks, and CLAUDE.md tells a session. |

## Running it

```
npm run check:hierarchy                 # what the current changes reach: what is staged, else everything uncommitted
npm run check:hierarchy -- --reviewed   # after going through the list: record the review of what is staged
npm run check:hierarchy -- --list       # print this hierarchy
npm run check:hierarchy -- --write      # write this file again after editing the script
```

Stage everything the commit will hold before recording a review: the record is a hash of exactly what is staged, kept inside `.git` and never committed, so staging anything more asks again. `git commit --no-verify` skips the check, with the rest of the hook, for one commit.
