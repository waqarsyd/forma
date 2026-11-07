import { STARTING_POINTS } from '../lib/startingPoints';
import { MAX_SHARES } from '../lib/shares';
import { A, P, STRONG, UL, type InfoDoc } from './InfoPage';
import { FAQS } from './faqs';

/** Each page by its route. */
export const INFO_DOCS = {
  '/security': () => SECURITY,
  '/pricing': () => PRICING,
  '/examples': () => EXAMPLES,
  '/compare': () => COMPARE,
  '/about': () => ABOUT,
  '/self-host': () => SELF_HOST,
  '/faq': () => FAQ_PAGE,
} as const;
export type InfoRoute = keyof typeof INFO_DOCS;

/**
 * The words of the pages the site audit found missing (2026-11-08, batch SJ,
 * items 110 to 114 and 116): what is true on main, and nothing a page cannot
 * back. Claims about other products are only what their own pages say,
 * checked on 2026-11-08 and linked, and a page that makes them carries the
 * day it was reviewed.
 */

const REPO = 'https://github.com/waqarsyd/forma';
const ext = { target: '_blank', rel: 'noopener' } as const;

/** Live shared reports to show on /examples, once the owner has shared some (item 111). Empty until then. */
export const EXAMPLE_SHARES: readonly { title: string; id: string }[] = [];

/* ------------------------------------------------------------- security */

export const SECURITY: InfoDoc = {
  eyebrow: 'Security',
  title: 'How Forma keeps your key and your work safe.',
  lede: (
    <p>
      Forma has no server of its own in the path of your work: your browser talks to the AI you chose, and, if you
      sign in, to Google’s database. What follows is how the code is built to keep it that way, and how to tell us if
      it does not.
    </p>
  ),
  sections: [
    {
      heading: 'Bring your own key',
      body: (
        <>
          <p className={P}>
            Forma ships with no API key and has no quota of its own. You supply your Gemini key, and your browser calls
            Google directly with it. It is held in your open Forma tabs, never written to disk in readable form, and
            gone when the last tab closes. An encrypted copy is kept in your account only if you ask, encrypted in your
            browser under a passphrase that never leaves it, so not even the operator can read it.
          </p>
        </>
      ),
    },
    {
      heading: 'Where the page may send anything',
      body: (
        <>
          <p className={P}>
            Every page carries a Content Security Policy whose <code className="doc-code">connect-src</code> lists the
            only places it may talk to: Google’s Gemini, sign-in and database, the contact form’s relay, OpenRouter, a
            local AI on your own computer and the designer companion on it. So even a script that got into the page could
            not send your key anywhere else. Scripts load only from this site and Google’s sign-in helper; nothing can
            frame the page; and the browser is told to keep it isolated from other sites’ windows.
          </p>
        </>
      ),
    },
    {
      heading: 'Your saved work',
      body: (
        <>
          <p className={P}>
            The database’s rules let an account read and write only its own projects, revisions and key. A shared report
            is a copy, readable by the people you add once they sign in with that address verified, or by anyone with
            the link if you choose it; making one needs a verified address and a project of your own, and an account can
            share up to {MAX_SHARES}. The rules are tested against Google’s emulator on every change.
          </p>
        </>
      ),
    },
    {
      heading: 'No tracking',
      body: (
        <p className={P}>
          No analytics, no advertising, no tracking pixels and no cookies. The{' '}
          <a href="/privacy" className={A}>privacy policy</a> lists everything that is stored and everything that is
          sent, and where.
        </p>
      ),
    },
    {
      heading: 'Reporting a vulnerability',
      body: (
        <>
          <p className={P}>
            Please report it privately: by email with “Forma security” in the subject (the address is on the{' '}
            <a href="/contact" className={A}>contact page</a>), or through{' '}
            <a href={`${REPO}/security/advisories/new`} className={A} {...ext}>GitHub’s private vulnerability reporting</a>.
            Do not open a public issue for anything that could expose someone’s key or saved reports. An acknowledgement
            comes within a few days; the full policy is{' '}
            <a href={`${REPO}/blob/main/SECURITY.md`} className={A} {...ext}>SECURITY.md</a>, and the machine-readable
            one is <a href="/.well-known/security.txt" className={A}>security.txt</a>.
          </p>
        </>
      ),
    },
  ],
};

/* -------------------------------------------------------------- pricing */

const PRICE_CARD = 'rounded-xl border border-outline-variant bg-surface-container-lowest dark:bg-card p-5';

