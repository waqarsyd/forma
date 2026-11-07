/**
 * Forma's release notes (2026-11-07): what changed, when, newest first. The
 * public page `/changelog` draws them (ChangelogPage.tsx), the Atom feed
 * `/changelog.xml` is written from them at build (vite.config.ts), and the
 * in-app "What's new" and the landing page's dock show the entries marked
 * `announce` (announcements.ts). One list for all four, so they cannot
 * disagree.
 *
 * Hand-written, as every changelog the research for this page looked at is
 * (Linear, Vercel, GitHub, Notion, Figma, Raycast): this repository's commit
 * messages are long internal reasoning, and Keep a Changelog warns against
 * publishing a commit log. Add a release at the top when work ships.
 *
 * **Only write what is true**, the rule announcements.ts has always carried:
 * this is where the product describes itself to people who have not used it.
 * A change is described as it is in the code on `main`; the live site shows
 * it once the owner deploys. Something not done yet is not a release.
 *
 * Pure data and pure functions, no DOM, so the page, the tests and the build's
 * feed writer all import it. **An id is never changed or reused**: it is the
 * entry's anchor, the feed's entry id, and what "already seen" is remembered by.
 */

export type ChangeKind = 'new' | 'improved' | 'changed' | 'fixed' | 'removed' | 'security';
export type ChangeArea = 'generation' | 'chat' | 'preview' | 'export' | 'ocr' | 'data' | 'sharing' | 'workspace' | 'site';

export interface Change {
  kind: ChangeKind;
  area: ChangeArea;
  text: string;
}

export interface Release {
  /** Stable slug, never reused: the anchor, the feed entry's id, the "seen" key. */
  id: string;
  /** ISO date, YYYY-MM-DD. */
  date: string;
  /** Only when a GitHub release carries it, e.g. '1.0.0'. */
  version?: string;
  title: string;
  /** One or two plain sentences: the feed's summary and the in-app note. */
  summary: string;
  changes: Change[];
  /** Shown in the in-app What's new and the landing page's dock too. */
  announce?: boolean;
}

/** The order a release's changes are grouped in, and their labels. */
export const KINDS: readonly ChangeKind[] = ['new', 'improved', 'changed', 'fixed', 'removed', 'security'];
export const KIND_LABELS: Record<ChangeKind, string> = {
  new: 'New',
  improved: 'Improved',
  changed: 'Changed',
  fixed: 'Fixed',
  removed: 'Removed',
  security: 'Security',
};
export const AREAS: readonly ChangeArea[] = ['generation', 'chat', 'preview', 'export', 'ocr', 'data', 'sharing', 'workspace', 'site'];
export const AREA_LABELS: Record<ChangeArea, string> = {
  generation: 'Report design',
  chat: 'Chat',
  preview: 'Preview',
  export: 'Export',
  ocr: 'OCR',
  data: 'Data',
  sharing: 'Sharing',
  workspace: 'Workspace',
  site: 'Site',
};

/** Where the site lives, for the feed's absolute links. */
export const SITE_URL = 'https://openforma.web.app';
/** The repository, for a version's release notes. */
export const REPO_URL = 'https://github.com/waqarsyd/forma';

