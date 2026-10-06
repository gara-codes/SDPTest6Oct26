import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parseRepo } from './parse.js';
import { parseMailmap, buildAuthorMap } from './mailmap.js';

const CACHE_LIMIT = 2; // parsed repos kept in memory (git/git parses are large)
const cache = new Map(); // repo id -> parsed, insertion order = LRU order

export async function getParsed(store, entry) {
  const hit = cache.get(entry.id);
  if (hit) {
    cache.delete(entry.id);
    cache.set(entry.id, hit);
    return hit;
  }
  const parsed = await parseRepo(store.workPath(entry));
  cache.set(entry.id, parsed);
  while (cache.size > CACHE_LIMIT) {
    cache.delete(cache.keys().next().value);
  }
  return parsed;
}

export function dropParsed(repoId) {
  cache.delete(repoId);
}

function gitShow(workdir, ref) {
  return new Promise((resolve) => {
    execFile('git', ['-C', workdir, 'show', ref], { maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      resolve(err ? null : stdout);
    });
  });
}

// .mailmap from the working tree, falling back to the file at HEAD.
export async function readMailmap(store, entry) {
  const file = path.join(store.workPath(entry), '.mailmap');
  try {
    const text = fs.readFileSync(file, 'utf8');
    if (text.trim()) return parseMailmap(text);
  } catch {
    // fall through to HEAD
  }
  const head = await gitShow(store.workPath(entry), 'HEAD:.mailmap');
  return head && head.trim() ? parseMailmap(head) : [];
}

export async function getAuthorMap(store, entry, parsed) {
  const rules = await readMailmap(store, entry);
  return buildAuthorMap(parsed, rules, entry.authorMerges || []);
}
