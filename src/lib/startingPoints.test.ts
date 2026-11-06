/** The empty workspace's starting points and recent projects (2026-11-06), as Stitch's home. */
import { describe, it, expect } from 'vitest';
import { STARTING_POINTS, recentProjects } from './startingPoints';

describe('STARTING_POINTS', () => {
  it('holds the six removed on 2026-11-05, each a whole description with a one-line gist', () => {
    expect(STARTING_POINTS.map((p) => p.title)).toEqual(['Invoice', 'Customer list', 'Sales by region', 'Employee directory', 'Purchase order', 'Inventory status']);
    expect(new Set(STARTING_POINTS.map((p) => p.id)).size).toBe(6);
    for (const p of STARTING_POINTS) {
      expect(p.text.length).toBeGreaterThan(150);
      expect(p.text.endsWith('.')).toBe(true);
      expect(p.gist.length).toBeLessThanOrEqual(36);
    }
  });
});

describe('recentProjects', () => {
  const at = (id: string, timestamp: string) => ({ id, timestamp });
  it('lists the newest first, leaves the archived out, and stops at the limit', () => {
    const projects = [at('a', '2026-11-01T10:00:00Z'), at('b', '2026-11-05T10:00:00Z'), at('c', '2026-11-03T10:00:00Z'), at('d', '2026-11-04T10:00:00Z')];
    expect(recentProjects(projects, ['d']).map((p) => p.id)).toEqual(['b', 'c', 'a']);
    expect(recentProjects(projects, [], 2).map((p) => p.id)).toEqual(['b', 'd']);
    expect(projects.map((p) => p.id)).toEqual(['a', 'b', 'c', 'd']);
  });
});
