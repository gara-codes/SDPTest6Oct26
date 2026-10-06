import { useState } from 'react';
import { api } from '../api.js';

export default function AddRepoPanel({ onAdded }) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(null); // 'clone' | 'upload' | null
  const [error, setError] = useState(null);

  async function handleClone(event) {
    event.preventDefault();
    const target = url.trim();
    if (!target) return;
    setBusy('clone');
    setError(null);
    try {
      await api.cloneRepo(target);
      setUrl('');
      onAdded();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  async function handleFile(event) {
    const file = event.target.files?.[0];
    event.target.value = ''; // allow re-selecting the same file
    if (!file) return;
    setBusy('upload');
    setError(null);
    try {
      await api.uploadRepo(file);
      onAdded();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="card add-panel">
      <div className="add-col">
        <h2>Clone from URL</h2>
        <form className="add-form" onSubmit={handleClone}>
          <input
            type="text"
            placeholder="https://github.com/user/repo.git"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={busy !== null}
          />
          <button type="submit" disabled={busy !== null || !url.trim()}>
            {busy === 'clone' ? 'Cloning…' : 'Clone'}
          </button>
        </form>
        <p className="hint">Full (non-shallow) clone via git.</p>
      </div>

      <div className="divider" />

      <div className="add-col">
        <h2>Upload zip</h2>
        <label className={`upload-label ${busy !== null ? 'disabled' : ''}`}>
          <input type="file" accept=".zip" hidden onChange={handleFile} disabled={busy !== null} />
          {busy === 'upload' ? 'Extracting…' : 'Choose .zip (with .git inside)'}
        </label>
        <p className="hint">A zip of the repository including its .git directory.</p>
      </div>

      {error && <div className="banner error">{error}</div>}
    </section>
  );
}