export const PRICING: InfoDoc = {
  eyebrow: 'Pricing',
  nav: 'Pricing',
  title: 'Forma is free. So is the AI, if you want it to be.',
  lede: (
    <p>
      Forma has no plans, no trial and no card to enter, and it will stay that way: it is open source, and the site runs
      on Firebase’s free plan. What you might pay for is the AI that designs your reports, and every choice has a free
      way in.
    </p>
  ),
  sections: [
    {
      heading: 'What each choice costs',
      body: (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {[
            ['Forma', 'Free', 'Every feature, signed in or not. No account is needed to use it.'],
            ['Google Gemini', 'Free tier', 'Your own key from Google AI Studio, with daily limits per model; Settings shows today’s count. Turn on billing for the key and Google bills you directly; Forma takes no cut.'],
            ['A local AI', 'Free', 'Ollama or LM Studio on your own computer: no limits but your machine’s, and nothing leaves it.'],
            ['OpenRouter', 'Free models', 'Its free models with a key of your own, with daily limits; their providers may log requests.'],
          ].map(([name, price, note]) => (
            <div key={name} className={PRICE_CARD}>
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="font-display-lg text-[16px] font-bold text-on-surface">{name}</h3>
                <span className="font-code-sm text-[12px] font-semibold text-secondary">{price}</span>
              </div>
              <p className="mt-2 font-body-lg text-[14px] leading-[1.55] text-on-surface-variant">{note}</p>
            </div>
          ))}
        </div>
      ),
    },
    {
      heading: 'Why it can be free',
      body: (
        <p className={P}>
          Forma does its work in your browser and with your own key, so the site has almost nothing to pay for: the
          pages are static, the database holds only what signed-in people save, and the AI is billed, if at all, to
          whoever owns the key. Even the OCR and Forma’s own models run on your machine.
        </p>
      ),
    },
    {
      heading: 'Keeping within a free tier',
      body: (
        <ul className={UL}>
          <li>The AI writes the .repx alone, and Forma reads the mockup and the spec off it, which cut what each report asks the AI to write by about three quarters.</li>
          <li>A rate-limited model is set aside until Google says its limit lifts, and the next request starts on another model your key can reach.</li>
          <li>Batch runs one file at a time by default, so a folder of reports does not spend a minute’s quota in a second.</li>
        </ul>
      ),
    },
  ],
};

/* ------------------------------------------------------------- examples */

export const EXAMPLES: InfoDoc = {
  eyebrow: 'Examples',
  title: 'Six reports to start from.',
  lede: (
    <p>
      Each is a description Forma can build a report from, the same six the workspace offers when it opens. They are
      made up for the purpose: no example on this site is anyone’s real report. Open one in the workspace, change what
      you like, and send it.
    </p>
  ),
  sections: [
    ...STARTING_POINTS.map((point) => ({
      id: point.id,
      heading: point.title,
      body: (
        <>
          <p className={P}>{point.gist}.</p>
          <blockquote className="mt-3 rounded-lg border-l-2 border-outline-variant bg-surface-container-low px-4 py-3 font-body-lg text-[14.5px] leading-[1.6] text-on-surface-variant">
            {point.text}
          </blockquote>
          <p className="mt-3">
            <a href={`/workspace?start=${point.id}`} className={A}>
              Open it in the workspace →
            </a>
          </p>
        </>
      ),
    })),
    ...(EXAMPLE_SHARES.length
      ? [
          {
            heading: 'Finished reports, shared',
            body: (
              <ul className={UL}>
                {EXAMPLE_SHARES.map((s) => (
                  <li key={s.id}>
                    <a href={`/s/${s.id}`} className={A}>{s.title}</a>, as Forma built it, with its Preview and its .repx.
                  </li>
                ))}
              </ul>
            ),
          },
        ]
      : []),
    {
      heading: 'From a picture or a file instead',
      body: (
        <p className={P}>
          Forma builds from what you already have just as well: attach a screenshot, a scan, a PDF or a .repx to the
          message, and say what to change. <a href="/docs#upload" className={A}>What you can upload</a> lists what it
          reads.
        </p>
      ),
    },
  ],
};

/* -------------------------------------------------------------- compare */

