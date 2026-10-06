import { useMemo, useState } from 'react';
import { api } from '../api.js';

const fmt = (n) => (n == null ? '—' : n.toLocaleString());

export default function AuthorsPanel({ repo, authors, loading, onChanged }) {
  const [selected, setSelected] = useState(() => new Set());
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return authors;
    return authors.filter(
      (a) => a.author.toLowerCase().includes(q) || a.members.some((m) => m.toLowerCase().includes(q))
    );
  }, [authors, filter]);

  const selectedMembers = useMemo(() => {
    const members = new Set();
    authors.forEach((a) => {
      if (selected.has(a.author)) a.members.forEach((m) => members.add(m));
    });
    return [...members];
  }, [authors, selected]);

  const toggle = (author) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(author)) next.delete(author);
      else next.add(author);
      return next;
    });
  };

  const doMerge = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.mergeAuthors(repo.id, selectedMembers);
      setSelected(new Set());
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const doUnmerge = async (a) => {
    setBusy(true);
    setError(null);
    try {
      await api.unmergeAuthors(repo.id, a.members[0]);
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card authors-panel">
      <h2>Authors &amp; identities</h2>
      <div className="authors-toolbar">
        <input
          placeholder="Filter identities…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <span className="muted small">
          {selected.size} group{selected.size === 1 ? '' : 's'} · {selectedMembers.length} identit
          {selectedMembers.length === 1 ? 'y' : 'ies'}
        </span>
        <button disabled={busy || selectedMembers.length < 2} onClick={doMerge}>
          Merge selected
        </button>
      </div>
      <p className="muted small">
        Merging folds several git identities into one author for metrics and ownership. A repository{' '}
        <code>.mailmap</code> is applied automatically; manual merges persist per repository and can be undone with
        Unmerge.
      </p>
      {error && <div className="banner error">{error}</div>}
      <table className="data-table">
        <thead>
          <tr>
            <th className="chk" />
            <th>Author</th>
            <th className="num">Commits</th>
            <th>Identities</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.author} className={selected.has(a.author) ? 'sel-row' : ''}>
              <td className="chk">
                <input type="checkbox" checked={selected.has(a.author)} onChange={() => toggle(a.author)} />
              </td>
              <td className="name-cell">{a.author}</td>
              <td className="num">{fmt(a.commits)}</td>
              <td className="muted small identities-cell">
                {a.members.length > 1 ? a.members.join('  ·  ') : a.members[0] !== a.author ? a.members[0] : ''}
              </td>
              <td>
                {a.members.length > 1 && (
                  <button className="link-btn" disabled={busy} onClick={() => doUnmerge(a)}>
                    Unmerge
                  </button>
                )}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={5} className="muted small">
                {loading
                  ? 'Loading authors… (first analysis of a large repo can take ~30s)'
                  : 'No identities match the filter.'}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}
