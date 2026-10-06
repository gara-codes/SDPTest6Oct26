import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.disable('x-powered-by');

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'rat-api', time: new Date().toISOString() });
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

const PORT = Number(process.env.PORT) || 3001;
app.listen(PORT, () => {
  console.log(`RAT API listening on http://localhost:${PORT}`);
});

export default app;
