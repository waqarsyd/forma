import { User } from 'firebase/auth';
import SiteHeader from './SiteHeader';
import SiteFooter from './SiteFooter';
import SheetRuler from './landing/SheetRuler';
import { Eyebrow } from './landing/sections';
import { APP_CHECK_SITE_KEY } from '../lib/appCheck';

/**
 * The Terms, the Privacy policy and the accessibility statement, from one
 * component because they are the same page three times: an eyebrow, a
 * heading, a date, and a column of prose.
 *
 * **These describe what the code actually does.** Every claim below is
 * checkable against the repository — where data goes, what is stored, what is
 * not collected. When the app changes, this changes in the same commit; a
 * privacy policy that has drifted from the software is worse than none,
 * because it is a promise nobody is keeping.
 *
 * Both were placeholders until 2026-08-15 (`href="#"`, `data-needs-url`) while
 * the sign-up form asked people to agree to them, which is the one combination
 * that had to end.
 *
 * Rewritten on 2026-11-08 (the site audit's batch SE) from an inventory of
 * every storage key, database and outbound call in the code: the policy had
 * not caught up with OpenRouter and the local AI, autosave, memory, the
 * library, dictation or the host's own logs, said saved projects were readable
 * by their account alone, and had none of the basics a policy is read for
 * (who runs it, rights, retention, cookies, age). The accessibility statement
 * joined the two the same day (site audit item 115).
 */

/*
 * Bumped whenever the text below changes, which the header comment requires:
 * a policy that has drifted from the software is a promise nobody is keeping,
 * and a date that has not moved says the drift never happened.
 *
 * 2026-09-08: the terms described the "Open in designer" button as hidden when
 * the companion is not installed. It is always drawn — the probe decides what
 * a click does, not whether the button exists — so the paragraph described
 * software that has not behaved that way since the launch path was added.
 * Corrected, along with the deletion note, which knew about deleting projects
 * one at a time and not about Clear all.
 */
const UPDATED = '9 November 2026';

type Section = { heading: string; paragraphs: string[] };

