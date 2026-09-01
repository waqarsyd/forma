# docs/media

Images the documentation links to. Nothing here is read by the build — Vite's static
root is `public/`, and anything in that directory is copied verbatim into `dist/` and
served publicly. These files are for people reading the repository, not for the app.

## What is here

| File | Status |
|---|---|
| `screenshot.placeholder.svg` | A drawing, not a capture. It exists so the README's Demo section has something to render, and it says so on its face. |

## Replacing the placeholder

The README's Demo section points here. Swap it in one commit:

1. `npm run dev`, then open <http://localhost:3000>.
2. Supply a Gemini key, generate a report from a sample document, and wait for the
   mockup to finish drawing. **Capture a real generation, not an empty workspace** —
   the point of the image is to show the three artifacts side by side.
3. Capture the viewport at roughly 1280×720 or 1600×900. Keep the browser chrome out
   of it unless the URL bar is adding something.
4. **Check the frame for anything of yours before saving it.** An API key is masked in
   the Settings dialog, but a signed-in capture shows your account email in the avatar
   menu, and saved report titles are yours too. Sign out, or use a throwaway account.
5. Save as `docs/media/screenshot.png`.
6. In the README, replace the placeholder `<img>` and its surrounding TODO comment with
   `![Forma workspace](docs/media/screenshot.png)`.
7. Delete `screenshot.placeholder.svg` in the same commit — a placeholder that outlives
   its replacement is how a repository ends up with two images and no way to tell which
   one is current.

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
