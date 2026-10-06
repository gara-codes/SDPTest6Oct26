import { useEffect, useState } from 'react';

const roadmap = [
  ['Repository ingestion', 'clone a remote URL or upload a zip of a repo'],
  ['Metric engine', 'file, directory, repository, commit-set and author metrics'],
  ['Dashboard', 'charts, tables and filters: author, path, time range, commits'],
  ['Author merging', 'via .mailmap and manual identity merging'],
];

export default function App() {
  const [api, setApi] = useState('checking');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/health')
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setApi(d.ok ? 'online' : 'unexpected');
      })
      .catch(() => {
        if (!cancelled) setApi('offline');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="shell">
      <header>
        <h1>RAT</h1>
        <p className="tagline">Repo Analysis Tool</p>
      </header>

      <section className="card">
        <h2>Scaffold is up</h2>
        <p>The dashboard shell and API are running. Features land here one at a time:</p>
        <ul className="roadmap">
          {roadmap.map(([title, note]) => (
            <li key={title}>
              <strong>{title}</strong>
              <span>{note}</span>
            </li>
          ))}
        </ul>
        <p className="api-line">
          API status: <span className={`status ${api}`}>{api}</span>
        </p>
      </section>
    </main>
  );
}
