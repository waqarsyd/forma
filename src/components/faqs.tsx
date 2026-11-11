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
        Settings, under General, has Download everything (.zip): every project you saved, each as its conversation
        and report and as a .repx to open in the designer, and what Forma remembers, in one .zip; signed in, also
        each project&apos;s earlier versions, the reports you share and what you shared for learning. Signed out, it
        is also the copy to keep, since a browser may clear what a site stores to free space.
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
        opens in the Visual Studio report designer or an end-user designer from DevExpress 20.1 up. The version
        written in it is a label, not a gate: the designer opens the file and rewrites it when it saves.
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
          Ask for it in the chat: say the region is a table and should be one control with rows and cells.
          With a report open the chat edits it in place, or redesigns it when an edit cannot reach, and Undo
          takes either back.
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
    // Says what the database holds (2026-11-11, the full audit's PS-02 and
    // LM-19): a plain "No" left out the projects and the learning events the
    // operator can read, which the privacy policy says. The key's sentence
    // carries encrypted sync's condition, as the policy and /security do: with
    // it on, an encrypted copy is in the account, so "never" alone was false.
    a: (
      <p>
        Your key, never in a form anyone can read: it goes only to the AI it belongs to, and only if you turn on
        encrypted sync is a copy kept in your account, encrypted in your browser with your passphrase. Your design
        goes from your browser to the AI you
        chose, not through a Forma server. Signed in, your projects, with the files you attached, are saved in
        Forma&apos;s database under your account, and so is the shape of each report you make (no text and no
        pictures, unless you choose to share whole reports), which trains Forma&apos;s own model; Settings → Learning
        turns that off or deletes it. Signed out, Forma keeps nothing of yours anywhere but this browser.
      </p>
    ),
  },
];
