import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';

const PAGE = 50;
const shortDate = (ts) => new Date(ts * 1000).toISOString().slice(0, 10);

export default function CommitsPanel({ repo, active, onApply, onClear }) {
  const [checked, setChecked] = useState(() => new Set(active || []));
  const [commits, setCommits] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    setChecked(new Set(active || []));
    setOffset(0);
  }, [active]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = { offset, limit: PAGE };
    if (search.trim()) params.q = search.trim();
    api
      .getCommits(repo.id, params)
      .then((d) => {
        if (cancelled) return;
        setCommits(d.commits);
        setTotal(d.total);
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [repo.id, offset, search]);

  const toggle = (hash) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(hash)) next.delete(hash);
      else next.add(hash);
      return next;
    });
  };

  const togglePage = () => {
    const pageHashes = commits.map((c) => c.hash);
    const allOn = pageHashes.length > 0 && pageHashes.every((h) => checked.has(h));
    setChecked((prev) => {
      const next = new Set(prev);
      pageHashes.forEach((h) => (allOn ? next.delete(h) : next.add(h)));
      return next;
    });
  };

  const pageAllOn = useMemo(
    () => commits.length > 0 && commits.every((c) => checked.has(c.hash)),
    [commits, checked]
  );

  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + PAGE, total);

  return (
    <section className="card commits-panel">
      <h2>Commit browser</h2>
      <div className="authors-toolbar">
        <input
          placeholder="Search subject or hash prefix…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setOffset(0);
          }}
        />
        <span className="muted small">{checked.size} selected</span>
        <button disabled={checked.size === 0} onClick={() => onApply([...checked])}>
          Apply as commit set
        </button>
        {(active || checked.size > 0) && (
          <button
            className="link-btn"
            onClick={() => {
              setChecked(new Set());
              onClear();
            }}
          >
            Clear
          </button>
        )}
      </div>
      <p className="muted small">
        Select commits to analyse an explicit subset — the dashboard then computes metrics over exactly those commits.
      </p>
      {error && <div className="banner error">{error}</div>}
      {active && (
        <div className="banner info">
          Active commit set: {active.length} commits — metrics on the Dashboard tab are restricted to it.{' '}
          <button className="link-btn" onClick={onClear}>
            Remove
          </button>
        </div>
      )}
      <table className="data-table">
        <thead>
          <tr>
            <th className="chk">
              <input type="checkbox" checked={pageAllOn} onChange={togglePage} title="Toggle page" />
            </th>
            <th>Hash</th>
            <th>Date</th>
            <th>Author</th>
            <th>Subject</th>
            <th className="num">Files</th>
          </tr>
        </thead>
        <tbody>
          {commits.map((c) => (
            <tr key={c.hash} className={checked.has(c.hash) ? 'sel-row' : ''}>
              <td className="chk">
                <input type="checkbox" checked={checked.has(c.hash)} onChange={() => toggle(c.hash)} />
              </td>
              <td className="commit-hash">{c.hash.slice(0, 10)}</td>
              <td className="muted small">{shortDate(c.ts)}</td>
              <td className="name-cell small-cell">{c.author}</td>
              <td className="commit-subject">{c.subject}</td>
              <td className="num">{c.files}</td>
            </tr>
          ))}
          {commits.length === 0 && !loading && (
            <tr>
              <td colSpan={6} className="muted small">
                No commits match.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <div className="pager">
        <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
          ‹ Prev
        </button>
        <span className="muted small">
          {loading ? '…' : `${from}–${to} of ${total.toLocaleString()}`}
        </span>
        <button disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}>
          Next ›
        </button>
      </div>
    </section>
  );
}
