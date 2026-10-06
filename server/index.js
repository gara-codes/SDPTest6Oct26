import express from 'express';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import multer from 'multer';
import { fileURLToPath } from 'node:url';
import { createStore } from './lib/store.js';
import { startClone, startZipIngest, resolveRepoInfo } from './lib/ingest.js';
import { getParsed, getAuthorMap } from './lib/analyzer.js';
import { computeMetrics } from './lib/metrics.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const store = createStore();

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));

const upload = multer({
  dest: path.join(os.tmpdir(), 'rat-uploads'),
  limits: { fileSize: 1024 ** 3 }, // 1GB zips
});

const TRANSIENT = new Set(['cloning', 'extracting']);

// Finish any ingest jobs that were in flight when the process last exited.
async function recoverTransient() {
  for (const entry of store.list()) {
    if (!TRANSIENT.has(entry.status)) continue;
    try {
      const info = await resolveRepoInfo(store.workPath(entry));
      store.update(entry.id, { ...info, status: 'ready' });
    } catch {
      store.update(entry.id, {
        status: 'error',
        error: 'ingest was interrupted before completion (server restarted)',
      });
    }
  }
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'rat-api', time: new Date().toISOString() });
});

app.get('/api/repos', (req, res) => {
  res.json({ repos: store.list() });
});

app.get('/api/repos/:id/status', (req, res) => {
  const entry = store.get(req.params.id);
  if (!entry) return res.status(404).json({ error: { message: 'repository not found' } });
  res.json({ repo: entry });
});

app.post('/api/repos/clone', (req, res) => {
  const url = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
  if (!url) {
    return res.status(400).json({ error: { message: 'body must be JSON: {"url": "<repository url>"}' } });
  }
  if (url.startsWith('-')) {
    return res.status(400).json({ error: { message: 'invalid repository URL' } });
  }
  const { entry, done } = startClone(store, url);
  done.catch(() => {}); // failures are recorded on the registry entry
  res.status(202).json({ repo: entry });
});

app.post('/api/repos/upload', (req, res) => {
  upload.single('zip')(req, res, (err) => {
    if (err) {
      const message = err.code === 'LIMIT_FILE_SIZE' ? 'zip exceeds the 1GB limit' : err.message;
      return res.status(400).json({ error: { message } });
    }
    if (!req.file) {
      return res.status(400).json({ error: { message: 'multipart field "zip" with a .zip file is required' } });
    }
    const original = req.file.originalname || 'upload.zip';
    if (!/\.zip$/i.test(original)) {
      fs.rmSync(req.file.path, { force: true });
      return res.status(400).json({ error: { message: 'uploaded file must be a .zip' } });
    }
    const { entry, done } = startZipIngest(store, req.file.path, original);
    done
      .catch(() => {})
      .finally(() => fsp.rm(req.file.path, { force: true }).catch(() => {}));
    res.status(202).json({ repo: entry });
  });
});

app.delete('/api/repos/:id', (req, res) => {
  const entry = store.get(req.params.id);
  if (!entry) return res.status(404).json({ error: { message: 'repository not found' } });
  store.remove(entry.id);
  res.json({ ok: true });
});

// --- analysis ---

async function requireReadyRepo(req, res) {
  const entry = store.get(req.params.id);
  if (!entry) {
    res.status(404).json({ error: { message: 'repository not found' } });
    return null;
  }
  if (entry.status !== 'ready') {
    res.status(409).json({ error: { message: `repository is not ready (status: ${entry.status})` } });
    return null;
  }
  return entry;
}

app.get('/api/repos/:id/metrics', async (req, res) => {
  try {
    const entry = await requireReadyRepo(req, res);
    if (!entry) return;
    const parsed = await getParsed(store, entry);
    const authorMap = await getAuthorMap(store, entry, parsed);
    const q = req.query;
    let explicit = null;
    if (typeof q.commits === 'string' && q.commits.trim()) {
      explicit = new Set(q.commits.split(',').map((s) => s.trim()).filter(Boolean));
    }
    const num = (v) => (v !== undefined && v !== null && v !== '' ? Number(v) : undefined);
    const metrics = computeMetrics(parsed, {
      path: typeof q.path === 'string' ? q.path : '',
      since: num(q.since),
      until: num(q.until),
      commits: explicit,
      author: typeof q.author === 'string' && q.author ? q.author : undefined,
      authorMap,
    });
    res.json(metrics);
  } catch (err) {
    res.status(500).json({ error: { message: err.message || 'metric computation failed' } });
  }
});