export const RELEASES: Release[] = [
  {
    id: '2026-11-07-chat-keeps-its-word',
    date: '2026-11-07',
    title: 'A chat that keeps its word',
    summary:
      'What the chat changes now shows everywhere at once, Try again starts from where your message did, and a reply’s Undo and Redo survive a reload. The chat follows what you asked it to remember, and a new report gets a project of its own.',
    changes: [
      { kind: 'improved', area: 'workspace', text: 'On a phone the message box stays at the foot of the screen and the reply card is a sheet over the report, so the report keeps its room.' },
      { kind: 'improved', area: 'workspace', text: 'A screen reader now hears when Forma starts, and what came of a request when it ends: a reply, a report ready, a question or a failure.' },
      { kind: 'improved', area: 'workspace', text: 'The keyboard stays where you are: after Stop, queueing, an edit or a withdrawal it is back in the box, and Forma’s questions move it from one to the next.' },
      { kind: 'fixed', area: 'workspace', text: 'Speaking a message stops when you send or start typing, so nothing heard afterwards refills the box, and the mic says your browser sends the sound to its own speech service.' },
      { kind: 'improved', area: 'workspace', text: 'A tab in the background says when a question is waiting for you or a request failed, not only when something is ready.' },
      { kind: 'improved', area: 'workspace', text: 'With Local AI or OpenRouter the box shows which model answers, and opens Settings to change it.' },
      { kind: 'improved', area: 'workspace', text: 'Each project keeps its own unsent message, as a chat app keeps a draft per chat, and messages waiting in the queue survive a reload.' },
      { kind: 'fixed', area: 'workspace', text: 'Words queued while a file is attached now take the file with them, and the queue says how many go.' },
      { kind: 'improved', area: 'workspace', text: 'When it was sent, the versions, Edit and Withdraw sit under your message, no longer hidden behind its arrow.' },
      { kind: 'fixed', area: 'workspace', text: 'Searching the requests marks what it found in the card rather than hiding replies, and the search, the card and the log stay in step.' },
      { kind: 'fixed', area: 'workspace', text: 'Folding the card keeps answers and edits you were typing, and the card makes room for the open request log.' },
      { kind: 'new', area: 'workspace', text: 'A code block in a reply or the Spec has its own Copy, and dragging files over the workspace shows “Drop to attach”.' },
      { kind: 'fixed', area: 'workspace', text: 'A failed request says so once, an old error clears when you send the next one, a file being read says so, and “Edit text” or a starting point no longer replaces what you had typed.' },
      { kind: 'improved', area: 'workspace', text: 'The conversation’s Markdown export now includes Forma’s questions and what became of a redesign it asked about.' },
      { kind: 'changed', area: 'chat', text: 'Only a message that starts “Remember” or “From now on” is kept as a memory. “Always…” or “Never mind…” now goes to the chat, which acts on it.' },
      { kind: 'improved', area: 'chat', text: 'The chat, its questions and the labels it adds follow what you asked Forma to remember, not only a new report.' },
      { kind: 'fixed', area: 'chat', text: 'A memory such as “Tahoma instead of Arial” or “never use Letter” is read the way you meant it.' },
      { kind: 'new', area: 'chat', text: 'Asking for a different report while one is open starts a new project for it, and keeps the one you had.' },
      { kind: 'improved', area: 'chat', text: 'A redesign is given everything you asked for in the conversation, and the controls you selected, not only your last message.' },
      { kind: 'improved', area: 'chat', text: 'A question asked while Forma’s questions are waiting is answered, and they stay open; “Create a report” with nothing about what it shows is asked about first.' },
      { kind: 'fixed', area: 'workspace', text: 'A project started with “hello” takes its report’s title once it has one.' },
      { kind: 'improved', area: 'chat', text: 'The chat sees each control’s colours, borders, number format, totals and expressions, and says when something is not in what it can see.' },
      { kind: 'fixed', area: 'chat', text: 'In a right-to-left report the chat aligns and edits the cell you mean, and two controls with the same name can each be changed.' },
      { kind: 'fixed', area: 'chat', text: 'An answer cut off part way changes nothing and says so, and turning a custom-size page to landscape keeps its size.' },
      { kind: 'improved', area: 'site', text: 'Every page loads faster: the first script a visitor downloads is 112 kB smaller.' },
      { kind: 'new', area: 'chat', text: 'The chat can now duplicate a control, change a band’s height, add borders, lines and page numbers, set a number format, bind a control to a field, and style a whole table row or column, each in seconds rather than a redesign.' },
      { kind: 'new', area: 'chat', text: 'Ask the chat to “undo that”, and it takes back the last change.' },
      { kind: 'improved', area: 'chat', text: 'When an edit cannot be made, or brings a problem the checks find, the chat takes one more pass at it before offering a redesign.' },
      { kind: 'fixed', area: 'chat', text: 'Bold or a colour on a whole table now reaches every cell, a colour change is described as one, and text written over two lines prints over two.' },
      { kind: 'new', area: 'workspace', text: 'Forma says when you are offline, and what you write waits for the connection rather than failing.' },
      { kind: 'improved', area: 'chat', text: 'A chat reply shows what it cost beside its time, and a report’s count includes every answer it took.' },
      { kind: 'fixed', area: 'generation', text: 'A local AI or OpenRouter that fails says so in its own words, not Google’s, and a local model’s context that is too small, or a reasoning model that wrote no answer, is named.' },
      { kind: 'fixed', area: 'generation', text: 'When a model is busy, Forma no longer falls back to one it was just refused by, and the chat keeps to the lighter models before the one your reports use.' },
      { kind: 'security', area: 'chat', text: 'The chat no longer exports or opens the designer on its own: it offers a button, so words written inside a report or a picture cannot make it act.' },
      { kind: 'improved', area: 'chat', text: 'A picture sent while a report is open is read with your message: the chat can answer about it or change the report to match, rather than always redesigning it.' },
      { kind: 'fixed', area: 'generation', text: 'If the AI fails while changing an open report, the report stays as it was instead of being replaced by a rough draft.' },
      { kind: 'changed', area: 'chat', text: 'Stop pauses the messages waiting in the queue, with Resume to send them on; a question from Forma or a failed request pauses them too.' },
      { kind: 'improved', area: 'chat', text: 'Steer changes the request under way rather than replacing it, Escape in the box stops Forma, and Ctrl+K can stop it or open the request log.' },
      { kind: 'fixed', area: 'chat', text: 'Forma’s questions can be answered after a reload, a message queued during a picture’s reading waits its turn, and a stopped reply no longer claims a change it did not make.' },
      { kind: 'fixed', area: 'chat', text: 'A change made in the chat, from the selection toolbar or by dragging on the Preview now shows on the Mockup and in the Spec as well.' },
      { kind: 'fixed', area: 'chat', text: 'Try again and editing a message start from the report as that message found it: an edit is not made twice, and a first report is designed again rather than refined.' },
      { kind: 'improved', area: 'chat', text: 'A reply’s Undo is the same step as the Undo in the corner, with a Redo beside it, and both are still there after a reload.' },
      { kind: 'fixed', area: 'chat', text: 'A message is saved as soon as you send it; if the page closes before Forma answers, it says so and offers Try again.' },
      { kind: 'fixed', area: 'chat', text: 'A report that could not be made marks its request as failed, with Try again, rather than looking answered.' },
      { kind: 'fixed', area: 'chat', text: 'A change you make on the Preview while Forma is answering is kept when the answer lands.' },
    ],
  },
  {
    id: '2026-11-07-settings-account-ocr',
    date: '2026-11-07',
    title: 'Settings, your account and the OCR review, redesigned',
    summary:
      'Settings is a list of sections, General, AI, Gemini key and Memory, and a change takes effect as you make it. Your account and the OCR review follow the same design, and this page lists every release.',
    announce: true,
    changes: [
      { kind: 'improved', area: 'workspace', text: 'Settings has its sections on the left, as ChatGPT’s does, and no Save or Cancel: each change applies at once.' },
      { kind: 'improved', area: 'workspace', text: 'Forgetting your kept reports, everything in Memory, or the encrypted key stored in your account asks first.' },
      { kind: 'improved', area: 'workspace', text: 'Your account has the same sections: Profile, Password, Email address and Delete account.' },
      { kind: 'improved', area: 'ocr', text: 'The OCR review has the same look: pages as a segmented control, unsure words as quiet rows, and a switch to leave them out of the report.' },
      { kind: 'new', area: 'site', text: 'This page, with an Atom feed at /changelog.xml.' },
      { kind: 'fixed', area: 'site', text: 'A link to a section of another page, such as the Docs’ FAQ, now reaches that section, and a link to a new page opens at its top.' },
    ],
  },
  {
    id: '2026-11-06-share-and-workspace',
    date: '2026-11-06',
    title: 'Share a report, and a workspace that behaves',
    summary:
      'Share a copy of a report with people you add by email, or with anyone who has the link. The workspace gained a home, a command menu and one Export panel, and an audit fixed 76 rough edges.',
    announce: true,
    changes: [
      { kind: 'new', area: 'sharing', text: 'Share: a copy of the report for people you add by email, opened with a verified address, or for anyone with the link. Update the copy or stop sharing at any time.' },
      { kind: 'new', area: 'workspace', text: 'The empty workspace is a home, with your recent projects and six starting points.' },
      { kind: 'new', area: 'workspace', text: 'Ctrl+K opens a command menu for every action, and ? lists the keyboard shortcuts. Right-click a control on the Preview for its menu, or type a zoom size.' },
      { kind: 'new', area: 'export', text: 'Export is one panel for every format: .repx, Open in designer, PDF, PDF with outline, Excel, CSV, Word, RTF, HTML and PNG.' },
      { kind: 'new', area: 'workspace', text: 'The project’s title opens its menu: Rename, Duplicate, Archive and Delete, with a pin beside it.' },
      { kind: 'new', area: 'workspace', text: 'The ? in the corner holds the theme, Light, System or Dark, and What’s new.' },
      { kind: 'improved', area: 'preview', text: 'Select a control on the Preview and a toolbar floats over the report to format, edit or delete it. A drag is one Undo step.' },
      { kind: 'fixed', area: 'workspace', text: 'A workspace audit fixed 76 things, among them a run still going when another project is opened, Escape closing one thing at a time, menus that work from the keyboard, and an export that fails now saying so.' },
      { kind: 'security', area: 'site', text: 'A dependency, sharp, lifted past three high-severity advisories.' },
    ],
  },
  {
    id: '2026-11-05-chat-edits-reports',
    date: '2026-11-05',
    title: 'A chat that edits your report',
    summary:
      'With a report open, the chat answers questions about it and changes it in place, listing what changed with an Undo. It asks before designing, queues what you send while it works, and floats over the report.',
    announce: true,
    changes: [
      { kind: 'new', area: 'chat', text: 'The chat sees the open report and edits it in place: text, position, size, font, colour, alignment, paper and margins, with a list of what changed and an Undo.' },
      { kind: 'new', area: 'chat', text: 'Before designing a report from words, Forma asks its questions one at a time, with a summary.' },
      { kind: 'new', area: 'chat', text: 'A message sent while Forma works waits in a queue, with Steer, Edit and Cancel.' },
      { kind: 'new', area: 'chat', text: 'Edit or withdraw a message and keep the versions it replaced; Try again, copy or rate a reply; search your requests; export the conversation as Markdown.' },
      { kind: 'new', area: 'chat', text: 'Speak a message into the box, and the message you are typing survives a reload.' },
      { kind: 'new', area: 'chat', text: 'Choose the model in the box, Auto, Fast or Balanced, with today’s requests to each; Settings shows Usage today.' },
      { kind: 'new', area: 'data', text: 'The chat box takes data files: CSV, JSON, Excel, Word, text and SQL.' },
      { kind: 'new', area: 'workspace', text: 'The conversation is saved with its project, and projects can be renamed, pinned and archived.' },
      { kind: 'changed', area: 'generation', text: 'The AI writes the .repx alone, and Forma reads the Mockup and the Spec off it, so each report costs about three quarters less output.' },
      { kind: 'changed', area: 'generation', text: 'From a picture, Forma drafts the report itself and the AI corrects the draft.' },
      { kind: 'removed', area: 'generation', text: 'Designing with no key (Forma Offline): a Gemini key opens the workspace, whichever AI you choose.' },
      { kind: 'fixed', area: 'generation', text: 'A free-tier key is no longer sent to billing when its daily quota runs out, and Gemini’s newer AQ. keys are recognised.' },
    ],
  },
  {
    id: '2026-11-04-clean-workspace',
    date: '2026-11-04',
    title: 'A workspace as clean as a chat app',
    summary:
      'No status bar or progress card, a sidebar that opens and closes as Gemini’s and ChatGPT’s do, settings Forma works out for itself, and OCR in more languages.',
    changes: [
      { kind: 'changed', area: 'workspace', text: 'Working dots and Stop replace the progress card and the status bar.' },
      { kind: 'new', area: 'workspace', text: 'The sidebar opens and closes as Gemini’s and ChatGPT’s do, with Ctrl+B.' },
      { kind: 'changed', area: 'generation', text: 'Forma works out the DevExpress version, the unit, the paper, right to left and the language of a picture from what you bring, instead of asking.' },
      { kind: 'new', area: 'ocr', text: 'OCR reads Arabic, Hindi, Urdu, French, German and Spanish, and English handwriting where the site serves the handwriting model.' },
      { kind: 'changed', area: 'ocr', text: 'An attached picture is read after you send it, behind the scenes.' },
      { kind: 'new', area: 'preview', text: 'Add and delete controls, retype a table cell, and select several at once on the Preview.' },
      { kind: 'new', area: 'generation', text: 'Batch takes a folder, by picker or by drop, and runs up to three files at once.' },
      { kind: 'improved', area: 'generation', text: 'A chart’s title, axis titles and legend are read from the source.' },
    ],
  },
  {
    id: '2026-11-02-choose-your-ai',
    date: '2026-11-02',
    title: 'Choose your AI, and Forma remembers',
    summary:
      'Use Google Gemini, a local AI on your own computer (Ollama or LM Studio), or OpenRouter’s free models. Tell Forma what to remember, and it learns the style of the reports you keep.',
    changes: [
      { kind: 'new', area: 'generation', text: 'Settings, AI: Automatic (Google Gemini), Local AI (Ollama or LM Studio) or OpenRouter’s free models.' },
      { kind: 'new', area: 'chat', text: 'Memory: start a message with “remember” and Forma keeps it, and it learns the style of the reports you export or save. See or change it in Settings, Memory.' },
      { kind: 'new', area: 'generation', text: 'Forma’s own model, learned from the structure of reports and never their content, helps the AI on every request.' },
      { kind: 'new', area: 'export', text: 'PDF/A when the report asks for it, with its fonts embedded.' },
    ],
  },
  {
    id: '2026-11-01-ocr-one-chat-box',
    date: '2026-11-01',
    title: 'OCR in your browser, and one chat box for everything',
    summary:
      'Forma reads the text of images and scans with OCR in your browser, and one chat box takes every input: pictures, PDFs, reports and words.',
    changes: [
      { kind: 'new', area: 'ocr', text: 'OCR with Tesseract.js runs in your browser, so nothing you upload leaves it to be read. Review the text read and build a report from it with no AI at all.' },
      { kind: 'changed', area: 'chat', text: 'The Describe dialog and the OCR button became one chat box that decides from what a message carries.' },
      { kind: 'new', area: 'export', text: 'Export Word, RTF, HTML and PNG, and a PDF with the report’s bookmarks as its outline, encrypted under the report’s own passwords.' },
      { kind: 'new', area: 'preview', text: 'Right-to-left reports print mirrored as DevExpress mirrors them, and the Preview draws a table of contents, drill-down groups and charts over test data.' },
      { kind: 'improved', area: 'preview', text: 'Line breaks, kerning, font metrics and bold are measured the way DevExpress prints them.' },
      { kind: 'improved', area: 'site', text: 'Firestore loads only once you sign in, which makes every page lighter.' },
    ],
  },
  {
    id: '2026-10-31-print-as-devexpress',
    date: '2026-10-31',
    title: 'A Preview that prints as DevExpress does',
    summary:
      'Measured against DevExpress 20.1’s own printed output: groups, totals, formats, filters, subreports, page numbers, page breaks and cross-tabs print in the Preview as they will in the designer.',
    changes: [
      { kind: 'new', area: 'preview', text: 'Groups nested by their level, totals with their running scope, number and date formats, and the report’s filter and parameters, all over test data.' },
      { kind: 'new', area: 'preview', text: 'Detail reports, embedded subreports, formatting rules, cross-band lines and page breaks.' },
      { kind: 'new', area: 'export', text: 'Export CSV byte for byte and Excel cell for cell, as DevExpress exports them.' },
      { kind: 'fixed', area: 'generation', text: 'Millimetre and pixel reports carry their Dpi on every band and control, so they print at size, and the paper is named, so an A4 report no longer prints on Letter.' },
      { kind: 'fixed', area: 'generation', text: 'A cross-tab gets the layout DevExpress needs before it will print one.' },
    ],
  },
  {
    id: '2026-10-28-describe-a-report',
    date: '2026-10-28',
    title: 'Describe a report in words',
    summary:
      'Prompt-to-Report designs a report from a written description, Prompt-to-Expression binds a column from a sentence, test data fills the Preview, and DevExpress’s own accessibility checks run on every report.',
    changes: [
      { kind: 'new', area: 'generation', text: 'Prompt-to-Report: a report designed from a written description, as DevExpress’s wizard does.' },
      { kind: 'new', area: 'data', text: 'Prompt-to-Expression: bind a column to an expression written from a sentence.' },
      { kind: 'new', area: 'preview', text: 'Preview a bound report over test data the AI writes for it.' },
      { kind: 'new', area: 'generation', text: 'The accessibility checks DevExpress’s designer runs: contrast, minimum font size and accessible descriptions.' },
      { kind: 'improved', area: 'generation', text: 'A model that starts repeating itself is cut off and the request retried, instead of running for minutes.' },
    ],
  },
  {
    id: '2026-10-28-version-1-0-0',
    date: '2026-10-28',
    version: '1.0.0',
    title: 'Forma 1.0.0',
    summary:
      'The first numbered release. Nothing in the app changed that day: the number caught up with what had been live since September.',
    announce: true,
    changes: [
      { kind: 'new', area: 'generation', text: 'Banded reports with data binding, grouping, parameters, charts and gauges.' },
      { kind: 'new', area: 'preview', text: 'A Preview drawn from the .repx file you actually download.' },
      { kind: 'new', area: 'workspace', text: 'Revisions and Batch on the sidebar.' },
    ],
  },
  {
    id: '2026-09-09-open-source-live',
    date: '2026-09-09',
    title: 'Forma is open source',
    summary:
      'The repository is public under Apache-2.0: the app itself, the prompt behind it, and the notes on why it works the way it does.',
    announce: true,
    changes: [{ kind: 'new', area: 'site', text: 'The source is public at github.com/waqarsyd/forma, under the Apache-2.0 licence.' }],
  },
];

