import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DATA_DIR = path.resolve(__dirname, '../../data');

// Registry of ingested repositories. Entries live in <dataDir>/meta.json and the
// repository files themselves under <dataDir>/repos/<id>/.
export function createStore(dataDir = process.env.RAT_DATA_DIR || DEFAULT_DATA_DIR) {
  const reposDir = path.join(dataDir, 'repos');
  const metaFile = path.join(dataDir, 'meta.json');
  let repos = [];
  let saveChain = Promise.resolve();

  fs.mkdirSync(reposDir, { recursive: true });
  if (fs.existsSync(metaFile)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
      repos = Array.isArray(parsed.repos) ? parsed.repos : [];
    } catch {
      repos = []; // corrupted registry: start fresh rather than refuse to boot
    }
  }

  // Writes are chained so concurrent ingest jobs cannot interleave JSON writes.
  function persist() {
    saveChain = saveChain.then(() => {
      try {
        const tmp = `${metaFile}.tmp-${randomUUID().slice(0, 8)}`;
        fs.writeFileSync(tmp, JSON.stringify({ repos }, null, 2));
        fs.renameSync(tmp, metaFile);
      } catch (err) {
        console.error('failed to persist registry:', err.message);
      }
    });
    return saveChain;
  }

  function find(id) {
    return repos.find((r) => r.id === id) || null;
  }

  return {
    reposDir,

    list() {
      return [...repos].sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
    },

    get(id) {
      return find(id);
    },

    add(partial) {
      const entry = {
        id: `r_${randomUUID().replace(/-/g, '').slice(0, 10)}`,
        name: partial.name || 'repo',
        source: partial.source || 'clone',
        url: partial.url,
        root: partial.root || '.',
        status: partial.status || 'ready',
        error: partial.error,
        head: partial.head,
        commits: partial.commits,
        lastCommitTs: partial.lastCommitTs,
        addedAt: Date.now(),
      };
      repos.push(entry);
      persist();
      return { ...entry };
    },

    update(id, patch) {
      const entry = find(id);
      if (!entry) return null;
      Object.assign(entry, patch);
      if (entry.status === 'ready') entry.error = undefined;
      persist();
      return { ...entry };
    },

    remove(id) {
      const idx = repos.findIndex((r) => r.id === id);
      if (idx === -1) return false;
      repos.splice(idx, 1);
      fs.rmSync(path.join(reposDir, id), { recursive: true, force: true });
      persist();
      return true;
    },

    reposPath(id) {
      return path.join(reposDir, id);
    },

    // Working tree of the repository: the clone dir, or the discovered root
    // inside an extracted zip (zips often wrap the repo in a top-level folder).
    workPath(entry) {
      if (entry.root && entry.root !== '.') {
        return path.join(reposDir, entry.id, entry.root);
      }
      return path.join(reposDir, entry.id);
    },

    flush() {
      return saveChain;
    },
  };
}
