import { api } from '../api.js';

const STATUS_LABEL = {
  ready: 'Ready',
  cloning: 'Cloning…',
  extracting: 'Extracting…',
  error: 'Failed',
};

function fmtCount(n) {
  return n == null ? '—' : n.toLocaleString();
}

function fmtDate(ts) {
  return ts ? new Date(ts).toLocaleDateString() : '—';
}

export default function RepoCard({ repo, onChanged, onOpen }) {
  const transient = repo.status === 'cloning' || repo.status === 'extracting';

  async function handleDelete() {
    if (!window.confirm(`Remove "${repo.name}" from RAT? This deletes the local copy.`)) return;
    try {
      await api.deleteRepo(repo.id);
      onChanged();
    } catch (err) {
      window.alert(err.message);
    }
  }

  return (
    <article className="repo-card">
      <div className="repo-head">
        <h3>{repo.name}</h3>
        <span className={`badge ${repo.status}`}>{STATUS_LABEL[repo.status] || repo.status}</span>
      </div>

      {repo.status === 'error' && repo.error && <p className="repo-error">{repo.error}</p>}

      <dl className="repo-meta">
        <div>
          <dt>Source</dt>
          <dd>{repo.source === 'clone' ? `URL${repo.url ? ` · ${repo.url}` : ''}` : 'Zip upload'}</dd>
        </div>
        <div>
          <dt>Commits</dt>
          <dd>{transient ? '…' : fmtCount(repo.commits)}</dd>
        </div>
        <div>
          <dt>HEAD</dt>
          <dd className="mono">{repo.head ? repo.head.slice(0, 10) : '—'}</dd>
        </div>
        <div>
          <dt>Last commit</dt>
          <dd>{repo.lastCommitTs ? fmtDate(repo.lastCommitTs * 1000) : '—'}</dd>
        </div>
      </dl>

      <div className="repo-actions">
        <button onClick={onOpen} disabled={repo.status !== 'ready'}>
          Open dashboard
        </button>
        <button className="danger" onClick={handleDelete} disabled={transient}>
          Remove
        </button>
      </div>
    </article>
  );
}