const TERMS: Section[] = [
  {
    heading: 'Who runs Forma',
    paragraphs: [
      'Forma is run by Waqar Sayyed, an independent developer, not a company. Its source code is open under the Apache-2.0 licence. The address to write to is on the contact page.',
    ],
  },
  {
    heading: 'What Forma is',
    paragraphs: [
      'Forma turns a design you already have — a picture, a PDF or an existing .repx file — or a report you describe in words into a DevExpress report file, with a written specification, a mockup and a Preview read off it, and exports from that Preview.',
      'It is offered free of charge and without a support contract. There is no uptime guarantee, and it may change or stop being available at any time.',
      'One thing the workspace does that is worth stating plainly: it checks whether the optional RepxDesigner companion is running on your own computer, by asking 127.0.0.1 — your machine, not the internet — whether anything answers on that port. The check sends nothing about you or your work, and if you have not installed the companion it simply fails. Nothing leaves your machine either way.',
      'What that check decides is what the “Open in designer” button does, not whether you can see it. The button is always there. If the companion is already running, clicking it hands the report straight over. If nothing answered, clicking it asks Windows to start the companion — which your browser will ask you to allow the first time — and reports plainly if it cannot. Exporting the .repx works regardless, and never involves any of this.',
    ],
  },
  {
    heading: 'Who may use it',
    paragraphs: [
      'You must be 18 or older to use Forma, which is also what Google’s terms for the Gemini API require of anyone using a key.',
    ],
  },
  {
    heading: 'You bring your own AI',
    paragraphs: [
      'Forma ships without an API key of its own. It needs your own Google Gemini API key to open the workspace, and whichever AI designs your reports — Gemini, OpenRouter with a key of your own, or a local AI on your computer — your browser calls it directly. Any usage, quota or cost is between you and that provider, and your use of it is governed by its terms, not these.',
      'Keep your keys to yourself. Anyone who has one can spend against your quota.',
    ],
  },
  {
    heading: 'What you bring, and what comes back',
    paragraphs: [
      'Only upload or describe material you have the right to use. You are responsible for what you put in and for what you do with the output.',
      'What you bring stays yours, and so do the reports Forma makes from it: Forma claims no rights in your designs, your reports or the files it writes.',
      'The output is generated by a language model and is not guaranteed to be correct, complete, or fit for any particular purpose. Check the generated .repx in the DevExpress designer before you rely on it. Forma checks the XML is well formed and refuses to hand over a file that is not — that is a structural check, not a promise the report is right.',
    ],
  },
  {
    heading: 'Your account, and what you share',
    paragraphs: [
      'An account is optional: Forma works signed out, with your work kept in your browser. Signing in lets your projects follow you between machines, and lets you share a report.',
      'You are responsible for keeping your sign-in details safe. You can change or delete your account at any time from Account settings in the workspace.',
      'You are responsible for what you share and with whom. Do not use sharing to publish anything unlawful, or anything you have no right to share.',
      'Accounts used to break the law, to attack the service, or to abuse other people may be suspended or removed, and their shared reports with them.',
    ],
  },
  {
    heading: 'Trademarks',
    paragraphs: [
      'DevExpress and XtraReports are trademarks of Developer Express Inc. Forma is an independent project and is not affiliated with, sponsored or endorsed by Developer Express Inc.; the names are used only to say which file format Forma writes. Gemini is a trademark of Google LLC, and other names belong to their owners.',
    ],
  },
  {
    heading: 'Liability',
    paragraphs: [
      'Forma is provided "as is", without warranties of any kind, express or implied. To the fullest extent the law allows, the operator is not liable for any loss or damage arising from your use of it — including lost work, lost data, or costs incurred against your own API key.',
      'Nothing here limits liability that cannot be limited by law.',
    ],
  },
  {
    // The owner's choice, 2026-11-08 (site audit item 33 had left it to them).
    heading: 'Governing law',
    paragraphs: [
      'These terms are governed by the laws of India. Nothing in them takes away a protection that the law where you live gives you and that no agreement can set aside.',
    ],
  },
  {
    heading: 'Changes',
    paragraphs: [
      'These terms may change as the software does. The date at the top is when they last did. Continuing to use Forma after a change means you accept the current version.',
    ],
  },
];

