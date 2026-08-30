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
   * Found by loading the built app and reading the network log, after the text
   * above had already been corrected once: Firebase's database client opens a
   * channel to firestore.googleapis.com as soon as the page loads, signed in or
   * not, because `getFirestore()` runs at module scope. Every app-level query is
   * correctly guarded on `user`; this is the SDK's own connection.
   *
   * The first correction said "three things leave your browser and no others",
   * which was more precise and still wrong. A closed-set claim has to be checked
   * against what the app *does*, not against what its code appears to do.
   */
  it('accounts for the Firebase connection that opens without signing in', () => {
    expect(legal).toMatch(/database client/i);
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
   * A count is not a constant, so pin the arithmetic instead. Three flows are
   * unconditional -- the Gemini request the user's own key makes, the Firebase
   * database client's connection, and the contact form -- and Google Fonts adds
   * a fourth whenever index.html loads from it. Derive the expected word from
   * that, and the test stays correct in both directions.
   */
  it('states a count that matches what actually leaves the browser', () => {
    const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six'];
    const flows = 3 + (indexHtml.includes('fonts.googleapis.com') ? 1 : 0);

    expect(
      legal,
      `${flows} things leave the browser when signed out, so the closed-set ` +
        `sentence must say "${WORDS[flows]}". Change the flows and this number ` +
        `changes with them -- do not edit the expectation to match the prose.`,
    ).toMatch(new RegExp(`${WORDS[flows]} things leave your browser and no others`, 'i'));
  });
});
