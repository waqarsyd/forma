/**
 * The offline worker's rules (2026-11-08, site audit item 55).
 */
import { describe, expect, it } from 'vitest';
import { serviceWorkerSource, swStrategy } from './serviceWorker';

describe('swStrategy', () => {
  it('fetches pages from the network first, and keeps hashed files', () => {
    expect(swStrategy('/docs', true)).toBe('page');
    expect(swStrategy('/', true)).toBe('page');
    expect(swStrategy('/assets/index-abc123.js', false)).toBe('asset');
    expect(swStrategy('/ocr/0123456789/worker.min.js', false)).toBe('asset');
    expect(swStrategy('/pdf-fonts/abcdef0123/LiberationSans-Regular.ttf', false)).toBe('asset');
    expect(swStrategy('/model/abcdef0123/formaModel.json', false)).toBe('asset');
    // PaddleOCR's models (2026-11-10), so a picture can be read offline.
    expect(swStrategy('/paddle/0123456789/det.onnx', false)).toBe('asset');
  });

  it('leaves the handwriting model, the worker, Firebase\'s paths and unversioned files to the network', () => {
    expect(swStrategy('/handwriting/0123456789/models/x.onnx', false)).toBe('network');
    expect(swStrategy('/sw.js', false)).toBe('network');
    expect(swStrategy('/__/auth/handler', true)).toBe('network');
    expect(swStrategy('/ocr/worker.min.js', false)).toBe('network');
    expect(swStrategy('/licenses.txt', false)).toBe('network');
    expect(swStrategy('/icons/icon-192.png', false)).toBe('network');
  });

  // The full audit (2026-11-11, SE-17): a shared report's address never goes into the cache, where a sign-out cannot reach it.
  it('never keeps a shared report\'s page', () => {
    expect(swStrategy('/s/abc123', true)).toBe('network');
    expect(swStrategy('/s/abc123', false)).toBe('network');
    expect(swStrategy('/security', true)).toBe('page');
  });
});

describe('serviceWorkerSource', () => {
  const source = serviceWorkerSource({ version: 'abc1234', precache: ['/', '/assets/index-1.js', '/assets/index-1.js', '/assets/index-2.css'] });

  it('is a script that parses, with its build\'s cache and the files to keep', () => {
    expect(() => new Function(source)).not.toThrow();
    expect(source).toContain('const CACHE = "forma-abc1234";');
    expect(source).toContain('const PRECACHE = ["/","/assets/index-1.js","/assets/index-2.css"];');
  });

  it('carries the same routing rule the test above holds', () => {
    const route = new Function(`${source.slice(source.indexOf('const swStrategy'), source.indexOf("self.addEventListener('install'"))}; return swStrategy;`)() as typeof swStrategy;
    expect(route('/assets/x.js', false)).toBe('asset');
    expect(route('/handwriting/0123456789/a', false)).toBe('network');
    expect(route('/features', true)).toBe('page');
    expect(route('/s/abc123', true)).toBe('network');
  });
});
