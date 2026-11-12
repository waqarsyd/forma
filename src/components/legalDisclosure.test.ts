/**
 * The privacy policy must name every third party the code actually talks to.
 *
 * `LegalPage.tsx`'s own header says it: *"These describe what the code actually
 * does. Every claim below is checkable against the repository ... a privacy
 * policy that has drifted from the software is worse than none, because it is a
 * promise nobody is keeping."* That was the intent and the code drifted from it
 * anyway — `ContactPage.tsx` gained a `formsubmit.co` POST carrying a visitor's
 * name, email and message, and the policy went on saying Firebase and Gemini
 * were "the only third parties in the path" (audit finding SEC-003 / INV-001).
 *
 * The drift was invisible because the two files have no relationship a compiler
 * or a test could see. This gives them one. It reads both off disk rather than
 * importing the components, the same way `routes.test.ts` reads `index.html` to
 * pin the home title — the claim is about the *source*, so the source is what
 * gets asserted, and no component tree has to render.
 *
 * The rule is deliberately one-directional: **a host appearing in the code
 * obliges a mention in the policy.** A host named in the policy but absent from
 * the code is not a failure here; removing an integration and leaving the
 * disclosure standing is harmless, and forcing them to match exactly would make
 * this test fight every future rewording.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { FIRESTORE_CACHE_PREFIX, SIGNED_OUT_DATABASES, SIGNED_OUT_LOCAL_KEYS, SIGNED_OUT_LOCAL_PREFIXES } from '../lib/signOut';
import { DEFAULT_LEARNING_SETTINGS, MAX_LOCAL } from '../lib/learning';

/** Vitest runs with the repo root as cwd — see the same note in routes.test.ts. */
const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

const legal = read('src/components/LegalPage.tsx');
const contact = read('src/components/ContactPage.tsx');

/**
 * `index.html` with its comments stripped, and that is load-bearing rather than
 * tidy.
 *
 * The probes below are substring checks, so prose counts as a reference. When
 * the typefaces were self-hosted on 2026-08-30 the `<link>` tags went, but the
 * comment left in their place explains what used to be there and names
 * `fonts.googleapis.com` while doing it. A raw read therefore still "found" the
 * host, and this file concluded the app was loading fonts from Google when it
 * had just stopped.
 *
 * Same shape as `scripts/check-encoding.mjs` skipping CLAUDE.md for containing
 * the mojibake signatures it hunts for: a file is allowed to *discuss* a thing
 * without *being* it. Comments are documentation; only live markup is a request.
 */
const indexHtml = read('index.html').replace(/<!--[\s\S]*?-->/g, '');

/**
 * Every third-party host the app reaches, and the name the policy has to use
 * for it. `probe` is where the host appears; `mustName` is what a reader needs
 * to see to know it is involved.
 *
 * Firebase and Gemini were already disclosed and are listed anyway — the point
 * of the table is that it is the *complete* set, so a future addition is a row
 * here rather than something nobody remembers to write down.
 */
const DISCLOSURES: Array<{
  host: string;
  source: string;
  probe: string;
  mustName: RegExp;
}> = [
  {
    host: 'formsubmit.co',
    source: 'src/components/ContactPage.tsx',
    probe: contact,
    mustName: /FormSubmit/i,
  },
  {
    host: 'fonts.googleapis.com',
    source: 'index.html',
    probe: indexHtml,
    mustName: /Google Fonts/i,
  },
  {
    host: 'generativelanguage.googleapis.com',
    source: 'src/components/ContactPage.tsx (via the app)',
    probe: 'generativelanguage.googleapis.com',
    mustName: /Gemini/i,
  },
  // 2026-11-08 (the site audit's batch SE, item 15): the AI a user may choose
  // instead, which the policy did not name for a week after it shipped.
  {
    host: 'openrouter.ai',
    source: 'src/lib/aiProvider.ts',
    probe: read('src/lib/aiProvider.ts'),
    mustName: /OpenRouter/,
  },
  // Dictation: the browser's speech service hears the audio (item 51).
  {
    host: 'SpeechRecognition',
    source: 'src/components/Composer.tsx',
    probe: read('src/components/Composer.tsx'),
    mustName: /speech recognition/i,
  },
];