async function authorsPayload(entry) {
  const parsed = await getParsed(store, entry);
  const authorMap = await getAuthorMap(store, entry, parsed);
  const groups = new Map(); // canonical -> {members:Set, commits}
  parsed.authors.forEach((raw, i) => {
    const canonical = authorMap[i];
    let g = groups.get(canonical);
    if (!g) {
      g = { members: new Set(), commits: 0 };
      groups.set(canonical, g);
    }
    g.members.add(raw);
  });
  for (const h of parsed.commits) {
    groups.get(authorMap[h.author]).commits += 1;
  }
  return [...groups.entries()]
    .map(([author, g]) => ({ author, members: [...g.members], commits: g.commits }))
    .sort((a, b) => b.commits - a.commits);
}

app.get('/api/repos/:id/authors', async (req, res) => {
  try {
    const entry = await requireReadyRepo(req, res);
    if (!entry) return;
    res.json({ authors: await authorsPayload(entry) });
  } catch (err) {
    res.status(500).json({ error: { message: err.message || 'failed to list authors' } });
  }
});

app.post('/api/repos/:id/authors/merge', async (req, res) => {
  try {
    const entry = await requireReadyRepo(req, res);
    if (!entry) return;
    const members = Array.isArray(req.body?.members) ? req.body.members.filter((m) => typeof m === 'string') : [];
    if (members.length < 2) {
      return res.status(400).json({ error: { message: 'body must be JSON: {"members": ["Name <email>", ...]} with at least 2 authors' } });
    }
    const parsed = await getParsed(store, entry);
    const known = new Set(parsed.authors);
    const unknown = members.filter((m) => !known.has(m));
    if (unknown.length) {
      return res.status(400).json({ error: { message: `unknown author(s): ${unknown.join(', ')}` } });
    }
    // Union any existing groups that contain a member of the new group.
    const groups = (entry.authorMerges || []).map((g) => [...g]);
    let target = null;
    for (const m of members) {
      const existing = groups.find((g) => g.includes(m));
      if (existing) {
        if (!target) target = existing;
        else if (existing !== target) {
          target.push(...existing);
          groups.splice(groups.indexOf(existing), 1);
        }
      } else if (target) {
        if (!target.includes(m)) target.push(m);
      }
    }
    if (!target) {
      target = [...members];
      groups.push(target);
    }
    store.update(entry.id, { authorMerges: groups });
    await store.flush();
    res.json({ authors: await authorsPayload(entry) });
  } catch (err) {
    res.status(500).json({ error: { message: err.message || 'merge failed' } });
  }
});

app.post('/api/repos/:id/authors/unmerge', async (req, res) => {
  try {
    const entry = await requireReadyRepo(req, res);
    if (!entry) return;
    const member = typeof req.body?.member === 'string' ? req.body.member : '';
    if (!member) {
      return res.status(400).json({ error: { message: 'body must be JSON: {"member": "Name <email>"}' } });
    }
    const groups = (entry.authorMerges || []).filter((g) => !g.includes(member));
    store.update(entry.id, { authorMerges: groups });
    await store.flush();
    res.json({ authors: await authorsPayload(entry) });
  } catch (err) {
    res.status(500).json({ error: { message: err.message || 'unmerge failed' } });
  }
});

app.get('/api/repos/:id/commits', async (req, res) => {
  try {
    const entry = await requireReadyRepo(req, res);
    if (!entry) return;
    const parsed = await getParsed(store, entry);
    const authorMap = await getAuthorMap(store, entry, parsed);
    const q = req.query;
    const num = (v) => (v !== undefined && v !== null && v !== '' ? Number(v) : undefined);
    const since = num(q.since);
    const until = num(q.until);
    const search = typeof q.q === 'string' ? q.q.toLowerCase() : '';
    const offset = Math.max(0, Number(q.offset) || 0);
    const limit = Math.min(200, Math.max(1, Number(q.limit) || 50));

    const filtered = parsed.commits.filter((h) => {
      if (since != null && h.ts < since) return false;
      if (until != null && h.ts >= until) return false;
      if (search && !h.subject.toLowerCase().includes(search) && !h.hash.startsWith(search)) return false;
      return true;
    }); // already newest-first from git log

    res.json({
      total: filtered.length,
      commits: filtered.slice(offset, offset + limit).map((h) => ({
        hash: h.hash,
        ts: h.ts,
        author: authorMap[h.author],
        subject: h.subject,
        files: h.rows.length / 3,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: { message: err.message || 'failed to list commits' } });
  }
});

// Unknown API routes get JSON 404s rather than falling through to the SPA.
app.use('/api', (req, res) => {
  res.status(404).json({ error: { message: `No such API route: ${req.method} ${req.path}` } });
});

// Production mode: serve the built dashboard when it exists.
const clientDist = path.resolve(__dirname, '../client/dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

// JSON error handler (bad JSON bodies, unexpected failures) for API clients.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({ error: { message: err.message || 'internal error' } });
});

const PORT = Number(process.env.PORT) || 3001;
app.listen(PORT, () => {
  console.log(`RAT API listening on http://localhost:${PORT}`);
});

recoverTransient().then(() => console.log('registry recovered'));
