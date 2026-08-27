/**
 * Which network interface `server.ts` listens on.
 *
 * The rule is one line of logic and two lines of consequence, which is why it
 * is a function with tests rather than a ternary at the call site.
 *
 * In **development** the answer is loopback. The dev server runs Vite in
 * middleware mode, so it serves the module graph and transforms project files
 * on request; binding it to every interface publishes that to anyone who can
 * reach the machine. On a personal laptop that is a shrug. This project is
 * developed on a shared host with other live users, where it is not.
 *
 * In **production** the answer is every interface, because the process sits
 * behind something that has to reach it, and there `npm start` serves only the
 * static contents of `dist/`.
 *
 * `HOST` overrides both, for the laptop case where you genuinely do want to
 * open the dev server from a phone on the same network.
 */

/** Reachable only from this machine. */
export const LOOPBACK = '127.0.0.1';

/** Every interface. What a proxy or a container needs. */
export const ALL_INTERFACES = '0.0.0.0';

export interface BindHostOptions {
  /** `NODE_ENV === 'production'`, resolved by the caller. */
  production?: boolean;
  /** The `HOST` environment variable, if set. */
  host?: string;
}

export function resolveBindHost({ production = false, host }: BindHostOptions = {}): string {
  // An empty string is what `HOST=` in a .env file produces, and passing it to
  // listen() binds every interface — the exact opposite of what someone who
  // cleared the variable was asking for. Treat blank as absent.
  const explicit = host?.trim();
  if (explicit) return explicit;

  // Note the default when `production` is not given at all: loopback. A
  // NODE_ENV that failed to arrive should leave the server unreachable, not
  // exposed — the first is a puzzle someone solves in a minute, the second is
  // a problem nobody notices.
  return production ? ALL_INTERFACES : LOOPBACK;
}