describe('privacy policy discloses every third party in the path', () => {
  for (const { host, source, probe, mustName } of DISCLOSURES) {
    it(`names the recipient behind ${host}`, () => {
      // Only assert the obligation if the code really does reach that host.
      // Remove the integration and this quietly stops applying, which is the
      // correct behaviour — see the one-directional note above.
      if (!probe.includes(host)) return;

      expect(
        mustName.test(legal),
        `${source} reaches ${host}, so LegalPage.tsx must name the recipient ` +
          `(expected to match ${mustName}). See audit finding SEC-003.`
      ).toBe(true);
    });
  }

  /**
   * The specific sentence that was false. It claimed a closed set of third
   * parties while two more were live, which is worse than an omission: a
   * reader who checks is told there is nothing further to look for.
   */
  it('does not claim a closed set of third parties', () => {
    expect(legal).not.toMatch(/the only third parties/i);
  });

  /**
   * The mirror of the table above, and the case the table cannot see.
   *
   * Those rows are one-directional on purpose: reach a host, name it. That
   * catches an undisclosed recipient and is silent about the opposite -- a
   * recipient named in the policy that the app no longer contacts. It went
   * exactly that way on 2026-08-30: the typefaces were self-hosted, the row for
   * fonts.googleapis.com stopped applying and passed vacuously, and three
   * sentences were left telling every reader that Google sees the IP address of
   * anyone who opens Forma. Overclaiming is its own kind of wrong -- it is a
   * privacy policy describing surveillance that is not happening.
   *
   * Past-tense text is fine and deliberate; the policy says the fonts *used to*
   * come from Google. What must not survive is a present-tense claim.
   */
  it('does not claim fonts still come from Google once they are self-hosted', () => {
    if (indexHtml.includes('fonts.googleapis.com')) return; // still true; nothing to assert

    expect(
      legal,
      'index.html no longer loads fonts from Google, so LegalPage.tsx must not ' +
        'say it does. Past tense is fine; the present tense is a false disclosure.',
    ).not.toMatch(/(pages|page) loads? their typefaces from Google Fonts/i);
    expect(legal).not.toMatch(/typefaces the page loads from Google Fonts/i);
  });

  /**
   * The other false sentence. Signed out, a visitor who uses the contact form
   * sends their name, email and message to FormSubmit, and every visitor's IP
   * reaches Google Fonts on page load.
   */
  it('does not claim nothing leaves the browser when signed out', () => {
    expect(legal).not.toMatch(/nothing about you leaves your browser except/i);
  });

  /**
   * This used to assert the opposite, and the reversal is the interesting part.
   *
   * It required the policy to mention a "database client" connection that opened
   * on page load whether or not you signed in. That was true when it was written,
   * and the reason was not `getFirestore()` running at module scope as the old
   * comment here claimed — it was `testConnection()` in `services/firebase.ts`,
   * which issued a real `getDocFromServer` on every load. Removing it (25b1b0a)
   * removed the connection, and this assertion was left quietly enforcing a
   * disclosure of something the app had stopped doing.
   *
   * Over-disclosure is not harmless. A policy that claims more contact with a
   * third party than actually happens is still wrong, and a reader deciding
   * whether to use the app is being given a worse answer than the truth.
   *
   * Measured signed out, 15 seconds per route, fresh browser profile: **zero**
   * requests leave the origin on `/`, `/privacy` and `/features`. Signed in, with
   * a real session: `securetoken.googleapis.com` to refresh, then a Firestore
   * `channel`. So the claim is now conditional on being signed in, and the
   * assertion is that the unconditional version has not crept back.
   */
  it('does not claim a page-load connection that no longer happens', () => {
    expect(
      legal,
      'Signed out, nothing leaves the origin — verified with the network log. ' +
        'The policy must not describe a database connection opening on load ' +
        'regardless of sign-in state; that stopped being true when ' +
        'testConnection() was removed.'
    ).not.toMatch(/database client|as soon as the page loads/i);
  });

  /**
   * The count in that sentence, checked against reality rather than against a
   * remembered number.
   *
   * This assertion used to be `not.toMatch(/three things/)`, banning the word
   * that had been wrong in 2026-08-27's first correction. That worked until the
   * number legitimately became three: self-hosting the typefaces on 2026-08-30
   * removed a flow, the sentence correctly said "three", and the test failed for
   * saying something true.
   *
   * A count is not a constant, so pin the arithmetic instead. **Two** flows are
   * unconditional as of 2026-09-01 -- the Gemini request the user's own key
   * makes, and the contact form -- and Google Fonts would add a third whenever
   * index.html loads from it. Derive the expected word from that, and the test
   * stays correct in both directions.
   *
   * It was three until `testConnection()` was removed (25b1b0a). That call was
   * the *only* reason Firebase contacted anything on a signed-out page load, so
   * deleting it took a flow out of this sum -- which is exactly the kind of
   * change that silently makes a privacy policy wrong, and exactly why the count
   * is derived here rather than written into the prose and forgotten.
   */
  it('states a count that matches what actually leaves the browser', () => {
    const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six'];
    // Three since 2026-11-06: opening a shared report's link, signed out,
    // reads that report from Firestore (SharedReportPage.tsx). The flow is
    // read off the router, so removing the shared page takes it out again.
    const sharedPage = read('src/lib/routes.ts').includes('export function sharedReportId');
    // Four since 2026-11-08 (the site audit's batch SE, item 51): dictation
    // hands the user's voice to the browser's speech service, which in Chrome
    // and Edge is a server. Read off the composer, so taking the microphone
    // out takes the flow out again.
    const dictation = read('src/components/Composer.tsx').includes('SpeechRecognition');
    const flows = 2 + (sharedPage ? 1 : 0) + (dictation ? 1 : 0) + (indexHtml.includes('fonts.googleapis.com') ? 1 : 0);

    expect(
      legal,
      `${flows} things leave the browser when signed out, so the closed-set ` +
        `sentence must say "${WORDS[flows]}". Change the flows and this number ` +
        `changes with them -- do not edit the expectation to match the prose.`,
    ).toMatch(new RegExp(`${WORDS[flows]} things leave your machine and no others`, 'i'));
  });
});

