import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';
import { createStore } from '../lib/store.js';
import { startClone, startZipIngest } from '../lib/ingest.js';
import { gitIn, tmpdir, makeFixtureRepo, waitFor } from './helpers.js';

test('store: add, update, remove, persistence across reload', async () => {
  const dataDir = tmpdir('rat-store-');
  const store = createStore(dataDir);

  const entry = store.add({ name: 'x', source: 'clone', status: 'cloning' });
  assert.equal(store.list().length, 1);
  assert.equal(store.get(entry.id).status, 'cloning');

  store.update(entry.id, { status: 'error', error: 'boom' });
  assert.equal(store.get(entry.id).error, 'boom');
  store.update(entry.id, { status: 'ready' });
  assert.equal(store.get(entry.id).error, undefined, 'ready clears the error');

  await store.flush();

  const reloaded = createStore(dataDir);
  assert.equal(reloaded.get(entry.id).status, 'ready');

  reloaded.remove(entry.id);
  await reloaded.flush();
  assert.equal(createStore(dataDir).list().length, 0);
});

test('ingest: clone from a local path', async () => {
  const fixtureDir = tmpdir('rat-fix-');
  const head = makeFixtureRepo(fixtureDir);
  const dataDir = tmpdir('rat-data-');
  const store = createStore(dataDir);

  const { entry, done } = startClone(store, fixtureDir);
  assert.equal(entry.status, 'cloning');

  const final = await done;
  assert.equal(final.status, 'ready');
  assert.equal(final.head, head);
  assert.equal(final.commits, 2);
  assert.ok(fs.existsSync(path.join(store.reposPath(final.id), '.git')));
  assert.equal(final.name, path.basename(fixtureDir));
});

test('ingest: failed clone records the error and cleans up', async () => {
  const dataDir = tmpdir('rat-data-');
  const store = createStore(dataDir);
  const badPath = path.join(tmpdir('rat-none-'), 'nope');

  const { done } = startClone(store, badPath);
  const final = await done;
  assert.equal(final.status, 'error');
  assert.ok(final.error, 'error message recorded');
  assert.ok(!fs.existsSync(store.reposPath(final.id)), 'clone dir removed');
});

test('ingest: zip with nested top-level folder', async () => {
  const fixtureDir = tmpdir('rat-fix-');
  const head = makeFixtureRepo(fixtureDir);
  const dataDir = tmpdir('rat-data-');
  const store = createStore(dataDir);

  const zip = new AdmZip();
  zip.addLocalFolder(fixtureDir, 'fixture-main'); // wrapped root case
  const zipPath = path.join(tmpdir('rat-zip-'), 'fixture.zip');
  zip.writeZip(zipPath);

  const { entry, done } = startZipIngest(store, zipPath, 'fixture.zip');
  assert.equal(entry.status, 'extracting');

  const final = await done;
  assert.equal(final.status, 'ready');
  assert.equal(final.head, head);
  assert.equal(final.commits, 2);
  assert.equal(final.name, 'fixture');
  assert.ok(fs.existsSync(path.join(store.workPath(store.get(final.id)), '.git')));
});

test('ingest: zip with .git at top level', async () => {
  const fixtureDir = tmpdir('rat-fix-');
  const head = makeFixtureRepo(fixtureDir);
  const store = createStore(tmpdir('rat-data-'));

  const zip = new AdmZip();
  zip.addLocalFolder(fixtureDir); // entries at top level
  const zipPath = path.join(tmpdir('rat-zip-'), 'flat.zip');
  zip.writeZip(zipPath);

  const final = await startZipIngest(store, zipPath, 'flat.zip').done;
  assert.equal(final.status, 'ready');
  assert.equal(final.head, head);
});

test('ingest: zip without .git fails clearly', async () => {
  const plainDir = tmpdir('rat-plain-');
  fs.writeFileSync(path.join(plainDir, 'file.txt'), 'hello\n');
  const store = createStore(tmpdir('rat-data-'));

  const zip = new AdmZip();
  zip.addLocalFolder(plainDir, 'plain');
  const zipPath = path.join(tmpdir('rat-zip-'), 'plain.zip');
  zip.writeZip(zipPath);

  const final = await startZipIngest(store, zipPath, 'plain.zip').done;
  assert.equal(final.status, 'error');
  assert.match(final.error, /no \.git/);
});

