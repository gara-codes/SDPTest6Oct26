async function jsonOrThrow(res) {
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    throw new Error(body?.error?.message || `request failed (HTTP ${res.status})`);
  }
  return body;
}

export const api = {
  listRepos: () => fetch('/api/repos').then(jsonOrThrow),

  cloneRepo: (url) =>
    fetch('/api/repos/clone', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url }),
    }).then(jsonOrThrow),

  uploadRepo: (file) => {
    const form = new FormData();
    form.append('zip', file);
    return fetch('/api/repos/upload', { method: 'POST', body: form }).then(jsonOrThrow);
  },

  deleteRepo: (id) => fetch(`/api/repos/${encodeURIComponent(id)}`, { method: 'DELETE' }).then(jsonOrThrow),

  getMetrics: (id, params = {}) => {
    // Large explicit commit selections go in a POST body to avoid URL length limits.
    if (Array.isArray(params.commits)) {
      return fetch(`/api/repos/${encodeURIComponent(id)}/metrics`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(params),
      }).then(jsonOrThrow);
    }
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') q.set(k, v);
    });
    const qs = q.toString();
    return fetch(`/api/repos/${encodeURIComponent(id)}/metrics${qs ? `?${qs}` : ''}`).then(jsonOrThrow);
  },

  getAuthors: (id) => fetch(`/api/repos/${encodeURIComponent(id)}/authors`).then(jsonOrThrow),

  getCommits: (id, params = {}) => {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') q.set(k, v);
    });
    const qs = q.toString();
    return fetch(`/api/repos/${encodeURIComponent(id)}/commits${qs ? `?${qs}` : ''}`).then(jsonOrThrow);
  },

  mergeAuthors: (id, members) =>
    fetch(`/api/repos/${encodeURIComponent(id)}/authors/merge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ members }),
    }).then(jsonOrThrow),

  unmergeAuthors: (id, member) =>
    fetch(`/api/repos/${encodeURIComponent(id)}/authors/unmerge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ member }),
    }).then(jsonOrThrow),
};