export const COMPARE: InfoDoc = {
  eyebrow: 'Compare and migrate',
  title: 'Forma beside DevExpress’s own AI, and moving reports in.',
  reviewed: '8 November 2026',
  lede: (
    <p>
      Forma writes DevExpress reports, so the honest comparison is with DevExpress’s own AI features, and the useful
      question is how to bring reports from another tool. Both answers, with links to DevExpress’s own pages.
    </p>
  ),
  sections: [
    {
      heading: 'DevExpress’s AI-powered extensions',
      body: (
        <>
          <p className={P}>
            DevExpress Reporting has its own AI features in its designers, among them Prompt-to-Report (a report from a
            description, still a preview) and an expression written from a sentence. Its documentation lists two things
            they need: an <span className={STRONG}>active DevExpress subscription</span>, and an account with an AI
            service of your choosing, such as OpenAI, Azure OpenAI or a self-hosted Ollama.{' '}
            <a href="https://docs.devexpress.com/XtraReports/405211/ai-powered-functionality/ai-for-devexpress-reporting" className={A} {...ext}>
              DevExpress: AI-powered extensions
            </a>
          </p>
        </>
      ),
    },
    {
      heading: 'Where Forma differs',
      body: (
        <ul className={UL}>
          <li><span className={STRONG}>Free, and in a browser.</span> No subscription and nothing to install; a free Gemini key, a local AI or OpenRouter’s free models.</li>
          <li><span className={STRONG}>From what you already have.</span> A screenshot, a scan, a PDF or a .repx, read with OCR in your browser, as well as a description.</li>
          <li><span className={STRONG}>Checked as DevExpress prints.</span> A Preview that pages the report as DevExpress does, exports, and an audit for what the designer would drop.</li>
          <li><span className={STRONG}>Not a designer.</span> Forma writes the .repx; DevExpress’s designer is still where a report is finished, and its subscription is still what runs it in your application.</li>
        </ul>
      ),
    },
    {
      heading: 'Moving reports from Crystal Reports or SSRS',
      body: (
        <>
          <p className={P}>
            DevExpress publishes a free tool for this: <span className={STRONG}>Reporting.Import</span>, open source
            under the MIT licence, a console program that converts Crystal Reports (.rpt) and SQL Server Reporting
            Services (RDL, RDLC) reports into .repx files. It needs the other tool’s own libraries installed, and says
            plainly that not everything converts.{' '}
            <a href="https://github.com/DevExpress/Reporting.Import" className={A} {...ext}>DevExpress/Reporting.Import on GitHub</a>
          </p>
          <p className={P}>
            The two fit together: convert with Reporting.Import, then bring the .repx to Forma to tidy it, check it in
            the Preview and the audit, and ask for what the conversion missed. For a report you only have as paper or a
            PDF, Forma alone is the way in, and <a href="/docs#batch" className={A}>Batch</a> takes a whole folder.
          </p>
        </>
      ),
    },
  ],
};

/* ---------------------------------------------------------------- about */

export const ABOUT: InfoDoc = {
  eyebrow: 'About',
  title: 'A report designer for DevExpress, built in the open.',
  lede: (
    <p>
      Forma is made by Waqar Sayyed, an independent developer, and is open source under the Apache-2.0 licence. It
      exists because turning a report someone already has into a DevExpress .repx by hand is slow, and it should not
      cost anything to do it faster.
    </p>
  ),
  sections: [
    {
      heading: 'The project',
      body: (
        <p className={P}>
          The code, its history and its issues are on <a href={REPO} className={A} {...ext}>GitHub</a>; ideas and
          questions go to <a href={`${REPO}/discussions`} className={A} {...ext}>Discussions</a>, and what changed when is
          on the <a href="/changelog" className={A}>changelog</a>. Contributions are welcome: CONTRIBUTING.md in the
          repository says how.
        </p>
      ),
    },
    {
      heading: 'Built with',
      body: (
        <>
          <ul className={UL}>
            <li>React, Vite, Tailwind CSS and Motion for the app; Firebase for sign-in and saved projects.</li>
            <li>Tesseract.js for OCR in your browser, pdf.js for PDFs, and Transformers.js with ONNX Runtime for handwriting.</li>
            <li>Inter, Hanken Grotesk and JetBrains Mono for type, and the Liberation fonts inside PDF/A files, all under the SIL Open Font License.</li>
          </ul>
          <p className={P}>
            Every open-source work Forma ships is listed with its licence in the{' '}
            <a href="/licenses.txt" className={A}>third-party notices</a>.
          </p>
        </>
      ),
    },
    {
      heading: 'DevExpress',
      body: (
        <p className={P}>
          DevExpress and XtraReports are trademarks of Developer Express Inc. Forma is an independent project, not
          affiliated with, sponsored or endorsed by Developer Express Inc.; it writes their file format so that their
          designer and their reporting engine can open what it makes.
        </p>
      ),
    },
    {
      id: 'press',
      heading: 'Press kit',
      body: (
        <>
          <p className={P}>The mark and the card, free to use when writing about Forma:</p>
          <ul className={UL}>
            <li><a href="/logo.png" className={A}>Logo, PNG</a> and <a href="/logo_white.png" className={A}>for dark backgrounds</a></li>
            <li><a href="/icons/icon-512.png" className={A}>App icon, 512 px</a></li>
            <li><a href="/og-card.png" className={A}>Social card, 1200 × 630</a></li>
          </ul>
          <p className={P}>
            The name is Forma, one word. For anything else, the <a href="/contact" className={A}>contact page</a>.
          </p>
        </>
      ),
    },
  ],
};

