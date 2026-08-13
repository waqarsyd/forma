# Forma

Turn a screenshot, a PDF, or an existing report into a real DevExpress `.repx` file.

Upload a design — a mockup, a scanned invoice, a photo of a printout, or a `.repx` you already have — and Forma returns three things in one pass:

- a **markdown specification** of the layout,
- an **in-browser mockup** drawn from a structured layout description, so you can see what it understood before you download anything,
- **`repxContent`** — valid `XtraReportsLayoutSerializer` XML that saves as a `.repx` and opens directly in the DevExpress Report Designer.

Built with React 19, Vite 6, Tailwind v4 and TypeScript, with Firebase for optional sign-in and cloud storage.

---

## Bring your own key

**Forma ships no Gemini API key, and it never will.** Every user supplies their own, and the browser calls Google directly with it — the server is never in the loop and never sees a credential.

This is not an accident of design. An earlier build inlined a build-time key into the shipped JavaScript; Google's secret scanner found it and revoked it. The architecture that replaced it is deliberate:

| Where the key lives | Lifetime |
|---|---|
| `sessionStorage` | Erased by the browser when the tab closes |
| Firestore (opt-in, signed in) | **AES-GCM ciphertext only** |

The optional cloud copy is zero-knowledge: your key is encrypted in your browser with a passphrase derived through PBKDF2-SHA256 (310,000 iterations, per-record salt and IV). The passphrase never leaves your machine, so nobody operating a Forma deployment can read your key.

That also means **a forgotten passphrase is unrecoverable by design.** There is no reset, because a reset would imply the operator could decrypt it.

---

## Quick start

Requires **Node 20, 22, or 24+** (developed on Node 24.18.1 / npm 11.16.0). "20+" is the wrong shorthand: Vitest supports `^20 || ^22 || >=24`, so the odd-numbered lines **21 and 23 are outside the supported range** even though they are newer than 20.

```bash
npm install
npm run dev
```

Open <http://localhost:3000>, click **Configure**, and paste a Gemini API key from [Google AI Studio](https://aistudio.google.com/app/apikey).

That's enough to generate reports. Sign-in and cloud sync are optional — signed out, Forma saves your projects to `localStorage` and works fully.

> **Never run `vite dev` directly.** The dev server is `server.ts`, an Express app that runs Vite in middleware mode. `npm run dev` is the entry point.

---

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Express + Vite middleware on port 3000 |
| `npm run dev:log` | Same, mirrored to `dev-server.log` |
| `npm run build` | Client bundle + server bundle into `dist/` |
| `npm run build:server` | Server bundle only (`dist/server.cjs`, via esbuild) |
| `npm start` | Serve the production build (run `build` first, from the repo root) |
| `npm run preview` | Vite preview against `dist/` |
| `npm run lint` | `tsc --noEmit` |
| `npm test` | Unit tests (Vitest + jsdom) |
| `npm run test:watch` | The same suite in watch mode |
| `npm run test:rules` | Firestore security-rule tests — **needs Java** |
| `npm run clean` | Remove `dist/` |

---

## Using your own Firebase project

Sign-in and cloud storage need a Firebase project. Skip this entirely if you only want local use.

