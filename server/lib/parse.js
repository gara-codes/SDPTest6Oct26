import { spawn } from 'node:child_process';

// Parses `git log -z --no-merges --find-renames=50% --numstat --format=...`
// into a compact, string-interned structure:
//   { paths: string[], authors: string[], commits: [{hash, ts, author, subject, rows}] }
// where rows is a flat array of [pathId, adds, removes, pathId, adds, ...] triples.
// Binary files (numstat "-") are skipped entirely; renames are attributed to
// the new path (git emits a single row for the destination).
export function parseRepo(workdir) {
  return new Promise((resolve, reject) => {
    const args = [
      '-C', workdir,
      'log',
      '-z',
      '--no-merges',
      '--find-renames=50%',
      '--numstat',
      '--format=%H%x1f%ct%x1f%an%x1f%ae%x1f%s',
      'HEAD',
    ];
    const child = spawn('git', args, { stdio: ['ignore', 'pipe', 'pipe'] });

    const paths = [];
    const pathIds = new Map();
    const authors = [];
    const authorIds = new Map();
    const commits = [];
    let current = null;
    let renamePending = null; // -z renames span 3 segments: stats, old path, new path
    let pending = '';
    let stderr = '';

    function internPath(p) {
      let id = pathIds.get(p);
      if (id === undefined) {
        id = paths.push(p) - 1;
        pathIds.set(p, id);
      }
      return id;
    }

    function internAuthor(identity) {
      let id = authorIds.get(identity);
      if (id === undefined) {
        id = authors.push(identity) - 1;
        authorIds.set(identity, id);
      }
      return id;
    }

    function handleSegment(raw) {
      const seg = raw.startsWith('\n') ? raw.slice(1) : raw;

      // Rename rows in -z mode: stats segment carries no path, then the old
      // path and new path arrive as the next two NUL segments.
      if (renamePending) {
        if (renamePending.stage === 1) {
          renamePending.stage = 2;
          return; // old path: changes are attributed to the new path only
        }
        if (!renamePending.binary && current && seg) {
          current.rows.push(internPath(seg), renamePending.add, renamePending.del);
        }
        renamePending = null;
        return;
      }

      if (!seg) return;
      const stat = /^(-|\d+)\t(-|\d+)\t([\s\S]*)$/.exec(seg);
      if (stat && current) {
        if (stat[1] === '-' || stat[2] === '-') {
          // binary: not measured (but still consume rename path segments if any)
          if (!stat[3]) renamePending = { binary: true, stage: 1 };
          return;
        }
        if (!stat[3]) {
          renamePending = { add: Number(stat[1]), del: Number(stat[2]), binary: false, stage: 1 };
          return;
        }
        const p = stat[3].replace(/\n+$/, '');
        current.rows.push(internPath(p), Number(stat[1]), Number(stat[2]));
        return;
      }
      const parts = seg.split('\x1f', 5);
      if (parts.length === 5 && /^[0-9a-f]{7,64}$/.test(parts[0])) {
        current = {
          hash: parts[0],
          ts: Number(parts[1]),
          author: internAuthor(`${parts[2]} <${parts[3]}>`),
          subject: parts[4],
          rows: [],
        };
        commits.push(current);
      }
    }

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      pending += chunk;
      let idx;
      while ((idx = pending.indexOf('\0')) !== -1) {
        handleSegment(pending.slice(0, idx));
        pending = pending.slice(idx + 1);
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (c) => {
      stderr += c;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (pending) handleSegment(pending);
      if (code !== 0) {
        reject(new Error(stderr.trim() || `git log failed (exit ${code})`));
      } else {
        resolve({ paths, authors, commits });
      }
    });
  });
}