/** A release's changes in the order of `KINDS`, each kind with its changes. */
export function changesByKind(release: Release): { kind: ChangeKind; changes: Change[] }[] {
  return KINDS.map((kind) => ({ kind, changes: release.changes.filter((c) => c.kind === kind) })).filter((g) => g.changes.length > 0);
}

export interface ReleaseFilter {
  kind: ChangeKind | null;
  area: ChangeArea | null;
}

/**
 * The releases with only the changes a filter keeps; a release left with none
 * is left out. No filter returns the list as it is.
 */
export function filterReleases(releases: readonly Release[], filter: ReleaseFilter): Release[] {
  if (!filter.kind && !filter.area) return [...releases];
  return releases
    .map((r) => ({ ...r, changes: r.changes.filter((c) => (!filter.kind || c.kind === filter.kind) && (!filter.area || c.area === filter.area)) }))
    .filter((r) => r.changes.length > 0);
}

/** A filter read off a query string, `?kind=fixed&area=preview`; anything unknown is no filter. */
export function filterFromSearch(search: string): ReleaseFilter {
  const params = new URLSearchParams(search);
  const kind = params.get('kind');
  const area = params.get('area');
  return {
    kind: (KINDS as readonly string[]).includes(kind ?? '') ? (kind as ChangeKind) : null,
    area: (AREAS as readonly string[]).includes(area ?? '') ? (area as ChangeArea) : null,
  };
}

