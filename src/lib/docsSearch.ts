/**
 * The Docs page's search and its feedback link (2026-11-08, site audit items
 * 87 and 12). Pure, so a test holds both.
 *
 * Search matched each article's title and a hand-written keyword list, so
 * "OCR", "export", "share", "Ollama" or "PDF/A" found nothing although the
 * articles said them. It reads the articles' own words now too: the page
 * collects each article's text once it has drawn (an effect, so the render
 * stays pure, which is why it was keywords in the first place), and every
 * word of the query has to be somewhere in the title, the keywords or the
 * text.
 *
 * The feedback box said "it gets fixed in the next pass" and threw what was
 * typed away: nothing was wired behind it. It opens an issue on GitHub now,
 * prefilled with what was typed and the article it was typed on, which the
 * person sends themselves; nothing is collected by Forma.
 */

/**
 * `keys` are words an article should be found by without saying them, as
 * "billing" for the FAQ. Since 2026-11-08 (site audit item 87) search also
 * reads each article's own text, collected in an effect once the page has
 * drawn (`lib/docsSearch.ts`); reading the DOM during render was impure and
 * found nothing on the first pass, which is why it was keywords alone.
 *
 * Moved here from DocsPage.tsx on 2026-11-10 (the AI accuracy programme,
 * batch AG item 25): the chat finds the article a question is about by the
 * same titles and keywords (lib/docsKnowledge.ts).
 */
export const DOCS_SECTIONS: ReadonlyArray<{ id: string; n: string; title: string; keys: string }> = [
  { id: 'start', n: '01', title: 'Getting started', keys: 'start begin first steps tutorial upload workflow guide describe prompt words' },
  { id: 'key', n: '02', title: 'Your API key', keys: 'key api gemini google studio session vault passphrase encrypt security storage' },
  { id: 'ai', n: '03', title: 'Choosing your AI', keys: 'ai provider model automatic gemini local ollama lm studio openrouter free offline private vision' },
  { id: 'account', n: '04', title: 'Your account', keys: 'account sign in signup register google email password forgot reset sync devices optional verify delete' },
  { id: 'upload', n: '05', title: 'What you can upload', keys: 'upload file formats png jpg pdf repx size limit pages attachments text extraction scan ocr photo' },
  { id: 'run', n: '06', title: 'Running and refining', keys: 'run generate working dots stop escape queue steer resume cancel read result specification mockup preview export refine change edit undo redo changed iterate conversation' },
  { id: 'workspace', n: '07', title: 'The workspace', keys: 'workspace tour sidebar rail home starting points views panes conversation panel thread search tools house style main menu reply project menu rename duplicate archive delete pin command menu clean screen zoom' },
  { id: 'data', n: '08', title: 'Data and binding', keys: 'data tab bind binding fields schema json csv create table map columns expression prompt-to-expression test data rows sample' },
  { id: 'sql', n: '09', title: 'Your SQL Server data', keys: 'sql server database ssms script layout schema sample rows connection name connectionstrings app.config stored procedure query join filter parameter lookup drift renamed column share ai never connects' },
  // xrchart and xrgauge are searchable because both are now written into the
  // file — a real XRChart with its series, and a real XRGauge with its value
  // and range. This comment used to say the opposite, and was left behind by
  // the work that added them.
  { id: 'controls', n: '10', title: 'Supported controls', keys: 'controls xrlabel xrtable xrpicturebox xrbarcode xrline xrpageinfo pageinfo page numbers xrchart xrgauge chart gauge xrcheckbox checkbox xrpanel panel xrshape shape crossband cross-band xrcrosstab cross-tab pivot xrsubreport subreport table of contents elements supported' },
  { id: 'repx', n: '11', title: 'The .repx file', keys: 'repx xml schema serializer band detail bands units grid coordinates export download audit warnings errors checks accessibility' },
  { id: 'designer', n: '12', title: 'Open in the DevExpress designer', keys: 'designer devexpress open in designer forma designer download windows install companion repxdesigner trial apps on device blocked local network smartscreen uninstall' },
  { id: 'config', n: '13', title: 'Settings and what is worked out', keys: 'config configure settings worked out version paper size letter a4 legal tabloid landscape rtl right to left stored procedure data model picker auto fast balanced local ai ollama lm studio openrouter unit units scale hundredths inch millimetre millimeter pixels locationfloat sizef' },
  { id: 'saving', n: '14', title: 'Saving your work', keys: 'save saved projects account cloud local storage sign out history' },
  { id: 'share', n: '15', title: 'Sharing a report', keys: 'share sharing link restricted anyone people invite email verified stop sharing collaborate' },
  { id: 'memory', n: '16', title: 'Memory and house style', keys: 'memory remember from now on forget house style library report library learn kept reports formatting' },
  /* Batch and Revisions are two of the five rail panels and both shipped on
     2026-09-05, and neither appeared anywhere on this page or on Features
     until 2026-09-08 — on a page whose sibling is titled "Everything it does".
     Batch in particular is the migration story: it is the thing a
     prompt-driven competitor structurally cannot offer, and it was the one
     feature a visitor could not discover without opening the app. */
  { id: 'batch', n: '17', title: 'Batch generation', keys: 'batch bulk many folder drop queue multiple files parallel two three zip archive migration legacy convert retry stop download all at once' },
  { id: 'revisions', n: '18', title: 'Revision history', keys: 'revisions history versions restore undo diff changed previous rollback compare' },
  { id: 'shortcuts', n: '19', title: 'Keyboard shortcuts', keys: 'keyboard shortcuts keys hotkeys ctrl cmd command' },
  { id: 'trouble', n: '20', title: 'Troubleshooting', keys: 'trouble error 404 429 503 quota overload fail slow retired invalid problem draft local not answering context sign in login pop-up popup password' },
  { id: 'faq', n: '21', title: 'FAQ', keys: 'faq questions common help cost price free billing visual studio photo' },
];

/** Whether every word of `query` appears in the article. An empty query matches everything. */
export function articleMatches(query: string, article: { title: string; keys: string; text?: string }): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const haystack = `${article.title} ${article.keys} ${article.text ?? ''}`.toLowerCase();
  return words.every((word) => haystack.includes(word));
}

/** Where a docs issue is filed. */
export const DOCS_ISSUES = 'https://github.com/waqarsyd/forma/issues/new';

/** A new GitHub issue about the docs, prefilled with what was typed and where; the person sends it. */
export function docsIssueUrl(comment: string, section: string): string {
  const said = comment.trim();
  const first = said.split('\n')[0].slice(0, 70);
  const title = `Docs: ${first || 'something was missing'}`;
  const body = [
    said || '(what were you looking for?)',
    '',
    `Page: https://openforma.web.app/docs${section ? `#${section}` : ''}`,
  ].join('\n');
  return `${DOCS_ISSUES}?${new URLSearchParams({ title, body, labels: 'documentation' }).toString()}`;
}
