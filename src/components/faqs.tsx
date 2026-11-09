import type { ReactNode } from 'react';

/**
 * The questions people ask, answered once (2026-11-08, the site audit's batch
 * SJ, item 117): shown in the Docs page's FAQ and on /faq, a page of its own
 * that search engines index, so the two cannot drift. Moved here from
 * DocsPage.tsx, where they were written.
 */
export const FAQS: Array<{ q: string; a: ReactNode }> = [
  {
    // 2026-11-08, site audit item 104: said, rather than left to be found out.
    q: 'Is Forma in my language?',
    a: (
      <p>
        Its own words are English for now. Dates follow your browser&apos;s language; OCR reads English, Arabic,
        Urdu, Hindi, French, German and Spanish; and a report in a right-to-left language comes out right to
        left.
      </p>
    ),
  },
  {
    q: 'How do I take all my projects with me?',
    a: (
      <p>
        Settings, under General, has Download all: every project you saved, in one .zip, each as its conversation
        and report and as a .repx to open in the designer. Signed out, it is also the copy to keep, since a browser
        may clear what a site stores to free space.
      </p>
    ),
  },
  {
    q: 'Does Forma cost anything to use?',
    a: (
      <p>
        Forma itself is open source (Apache-2.0) and free, and it is built to stay inside Google's free tier
        for your own Gemini key. If you turn on billing for your key, Google bills you directly; Forma takes
        no cut. A local AI costs nothing at all. Whoever runs Forma pays nothing for your requests, and you
        never wait behind another user's quota.
      </p>
    ),
  },
  {
    q: 'Which file formats can I upload?',
    a: (
      <p>
        Pictures (PNG, JPG and the like), PDF documents, existing DevExpress <code className="doc-code">.repx</code>{' '}
        files, and data files (CSV, TSV, JSON, text, SQL, Excel and Word), several at once, and you can mix them.
      </p>
    ),
  },
  {
    q: 'Can I open the generated file in Visual Studio?',
    a: (
      <p>
        Yes. The output is standard <code className="doc-code">XtraReportsLayoutSerializer</code> XML and
        opens in the Visual Studio report designer or an end-user designer. The version is read from a
        report you bring; ask in the chat for another if your SDK needs it.
      </p>
    ),
  },
  {
    q: 'How do I open a report in the DevExpress designer?',
    a: (
      <p>
        With Forma Designer, a free Windows app:{' '}
        <a href="/download" className="font-semibold text-secondary hover:underline">download it</a>, install it, and
        choose Open in designer. It needs DevExpress Reporting on the same PC, a separate commercial product of
        Developer Express Inc. with a free 30-day trial on devexpress.com. Without it, Export saves the .repx to open
        however you like.
      </p>
    ),
  },
  {
    q: 'Can Forma read a photo of a printed form?',
    a: (
      <p>
        Yes — that is one of the cases it is built for. Its words are read by OCR in your browser and its
        layout from the picture, so expect the odd misread string where a digital PDF would be exact. If
        you have a digital PDF of the same document, use that instead: the text layer gives exact positions.
      </p>
    ),
  },
  {
    q: 'Why does my grid come out as separate labels?',
    a: (
      <>
        <p>
          Ask for it explicitly in the conversation — say the region is a table and should be one control
          with rows and cells. With a report open the chat edits it in place where it can, and asks before a
          redesign where it cannot, so you keep everything else.
        </p>
        <p className="mt-2.5">
          Projects saved before tables were supported still contain the older split-label form and will keep
          rendering that way.
        </p>
      </>
    ),
  },
  {
    q: "Is my design or my key sent to Forma's servers?",
    a: (
      <p>
        No. Generation runs entirely in your browser and talks to Google directly — there is no generation
        endpoint on Forma's server to route through. Signed in, your projects are saved to your own account
        as you work; the key is never part of them.
      </p>
    ),
  },
];
