// Pure metric engine per the COMS3011A brief. Every metric is additive over
// (commit, object) pairs, so one pass over the selected commit set H rolls
// values up the directory tree: each file row credits the file and every
// ancestor directory (the root '' included, which yields repository metrics).

function ancestors(path) {
  const out = [path];
  let idx = path.lastIndexOf('/');
  while (idx > 0) {
    out.push(path.slice(0, idx));
    idx = path.lastIndexOf('/', idx - 1);
  }
  out.push('');
  return out;
}

function selectCommits(parsed, { since, until, commits }) {
  const explicit = commits && commits.size ? commits : null;
  return parsed.commits.filter((h) => {
    if (explicit) {
      if (!explicit.has(h.hash)) return false;
    } else {
      if (since != null && h.ts < since) return false;
      if (until != null && h.ts >= until) return false;
    }
    return true;
  });
}

export function computeMetrics(parsed, options = {}) {
  const authorMap = options.authorMap || parsed.authors;
  const queryPath = (options.path || '').replace(/^\/+|\/+$/g, '');

  const H = selectCommits(parsed, options);
  const authorFilter = options.author || null;

  // acc: object path -> { a, d, n, authors: Map(canonical -> {a, d, n}) }
  const acc = new Map();
  const timeline = new Map(); // 'YYYY-MM' -> {a, d}

  for (const h of H) {
    const canonical = authorMap[h.author];
    if (authorFilter && canonical !== authorFilter) continue;

    const touched = new Map(); // object -> {a, d} for this commit
    let commitAdd = 0;
    let commitDel = 0;
    for (let i = 0; i < h.rows.length; i += 3) {
      const pid = h.rows[i];
      const add = h.rows[i + 1];
      const del = h.rows[i + 2];
      commitAdd += add;
      commitDel += del;
      for (const obj of ancestors(parsed.paths[pid])) {
        let t = touched.get(obj);
        if (!t) {
          t = { a: 0, d: 0 };
          touched.set(obj, t);
        }
        t.a += add;
        t.d += del;
      }
    }

    const month = new Date(h.ts * 1000).toISOString().slice(0, 7);
    let tl = timeline.get(month);
    if (!tl) {
      tl = { a: 0, d: 0 };
      timeline.set(month, tl);
    }
    tl.a += commitAdd;
    tl.d += commitDel;

    for (const [obj, { a, d }] of touched) {
      let e = acc.get(obj);
      if (!e) {
        e = { a: 0, d: 0, n: 0, authors: new Map() };
        acc.set(obj, e);
      }
      e.a += a;
      e.d += d;
      if (a + d > 0) e.n += 1;
      let au = e.authors.get(canonical);
      if (!au) {
        au = { a: 0, d: 0, n: 0 };
        e.authors.set(canonical, au);
      }
      au.a += a;
      au.d += d;
      if (a + d > 0) au.n += 1;
    }
  }

  // Directory set: strict ancestor prefixes of every accumulated path (a
  // path is a directory iff some object lives beneath it). Root is always a dir.
  const dirSet = new Set(['']);
  for (const key of acc.keys()) {
    let idx = key.lastIndexOf('/');
    while (idx > 0) {
      dirSet.add(key.slice(0, idx));
      idx = key.lastIndexOf('/', idx - 1);
    }
  }

  const e = acc.get(queryPath) || { a: 0, d: 0, n: 0, authors: new Map() };
  const total = H.length;
  const churn = e.a + e.d;

  const byAuthor = [...e.authors.entries()]
    .map(([author, v]) => ({
      author,
      added: v.a,
      removed: v.d,
      churn: v.a + v.d,
      modifications: v.n,
      ownership: churn !== 0 ? (v.a + v.d) / churn : 0,
    }))
    .sort((x, y) => y.churn - x.churn);

  const children = [];
  const prefix = queryPath === '' ? '' : `${queryPath}/`;
  for (const [obj, ce] of acc) {
    if (obj === queryPath) continue;
    if (!obj.startsWith(prefix)) continue;
    const rel = obj.slice(prefix.length);
    if (rel.includes('/')) continue; // not an immediate child
    children.push({
      name: rel,
      path: obj,
      type: dirSet.has(obj) ? 'dir' : 'file',
      added: ce.a,
      removed: ce.d,
      growth: ce.a - ce.d,
      churn: ce.a + ce.d,
      modifications: ce.n,
    });
  }
  children.sort((x, y) => y.churn - x.churn);

  return {
    path: queryPath,
    type: dirSet.has(queryPath) ? 'dir' : 'file',
    set: { total },
    added: e.a,
    removed: e.d,
    growth: e.a - e.d,
    churn,
    modifications: e.n,
    modFrequency: total !== 0 ? e.n / total : 0,
    churnRate: total !== 0 ? churn / total : 0,
    byAuthor,
    children,
    timeline: [...timeline.entries()]
      .sort((x, y) => (x[0] < y[0] ? -1 : 1))
      .map(([month, v]) => ({ month, added: v.a, removed: v.d, churn: v.a + v.d })),
  };
}
