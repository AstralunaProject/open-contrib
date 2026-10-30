import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';
import { isSafePath, scanRepository } from '../src/core/scan.js';
import { fixture } from './helpers.js';

describe('isSafePath', () => {
  it('keeps ordinary source, config and docs', () => {
    for (const file of ['src/index.ts', 'README.md', '.github/workflows/ci.yml', 'pkg/env/config.go', '.env-loader.js']) {
      assert.ok(isSafePath(file), file);
    }
  });

  it('rejects secrets, binaries and dependency folders', () => {
    for (const file of [
      '.env',
      'apps/api/.env.production',
      'certs/server.pem',
      'deploy/tls.KEY',
      'home/.ssh/id_ed25519',
      '.npmrc',
      'assets/logo.png',
      'public/icon.svg',
      'fonts/Inter.woff2',
      'node_modules/lodash/index.js',
      'venv/lib/site.py',
      'target/release/app',
      'dist/index.js',
      'static/app.min.js',
      'static/app.js.map',
      '.envrc',
      'infra/terraform.tfstate',
      'infra/terraform.tfstate.backup',
      'infra/prod.auto.tfvars',
      'gha-creds-1a2b3c.json',
      'keys/service-account-prod.json',
      '.aws/credentials',
      'deploy/kubeconfig',
      '.kube/config',
      '.ssh/known_hosts',
      '.docker/config.json',
      'putty/server.ppk',
      'packages/web/.NPMRC',
      'Infra/Terraform.TFSTATE',
      'certs/Server.PEM',
    ]) {
      assert.equal(isSafePath(file), false, file);
    }
  });
});

describe('scanRepository', () => {
  it('walks plain directories with the fixed rules', async (t) => {
    const root = await fixture(t, {
      'src/app.ts': 'export {}',
      'src/.env.local': 'TOKEN=1',
      'node_modules/dep/index.js': '',
      'logo.png': Buffer.from([0x89, 0x50]),
      'README.md': '# app',
    });
    await symlink(path.join(root, 'README.md'), path.join(root, 'link.md'));

    const { files, truncated } = await scanRepository(root);
    assert.deepEqual(files, ['README.md', 'src/app.ts']);
    assert.equal(truncated, false);
  });

  it('flags truncation only when safe files exceed the limit', async (t) => {
    const binaries = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`img/${i}.png`, '']));

    const fits = await fixture(t, { ...binaries, 'src/a.ts': '', 'src/b.ts': '' });
    assert.deepEqual(await scanRepository(fits, 2), { files: ['src/a.ts', 'src/b.ts'], truncated: false });

    const overflows = await fixture(t, { ...binaries, 'src/a.ts': '', 'src/b.ts': '', 'src/c.ts': '' });
    const { files, truncated } = await scanRepository(overflows, 2);
    assert.equal(files.length, 2);
    assert.equal(truncated, true);
  });

  it('lists tracked files only inside a git work tree', async (t) => {
    const root = await fixture(t, {
      '.gitignore': 'generated/\n',
      'generated/schema.ts': 'export {}',
      'src/app.ts': 'export {}',
      '.env': 'TOKEN=1',
    });
    try {
      execFileSync('git', ['init', '-q'], { cwd: root });
    } catch {
      t.skip('git is not installed');
      return;
    }
    execFileSync('git', ['add', '.'], { cwd: root });
    await writeFile(path.join(root, 'notes.txt'), 'untracked');

    const { files } = await scanRepository(root);
    assert.deepEqual(files, ['.gitignore', 'src/app.ts']);
  });

  it('fails instead of walking past .gitignore when git itself errors', async (t) => {
    const root = await fixture(t, { '.gitignore': 'secret/\n', 'secret/dump.sql': '', 'src/app.ts': '' });
    try {
      execFileSync('git', ['init', '-q'], { cwd: root });
    } catch {
      t.skip('git is not installed');
      return;
    }
    execFileSync('git', ['config', 'core.repositoryformatversion', '99'], { cwd: root });

    await assert.rejects(scanRepository(root), /git ls-files failed/);
  });
});
