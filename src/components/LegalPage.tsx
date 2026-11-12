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
 *
 * 2026-11-11 (the full audit's batch LG, approved by the owner as Owner
 * decision 4): the policy promised a purpose ("for nothing else") and an
 * opt-in ("only because you turned it on") that the default-on learning does
 * not follow, and said deleting an account removed what the operator had
 * already downloaded. It now says what learning is for, that it is on unless
 * turned off, what deletion reaches and what it cannot, every name this
 * browser stores (legalDisclosure.test.ts reads them out of src), reCAPTCHA
 * among the scripts, and no single host as the one that asks to reach the PC.
 *
 * The same day (the re-audit's R4-01 and R4-02): the policy said the library
 * was there "only because you turned it on" and that 127.0.0.1 was asked
 * "only then", when Open in designer was chosen. Since LRN2 a kept report
 * joins the library on its own, with "Learn the style of reports I keep" on
 * by default, and goes, stripped, with a first report to the AI; the changes
 * a person makes to Forma's reports are counted; and since CC-10 each new
 * report goes to a Forma Designer that has answered in the tab. Each is said
 * where a reader looks for it, and legalDisclosure.test.ts holds them to the
 * code (lib/memory.ts, services/library.ts, lib/designerBridge.ts).
 *
 * 2026-11-12 (Owner decision 10, the full audit's SA-15): error reports, sent
 * only once "Send error reports" is turned on, what a report holds and what is
 * taken out of it, who reads it and when it is deleted, and what account
 * deletion leaves of their count (lib/errorReport.ts). The same day (Owner
 * decision 20, the full audit's D10): the positions of the text on a page
 * sent, never the text, kept with the report kept from it to teach the box
 * reader (lib/readerPairs.ts), and the last twenty pages' kept in IndexedDB.
 */
const UPDATED = '12 November 2026';

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
      'One thing the workspace does that is worth stating plainly: when you choose Open in designer it asks 127.0.0.1 — your machine, not the internet — whether the optional Forma Designer app is running there, and your browser may ask the first time whether this site may reach apps on your device. Until you choose it, nothing on the page asks Forma Designer anything, unless you run Forma on your own computer and ask it to read your SQL Server, as the privacy policy describes. The check sends nothing about you or your work, and if you have not installed Forma Designer it simply fails.',
      'What that check decides is what Open in designer does next. If Forma Designer is running, the report is handed straight to it, on your computer. If nothing answers, the workspace asks Windows to start it — which your browser asks you to allow the first time — and if it is not installed, says so and links its download page. Once Forma Designer has answered in a tab — which it does when you choose Open in designer while it is running, whether or not the report then opens — the workspace in that tab also hands it each new report you make, with the records read off your page, if your copy of Forma Designer can take them, to ask how DevExpress loads and prints it; that too stays on your computer. Forma Designer is a free, open-source Windows program, offered on that page as a file on GitHub. It uses DevExpress Reporting, which is not part of Forma or of the download: DevExpress is a commercial product of Developer Express Inc., licensed by them, and Forma only links their trial. Exporting the .repx works regardless, and never involves any of this.',
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
      // reCAPTCHA is named only once App Check has a key, as below (lib/appCheck.ts).
      `Forma is run by Waqar Sayyed, who is responsible for what this policy describes. It collects as little as it can. There are no analytics or advertising trackers, no tracking pixels, no third-party scripts beyond Google’s sign-in helper${APP_CHECK_SITE_KEY ? ' and, once you sign in or open a shared report, Google’s reCAPTCHA' : ''}, and no cookies of Forma’s. Unless you turn it off, the shape of your reports (never their text) is kept to train Forma’s own model; see Settings → Learning. Error reports are sent only if you turn them on, in Settings → General. Nothing is sold or shared with anyone for marketing.`,
      'Opening any page asks Forma’s host for it, as every website does. The host is Firebase Hosting, run by Google, which keeps the ordinary request logs a web host keeps — your IP address, the address asked for and your browser — for as long as Google keeps them. Forma itself keeps no record of visitors.',
      'Beyond the host, signed out, four things leave your machine and no others: what you ask the AI you chose to do, sent to Google with your own Gemini key or to OpenRouter with yours (a local AI stays on your computer); only if you use the contact form, the message you type into it; only if you open a link to a report someone shared, a request to Google’s database for that report; and only if you dictate a message, your voice, to your browser’s speech service. Who receives each of those is set out under “Who else is involved” below.',
      'Your machine, not your browser, is the boundary that sentence draws, and the difference is deliberate. When you choose Open in designer, the workspace asks 127.0.0.1 whether the optional Forma Designer app is running — a request that leaves the browser and reaches nothing but your own computer, and that nothing on the page makes before you choose it. It carries no information about you; the report you asked to open goes to Forma Designer on your computer and nowhere else, and once it has answered in a tab, whether or not that report then opened, so does each new report you make in that tab, with the records read off your page, for DevExpress to say how it loads and prints them; and the terms describe it under “What Forma is”. Forma Designer itself is downloaded from GitHub, under GitHub’s own privacy statement. If you run Forma on your own computer and ask Forma Designer to read your SQL Server, it reads it there with the connection you gave Forma Designer, and what it reads comes back to this browser and goes nowhere else unless you share the database with the AI.',
    ],
  },
  {
    heading: 'What the AI providers do with your requests',
    paragraphs: [
      'Your browser sends your files, your words and the report straight to the AI you chose, and that provider’s terms decide what happens to them next. Forma’s own server is never in the path. When you ask for a first report while “Learn the style of reports I keep” and the box’s house style are on, the parts of the kept report most like it go too, with every text, name, field, data source, expression and link in them replaced, as formatting to follow.',
      'Your SQL Server database: its table, view, procedure and column names, and up to three sample values a column, go with your requests only if you share it with the AI, by attaching its layout in the chat or with “Send names and sample values to the AI” on the Data view, which also turns it off, or, for SQL written from a sentence there, by saying yes when Forma asks first. Otherwise none of it is sent. Forma never asks for, stores or sends a connection string, a login or a password: a report names its connection, and your application supplies it.',
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
      'If you opt in to encrypted sync, an encrypted copy of your Gemini API key. It is encrypted in your browser with a passphrase that never leaves it, so the stored copy is unreadable without your passphrase, to the operator as to anyone else — so choose one nobody could guess. It is the one thing Forma stores that the operator cannot read.',
      'What you let Forma learn from, under Settings → Learning. With “Help Forma learn from the shape of my reports” on, which it is unless you turn it off, each report you make or change in the chat, each translation and each rating of a reply is kept as an event: the report’s structure — its bands, where each control sits, its size, font, alignment and what kind of text it holds — never the text itself, a field name, a query or a picture; the kind of request and which kind of AI answered; the names of the edits; and your rating. With it on, Forma also keeps which reports you kept or undid and how long each took, never their words; and the positions of the text on a page you send, never the text: where each piece of text sits on the picture or PDF page, how long it is and whether it reads as a word, a figure or a date, and, once you keep the report made from it, which part of the report each piece ended in. Those positions wait in this browser until you keep that report, and go with it, to teach Forma to tell the parts of a page apart. With “Share whole reports and what I asked for” on, which it is not unless you turn it on, the complete report file and the words you typed go with each event. Signed in, the events are stored in Google Firestore under your account, where only you and the operator can read them; the operator downloads them to train Forma’s own model and improve how it reads and lays out reports. You can see what was kept and delete it under Settings → Learning. Deleting it there, or deleting your account, removes it from Forma’s database. Copies the operator already downloaded for training are deleted at the next download after yours are gone; what a trained model learned from them is averages over many reports and holds none of your text. Signed out, the events stay on your device only.',
      'Error reports, only if you turn on “Send error reports” in Settings → General, which is off unless you turn it on. When part of Forma stops working, your browser sends a short note of it: the day, the version of Forma, which part failed, the kind of error, and the error’s message cut to 200 characters, with keys, email addresses, links beyond their site, file names and paths, quoted text and long numbers taken out first. The note does not name you or your account and holds nothing of your reports or your words; your account keeps only how many it sent that day, when the last one went and its id, so that it cannot send more than twenty a day. The notes are stored in Google Firestore, where no one but the operator can read them; the operator downloads them to find what broke, which deletes them from the database.',
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
      'Signed out, your projects are saved automatically in this browser only, in its IndexedDB (in local storage, in a browser without it) — the conversation, the report, your attachments and your ratings — and Forma asks the browser to keep them rather than clear them to free space. Signing out does not remove them: they are the projects of whoever uses Forma here without signing in. Revisions last only while the tab is open. Settings, under General, has Download everything (.zip): every project you saved and what else Forma keeps for you, signed in or not.',
      'Local storage keeps: the theme; the DevExpress version and unit last used; the AI you chose, with its server address and model, never a key; whether a new Forma tab may take your keys from one already open; your memories and the style of reports you kept, with what you changed in the reports Forma made, as the kind of change and the value you gave it, never a word of the report; the Learning switches, with which account they belong to; whether this browser sends error reports, and for which account; which projects you pinned or archived; when each account’s project list was last checked, under that account’s id; which library reports are your house style, and whether it is used; whether CSV exports are made safe for spreadsheets; the workspace’s layout; today’s request counts and the daily limits Google reported; the models your key can reach, with a short fingerprint of the key rather than the key; the last announcement you saw; and, on another of Forma’s addresses, that you dismissed the note pointing to its main one.',
      'Session storage, which the browser erases when the tab closes, keeps your keys, the unsent text in the box and any messages waiting in the queue, the open project, the changes a reply’s Undo can take back, the model in use, and when Forma last reloaded itself to load a new version.',
      'IndexedDB keeps the report library — the stripped reports you add and their index, and the newest twenty reports you kept, stripped the same way —, the SQL Server layouts you add with any sample rows, up to five databases, until you forget them on the Data view or sign out, the last batch you ran — its files and the reports made from them — until you clear it or sign out, the last five hundred events Forma may learn from (Settings → Learning, above) with the positions of the text on the last twenty pages you sent, and, once you sign in, Firebase’s record that you are signed in and a copy of your saved projects, so a change made offline is not lost.',
      'The browser’s cache also keeps a copy of Forma’s own pages and files, so it opens without a connection; it holds nothing of yours.',
      'None of this is a cookie, nothing but Forma in this browser reads it, and all of it is there only to make Forma work, which is why there is no cookie banner. Clearing your browser storage removes it. Signing out clears the workspace — the uploads, the extracted text and the generated report — and deletes from this browser the database layouts, the last batch, the events kept for learning, the report library, the copy of your saved projects, which projects you pinned or archived, which library reports were your house style and when each account’s project list was last checked, so the next person at that browser does not see your work. Your memories stay, kept under your account, for you to find when you sign back in.',
    ],
  },
  {
    heading: 'Who else is involved',
    paragraphs: [
      'Google Firebase hosts the site, runs sign-in and holds the database. Google Gemini answers the requests you make with your key. Signed out, the database is reached only through a link to a shared report. Once you are signed in, your browser does talk to Google on every load, first to check your session is still valid and then to fetch your saved projects, and it holds a connection open so changes to them arrive as they happen.',
      'OpenRouter answers your requests only if you chose it under Settings → AI, with your own key.',
      // Said only once App Check is on (lib/appCheck.ts, site audit item 56).
      ...(APP_CHECK_SITE_KEY
        ? ['Google reCAPTCHA checks that requests to the database come from this site, through Firebase App Check. It runs only when the database is used — once you are signed in, or when you open a shared report — and Google sees your browser and the page while it does, and may set its own cookies on google.com.']
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
      'Your account and projects stay until you delete them, or the account. A shared copy stays until you stop sharing it or delete its project or your account. Revisions are the newest ten of each project, and go with it. What Forma learned from your use stays until you delete it under Settings → Learning, or the account; the copies the operator downloaded for training go at the next download after that. An error report stays in Forma’s database until the operator downloads it, which deletes it there, and on the operator’s computer only as long as it takes to fix what it shows. A contact message stays in the maintainer’s inbox only as long as it takes to answer it. The host’s request logs last as long as Google keeps them.',
    ],
  },
  {
    heading: 'Why it is used',
    paragraphs: [
      'Your account, projects and shares are kept to give you the service you asked for. What Forma learns from your use (Settings → Learning) is kept to train Forma’s own model and improve how it reads and lays out reports; it is on unless you turn it off, and it never holds your words or pictures unless you turn on the second switch. Error reports, if you turn them on, are used only to find and fix what broke. A contact message is used only to answer it. Learning the style of the reports you keep (Settings → Memory) is on unless you turn it off: a report you export, save or open in the designer is kept in this browser, with what you changed in Forma’s reports, and used only to make your next reports look like yours. Everything else optional — the encrypted key, the memories you ask for, the reports you add to the library, sharing, dictation — is there only because you turned it on, and you can turn it off.',
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
      'Account settings in the workspace has a Delete account action. It removes your saved projects with their revisions, every report you shared, what you let Forma learn from and the encrypted copy of your key along with the account itself, from Forma’s database. Copies the operator already downloaded for training are deleted at the next download after yours are gone; what a trained model learned from them is averages over many reports and holds none of your text. If you delete your account on a day you sent something to learn from or an error report, a count stays under the deleted account: no projects, how many of each were sent that day and when the last one was, and no ids. Error reports are not removed with it, since nothing in them says whose they are. It cannot be undone.',
      'Individual projects can be deleted from Saved projects, one at a time or all at once with Clear all, which asks you to confirm first. Deleting a project also stops sharing it, and Stop sharing in the Share dialog removes the shared copy on its own. Settings → Memory forgets your memories and kept reports, Settings → Learning deletes what Forma learned from your use, and the Report library removes a report from this browser.',
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