test('ingest: zip of a .git file (worktree link) without its gitdir fails clearly', async () => {
  // Build a linked worktree, then delete the main repo so the worktree's
  // .git file points at a gitdir that is genuinely missing (as it would be
  // for a zip moved to another machine).
  const fixtureDir = tmpdir('rat-fix-');
  makeFixtureRepo(fixtureDir);
  const worktreeDir = path.join(tmpdir('rat-wt-'), 'linked');
  gitIn(fixtureDir, ['worktree', 'add', '-q', worktreeDir, 'HEAD']);
  fs.writeFileSync(path.join(worktreeDir, 'note.txt'), 'x\n');
  fs.rmSync(fixtureDir, { recursive: true, force: true });

  const zip = new AdmZip();
  zip.addLocalFolder(worktreeDir, 'linked'); // .git file included, gitdir is not
  const zipPath = path.join(tmpdir('rat-zip-'), 'linked.zip');
  zip.writeZip(zipPath);

  const store = createStore(tmpdir('rat-data-'));
  const final = await startZipIngest(store, zipPath, 'linked.zip').done;
  assert.equal(final.status, 'error');
  assert.match(final.error, /gitdir/);
});

test('api: clone, poll, upload, status, delete, validation', async () => {
  const fixtureDir = tmpdir('rat-fix-');
  const head = makeFixtureRepo(fixtureDir);

  const fixtureZip = new AdmZip();
  fixtureZip.addLocalFolder(fixtureDir, 'fixture-main');
  const zipPath = path.join(tmpdir('rat-zip-'), 'fixture.zip');
  fixtureZip.writeZip(zipPath);
  const zipBytes = fs.readFileSync(zipPath);

  const port = 31000 + Math.floor(Math.random() * 9000);
  const serverEntry = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../index.js');
  const child = spawn(process.execPath, [serverEntry], {
    env: { ...process.env, PORT: String(port), RAT_DATA_DIR: tmpdir('rat-http-') },
    stdio: 'ignore',
  });

  const base = `http://localhost:${port}`;
  try {
    await waitFor(async () => {
      const res = await fetch(`${base}/api/health`);
      if (!res.ok) throw new Error('not healthy');
    });

    // Clone via the API (local path stands in for a remote URL).
    const cloneRes = await fetch(`${base}/api/repos/clone`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: fixtureDir }),
    });
    assert.equal(cloneRes.status, 202);
    const { repo: cloneEntry } = await cloneRes.json();
    assert.equal(cloneEntry.status, 'cloning');

    const cloned = await waitFor(async () => {
      const list = await (await fetch(`${base}/api/repos`)).json();
      const found = list.repos.find((r) => r.id === cloneEntry.id);
      if (!found || found.status === 'cloning') throw new Error('still cloning');
      return found;
    });
    assert.equal(cloned.status, 'ready');
    assert.equal(cloned.head, head);

    // Upload via multipart FormData.
    const form = new FormData();
    form.append('zip', new Blob([zipBytes], { type: 'application/zip' }), 'fixture.zip');
    const uploadRes = await fetch(`${base}/api/repos/upload`, { method: 'POST', body: form });
    assert.equal(uploadRes.status, 202);
    const { repo: uploadEntry } = await uploadRes.json();
    assert.equal(uploadEntry.status, 'extracting');

    const uploaded = await waitFor(async () => {
      const list = await (await fetch(`${base}/api/repos`)).json();
      const found = list.repos.find((r) => r.id === uploadEntry.id);
      if (!found || found.status === 'extracting') throw new Error('still extracting');
      return found;
    });
    assert.equal(uploaded.status, 'ready');
    assert.equal(uploaded.commits, 2);

    // Status endpoint.
    const statusRes = await fetch(`${base}/api/repos/${cloned.id}/status`);
    assert.equal(statusRes.status, 200);
    assert.equal((await statusRes.json()).repo.head, head);
    const missing = await fetch(`${base}/api/repos/r_missing/status`);
    assert.equal(missing.status, 404);

    // Delete removes the entry.
    const delRes = await fetch(`${base}/api/repos/${cloned.id}`, { method: 'DELETE' });
    assert.equal(delRes.status, 200);
    const remaining = await (await fetch(`${base}/api/repos`)).json();
    assert.equal(remaining.repos.length, 1);

    // Validation errors.
    const noUrl = await fetch(`${base}/api/repos/clone`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(noUrl.status, 400);
    const badJson = await fetch(`${base}/api/repos/clone`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    assert.equal(badJson.status, 400);
    const noFile = await fetch(`${base}/api/repos/upload`, { method: 'POST', body: new FormData() });
    assert.equal(noFile.status, 400);
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
  }
});
