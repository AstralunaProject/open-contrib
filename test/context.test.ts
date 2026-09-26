import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildContext, rankFiles, renderTree } from '../src/core/context.js';
import { fixture } from './helpers.js';

const files = [
  'src/core/lexer.ts',
  'src/core/parser.ts',
  'src/core/printer.ts',
  'src/cli/main.ts',
  'test/core/parser.test.ts',
  'docs/usage.md',
];

describe('rankFiles', () => {
  it('puts explicitly mentioned paths first', () => {
    const ranked = rankFiles(files, 'Crash in src/core/printer.ts when the parser sees a comment');
    assert.equal(ranked[0], 'src/core/printer.ts');
    assert.ok(ranked.includes('src/core/parser.ts'));
  });

  it('matches camelCase and snake_case identifiers against file names', () => {
    assert.deepEqual(rankFiles(files, 'parseTokens should reuse the Lexer_state').slice(0, 1), ['src/core/lexer.ts']);
  });

  it('ignores directory names shared by most of the tree', () => {
    assert.deepEqual(rankFiles(files, 'something in core is slow'), []);
  });
});

describe('renderTree', () => {
  it('lists every path when it fits', () => {
    assert.equal(renderTree(['a.ts', 'b/c.ts'], 100), 'a.ts\nb/c.ts');
  });

  it('groups by directory when the listing is too long', () => {
    const many = Array.from({ length: 50 }, (_, i) => `packages/web/src/file${i}.ts`).concat('README.md');
    const tree = renderTree(many, 200);
    assert.match(tree, /^51 files, grouped by directory:/);
    assert.match(tree, /packages\/web\/ \(50 files\)/);
    assert.match(tree, /^\.\/ \(1 files\)$/m);
    assert.ok(tree.length <= 200);
  });
});

describe('buildContext', () => {
  it('includes orientation files and relevant sources within budget', async (t) => {
    const root = await fixture(t, {
      'README.md': '# Demo',
      'package.json': '{"scripts":{"test":"node --test"}}',
      'package-lock.json': '{}',
      'src/lexer.ts': 'export const lex = () => [];',
      'src/unrelated.ts': 'export {}',
      'src/blob.ts': Buffer.from([0x61, 0x00, 0x62]),
    });
    const all = ['README.md', 'package-lock.json', 'package.json', 'src/blob.ts', 'src/lexer.ts', 'src/unrelated.ts'];

    const context = await buildContext({ root, files: all, query: 'lexer drops tokens, see blob.ts', budget: 10_000 });
    assert.deepEqual(
      context.files.map((file) => file.path),
      ['README.md', 'package.json', 'src/lexer.ts'],
    );
    assert.match(context.tree, /src\/unrelated\.ts/);
  });

  it('truncates files to the remaining budget', async (t) => {
    const root = await fixture(t, { 'src/lexer.ts': 'x'.repeat(5_000) });
    const context = await buildContext({ root, files: ['src/lexer.ts'], query: 'lexer', budget: 1_200 });

    const [file] = context.files;
    assert.ok(file);
    assert.equal(file.truncated, true);
    assert.ok(file.content.length < 1_200);
  });

  it('skips files that disappeared after listing', async (t) => {
    const root = await fixture(t, {});
    const context = await buildContext({ root, files: ['src/lexer.ts'], query: 'lexer', budget: 5_000 });
    assert.deepEqual(context.files, []);
  });
});
