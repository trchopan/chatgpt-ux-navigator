import {describe, it, expect, beforeEach, afterEach} from 'bun:test';
import {isPathInsideRoot} from '../src/fs/security';
import {formatTree, listPathsRecursive, concatFirstLevelFiles} from '../src/fs/tree';
import {join, resolve} from 'node:path';
import {mkdir, writeFile, rm} from 'node:fs/promises';

const TEST_ROOT = join(import.meta.dir, 'temp_test_fs');

describe('FileSystem Utils', () => {
    describe('isPathInsideRoot', () => {
        it('should return true for path inside root', () => {
            expect(isPathInsideRoot('/app/data/file.txt', '/app/data')).toBe(true);
        });

        it('should return true for root itself', () => {
            expect(isPathInsideRoot('/app/data', '/app/data')).toBe(true);
        });

        it('should return false for path outside root', () => {
            expect(isPathInsideRoot('/app/other/file.txt', '/app/data')).toBe(false);
        });

        it('should return false for parent directory', () => {
            expect(isPathInsideRoot('/app', '/app/data')).toBe(false);
        });

        it('should handle trailing slashes in root', () => {
            expect(isPathInsideRoot('/app/data/file.txt', '/app/data/')).toBe(true);
        });

        // Basic traversal check - note that isPathInsideRoot expects absolute paths
        // and doesn't resolve ".." itself, so the caller must resolve first.
        // However, if we pass unresolved paths, we want to see behavior.
        // The implementation does simple string prefix matching.
        it('should return false for path traversing out of root', () => {
            // This currently fails/passes incorrectly because of simple string matching
            // /app/data/../other/file.txt starts with /app/data/ but resolves to /app/other/file.txt
            expect(isPathInsideRoot('/app/data/../other/file.txt', '/app/data')).toBe(false);
        });

        it('should be careful with string prefix matching', () => {
            // /app/database starts with /app/data but is not inside it
            expect(isPathInsideRoot('/app/database', '/app/data')).toBe(false);
        });
    });

    describe('Tree Operations', () => {
        const TREE_ROOT = join(TEST_ROOT, 'tree');

        beforeEach(async () => {
            await rm(TEST_ROOT, {recursive: true, force: true});
            await mkdir(TREE_ROOT, {recursive: true});
        });

        afterEach(async () => {
            await rm(TEST_ROOT, {recursive: true, force: true});
        });

        it('formatTree should generate correct ASCII tree', () => {
            const nodes = [
                {name: 'file1.txt', type: 'file' as const},
                {
                    name: 'subdir',
                    type: 'directory' as const,
                    children: [{name: 'subfile.txt', type: 'file' as const}],
                },
                {name: 'file2.txt', type: 'file' as const},
            ];

            const lines = formatTree(nodes);
            expect(lines).toEqual([
                '├── file1.txt',
                '├── subdir',
                '│   └── subfile.txt',
                '└── file2.txt',
            ]);
        });

        it('listPathsRecursive should respect SKIP_DIR_NAMES', async () => {
            await mkdir(join(TREE_ROOT, 'node_modules'));
            await writeFile(join(TREE_ROOT, 'node_modules', 'ignore.js'), '');
            await writeFile(join(TREE_ROOT, 'keep.txt'), '');

            const nodes = await listPathsRecursive(TREE_ROOT);
            const names = nodes.map(n => n.name);

            expect(names).toContain('keep.txt');
            expect(names).not.toContain('node_modules');
        });

        it('concatFirstLevelFiles should skip directories and sort files', async () => {
            await writeFile(join(TREE_ROOT, 'b.txt'), 'Content B');
            await writeFile(join(TREE_ROOT, 'a.txt'), 'Content A');
            await mkdir(join(TREE_ROOT, 'subdir'));

            const result = await concatFirstLevelFiles(TREE_ROOT, 'rel/path');

            expect(result.length).toBeGreaterThan(0);
            const text = result.join('\n');

            // Should find files in alphabetical order
            const idxA = text.indexOf('Content A');
            const idxB = text.indexOf('Content B');
            expect(idxA).not.toBe(-1);
            expect(idxB).not.toBe(-1);
            expect(idxA).toBeLessThan(idxB);

            // Should not try to read directory as file
            expect(text).not.toContain('subdir');
        });
    });
});
