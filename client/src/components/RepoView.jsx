import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { api } from '../api.js';
import AuthorsPanel from './AuthorsPanel.jsx';
import CommitsPanel from './CommitsPanel.jsx';

const fmt = (n) => (n == null ? '—' : n.toLocaleString());
const fmtNum = (n) => (n == null ? '—' : Number(n.toFixed(3)).toString());
const toUnix = (dateStr) => (dateStr ? Math.floor(Date.parse(`${dateStr}T00:00:00Z`) / 1000) : undefined);

function Breadcrumbs({ path, onNavigate }) {
  const parts = path === '' ? [] : path.split('/');
  return (
    <nav className="crumbs">
      <button className="crumb" onClick={() => onNavigate('')}>root</button>
      {parts.map((part, i) => (
        <span key={i}>
          <span className="crumb-sep">/</span>
          <button className="crumb" onClick={() => onNavigate(parts.slice(0, i + 1).join('/'))}>
            {part}
          </button>
        </span>
      ))}
    </nav>
  );
}

function MetricCards({ m }) {
  const cards = [
    ['Added lines', fmt(m.added), 'good'],
    ['Removed lines', fmt(m.removed), 'bad'],
    ['Growth', fmt(m.growth), m.growth >= 0 ? 'good' : 'bad'],
    ['Churn', fmt(m.churn), 'neutral'],
    ['Modifications', fmt(m.modifications), 'neutral'],
    ['Mod frequency', fmtNum(m.modFrequency), 'neutral'],
    ['Churn rate', fmtNum(m.churnRate), 'neutral'],
    ['Commits in set', fmt(m.set.total), 'neutral'],
  ];
  return (
    <div className="metric-cards">
      {cards.map(([label, value, tone]) => (
        <div key={label} className={`metric-card ${tone}`}>
          <div className="metric-value">{value}</div>
          <div className="metric-label">{label}</div>
        </div>
      ))}
    </div>
  );
}

