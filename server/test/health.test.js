import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverEntry = path.resolve(__dirname, '../index.js');

function startServer(port) {
  return spawn(process.execPath, [serverEntry], {
    env: { ...process.env, PORT: String(port) },
    stdio: 'ignore',
  });
}

async function waitForHealth(port, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${port}/api/health`);
      if (res.ok) return await res.json();
    } catch {
      // server not up yet, keep polling
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`server on port ${port} did not become healthy within ${timeoutMs}ms`);
}

test('GET /api/health returns ok', async () => {
  const port = 30000 + Math.floor(Math.random() * 10000);
  const child = startServer(port);
  try {
    const body = await waitForHealth(port);
    assert.equal(body.ok, true);
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
  }
});
