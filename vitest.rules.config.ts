import { defineConfig } from 'vitest/config';

/**
 * Separate from vitest.config.ts on purpose. The unit suite is dependency-free
 * and runs in ~2s; this one needs Java and a live Firestore emulator, so it must
 * not be picked up by `npm test`. Use `npm run test:rules`, which starts the
 * emulator around it.
 *
 * `node` environment, not jsdom: this talks to the emulator over the wire and
 * has no DOM to speak of. The emulator is slow to warm up, hence the timeouts.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 20000,
    hookTimeout: 30000,
    // The rules tests share one emulator and clear Firestore between cases, so
    // they must not run concurrently against each other.
    fileParallelism: false,
    reporters: 'default',
  },
});