/** The policy's source on one line, so a sentence the file wraps is still found. */
const policy = legal.replace(/\s+/g, ' ');

/*
 * What this browser stores, held to the code (2026-11-11, the full audit's
 * PS-08 and SA-23). The policy says it lists everything stored, and it had
 * drifted three ways in three days: the batch kept in IndexedDB, the Learning
 * switches, whether keys reach a new tab and when each account's project list
 * was checked were all stored and none was named. So the names are read out
 * of src, every one has to be in this table, and every row's phrase has to be
 * in the policy. A new key fails here until it is both described and listed.
 */
const STORED: Record<string, RegExp> = {
  // Local storage.
  // Moved to IndexedDB on 2026-11-11 (PR-15, lib/projectStore.ts); the old key is
  // read once to move it, and is still where they go in a browser without IndexedDB.
  savedReports: /in local storage, in a browser without it/,
  darkMode: /keeps: the theme;/,
  reportConfig: /the DevExpress version and unit last used/,
  'forma.aiProvider': /the AI you chose, with its server address and model, never a key/,
  'forma:keyAcrossTabs': /whether a new Forma tab may take your keys from one already open/,
  'forma.memory': /your memories and the style of reports you kept/,
  'forma.memoryRetired': /your memories and the style of reports you kept/,
  // The signed-in account's own memory (lib/memory.ts, memoryKey).
  'forma.memory:': /your memories and the style of reports you kept/,
  'forma:learning': /the Learning switches, with which account they belong to/,
  // "Send error reports" (2026-11-12, lib/errorReport.ts), for one account at a time.
  'forma:errorReports': /whether this browser sends error reports, and for which account/,
  'forma:pinnedProjects': /which projects you pinned or archived/,
  'forma:archivedProjects': /which projects you pinned or archived/,
  'forma:indexCheckedAt:': /when each account’s project list was last checked, under that account’s id/,
  libraryCanonical: /which library reports are your house style/,
  houseStyle: /which library reports are your house style, and whether it is used/,
  'forma.csvSafeForSpreadsheets': /whether CSV exports are made safe for spreadsheets/,
  reviewCollapsed: /the workspace’s layout/,
  railExpanded: /the workspace’s layout/,
  'forma:requestsToday': /today’s request counts/,
  'forma:dailyLimits': /the daily limits Google reported/,
  'geminiModel:day': /the models your key can reach, with a short fingerprint of the key rather than the key/,
  announcementsSeenId: /the last announcement you saw/,
  // components/OtherHostNotice.tsx (2026-11-12, owner decision 9): a device preference, kept through a sign-out.
  'forma:otherHostNoticeClosed': /on another of Forma’s addresses, that you dismissed the note pointing to its main one/,
  // Session storage.
  'geminiApiKey:session': /Session storage, which the browser erases when the tab closes, keeps your keys/,
  'openRouterKey:session': /Session storage, which the browser erases when the tab closes, keeps your keys/,
  'forma:drafts': /the unsent text in the box/,
  'forma:draft': /the unsent text in the box/,
  'forma:queue': /any messages waiting in the queue/,
  'forma:openProject': /the open project/,
  'forma:replyChanges': /the changes a reply’s Undo can take back/,
  'geminiModel:session': /the model in use/,
  'geminiModels:session': /the model in use/,
  'forma:staleReloadAt': /when Forma last reloaded itself to load a new version/,
  // The channel a new tab takes the keys through (lib/keyHandoff.ts): not storage, but where they go.
  'forma-keys': /a Forma tab you open while another is open gets them from it, inside this browser/,
  // IndexedDB.
  'forma-projects': /your projects are saved automatically in this browser only, in its IndexedDB/,
  'forma-databases': /the SQL Server layouts you add with any sample rows/,
  'forma-batch': /the last batch you ran — its files and the reports made from them —/,
  'forma-learning': /the last five hundred events Forma may learn from/,
  'forma-library': /IndexedDB keeps the report library/,
};

/** Names the scan finds that are not stored at all, with why. */
const NOT_STORED: Record<string, string> = {
  // keyVault.ts reads it once, only to erase a key an old version kept in plain text.
  customGeminiApiKey: 'read once to erase',
  // App.tsx removes what an old model dropdown stored; nothing writes it.
  selectedAiModel: 'erased only',
  // App.tsx removes the side panel's width, kept until its handle went (WS-39).
  reviewWidth: 'erased only',
  reviewWidthEpoch: 'erased only',
  // lib/designerBridge.ts: the link scheme that starts Forma Designer.
  'forma-repx': 'a link scheme',
  // lib/router.ts: the event a route change dispatches in the page.
  'forma:routechange': 'an event name',
};

