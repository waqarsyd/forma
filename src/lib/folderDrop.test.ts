import { describe, it, expect } from 'vitest';
import { acceptsForBatch, filesFromDrop, filesFromPicker, forBatch, MAX_BATCH_FILES, type GivenFile } from './folderDrop';

const file = (name: string, type = 'image/png') => new File(['x'], name, { type });
const given = (path: string, type = 'image/png'): GivenFile => ({ file: file(path.split('/').pop()!, type), path });

/** A file entry, as a drop hands it over. */
const fileEntry = (path: string, type = 'image/png') =>
  ({
    isFile: true,
    isDirectory: false,
    fullPath: `/${path}`,
    file: (ok: (f: File) => void) => ok(file(path.split('/').pop()!, type)),
  }) as unknown as FileSystemEntry;

/** A folder entry whose reader answers `per` entries at a time, then none, as Chrome's does with 100. */
const folderEntry = (path: string, children: FileSystemEntry[], per = 100) =>
  ({
    isFile: false,
    isDirectory: true,
    fullPath: `/${path}`,
    createReader: () => {
      let at = 0;
      return {
        readEntries: (ok: (e: FileSystemEntry[]) => void) => {
          const batch = children.slice(at, at + per);
          at += per;
          ok(batch);
        },
      };
    },
  }) as unknown as FileSystemEntry;

describe('acceptsForBatch', () => {
  it('takes images, PDFs and .repx files, by type or by name', () => {
    expect(acceptsForBatch('a.png', 'image/png')).toBe(true);
    expect(acceptsForBatch('scan', 'image/tiff')).toBe(true);
    expect(acceptsForBatch('b.pdf', 'application/pdf')).toBe(true);
    // A .repx arrives with no type at all.
    expect(acceptsForBatch('old/c.repx', '')).toBe(true);
    expect(acceptsForBatch('d.JPG', '')).toBe(true);
  });

  it('leaves out other files and hidden ones', () => {
    expect(acceptsForBatch('notes.xlsx', 'application/vnd.ms-excel')).toBe(false);
    expect(acceptsForBatch('dir/.DS_Store', '')).toBe(false);
    expect(acceptsForBatch('dir/._a.png', 'image/png')).toBe(false);
  });
});

describe('forBatch', () => {
  it('keeps what it can take, in path order, and counts the rest', () => {
    const out = forBatch([given('b/2.png'), given('a/1.pdf', 'application/pdf'), given('a/x.txt', 'text/plain')]);
    expect(out.files.map((f) => f.path)).toEqual(['a/1.pdf', 'b/2.png']);
    expect(out.skipped).toBe(1);
    expect(out.truncated).toBe(false);
  });

  it('stops at the most a batch takes, and says it did', () => {
    const many = Array.from({ length: MAX_BATCH_FILES + 3 }, (_, i) => given(`p${String(i).padStart(4, '0')}.png`));
    const out = forBatch(many);
    expect(out.files).toHaveLength(MAX_BATCH_FILES);
    expect(out.truncated).toBe(true);
  });
});

describe('filesFromPicker', () => {
  it("names each file by its path in a chosen folder, or by its name", () => {
    const inFolder = Object.assign(file('a.png'), { webkitRelativePath: 'old/a.png' });
    expect(filesFromPicker([inFolder, file('b.png')]).map((g) => g.path)).toEqual(['old/a.png', 'b.png']);
  });
});

describe('filesFromDrop', () => {
  it('opens a dropped folder, and the folders inside it', async () => {
    const tree = folderEntry('old', [fileEntry('old/a.png'), folderEntry('old/2024', [fileEntry('old/2024/b.pdf', 'application/pdf')])]);
    const out = await filesFromDrop([{ kind: 'file', webkitGetAsEntry: () => tree, getAsFile: () => null }]);
    expect(out.map((g) => g.path).sort()).toEqual(['old/2024/b.pdf', 'old/a.png']);
  });

  it('reads a folder to its end, past the first batch its reader answers', async () => {
    const children = Array.from({ length: 250 }, (_, i) => fileEntry(`big/${i}.png`));
    const out = await filesFromDrop([{ kind: 'file', webkitGetAsEntry: () => folderEntry('big', children, 100), getAsFile: () => null }]);
    expect(out).toHaveLength(250);
  });

  it('takes a loose file where the browser gives no entry, and ignores dragged text', async () => {
    const out = await filesFromDrop([
      { kind: 'file', getAsFile: () => file('loose.png') },
      { kind: 'string', getAsFile: () => null },
    ]);
    expect(out.map((g) => g.path)).toEqual(['loose.png']);
  });

  it('stops walking once it has more than a batch takes', async () => {
    const children = Array.from({ length: MAX_BATCH_FILES + 50 }, (_, i) => fileEntry(`huge/${i}.png`));
    const out = await filesFromDrop([{ kind: 'file', webkitGetAsEntry: () => folderEntry('huge', children, 100), getAsFile: () => null }]);
    expect(out.length).toBeGreaterThan(MAX_BATCH_FILES);
    expect(out.length).toBeLessThanOrEqual(MAX_BATCH_FILES + 1);
  });
});