/** The query string for a filter, `''` for none, so a filtered view can be linked. */
export function searchForFilter(filter: ReleaseFilter): string {
  const params = new URLSearchParams();
  if (filter.kind) params.set('kind', filter.kind);
  if (filter.area) params.set('area', filter.area);
  const s = params.toString();
  return s ? `?${s}` : '';
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Releases by month, newest first, each month with its anchor id and its name. */
export function releasesByMonth(releases: readonly Release[]): { id: string; label: string; releases: Release[] }[] {
  const months: { id: string; label: string; releases: Release[] }[] = [];
  for (const r of releases) {
    const id = r.date.slice(0, 7);
    let month = months.find((m) => m.id === id);
    if (!month) {
      month = { id, label: `${MONTHS[Number(id.slice(5, 7)) - 1]} ${id.slice(0, 4)}`, releases: [] };
      months.push(month);
    }
    month.releases.push(r);
  }
  return months;
}

/** A date as the page shows it: 7 November 2026. */
export function readableDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

const escapeXml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/**
 * The Atom 1.0 feed of the releases, written at build into `dist/changelog.xml`
 * (vite.config.ts) and served beside the page. Free, and needs no server: a feed
 * reader, or GitHub's "Watch, Releases", is how someone follows Forma, since an
 * email list would need a service.
 */
export function atomFeed(releases: readonly Release[], site = SITE_URL): string {
  const page = `${site}/changelog`;
  const updated = releases[0] ? `${releases[0].date}T00:00:00Z` : '1970-01-01T00:00:00Z';
  const entries = releases.map((r) => {
    const items = changesByKind(r)
      .map((g) => `<h4>${escapeXml(KIND_LABELS[g.kind])}</h4><ul>${g.changes.map((c) => `<li>${escapeXml(c.text)}</li>`).join('')}</ul>`)
      .join('');
    const content = `<p>${escapeXml(r.summary)}</p>${items}`;
    return [
      '  <entry>',
      `    <id>${escapeXml(`${page}#${r.id}`)}</id>`,
      `    <title>${escapeXml(r.version ? `${r.title} (${r.version})` : r.title)}</title>`,
      `    <updated>${r.date}T00:00:00Z</updated>`,
      `    <link rel="alternate" type="text/html" href="${escapeXml(`${page}#${r.id}`)}"/>`,
      `    <summary>${escapeXml(r.summary)}</summary>`,
      `    <content type="html">${escapeXml(content)}</content>`,
      '  </entry>',
    ].join('\n');
  });
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    `  <id>${escapeXml(page)}</id>`,
    '  <title>Forma changelog</title>',
    '  <subtitle>What changed in Forma, newest first.</subtitle>',
    `  <updated>${updated}</updated>`,
    `  <link rel="alternate" type="text/html" href="${escapeXml(page)}"/>`,
    `  <link rel="self" type="application/atom+xml" href="${escapeXml(`${site}/changelog.xml`)}"/>`,
    '  <author><name>Waqar Sayyed</name></author>',
    ...entries,
    '</feed>',
    '',
  ].join('\n');
}