/** Every source file under src but the tests, as text. */
const sources = (readdirSync(resolve(process.cwd(), 'src'), { recursive: true }) as string[])
  .map((p) => p.replace(/\\/g, '/'))
  .filter((p) => /\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p) && !p.endsWith('.d.ts'))
  .map((p) => ({ path: p, text: read(`src/${p}`) }));

/**
 * The names this browser keeps things under, read out of the code: a constant
 * named for a key, a setting or a database; a literal handed to a storage
 * call, on `localStorage`, `sessionStorage` or a storage passed in (a
 * template's fixed start, for a key per account); and any constant spelling
 * Forma's own prefix.
 *
 * What it cannot find is a key built only inside a helper and never spelled
 * at a storage call or in a constant: `memoryKey` builds `forma.memory:<uid>`
 * that way, and it is found only because lib/signOut.ts removes it by its
 * spelling. A new per-account key needs the same, or a row added by hand.
 */
function storedNames(): Map<string, string> {
  const found = new Map<string, string>();
  const add = (name: string, path: string) => {
    if (/^https?:/.test(name)) return; // a URL, not a key
    if (!found.has(name)) found.set(name, path);
  };
  for (const { path, text } of sources) {
    for (const m of text.matchAll(/\bconst\s+([A-Z][A-Z0-9_]*)\s*=\s*(['"])([^'"\n]+)\2/g)) {
      if (/SITE_KEY/.test(m[1])) continue; // App Check's public site key: a value, not a name
      if (/KEY|SETTING|_DB$|DB_NAME$/.test(m[1])) add(m[3], path);
    }
    for (const m of text.matchAll(/\b\w*[sS]torage\??\.(?:getItem|setItem|removeItem)\(\s*(['"`])([^'"`$\n]+)/g)) add(m[2], path);
    for (const m of text.matchAll(/\bconst\s+\w+\s*=\s*(['"])(forma[.:-][^'"\n]*)\1/g)) add(m[2], path);
  }
  return found;
}

describe('the privacy policy names everything this browser stores', () => {
  const found = storedNames();

  it('finds the names it is meant to find, so a scan that stopped matching cannot pass empty', () => {
    for (const name of ['forma-batch', 'forma:learning', 'forma:keyAcrossTabs', 'forma:indexCheckedAt:', 'forma.memory:', 'geminiApiKey:session']) {
      expect(found.has(name), name).toBe(true);
    }
  });

  it('describes every name the code stores under', () => {
    const missing = [...found].filter(([name]) => !(name in STORED) && !(name in NOT_STORED)).map(([name, path]) => `${name} (src/${path})`);
    expect(
      missing,
      'These are stored by the code and not described: add a phrase for each to the privacy policy ' +
        '(LegalPage.tsx, "What is kept in your browser") and a row to STORED here.',
    ).toEqual([]);
  });

  it.each(Object.entries(STORED))('says what %s holds', (_name, phrase) => {
    expect(policy).toMatch(phrase);
  });

  it('names every database a sign-out deletes', () => {
    for (const name of SIGNED_OUT_DATABASES) expect(STORED[name], name).toBeTruthy();
  });

  // Not named by a constant the scan reads: Firestore's cache is matched by
  // prefix (lib/signOut.ts) and the offline worker's by build (lib/serviceWorker.ts).
  it("names Firestore's copy of the projects and the offline copy of the site", () => {
    if (read('src/lib/firebaseClient.ts').includes('persistentLocalCache(')) {
      expect(policy).toMatch(/a copy of your saved projects, so a change made offline is not lost/);
    }
    if (read('src/lib/serviceWorker.ts').includes('caches.open(')) {
      expect(policy).toMatch(/a copy of Forma’s own pages and files, so it opens without a connection; it holds nothing of yours/);
    }
  });
});

/*
 * What deleting an account leaves (2026-11-11, the full audit's BW2): on a day
 * a learning event was sent, `users/{uid}/meta/usage` keeps its counts and
 * loses its ids (lib/accountData.ts, firestore.rules). Settings → Learning and
 * the policy say it in the same sentence, so one cannot drift from the other.
 */
describe('the policy and Settings → Learning say what account deletion leaves', () => {
  it('says the same sentence in both, and the code still leaves exactly that', () => {
    const sentence = read('src/components/LearningSettings.tsx').match(/export const COUNT_LEFT = '([^']+)'/)?.[1];
    expect(sentence).toBeTruthy();
    const at = policy.indexOf('Account settings in the workspace has a Delete account action');
    expect(at).toBeGreaterThan(0);
    expect(policy.slice(at)).toContain(sentence!);
    // Still true: the ids go first, then the counts are deleted only where the rules allow.
    const account = read('src/lib/accountData.ts');
    expect(account).toMatch(/updateDoc\(usageDocRef\(db, uid\), \{ report: deleteField\(\), event: deleteField\(\), error: deleteField\(\) \}\)/);
    expect(read('firestore.rules')).toMatch(/resource\.data\.get\('eventDay', ''\) != serverDay\(\)/);
    expect(read('firestore.rules')).toMatch(/resource\.data\.get\('errorDay', ''\) != serverDay\(\)/);
  });
});

/*
 * Error reports, held to lib/errorReport.ts, lib/accountData.ts and the rules
 * (2026-11-12, Owner decision 10, the full audit's SA-15): off until turned
 * on, what a note holds and how long its message may be, the day's cap, and
 * that the owner's pull deletes what it saves.
 */
describe('the policy says of error reports what the code does', () => {
  const WORDS: Record<number, string> = { 10: 'ten', 20: 'twenty', 50: 'fifty' };

  it('says they are off until turned on, as the switch reads it', () => {
    const source = read('src/lib/errorReport.ts');
    expect(source).toMatch(/return !!kept && kept\.uid === uid && kept\.on === true;/);
    expect(policy).toMatch(/Error reports are sent only if you turn them on, in Settings → General/);
    expect(policy).toMatch(/only if you turn on “Send error reports” in Settings → General, which is off unless you turn it on/);
  });

  it('gives the message length and the day cap the code and the rules hold', () => {
    const max = Number(/export const MAX_MESSAGE = (\d+);/.exec(read('src/lib/errorReport.ts'))?.[1]);
    expect(policy).toContain(`cut to ${max} characters`);
    expect(read('firestore.rules')).toContain(`data.message.size() <= ${max}`);
    const day = Number(/export const MAX_ERRORS_A_DAY = (\d+);/.exec(read('src/lib/accountData.ts'))?.[1]);
    expect(WORDS[day], `MAX_ERRORS_A_DAY is ${day}: add its word here and in the policy`).toBeTruthy();
    expect(policy).toContain(`it cannot send more than ${WORDS[day]} a day`);
    expect(read('firestore.rules')).toContain(`after.errors <= ${day}`);
  });

  it('says the operator\'s download deletes them, while scripts/admin/pull-errors.ts does', () => {
    const pull = read('scripts/admin/pull-errors.ts');
    expect(pull).toMatch(/method: 'DELETE'/);
    expect(policy).toMatch(/the operator downloads them to find what broke, which deletes them from the database/);
    expect(policy).toMatch(/An error report stays in Forma’s database until the operator downloads it, which deletes it there/);
  });
});

describe('the policy says what a sign-out clears, as lib/signOut.ts clears it', () => {
  const start = policy.indexOf('Signing out clears the workspace');
  const said = policy.slice(start, policy.indexOf("',", start));
  const PHRASE: Record<string, string> = {
    'forma-databases': 'the database layouts',
    'forma-batch': 'the last batch',
    'forma-learning': 'the events kept for learning',
    'forma-library': 'the report library',
    'forma:pinnedProjects': 'which projects you pinned or archived',
    'forma:archivedProjects': 'which projects you pinned or archived',
    libraryCanonical: 'which library reports were your house style',
    'forma:indexCheckedAt:': 'when each account’s project list was last checked',
    [FIRESTORE_CACHE_PREFIX]: 'the copy of your saved projects',
  };

  it.each([...SIGNED_OUT_DATABASES, ...SIGNED_OUT_LOCAL_KEYS, ...SIGNED_OUT_LOCAL_PREFIXES, FIRESTORE_CACHE_PREFIX])('names %s', (name) => {
    expect(start).toBeGreaterThan(0);
    expect(PHRASE[name], `add a phrase for ${name}, which a sign-out now removes`).toBeTruthy();
    expect(said).toContain(PHRASE[name]);
  });
});

/*
 * Learning, held to lib/learning.ts and scripts/model/pull-learning.ts
 * (2026-11-11, the full audit's LM-27b, LM-03 and SE-10, D6). The policy
 * states numbers, defaults and a deletion promise that the code decides.
 */
describe('the policy says of learning what the code does', () => {
  const learning = read('src/lib/learning.ts');

  it('gives the number of events kept on the device', () => {
    const WORDS: Record<number, string> = { 100: 'one hundred', 200: 'two hundred', 250: 'two hundred and fifty', 500: 'five hundred', 1000: 'one thousand' };
    expect(WORDS[MAX_LOCAL], `MAX_LOCAL is ${MAX_LOCAL}: add its words here and in the policy`).toBeTruthy();
    expect(policy).toContain(`the last ${WORDS[MAX_LOCAL]} events Forma may learn from`);
  });

  it('says which switch is on until turned off and which is off until turned on', () => {
    expect(DEFAULT_LEARNING_SETTINGS).toEqual({ structure: true, full: false });
    expect(policy).toMatch(/“Help Forma learn from the shape of my reports” on, which it is unless you turn it off/);
    expect(policy).toMatch(/“Share whole reports and what I asked for” on, which it is not unless you turn it on/);
    expect(policy).toMatch(/Unless you turn it off, the shape of your reports \(never their text\) is kept/);
  });

  it('says what deleting reaches, while the pull removes the copies of what was deleted', () => {
    const pull = read('scripts/model/pull-learning.ts');
    const reconciles = /Deletion reaches these copies/.test(pull) && /applyReconcile\(/.test(pull);
    const promise = /Copies the operator already downloaded for training are deleted at the next download after yours are gone/;
    if (reconciles) {
      expect(policy).toMatch(promise);
      expect(policy).toMatch(/Deleting it there, or deleting your account, removes it from Forma’s database/);
    } else {
      expect(policy, 'pull-learning.ts no longer removes deleted events: the policy must stop promising it').not.toMatch(promise);
    }
    expect(policy).not.toMatch(/deleting your account removes it\./);
  });

  it('names what learning is for, and does not say the account is kept for nothing else', () => {
    expect(policy).toMatch(/kept to train Forma’s own model and improve how it reads and lays out reports; it is on unless you turn it off/);
    expect(policy).not.toMatch(/the service you asked for, and for nothing else/);
  });

  // One-directional, as the hosts above: a signal the code records obliges the
  // sentence. The policy may say it before the code does (batch LRN adds it in
  // the same wave), never after.
  // The page pair (2026-11-12, Owner decision 20, D10): what a kept event carries obliges the sentence.
  it('says the positions of the text on a page sent are kept, never the text, once a kept event carries them', () => {
    expect(learning).toMatch(/\n\s+boxes: string;/);
    expect(policy).toMatch(/the positions of the text on a page you send, never the text/);
    expect(policy).toMatch(/Those positions wait in this browser until you keep that report, and go with it/);
    const WORDS: Record<number, string> = { 10: 'ten', 20: 'twenty', 50: 'fifty' };
    const max = Number(/export const MAX_READINGS = (\d+);/.exec(learning)?.[1]);
    expect(WORDS[max], `MAX_READINGS is ${max}: add its word here and in the policy`).toBeTruthy();
    expect(policy).toContain(`with the positions of the text on the last ${WORDS[max]} pages you sent`);
  });

  it('says the kept and undone reports and the time each took once events record them', () => {
    if (/'kept'|'undo'/.test(learning.slice(learning.indexOf('export type LearningKind'), learning.indexOf(';', learning.indexOf('export type LearningKind')))) || /\n\s+ms\??:\s*number/.test(learning)) {
      expect(policy).toMatch(/Forma also keeps which reports you kept or undid and how long each took, never their words/);
    }
  });
});

/*
 * The learning loop and Forma Designer, held to the code (2026-11-11, the
 * re-audit's R4-01 and R4-02). The policy said the library was there "only
 * because you turned it on" and that 127.0.0.1 was asked "only then", when
 * Open in designer was chosen; LRN2 made kept reports join the library on
 * their own and go, stripped, with a first report, and CC-10 hands each new
 * report to a Forma Designer that has answered. One-directional like the rest
 * of this file: what the code does obliges the sentence.
 *
 * Unlike the older cases above, these assert the code's shape directly rather
 * than behind an `if (/regex/.test(source))` (the review of 2026-11-11): a
 * guard turns a reworded source into a silent pass, and the point of each case
 * is to fail when the code stops matching what the policy says of it.
 */
describe('the policy says what kept reports and Forma Designer are used for', () => {
  const source = (path: string) => read(path);
  const WORDS: Record<number, string> = { 10: 'ten', 20: 'twenty', 30: 'thirty', 50: 'fifty' };

  it('says the style of kept reports is learned unless turned off, as lib/memory.ts defaults it', () => {
    expect(source('src/lib/memory.ts')).toMatch(/const EMPTY: MemoryState = \{[^}]*learnFromKept: true/);
    expect(policy).toMatch(/Learning the style of the reports you keep \(Settings → Memory\) is on unless you turn it off/);
    expect(policy).not.toMatch(/memories, the library, sharing, dictation — is there only because you turned it on/);
  });

  it('names the kept reports in the library, as many as services/library.ts keeps', () => {
    const max = Number(/export const MAX_KEPT_REPORTS = (\d+);/.exec(source('src/services/library.ts'))?.[1]);
    expect(WORDS[max], `MAX_KEPT_REPORTS is ${max}: add its word here and in the policy`).toBeTruthy();
    expect(policy).toContain(`the newest ${WORDS[max]} reports you kept, stripped the same way`);
  });

  it('says a kept report goes with a first report to the AI, once lib/learningLoop.ts sends one', () => {
    expect(source('src/lib/learningLoop.ts')).toContain('keptExampleBlock(');
    expect(policy).toMatch(/the parts of the kept report most like it go too, with every text, name, field, data source, expression and link in them replaced/);
  });

  it('names the count of changes behind "Learned from your changes", never their words', () => {
    expect(source('src/lib/memory.ts')).toMatch(/ledger\?: Correction\[\]/);
    expect(policy).toMatch(/with what you changed in the reports Forma made, as the kind of change and the value you gave it, never a word of the report/);
  });

  /*
   * The trigger is /health answering, not a report opening: askDesigner sets
   * both flags designerAnswered() reads before /open is sent, and whether or
   * not it succeeds (the review of 2026-11-11 caught "has opened a report").
   */
  it('says each new report goes to Forma Designer once it has answered, and never "only then"', () => {
    const bridge = source('src/lib/designerBridge.ts');
    expect(bridge).toMatch(/post\('\/inspect'/);
    expect(bridge).toMatch(/answered = true;\s*\n\s*inspects = health\.inspects === true;/);
    expect(policy).toMatch(/once it has answered in a tab, whether or not that report then opened, so does each new report you make in that tab, with the records read off your page/);
    expect(policy).toMatch(/Once Forma Designer has answered in a tab — which it does when you choose Open in designer while it is running, whether or not the report then opens — the workspace in that tab also hands it each new report you make, with the records read off your page/);
    expect(policy).not.toMatch(/Open in designer, and only then/);
    expect(policy).not.toMatch(/has opened a report in a tab|once it has opened one/);
    expect(policy).not.toMatch(/nothing on the page reaches your computer that way/);
  });
});

/**
 * The "Last updated" date must move when the words above it do.
 *
 * This is not a tidiness rule. The Terms' own *Changes* clause says **"The date
 * at the top is when they last did"** and anchors acceptance to it — "continuing
 * to use Forma after a change means you accept the current version". So the date
 * is a factual claim the document makes about itself, and a stale one is the
 * document lying in the single place a reader checks to see whether it is worth
 * re-reading.
 *
 * It had already gone stale before this test existed, which is why the test
 * exists: `UPDATED` said 27 August 2026 while the copy underneath it described
 * the typefaces moving off Google Fonts on 30 August 2026. Three days, on a site
 * that had not launched yet — the failure mode is not carelessness over years,
 * it is one edit that forgets a constant fifty lines away.
 *
 * Nothing here checks the date is *correct*, because nothing can: only a person
 * knows whether an edit was substantive. What it checks is that the two changed
 * **together**, which is the part a human reliably forgets.
 *
 * ## When this fails
 *
 * You edited TERMS or PRIVACY. Do both of these, in this order:
 *
 *   1. Set `UPDATED` in `LegalPage.tsx` to the date you are making the change.
 *   2. Put the hash from the failure message into `EXPECTED_COPY_HASH` below.
 *
 * Doing (2) alone makes this test green and the date wrong, which is precisely
 * the bug it is here to catch. If the edit genuinely was not substantive — a
 * typo, a reflow — updating only the hash is defensible, but that is a decision,
 * and it should be visible in the diff rather than automatic.
 */
describe('the legal copy and its date change together', () => {
  /** Whitespace-collapsed so reformatting alone does not trip it. */
  const legalCopy = () => {
    const start = legal.indexOf('const TERMS: Section[] = [');
    const end = legal.indexOf('const DOCS = {');
    expect(
      start >= 0 && end > start,
      'Could not find the TERMS…DOCS block in LegalPage.tsx. If those markers ' +
        'were renamed, update them here — do not delete this test.'
    ).toBe(true);
    return legal.slice(start, end).replace(/\s+/g, ' ').trim();
  };

  /* Moved together on 2026-09-01, when "Who else is involved" and the closed-set
     sentence were corrected — the first real use of this guard, and it caught
     the edit before the date was stale rather than after. Bumped again the same
     day for the loopback designer probe, which is why the date does not move a
     second time: same day, same version of the document.

     Moved again on 2026-09-08, and this guard earned its keep a second time by
     failing the moment the copy changed. The terms told visitors the "Open in
     designer" button stays hidden when the companion is not installed; it is
     always drawn, and has been since the `forma-repx://` launch path was added
     — the probe decides what a click does, not whether the button exists. The
     deletion note also knew only about removing projects one at a time, not
     about Clear all. Both substantive, so the date moved with them.

     Moved again on 2026-11-06 for sharing: a shared copy is stored and
     readable by others, opening a shared link signed out reaches the
     database (the closed set went from two to three), and deleting a project
     or an account removes its shares. Substantive, so the date moved.

     Moved again on 2026-11-08 (the site audit's batch SE): both documents
     rewritten from an inventory of the code's storage and outbound calls
     (OpenRouter, a local AI, dictation, autosave, memory, the library, the
     host's logs, the closed set going from three to four), with who runs
     Forma, the rights, retention, cookies, the age and the trademark notice,
     and the accessibility statement added to the same block. The same day
     batch SF added the skip link and the contrast to that statement, which
     moves the hash and not the date. So did batch SH's reCAPTCHA paragraph,
     which the policy shows only once App Check has a key (lib/appCheck.ts):
     the words a reader sees today did not change. Batch SI changed them the
     same day (the key reaching a new tab, the request to keep local
     projects, the download of every project), which is substantive, but
     the date is already that day's. The governing-law clause the owner chose
     (the laws of India) joined the terms the same day: substantive, and
     again already that day's date. So did the box's house style switch the
     same day, which local storage keeps and the policy now names.

     Moved again on 2026-11-09 for the SQL Server programme (checklist item
     32): a shared database's names and sample values go to the AI only when
     the user shares it, no connection string, login or password is ever
     asked for, stored or sent, the layouts kept in IndexedDB are named, and
     signing out now deletes them (lib/signOut.ts, forgetDevice).
     Substantive, so the date moved. Phase 2 the same day added what the
     companion reads from a SQL Server on the user's own computer to the
     paragraph on 127.0.0.1: substantive, and already that day's date. The
     Forma Designer download the same day (batch WH): the workspace asks
     127.0.0.1 only when Open in designer is chosen, the website too after the
     browser asks, the download from GitHub, and DevExpress named as Developer
     Express Inc.'s product, not Forma's. Substantive, and that day's date.

     Moved again on 2026-11-10 (the full audit, batch FD): what a person lets
     Forma learn from (Settings > Learning, lib/learning.ts) is a new thing
     stored under the account and on the device, with two switches and the
     operator's use of it, so the policy says so in its own paragraph and
     the IndexedDB list names the store. Substantive, so the date moved.

     Moved again on 2026-11-11 (the full audit's batch LG, the wording the
     owner approved as Owner decision 4): learning's purpose and its default
     in the short version and in "Why it is used", what deletion reaches and
     what it cannot, every name this browser stores and what a sign-out
     clears, reCAPTCHA among the scripts and its cookies, the passphrase's
     condition, and no single host as the one that asks to reach the PC.
     Substantive, so the date moved. Its review the same day made that
     browser's question one it "may" ask, since only some browsers ask: the
     hash moved, and the date is already that day's.

     Moved again the same day (batch BW2): projects saved signed out are kept
     in IndexedDB, local storage only where a browser has none, and a
     sign-out leaves them; and what deleting an account leaves of learning,
     a day's count with no ids. Substantive, and already that day's date.

     Moved again the same day (the re-audit's batch FIX2D, R4-01 and R4-02):
     a kept report joins the library on its own and goes, stripped, with a
     first report to the AI; learning the style of kept reports is on unless
     turned off; what a person changes in Forma's reports is counted, never
     its words; and after one Open in designer each new report in that tab
     goes to Forma Designer on the computer. Substantive, and already that
     day's date. Its review the same day corrected the trigger: Forma
     Designer gets each new report once it has answered in a tab, whether or
     not the report then opened, not once it has opened one; and "nothing on
     the page reaches your computer" became "nothing asks Forma Designer
     anything", naming the SQL Server reading on a self-run Forma. The hash
     moved, and the date is already that day's.

     Moved again on 2026-11-12 (the owner's decision 9 of the 2026-11-11
     audit): local storage keeps, on another of Forma's addresses, that the
     note pointing to its main one was dismissed
     (components/OtherHostNotice.tsx). A new thing stored, so the date moved.
     The same day (owner decision 3), a database's names also go when the
     person says yes to the Data view's question before SQL is written from a
     sentence: substantive, and already that day's date. And the same day
     (Owner decision 10, the full audit's SA-15): error reports, off until
     "Send error reports" is turned on, what a note holds and what is taken
     out of it first, that the operator's download deletes it from the
     database, the local storage key that keeps the switch, and what account
     deletion leaves of their count. Substantive, and already that day's date.

     Moved again the same day (Owner decision 20, the full audit's D10): the
     positions of the text on a page sent, never the text, kept in the
     browser until the report made from it is kept and sent with it to teach
     Forma to tell a page's parts apart, and the last twenty pages' positions
     named among what IndexedDB keeps. Substantive, and already that day's
     date.
     */
  const EXPECTED_COPY_HASH = '1d793ce2bc19';
  const EXPECTED_UPDATED = '12 November 2026';

  it('has not changed the terms or policy without moving the date', () => {
    const actual = createHash('sha256').update(legalCopy()).digest('hex').slice(0, 12);
    const declared = legal.match(/const UPDATED = '([^']+)'/)?.[1];

    if (actual !== EXPECTED_COPY_HASH) {
      expect.fail(
        `The terms or privacy copy changed (hash ${EXPECTED_COPY_HASH} -> ${actual}).\n` +
          `"Last updated" currently reads ${declared}.\n` +
          `Set UPDATED in LegalPage.tsx to today's date, then set ` +
          `EXPECTED_COPY_HASH here to ${actual}.`
      );
    }

    expect(
      declared,
      'UPDATED changed but the copy did not. If that is deliberate, move ' +
        'EXPECTED_UPDATED here to match; if not, put the date back.'
    ).toBe(EXPECTED_UPDATED);
  });
});
