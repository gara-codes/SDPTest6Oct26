import express from 'express';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import multer from 'multer';
import { fileURLToPath } from 'node:url';
import { createStore } from './lib/store.js';
import { startClone, startZipIngest, resolveRepoInfo } from './lib/ingest.js';

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
