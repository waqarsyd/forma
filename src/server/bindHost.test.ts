/**
 * Which interface the server listens on.
 *
 * It bound `0.0.0.0` unconditionally until the 2026-08-27 audit (SEC-002).
 * On a single-developer laptop that is a convenience — it is how you open the
 * dev server from your phone. This project is developed on a shared Windows
 * Server host with other live users, where it means anyone else on the box or
 * the network segment can reach the dev server while it runs, and in
 * development that server has Vite middleware mounted, which serves the module
 * graph and transforms arbitrary project files.
 *
 * The default therefore has to differ by environment, and a rule that differs
 * by environment is exactly the kind that gets "tidied up" into a constant
 * later. Hence a function with tests rather than a ternary in `server.ts`:
 * getting it wrong re-exposes the dev server and nothing visibly breaks.
 */
import { describe, it, expect } from 'vitest';
import { LOOPBACK, ALL_INTERFACES, resolveBindHost } from './bindHost';

describe('resolveBindHost', () => {
  it('binds loopback in development', () => {
    expect(resolveBindHost({ production: false })).toBe(LOOPBACK);
  });

  it('binds all interfaces in production, where a proxy has to reach it', () => {
    expect(resolveBindHost({ production: true })).toBe(ALL_INTERFACES);
  });

  it('defaults to development when nothing says otherwise', () => {
    // The safe default is the restrictive one: a misconfigured NODE_ENV should
    // fail towards "unreachable", never towards "exposed".
    expect(resolveBindHost({})).toBe(LOOPBACK);
  });

  it('lets an explicit HOST override either default', () => {
    expect(resolveBindHost({ production: false, host: '0.0.0.0' })).toBe('0.0.0.0');
    expect(resolveBindHost({ production: true, host: '127.0.0.1' })).toBe('127.0.0.1');
    expect(resolveBindHost({ production: false, host: '192.168.1.50' })).toBe('192.168.1.50');
  });

  it('ignores an empty or whitespace HOST rather than binding to nothing', () => {
    // `HOST=` in a .env file arrives as an empty string. Passing that to
    // listen() binds all interfaces, which is the opposite of what someone
    // clearing the variable meant.
    for (const host of ['', '   ', '\t']) {
      expect(resolveBindHost({ production: false, host })).toBe(LOOPBACK);
    }
  });

  it('trims a HOST that arrived with stray whitespace', () => {
    expect(resolveBindHost({ production: false, host: '  10.0.0.5  ' })).toBe('10.0.0.5');
  });
});
