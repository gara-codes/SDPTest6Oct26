import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';

const MAX_UNCOMPRESSED_BYTES = 2 * 1024 ** 3; // guard against zip bombs

function git(args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { maxBuffer: 256 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      if (err) {
        const hint = String(stderr || err.message)
          .split('\n')
          .filter(Boolean)
          .slice(0, 3)
          .join(' ');
        reject(new Error(hint || `git ${args[0]} failed`));
      } else {
        resolve(stdout);
      }
    });
  });
}

// Snapshot facts about a repository's HEAD, recorded when ingest completes.
export async function resolveRepoInfo(workdir) {
  const head = (await git(['-C', workdir, 'rev-parse', 'HEAD'])).trim();
  const commits = Number((await git(['-C', workdir, 'rev-list', '--count', 'HEAD'])).trim());
  const lastCommitTs = Number((await git(['-C', workdir, 'log', '-1', '--format=%ct'])).trim());
  return { head, commits, lastCommitTs };
}

function deriveName(source) {
  const base = String(source)
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '')
    .replace(/\.zip$/i, '');
  const name = path.basename(base) || 'repo';
  return name.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 60);
}

// Deep (non-shallow) clone from a remote URL or local path. Returns immediately
// with the new registry entry; `done` resolves with the final entry once the
// clone finishes (or fails, with the error recorded on the entry).
export function startClone(store, url) {
  const entry = store.add({
    name: deriveName(url),
    source: 'clone',
    url,
    status: 'cloning',
  });
  const dir = store.reposPath(entry.id);

  const done = (async () => {
    try {
      await git(['clone', url, dir]);
      const info = await resolveRepoInfo(dir);
      const final = store.update(entry.id, { ...info, status: 'ready', root: '.' });
      await store.flush();
      return final;
    } catch (err) {
      fs.rmSync(dir, { recursive: true, force: true });
      const final = store.update(entry.id, { status: 'error', error: err.message });
      await store.flush();
      return final;
    }
  })();

  return { entry, done };
}

function extractZip(zipPath, targetDir) {
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();
  let total = 0;
  for (const e of entries) {
    const name = e.entryName;
    if (name.startsWith('/') || /^[A-Za-z]:/.test(name) || name.split('/').includes('..')) {
      throw new Error(`unsafe path inside zip: ${name}`);
    }
    total += e.header.size;
    if (total > MAX_UNCOMPRESSED_BYTES) {
      throw new Error('zip expands beyond the 2GB limit');
    }
  }
  fs.mkdirSync(targetDir, { recursive: true });
  zip.extractAllTo(targetDir, true);
}

// A zip is expected to contain the repository's .git directory, either at the
// top level or wrapped in a single top-level folder (how GitHub/GitLab export
// zips and how most tools create them). A .git *file* (linked worktree) is
// accepted only if its gitdir target is inside the archive too.
function validateDotGitFile(dotGitFile) {
  const content = fs.readFileSync(dotGitFile, 'utf8').trim();
  const match = content.match(/^gitdir:\s*(.+)$/);
  if (!match) throw new Error('.git file inside zip is malformed');
  const target = path.resolve(path.dirname(dotGitFile), match[1].trim());
  if (!fs.existsSync(target)) {
    throw new Error('zip contains a .git file (linked worktree) but its gitdir is not in the archive');
  }
}

function findGitRoot(dir) {
  const direct = path.join(dir, '.git');
  if (fs.existsSync(direct)) {
    if (fs.statSync(direct).isFile()) validateDotGitFile(direct);
    return dir;
  }
  let children = [];
  try {
    children = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    children = [];
  }
  for (const child of children) {
    if (!child.isDirectory()) continue;
    const candidate = path.join(dir, child.name, '.git');
    if (fs.existsSync(candidate)) {
      if (fs.statSync(candidate).isFile()) validateDotGitFile(candidate);
      return path.join(dir, child.name);
    }
  }
  throw new Error('no .git directory or file found in the zip (not a git repository archive)');
}

// Ingest an uploaded zip. Same contract as startClone: immediate entry + done.
export function startZipIngest(store, zipPath, originalName = 'upload.zip') {
  const entry = store.add({
    name: deriveName(originalName),
    source: 'zip',
    status: 'extracting',
  });
  const dir = store.reposPath(entry.id);

  const done = (async () => {
    try {
      extractZip(zipPath, dir);
      const root = findGitRoot(dir);
      const info = await resolveRepoInfo(root);
      const final = store.update(entry.id, {
        ...info,
        status: 'ready',
        root: path.relative(dir, root) || '.',
      });
      await store.flush();
      return final;
    } catch (err) {
      fs.rmSync(dir, { recursive: true, force: true });
      const final = store.update(entry.id, { status: 'error', error: err.message });
      await store.flush();
      return final;
    }
  })();

  return { entry, done };
}