1. Create a project at [console.firebase.google.com](https://console.firebase.google.com/) and register a **Web app**.
2. **Authentication → Get started → Sign-in method → Google → Enable.** The tabs stay hidden until you click *Get started*, which is the usual stumbling block.
3. **Authentication → Settings → Authorized domains** — confirm `localhost` is listed, and add your deployment domain.
4. **Firestore Database → Create database** (production mode).
5. Put your web config into `firebase-applet-config.json`, and make sure `firestoreDatabaseId` there matches `databaseId` in `firebase.json` — **a mismatch silently talks to the wrong database.**
6. Set the deploy target in `.firebaserc`, then `npx firebase deploy --only firestore:rules`.

`.firebaserc` is what decides the deploy target. `firebase use <id>` only sets the CLI's own per-directory state, so a stale `.firebaserc` will happily deploy to the wrong project from a fresh shell or from CI.

**The `AIzaSy…` string committed in `firebase-applet-config.json` is correct and should stay.** A Firebase web API key is a public project identifier, not a secret — it ships in every Firebase web app by design, and `firestore.rules` plus the authorized-domain list are what actually protect your data. It is not the same class of value as a Gemini key.

---

## Project structure

```
src/
  App.tsx              workspace, chat, config modal
  main.tsx             entry point
  index.css            tokens, marketing pages, shared chrome (Tailwind v4, no config file)
  workspace.css        the workspace shell only — every `wb-` class lives here
  components/          LandingPage, FeaturesPage, DocsPage, ContactPage,
                       LoginPage, SiteHeader, SiteFooter, MobileNav,
                       Logo, UserAvatar
    landing/           figures used by the marketing pages: HeroScanner,
                       SheetRuler, StepFigures, VaultFigure, sections, icons
  lib/                 router, motion tokens, repx + sourceRect helpers (+ tests)
  services/            geminiService, firebase, keyVault (+ tests)
tests/                 Firestore rules tests (emulator)
public/                static assets served at / — logos (one doubles as the
                       favicon) and the pre-rendered og-card.png
assets/source/         full-resolution logo masters and the og-card source
                       page they are rendered from (not deployed)
docs/                  PRD.md, design/DESIGN.md, notes/ (architecture + incident history)
scripts/               dev + build helpers
server.ts              Express server, used in development and production
firestore.rules        the actual security boundary
```

---

## Testing

```bash
npm test          # pure helpers: REPX validation, crop geometry, stream parsing
npm run test:rules # security rules, against the Firestore emulator
```

The unit suite deliberately targets functions whose invariants **fail plausibly rather than loudly** — a transposed crop box puts a logo somewhere believable but wrong; a mis-scanned stream shows a stray character in a chat bubble. Those are the failures that survive manual testing.

The rules suite covers account isolation, document shape, and the encrypted key vault. It needs a JVM because the Firestore emulator is a Java process; a **runtime is enough — no JDK required.** This project was developed against a Temurin **JRE 21**, installed per-user with `JAVA_HOME` and `PATH` set at user scope, so nothing had to go in system-wide and no admin rights were needed.

Neither suite covers React components or `App.tsx`'s stateful logic. **This is a floor, not a net.**

---

## Contributing

Two documents carry the reasoning that the code cannot:

- **[`CLAUDE.md`](CLAUDE.md)** — the entry point: hard constraints, commands, and an index that routes you to the note covering whatever you are about to change.
- **[`docs/notes/`](docs/notes/)** — four notes carrying the architecture and its incident history: [`gemini.md`](docs/notes/gemini.md), [`app-shell.md`](docs/notes/app-shell.md), [`persistence.md`](docs/notes/persistence.md), [`styling.md`](docs/notes/styling.md). Most of it explains *why* something is the way it is, usually because the obvious alternative broke. Read the one covering what you're touching before you change it.
- **[`docs/PRD.md`](docs/PRD.md)** — the product specification, kept current against the code.

A few rules worth knowing up front:

- **No Gemini key in any committed file**, `.env` included. `vite.config.ts` allowlists `VITE_*` only, so a key placed there reaches neither the server nor the browser — it just sits in your working tree waiting to be committed.
- **A failed sign-in is a failure.** There is deliberately no fallback that fabricates a session when Firebase is misconfigured; one existed, and it was an authentication bypass on any unrecognised deployment domain.
- **`public/` is Vite's static root** — everything in it is copied verbatim into `dist/` and served publicly. Design notes and internal documents belong in `docs/`.

---

## Status and limitations

Forma is usable but young, and some things are worth knowing before you rely on it:

- **Generation is slow**, typically a minute or more. Most of that is the model reasoning before it emits any output — measured at 4,770 thinking tokens against 3,184 output tokens on a representative run. `ReportConfig.thinkingBudget` exists as a lever but is unset by default.
- **Gauges and barcodes in the mockup are decorative placeholders**; charts follow the supplied values but are stylised rather than a real charting library. The exported `.repx` still carries the correct DevExpress control types.
- **Models are detected at runtime, never hardcoded.** Google retires models "for new users", so a pinned id works for existing projects and 404s for every new key. Forma probes a preference list on first use and caches the winner for the session.
- **Reports with large images may not sync to the cloud.** A single detailed 2048px upload can exceed Firestore's 1 MiB document limit on its own; Forma saves the spec and REPX without the images in that case, and says so.

---

## License

**No license has been declared yet.** Until one is added, default copyright applies and others have no right to use, modify, or distribute this code. If the intent is to open-source it, add a `LICENSE` file and set the `license` field in `package.json`.
