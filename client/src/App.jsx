import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import AddRepoPanel from './components/AddRepoPanel.jsx';
import RepoCard from './components/RepoCard.jsx';
import RepoView from './components/RepoView.jsx';

export default function App() {
  const [repos, setRepos] = useState(null); // null while loading
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null); // repo entry being viewed
  const busyRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const data = await api.listRepos();
      setRepos(data.repos);
      setError(null);
      busyRef.current = data.repos.some((r) => r.status === 'cloning' || r.status === 'extracting');
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Poll only while an ingest job is in flight.
  useEffect(() => {
    const timer = setInterval(() => {
      if (busyRef.current) refresh();
    }, 1500);
    return () => clearInterval(timer);
  }, [refresh]);

  if (selected) {
    return <RepoView repo={selected} onExit={() => { setSelected(null); refresh(); }} />;
  }

  return (
    <main className="shell wide">
      <header>
        <h1>RAT</h1>
        <p className="tagline">Repo Analysis Tool</p>
      </header>

      <AddRepoPanel onAdded={refresh} />

      {error && <div className="banner error">{error}</div>}

      {repos === null && !error && <p className="muted">Loading repositories…</p>}

      {repos !== null && repos.length === 0 && (
        <section className="card empty">
          <h2>No repositories yet</h2>
          <p>Clone one from a URL or upload a zip above to get started.</p>
        </section>
      )}

      {repos !== null && repos.length > 0 && (
        <section className="repo-grid">
          {repos.map((repo) => (
            <RepoCard key={repo.id} repo={repo} onChanged={refresh} onOpen={() => setSelected(repo)} />
          ))}
        </section>
      )}
    </main>
  );
}
