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
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

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
    const flows = 2 + (indexHtml.includes('fonts.googleapis.com') ? 1 : 0);

    expect(
      legal,
      `${flows} things leave the browser when signed out, so the closed-set ` +
        `sentence must say "${WORDS[flows]}". Change the flows and this number ` +
        `changes with them -- do not edit the expectation to match the prose.`,
    ).toMatch(new RegExp(`${WORDS[flows]} things leave your machine and no others`, 'i'));
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
     second time: same day, same version of the document. */
  const EXPECTED_COPY_HASH = 'dca540a90ef8';
  const EXPECTED_UPDATED = '1 September 2026';

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