const PRIVACY: Section[] = [
  {
    heading: 'The short version',
    paragraphs: [
      'Forma is run by Waqar Sayyed, who is responsible for what this policy describes. It collects as little as it can. There are no analytics, no advertising, no tracking pixels, no third-party scripts watching what you do, and no cookies. Nothing is sold or shared with anyone for marketing.',
      'Opening any page asks Forma’s host for it, as every website does. The host is Firebase Hosting, run by Google, which keeps the ordinary request logs a web host keeps — your IP address, the address asked for and your browser — for as long as Google keeps them. Forma itself keeps no record of visitors.',
      'Beyond the host, signed out, four things leave your machine and no others: what you ask the AI you chose to do, sent to Google with your own Gemini key or to OpenRouter with yours (a local AI stays on your computer); only if you use the contact form, the message you type into it; only if you open a link to a report someone shared, a request to Google’s database for that report; and only if you dictate a message, your voice, to your browser’s speech service. Who receives each of those is set out under “Who else is involved” below.',
      'Your machine, not your browser, is the boundary that sentence draws, and the difference is deliberate. The workspace asks 127.0.0.1 whether the optional designer companion is running — a request that leaves the browser and reaches nothing but your own computer. It carries no information about you, and the terms describe it under “What Forma is”.',
    ],
  },
  {
    heading: 'What the AI providers do with your requests',
    paragraphs: [
      'Your browser sends your files, your words and the report straight to the AI you chose, and that provider’s terms decide what happens to them next. Forma’s own server is never in the path.',
      'Your SQL Server database: its table, view, procedure and column names, and up to three sample values a column, go with your requests only if you share it with the AI, by attaching its layout in the chat or with “Send names and sample values to the AI” on the Data view, which also turns it off. Otherwise none of it is sent. Forma never asks for, stores or sends a connection string, a login or a password: a report names its connection, and your application supplies it.',
      'Google Gemini: on the free tier, Google’s terms say it may use what you send and what comes back to improve its products, and that people may read it to do so. Do not send confidential or personal information with a free-tier key. With billing turned on, Google says it does not use them that way.',
      'OpenRouter: its free models come from providers that may log and keep your requests.',
      'A local AI (Ollama or LM Studio on your computer): the request never leaves your machine. For a confidential report, this is the choice to make.',
    ],
  },
  {
    heading: 'What is stored when you have an account',
    paragraphs: [
      'Your email address and, if you give one, a display name. These are held by Google Firebase Authentication, which runs the sign-in.',
      'Your projects, saved automatically as you work: the report’s title, the conversation, the generated report with its specification and layout, any images you attached, your ratings of replies, and the newest ten revisions. They live in Google Firestore under your account, and the security rules let only your account read or change them through the app. They are not encrypted end to end: they sit in the operator’s Firebase project, which its owner can reach through Firebase’s own console, as with any service built this way.',
      'Reports you choose to share: a copy of the report’s title, layout and XML — not the conversation, and not your images — with the email addresses you add to it. It lives in Google Firestore, and the security rules let it be read by you, by the people you add once they sign in with that address verified, or, if you choose it, by anyone who has the link. It stays until you stop sharing it or delete the project or your account. Forma sends no email to the people you add.',
      'If you opt in to encrypted sync, an encrypted copy of your Gemini API key. It is encrypted in your browser with a passphrase that never leaves it, so the stored copy is unreadable to anyone who does not know the passphrase — including the operator. It is the one thing Forma stores that the operator cannot read.',
    ],
  },
  {
    heading: 'Your API keys',
    paragraphs: [
      'Your Gemini key, and an OpenRouter key if you use one, are held in the Forma tabs you have open and erased when the last of them closes: a Forma tab you open while another is open gets them from it, inside this browser, unless you turn that off in Settings. Neither is written to disk in readable form or sent to any server belonging to Forma; each goes only to its own provider.',
    ],
  },
  {
    heading: 'What is kept in your browser',
    paragraphs: [
      'Signed out, your projects are saved automatically in your browser’s local storage on that machine only — the conversation, the report, your attachments and your ratings — and Forma asks the browser to keep them rather than clear them to free space. Revisions last only while the tab is open. Settings, under General, downloads every project you saved, signed in or not.',
      'Local storage also keeps: the theme; the DevExpress version and unit last used; the AI you chose, with its server address and model, never a key; your memories and the style of reports you kept; which projects you pinned or archived; which library reports are your house style, and whether it is used; the workspace’s layout; today’s request counts and the daily limits Google reported; the models your key can reach, with a short fingerprint of the key rather than the key; and the last announcement you saw.',
      'Session storage, which the browser erases when the tab closes, keeps your keys, the unsent text in the box and any messages waiting in the queue, the open project, the changes a reply’s Undo can take back, and the model in use.',
      'IndexedDB keeps the report library — the stripped reports you add and their index —, the SQL Server layouts you add with any sample rows, up to five databases, until you forget them on the Data view or sign out, and, once you sign in, Firebase’s record that you are signed in.',
      'None of this is a cookie, nothing but Forma in this browser reads it, and all of it is there only to make Forma work, which is why there is no cookie banner. Clearing your browser storage removes it. Signing out clears the workspace — the uploads, the extracted text, the generated report and the database layouts kept on this device — so the next person at that browser does not see your work.',
    ],
  },
  {
    heading: 'Who else is involved',
    paragraphs: [
      'Google Firebase hosts the site, runs sign-in and holds the database. Google Gemini answers the requests you make with your key. Signed out, the database is reached only through a link to a shared report. Once you are signed in, your browser does talk to Google on every load, first to check your session is still valid and then to fetch your saved projects, and it holds a connection open so changes to them arrive as they happen.',
      'OpenRouter answers your requests only if you chose it under Settings → AI, with your own key.',
      // Said only once App Check is on (lib/appCheck.ts, site audit item 56).
      ...(APP_CHECK_SITE_KEY
        ? ['Google reCAPTCHA checks that requests to the database come from this site, through Firebase App Check. It runs only when the database is used — once you are signed in, or when you open a shared report — and Google sees your browser and the page while it does.']
        : []),
      'The contact form is delivered by FormSubmit, which receives the name, email address, subject and message you type into that form and forwards them on as email — only when you press send, only from that one page, and nothing else about you goes with it.',
      'Dictation uses your browser’s own speech recognition. Forma receives only the text; the audio goes wherever your browser sends it, which in Chrome is Google and in Edge is Microsoft.',
      'The typefaces used to come from Google Fonts, which meant Google saw the IP address and browser of anyone who opened Forma at all. Since 30 August 2026 they are served by Forma’s own host, as are OCR, Forma’s own models and the fonts a PDF embeds. OCR and those models run in your browser, so a picture’s words are read without leaving your machine.',
      'Files you upload are prepared in your browser — resized, rendered, parsed — before anything is sent.',
    ],
  },
  {
    heading: 'Where it is kept, and for how long',
    paragraphs: [
      'Firebase keeps your account and projects on Google’s servers, which may be in another country than yours; Google’s data processing terms for Firebase cover that transfer.',
      'Your account and projects stay until you delete them, or the account. A shared copy stays until you stop sharing it or delete its project or your account. Revisions are the newest ten of each project. A contact message stays in the maintainer’s inbox only as long as it takes to answer it. The host’s request logs last as long as Google keeps them.',
    ],
  },
  {
    heading: 'Why it is used',
    paragraphs: [
      'Your account, projects and shares are kept to give you the service you asked for, and for nothing else. A contact message is used only to answer it. Everything optional — the encrypted key, memories, the library, sharing, dictation — is there only because you turned it on, and you can turn it off.',
    ],
  },
  {
    heading: 'Your rights',
    paragraphs: [
      'You can see, correct, download and delete what Forma holds about you, and object to its use. Your projects and shares are in the workspace, each report downloads as a .repx and each conversation as a Markdown file, and Account settings deletes everything.',
      'For anything the workspace does not do, or a copy of your data, write through the contact page; you will have an answer within 30 days. You can also complain to the data protection authority where you live.',
      'Forma is not for anyone under 18, and does not knowingly hold anything about a child.',
    ],
  },
  {
    heading: 'Deleting your data',
    paragraphs: [
      'Account settings in the workspace has a Delete account action. It removes your saved projects with their revisions, every report you shared and the encrypted copy of your key along with the account itself. It cannot be undone.',
      'Individual projects can be deleted from Saved projects, one at a time or all at once with Clear all, which asks you to confirm first. Deleting a project also stops sharing it, and Stop sharing in the Share dialog removes the shared copy on its own. Settings → Memory forgets your memories and kept reports, and the Report library removes a report from this browser.',
    ],
  },
  {
    heading: 'Contact',
    paragraphs: [
      'Questions about any of this, or a request about your data, can go through the contact page.',
    ],
  },
];