/* ------------------------------------------------------------------ faq */

export const FAQ_PAGE: InfoDoc = {
  eyebrow: 'FAQ',
  title: 'Questions people ask about Forma.',
  lede: (
    <p>
      The short answers. The <a href="/docs" className={A}>documentation</a> has the long ones, and anything not here
      can go to <a href={`${REPO}/discussions`} className={A} {...ext}>Discussions</a> or the{' '}
      <a href="/contact" className={A}>contact page</a>.
    </p>
  ),
  sections: FAQS.map((f) => ({
    heading: f.q,
    body: <div className="mt-3 font-body-lg text-[15.5px] leading-[1.65] text-on-surface-variant [&_p+p]:mt-2.5">{f.a}</div>,
  })),
};

/* ------------------------------------------------------------ self-host */

const CODE = 'mt-3 overflow-x-auto rounded-lg bg-[color:var(--code-bg)] p-4 font-code-sm text-[12.5px] leading-[1.7] text-[color:var(--code-ink)]';

export const SELF_HOST: InfoDoc = {
  eyebrow: 'Self-hosting',
  title: 'Run your own Forma.',
  lede: (
    <p>
      Forma is open source, so you can run it yourself: on your own computer, or on your own Firebase project for a
      team. It needs no server of its own, and nothing of ours.
    </p>
  ),
  sections: [
    {
      heading: 'On your computer',
      body: (
        <>
          <p className={P}>Node 20, 22 or 24 and later (not 21 or 23), then:</p>
          <pre className={CODE}>{`git clone ${REPO}.git
cd forma
npm ci
npm run dev`}</pre>
          <p className={P}>
            Open <code className="doc-code">http://localhost:3000</code> and add your Gemini key in Settings. Signed
            out, projects are kept in your browser, and everything works; Open in designer works too, from here.
          </p>
        </>
      ),
    },
    {
      heading: 'With your own Firebase project',
      body: (
        <>
          <p className={P}>For sign-in, saved projects and sharing, on Firebase’s free plan:</p>
          <ol className={`${UL} list-decimal`}>
            <li>Create a project in the Firebase console and register a web app.</li>
            <li>Authentication: Get started, then enable Google (and email, if you want it).</li>
            <li>Create a Firestore database in production mode.</li>
            <li>Put your web app’s config into <code className="doc-code">firebase-applet-config.json</code>, and set your project in <code className="doc-code">.firebaserc</code>.</li>
            <li>Restrict the browser API key to your sites by HTTP referrer, including your <code className="doc-code">authDomain</code>.</li>
            <li>Deploy the rules and the site with Firebase Hosting.</li>
          </ol>
          <pre className={CODE}>{`npx firebase deploy --only firestore:rules
npm run build
npx firebase deploy --only hosting`}</pre>
          <p className={P}>
            The README’s <a href={`${REPO}#using-your-own-firebase-project`} className={A} {...ext}>own walkthrough</a>{' '}
            has the details and the two traps (an <code className="doc-code">authDomain</code> missing from the key’s
            referrers, and a database id that does not match).
          </p>
        </>
      ),
    },
    {
      heading: 'What you take on',
      body: (
        <ul className={UL}>
          <li>Your own users’ data, under your own privacy policy: the one here describes this site.</li>
          <li>The headers: <code className="doc-code">firebase.json</code> carries the security headers, generated from the code; keep them when you change anything.</li>
          <li>Updates: pull from the repository and deploy again. The changelog says what changed.</li>
        </ul>
      ),
    },
  ],
};
