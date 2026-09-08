# docs/media

Images the documentation links to. Nothing here is read by the build — Vite's static
root is `public/`, and anything in that directory is copied verbatim into `dist/` and
served publicly. These files are for people reading the repository, not for the app.

## What is here

| File | What it shows |
|---|---|
| `screenshot.png` | The home page at `/`, 2400×1500. The README's lead image. |
| `workspace.png` | The workspace at `/workspace` with no key supplied, 3200×2000. The real shell — five-panel rail, review pane, canvas, status bar — and the banner stating that Forma ships no key of its own. |

Both were captured from `localhost:3000` over CDP against a headless Edge, at a device
scale factor of 1.5 and 2 respectively. A placeholder SVG stood here until they were
taken; it was deleted in the same commit, per step 7 below.

**`workspace.png` was recaptured on 2026-09-05**, because the rail had grown two buttons
it did not show: Revisions and Batch. **`screenshot.png` was recaptured on 2026-09-08**,
for the same class of reason one step subtler: the home page's stat row read *"5 versions
— DevExpress 24.1 back to 20.1"* against an app that had offered eight, up to 26.1, since
25.1/25.2/26.1 were added. The picture was not broken. It was a correct picture of an
older product.

That is the failure mode worth naming here. **A screenshot goes stale by *omission*, not
by breaking** — nothing in the build, the tests or the encoding sweep can tell, and the
lead image on the README is the first claim a visitor reads. **When a rail button, a
pane, a status field or a number on the home page changes, this file is a second place
to change.** The version list in particular is already a change to seven files; this
makes eight.

*Found by looking at the image during the pre-push leak audit, not by any check.* Both
files were opened and read frame by frame for anything personal — an account email, a
key, a saved report title — and both are clean. The stat was noticed on the way past.

**Neither shows generated output, and that is deliberate.** Generating a report needs a
Gemini key, which is the user's and does not belong in a capture. `VITE_FORMA_MOCK=true`
produces a report without one, but the canned fixture prints `INVOICE - FORMA MOCK
ENGINE` across the sheet — an honesty marker that works exactly as intended and makes
the image useless as a README lead. If you want a screenshot of real output, capture it
yourself with your own key and follow the checklist below.

## Recapturing

The README's Demo section points here. Swap an image in one commit:

1. `npm run dev`, then open <http://localhost:3000>.
2. Supply a Gemini key, generate a report from a sample document, and wait for the
   mockup to finish drawing. **Capture a real generation, not an empty workspace** —
   the point of the image is to show the three artifacts side by side.
3. Capture the viewport at roughly 1280×720 or 1600×900. Keep the browser chrome out
   of it unless the URL bar is adding something.
4. **Check the frame for anything of yours before saving it.** An API key is masked in
   the Settings dialog, but a signed-in capture shows your account email in the avatar
   menu, and saved report titles are yours too. Sign out, or use a throwaway account.
5. Overwrite the file in place, keeping the name — the README links to these paths, and
   a second file beside the first is how a repository ends up with two images and no way
   to tell which is current. Update the table above with the new dimensions.
6. Re-check the size. Anything approaching 500 KB wants a lower device scale factor
   rather than a JPEG; the two images here were taken at 1.5 and 2.

**On automating it.** These were captured headlessly over the Chrome DevTools Protocol,
which is the only reliable route on a machine where the browser extension cannot reach
`localhost`. A page can be driven to a chosen state — planting a session key, attaching a
file, clicking through — with nothing but Node's global `fetch` and `WebSocket` against
`msedge.exe --headless=new --remote-debugging-port=9222`, no Puppeteer and no dependency
added to this project. Launch it with `--user-data-dir` pointing somewhere temporary: on
a shared machine, the default profile is somebody's real browser.

## Rules for this directory

- **PNG for captures, SVG for drawings.** No JPEG for UI — it smears text.
- **Keep files small.** Anything approaching 500 KB should be resized first; the
  pre-commit hook rejects anything over 1 MB outright.
- **No animated GIFs of long flows.** Generation takes a minute or more, so a GIF of it
  is either enormous or too fast to read. A still of the finished state is more useful.
- **This directory is the documented exception to `CONTRIBUTING.md`'s "never commit
  screenshots" rule**, and the exception is narrow: an image linked from committed
  documentation belongs here, and a debugging capture, a scratch recording or a
  screenshot pasted into a PR thread still does not belong in the repository at all.