function Timeline({ data }) {
  if (!data || data.length === 0) return <p className="muted small">No activity in the selected set.</p>;
  return (
    <div className="chart-box">
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="gAdd" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3fb950" stopOpacity={0.7} />
              <stop offset="100%" stopColor="#3fb950" stopOpacity={0.05} />
            </linearGradient>
            <linearGradient id="gDel" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f85149" stopOpacity={0.7} />
              <stop offset="100%" stopColor="#f85149" stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <XAxis dataKey="month" stroke="#8b949e" fontSize={11} />
          <YAxis stroke="#8b949e" fontSize={11} width={54} />
          <Tooltip
            contentStyle={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, fontSize: 12 }}
            labelStyle={{ color: '#e6edf3' }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Area type="monotone" dataKey="added" stroke="#3fb950" fill="url(#gAdd)" strokeWidth={1.5} />
          <Area type="monotone" dataKey="removed" stroke="#f85149" fill="url(#gDel)" strokeWidth={1.5} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function ChildrenTable({ children: kids, onNavigate }) {
  const [sort, setSort] = useState({ key: 'churn', dir: 'desc' });
  const rows = useMemo(() => {
    const sorted = [...kids].sort((a, b) => (sort.dir === 'desc' ? b[sort.key] - a[sort.key] : a[sort.key] - b[sort.key]));
    return sorted.slice(0, 200);
  }, [kids, sort]);

  const th = (key, label, extraClass = '') => (
    <th
      className={extraClass}
      onClick={() => setSort((s) => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }))}
    >
      {label}
      {sort.key === key && <span className="sort-arrow">{sort.dir === 'desc' ? ' ▾' : ' ▴'}</span>}
    </th>
  );

  if (kids.length === 0) return <p className="muted small">No immediate children changed in this set.</p>;

  return (
    <table className="data-table">
      <thead>
        <tr>
          {th('name', 'Name')}
          {th('added', 'Added', 'num')}
          {th('removed', 'Removed', 'num')}
          {th('growth', 'Growth', 'num')}
          {th('churn', 'Churn', 'num')}
          {th('modifications', 'Mods', 'num')}
        </tr>
      </thead>
      <tbody>
        {rows.map((c) => (
          <tr key={c.path} className="row-click" onClick={() => onNavigate(c.path)}>
            <td className="name-cell">
              <span className={`obj-${c.type}`}>{c.type === 'dir' ? '▸' : '◦'}</span> {c.name}
            </td>
            <td className="num good">{fmt(c.added)}</td>
            <td className="num bad">{fmt(c.removed)}</td>
            <td className="num">{fmt(c.growth)}</td>
            <td className="num">{fmt(c.churn)}</td>
            <td className="num">{fmt(c.modifications)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function AuthorsTable({ byAuthor }) {
  if (!byAuthor || byAuthor.length === 0) return <p className="muted small">No author activity in this set.</p>;
  const maxChurn = byAuthor[0].churn || 1;
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>Author</th>
          <th className="num">Added</th>
          <th className="num">Removed</th>
          <th className="num">Churn</th>
          <th className="num">Mods</th>
          <th>Ownership</th>
        </tr>
      </thead>
      <tbody>
        {byAuthor.map((a) => (
          <tr key={a.author}>
            <td className="name-cell">{a.author}</td>
            <td className="num good">{fmt(a.added)}</td>
            <td className="num bad">{fmt(a.removed)}</td>
            <td className="num">{fmt(a.churn)}</td>
            <td className="num">{fmt(a.modifications)}</td>
            <td>
              <div className="ownership">
                <div className="ownership-bar" style={{ width: `${(a.ownership * 100).toFixed(1)}%` }} />
                <span className="ownership-val">{(a.ownership * 100).toFixed(1)}%</span>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function RepoView({ repo, onExit }) {
  const [view, setView] = useState('dashboard');
  const [path, setPath] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [author, setAuthor] = useState('');
  const [commitSet, setCommitSet] = useState(null); // null = full commit set; array = explicit subset
  const [metrics, setMetrics] = useState(null);
  const [authors, setAuthors] = useState([]);
  const [authorsVersion, setAuthorsVersion] = useState(0);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const reloadAuthors = useCallback(() => {
    api
      .getAuthors(repo.id)
      .then((d) => setAuthors(d.authors))
      .catch(() => {});
  }, [repo.id]);

  useEffect(() => {
    reloadAuthors();
  }, [reloadAuthors]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = { path };
    const since = toUnix(from);
    const until = toUnix(to);
    if (since != null) params.since = since;
    if (until != null) params.until = until;
    if (until == null && since != null) {
      // "from X to present": use since only (H_t semantics)
    }
    if (author) params.author = author;
    if (commitSet) params.commits = commitSet;
    api
      .getMetrics(repo.id, params)
      .then((m) => {
        if (!cancelled) {
          setMetrics(m);
          setError(null);
        }
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
  }, [repo.id, path, from, to, author, authorsVersion, commitSet]);

  // Identity changes (merge/unmerge) can invalidate the author filter.
  const onIdentitiesChanged = useCallback(() => {
    setAuthor('');
    reloadAuthors();
    setAuthorsVersion((v) => v + 1);
  }, [reloadAuthors]);

  const hardRange = to !== '' && from !== '';

  return (
    <main className="shell wide">
      <header className="dash-head">
        <button onClick={onExit}>← All repositories</button>
        <h1 className="dash-title">{repo.name}</h1>
        <span className="muted small">
          {repo.commits?.toLocaleString()} commits · {repo.head?.slice(0, 10)}
        </span>
        <div className="tabs">
          <button className={view === 'dashboard' ? 'tab active' : 'tab'} onClick={() => setView('dashboard')}>
            Dashboard
          </button>
          <button className={view === 'authors' ? 'tab active' : 'tab'} onClick={() => setView('authors')}>
            Authors
          </button>
          <button className={view === 'commits' ? 'tab active' : 'tab'} onClick={() => setView('commits')}>
            Commits
          </button>
        </div>
      </header>

      {view === 'authors' && (
        <AuthorsPanel repo={repo} authors={authors} onChanged={onIdentitiesChanged} />
      )}

      {view === 'commits' && (
        <CommitsPanel
          repo={repo}
          active={commitSet}
          onApply={(hashes) => {
            setCommitSet(hashes);
            setView('dashboard');
          }}
          onClear={() => setCommitSet(null)}
        />
      )}

      {view === 'dashboard' && (
      <section className="card filter-bar">
        <div className="filter-item">
          <label>From</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="filter-item">
          <label>To</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="filter-item grow">
          <label>Author</label>
          <select value={author} onChange={(e) => setAuthor(e.target.value)}>
            <option value="">All authors</option>
            {authors.map((a) => (
              <option key={a.author} value={a.author}>
                {a.author} ({a.commits})
              </option>
            ))}
          </select>
        </div>
        <div className="filter-item">
          <label>&nbsp;</label>
          <button
            onClick={() => {
              setFrom('');
              setTo('');
              setAuthor('');
            }}
          >
            Clear
          </button>
        </div>
        {hardRange && <span className="muted small filter-note">Range [from, to)</span>}
      </section>
      )}

      {view === 'dashboard' && commitSet && (
        <div className="banner info">
          Custom commit set active: {commitSet.length} commits — metrics are restricted to the selection.{' '}
          <button className="link-btn" onClick={() => setCommitSet(null)}>
            Use all commits
          </button>
        </div>
      )}

      {view === 'dashboard' && error && <div className="banner error">{error}</div>}
      {view === 'dashboard' && loading && !metrics && <p className="muted">Computing metrics…</p>}

      {view === 'dashboard' && metrics && (
        <>
          <Breadcrumbs path={path} onNavigate={setPath} />
          <MetricCards m={metrics} />

          <section className="card">
            <h2>Added / removed lines per month</h2>
            <Timeline data={metrics.timeline} />
          </section>

          <section className="card">
            <h2>
              {path === '' ? 'Root' : path} <span className="muted small">— immediate children</span>
            </h2>
            <ChildrenTable children={metrics.children} onNavigate={setPath} />
          </section>

          <section className="card">
            <h2>
              Author ownership <span className="muted small">— churn share for {path === '' ? 'the repository' : path}</span>
            </h2>
            <AuthorsTable byAuthor={metrics.byAuthor} />
          </section>
        </>
      )}
    </main>
  );
}
