/**
 * A signed-in person's initials, for the avatar: the first letters of the
 * first two words of their name, or of their address when they have no name
 * ("john.smith@example.com" is JS).
 *
 * One copy since 2026-11-06 (the workspace audit). The site header's avatar
 * and the workspace's each worked them out, and disagreed: an address-only
 * account was "J" in one and "JS" in the other.
 */
export function initialsOf(user: { displayName?: string | null; email?: string | null }): string {
  const source = (user.displayName || user.email || '?').trim();
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  return parts.slice(0, 2).map((p) => p[0]).join('').toUpperCase() || '?';
}
