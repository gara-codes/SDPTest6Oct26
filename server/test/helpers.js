import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Test Author',
  GIT_AUTHOR_EMAIL: 'author@example.com',
  GIT_COMMITTER_NAME: 'Test Committer',
  GIT_COMMITTER_EMAIL: 'committer@example.com',
};

export function gitIn(dir, args, extraEnv = {}) {
  execFileSync('git', ['-C', dir, ...args], {
    env: { ...GIT_ENV, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

export function tmpdir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// Deterministic two-commit fixture repository with a nested directory.
export function makeFixtureRepo(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  gitIn(dir, ['init', '-q', '-b', 'main']);
  fs.writeFileSync(path.join(dir, 'README.md'), 'line1\nline2\n');
  gitIn(dir, ['add', '-A']);
  gitIn(dir, ['commit', '-q', '-m', 'first']);
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'app.js'), 'console.log(1);\n');
  gitIn(dir, ['add', '-A']);
  gitIn(dir, ['commit', '-q', '-m', 'second']);
  return execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD']).toString().trim();
}

export async function waitFor(fn, { timeoutMs = 15000, intervalMs = 100 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw lastError || new Error('waitFor timed out');
}
