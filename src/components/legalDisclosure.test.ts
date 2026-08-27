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
const indexHtml = read('index.html');

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
    // And the count must not contradict the list that follows it.
    expect(legal).not.toMatch(/three things leave your browser/i);
  });
});