const ACCESSIBILITY: Section[] = [
  {
    heading: 'What Forma aims for',
    paragraphs: [
      'Forma aims to meet the Web Content Accessibility Guidelines (WCAG) 2.2 at level AA, on these public pages and in the workspace. It does not meet all of them yet. This page says what is in place, what is known to fall short, and how to tell us when something stands in your way.',
    ],
  },
  {
    heading: 'What is in place',
    paragraphs: [
      'The workspace is built to be used from the keyboard. Ctrl+K (⌘K on a Mac) opens a command menu that runs an action by name, “?” lists every shortcut, and a selected control moves with the arrow keys rather than only by dragging.',
      'Dialogs keep focus inside them, close with Escape and hand focus back to where you were; menus move with the arrow keys. Progress and replies are announced to screen readers as they arrive.',
      'Every public page opens with a link that skips to its content, and its text and buttons meet the 4.5:1 contrast the guidelines ask for, in the light theme and the dark. The light and dark themes follow your system, and motion is reduced when your system asks for it.',
      'Every report Forma writes is checked as DevExpress’s own designer checks it: text too small to read, contrast too low, and pictures with no description are listed in the REPX view.',
    ],
  },
  {
    heading: 'What is known to fall short',
    paragraphs: [
      'The mockup and the Preview draw a printed page as boxes placed where the report puts them, so a screen reader meets them in layout order rather than reading order. The Spec view describes the same report as structured text.',
      'Retyping a control on the Preview needs a double-click, and its right-click menu needs a pointer; the command menu reaches most of the same actions.',
      'Neither the public pages nor the workspace has yet been tested with a screen reader from end to end, or audited by anyone outside the project.',
    ],
  },
  {
    heading: 'How it was checked',
    paragraphs: [
      'By the maintainer, with the keyboard and the browser’s own accessibility tools, on the date at the top of this page.',
    ],
  },
  {
    heading: 'Tell us',
    paragraphs: [
      'If something on Forma is hard or impossible to use, write through the contact page or open an issue on GitHub, and say what you were trying to do and with what browser or assistive technology. You will have an answer within a few days, and a fix or a way round it where one can be made.',
    ],
  },
];

const DOCS = {
  terms: { eyebrow: 'Terms', title: 'Terms of use', sections: TERMS },
  privacy: { eyebrow: 'Privacy', title: 'Privacy policy', sections: PRIVACY },
  accessibility: { eyebrow: 'Accessibility', title: 'Accessibility statement', sections: ACCESSIBILITY },
} as const;

export type LegalDoc = keyof typeof DOCS;

export default function LegalPage({
  doc,
  onEnterWorkspace,
  onSignIn,
  onSignUp,
  user,
  logOut,
  isDarkMode,
  setIsDarkMode,
}: {
  doc: LegalDoc;
  onEnterWorkspace: () => void;
  onSignIn: () => void;
  onSignUp: () => void;
  user: User | null;
  logOut: () => void;
  isDarkMode: boolean;
  setIsDarkMode: (val: boolean) => void;
}) {
  const { eyebrow, title, sections } = DOCS[doc];

  return (
    <div className="landing font-body-lg text-[16px] leading-[1.62] bg-surface text-on-surface min-h-screen flex flex-col">
      <SheetRuler />
      <SiteHeader
        active="none"
        onEnterWorkspace={onEnterWorkspace}
        onSignIn={onSignIn}
        onSignUp={onSignUp}
        user={user}
        logOut={logOut}
        isDarkMode={isDarkMode}
        setIsDarkMode={setIsDarkMode}
      />

      <main id="main" tabIndex={-1} className="outline-none flex-grow sheet-grid pt-[76px] pb-[104px]">
        <div className="max-w-container-max mx-auto px-margin-desktop">
          <Eyebrow>{eyebrow}</Eyebrow>

          <h1 className="mt-[22px] font-display-lg text-display-lg md:text-[56px] font-extrabold leading-[1.04] tracking-[-0.038em] text-on-surface">
            {title}
          </h1>
          <p className="mt-4 font-code-sm text-[11px] font-medium leading-[1.62] tracking-[0.12em] uppercase text-[color:var(--ink-faint)]">
            Last updated {UPDATED}
          </p>

          {/* One column, measured for reading rather than stretched to the
              container: legal prose nobody can follow is legal prose nobody
              reads. */}
          <div className="mt-11 max-w-[68ch]">
            {sections.map((section, i) => (
              <section key={section.heading} className={i > 0 ? 'mt-10' : ''}>
                <h2 className="font-display-lg text-[22px] font-extrabold leading-[1.25] tracking-[-0.02em] text-on-surface">
                  {section.heading}
                </h2>
                {section.paragraphs.map((text, j) => (
                  <p
                    key={j}
                    className="mt-3.5 font-body-lg text-[15.5px] leading-[1.65] text-on-surface-variant"
                  >
                    {text}
                  </p>
                ))}
              </section>
            ))}

            <p className="mt-12 font-body-lg text-[13.5px] leading-[1.6] text-[color:var(--ink-faint)]">
              Forma is an independent project and this page is written in plain language rather than by a lawyer.
              It describes what the software actually does; where the law of your country gives you more, the law
              wins.
            </p>
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
